import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import {
  bailianProvider,
  qwenTokenPlanCnProvider,
  qwenTokenPlanProvider,
  qwenTokenPlanIndividualProvider,
} from "./providers/bailian.js";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { discoverCatalog, type Namespace } from "./ns.js";
import { buildActivePrompt, buildCatalogPrompt } from "./prompt.js";
import { coreTools } from "./tools/core.js";
import { nsTools, type NsState } from "./tools/ns.js";
import { McpManager } from "./mcp.js";
import { readUsage, UsageTracker } from "./usage.js";

export interface NsAgentRuntimeOptions {
  root: string;
  model?: string;
  onText?: (delta: string) => void;
  onToolEvent?: (line: string) => void;
}

const MODEL_FALLBACKS = [
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5",
  "google/gemini-2.5-pro",
];

const PROVIDER_KEY_ENVS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY", "AZURE_OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  bailian: ["DASHSCOPE_API_KEY", "BAILIAN_API_KEY"],
  "qwen-token-plan-cn": ["QWEN_TOKEN_PLAN_CN_API_KEY"],
  "qwen-token-plan": ["QWEN_TOKEN_PLAN_API_KEY"],
  "qwen-token-plan-individual": ["QWEN_TOKEN_PLAN_API_KEY"],
};

function providerKeyPresent(providerId: string): boolean {
  const envs = PROVIDER_KEY_ENVS[providerId];
  return envs ? envs.some((k) => process.env[k]) : false;
}

export class NsAgentRuntime {
  catalog: Namespace[] = [];
  active: Namespace | null = null;
  loadWarnings: string[] = [];
  readonly root: string;
  readonly agent: Agent;
  readonly mcp = new McpManager();
  readonly usage: UsageTracker;
  private baseTools: AgentTool[];
  private models = createModels();
  private defaultModelSpec = "";
  modelName = "";

  constructor(opts: NsAgentRuntimeOptions) {
    this.root = opts.root;
    this.catalog = discoverCatalog(this.root, this.loadWarnings);
    this.usage = new UsageTracker(
      () => this.active?.dir ?? null,
      () => this.active?.manifest.name ?? null
    );

    this.models.setProvider(anthropicProvider());
    this.models.setProvider(openaiProvider());
    this.models.setProvider(googleProvider());
    this.models.setProvider(bailianProvider());
    this.models.setProvider(qwenTokenPlanCnProvider());
    this.models.setProvider(qwenTokenPlanProvider());
    this.models.setProvider(qwenTokenPlanIndividualProvider());

    const model = this.resolveModel(opts.model);
    this.modelName = `${model.provider}/${model.id}`;
    this.defaultModelSpec = this.modelName;

    const state: NsState = {
      catalog: this.catalog,
      active: null,
      refresh: () => {
        this.loadWarnings = [];
        this.catalog = discoverCatalog(this.root, this.loadWarnings);
        state.catalog = this.catalog;
        if (this.active && !this.catalog.some((ns) => ns.manifest.name === this.active?.manifest.name)) {
          this.active = null;
          state.active = null;
        }
        this.rebuildPrompt();
      },
      activate: (name) => this.activate(name),
    };

    this.baseTools = [
      ...coreTools({ cwd: () => this.active?.contextDir ?? process.cwd() }),
      ...nsTools(state, this.root),
    ];

    this.agent = new Agent({
      initialState: {
        systemPrompt: buildCatalogPrompt(this.catalog),
        model,
        tools: this.baseTools,
      },
      streamFn: this.models.streamSimple.bind(this.models),
    });

    Object.defineProperty(state, "active", {
      get: () => this.active,
      set: (v: Namespace | null) => {
        this.active = v;
      },
      enumerable: true,
    });

    this.agent.subscribe(async (event) => {
      const ev = event as { type: string; [k: string]: unknown };
      if (ev.type === "message_update" && opts.onText) {
        const me = ev.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (me?.type === "text_delta" && typeof me.delta === "string") opts.onText(me.delta);
      } else if (ev.type === "tool_execution_start" && opts.onToolEvent) {
        opts.onToolEvent(`[tool] ${String(ev.toolName)}`);
      } else if (ev.type === "tool_execution_end") {
        this.usage.record("tool", { tool: String(ev.toolName), isError: Boolean(ev.isError) });
      } else if (ev.type === "message_end") {
        const u = readUsage(ev.message);
        if (u) this.usage.record("tokens", { model: this.modelName, ...u });
      }
    });
  }

  private resolveModel(spec?: string) {
    const explicit = [spec, process.env.NS_AGENT_MODEL].filter(Boolean) as string[];
    const keyed = MODEL_FALLBACKS.filter((s) => providerKeyPresent(s.slice(0, s.indexOf("/"))));
    for (const c of [...explicit, ...keyed]) {
      const slash = c.indexOf("/");
      if (slash === -1) continue;
      const m = this.models.getModel(c.slice(0, slash), c.slice(slash + 1));
      if (m) return m;
    }
    for (const pid of Object.keys(PROVIDER_KEY_ENVS)) {
      if (!providerKeyPresent(pid)) continue;
      const first = this.models.getProvider(pid)?.getModels()[0];
      if (first) return first;
    }
    for (const c of MODEL_FALLBACKS) {
      const slash = c.indexOf("/");
      const m = this.models.getModel(c.slice(0, slash), c.slice(slash + 1));
      if (m) return m;
    }
    throw new Error(
      `no usable model. Set --model <provider>/<id> or NS_AGENT_MODEL, and export a provider API key (anthropic/openai/google/bailian/qwen-token-plan*)`
    );
  }

  private applyModel(ns: Namespace | null): string {
    if (ns?.manifest.model) {
      const pref = this.models.getModel(ns.manifest.model.provider, ns.manifest.model.id);
      if (!pref) return `model preference ${ns.manifest.model.provider}/${ns.manifest.model.id} unavailable, kept ${this.modelName}`;
      this.agent.state.model = pref;
      this.modelName = `${pref.provider}/${pref.id}`;
      return `model switched to ${this.modelName}`;
    }
    const slash = this.defaultModelSpec.indexOf("/");
    const fallback = this.models.getModel(this.defaultModelSpec.slice(0, slash), this.defaultModelSpec.slice(slash + 1));
    if (fallback && this.modelName !== this.defaultModelSpec) {
      this.agent.state.model = fallback;
      this.modelName = this.defaultModelSpec;
      return `model restored to ${this.modelName}`;
    }
    return "";
  }

  private rebuildPrompt(): void {
    this.agent.state.systemPrompt = buildActivePrompt(this.catalog, this.active);
  }

  async activate(name: string | null): Promise<string> {
    await this.mcp.disconnectAll();
    if (name === null) {
      this.active = null;
      this.agent.state.tools = this.baseTools;
      const note = this.applyModel(null);
      this.rebuildPrompt();
      return ["namespace deactivated", note].filter(Boolean).join("\n");
    }
    const ns = this.catalog.find((n) => n.manifest.name === name);
    if (!ns) throw new Error(`namespace not found: ${name} (catalog: ${this.catalog.map((n) => n.manifest.name).join(", ") || "empty"})`);

    this.active = ns;
    const { tools: mcpTools, notes } = await this.mcp.connect(ns.mcpServers, {
      "{nsDir}": ns.dir,
      "{context}": ns.contextDir,
    });
    this.agent.state.tools = [...this.baseTools, ...mcpTools];

    let modelNote = this.applyModel(ns);
    this.rebuildPrompt();
    this.usage.record("activate", { mcp: notes });
    return [
      `activated ${ns.manifest.name}`,
      `working root: ${ns.contextDir}`,
      `skills: ${ns.skills.map((s) => s.name).join(", ") || "none"}`,
      notes.join("; ") || "mcp: none declared",
      modelNote,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async prompt(text: string): Promise<void> {
    await this.agent.prompt(text);
  }

  status(): string {
    return [
      `root: ${this.root}`,
      `model: ${this.modelName}`,
      `active ns: ${this.active?.manifest.name ?? "(none)"}`,
      this.active ? `working root: ${this.active.contextDir}` : "",
      this.active ? `mcp connected: ${this.mcp.status().join(", ") || "none"}` : "",
      `catalog: ${this.catalog.map((n) => n.manifest.name).join(", ") || "empty"}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async shutdown(): Promise<void> {
    await this.mcp.disconnectAll();
  }
}
