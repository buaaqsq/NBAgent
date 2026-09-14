import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, isAbsolute } from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Namespace } from "../ns.js";

export interface NsState {
  catalog: Namespace[];
  active: Namespace | null;
  refresh(): void;
  activate(name: string | null): Promise<string>;
}

function requireActive(state: NsState): Namespace {
  if (!state.active) throw new Error("no active namespace — call ns_activate first");
  return state.active;
}

export function guardInside(base: string, target: string): string {
  const baseAbs = resolve(base);
  const abs = resolve(baseAbs, target);
  const rel = relative(baseAbs, abs);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes namespace dir: ${target}`);
  return abs;
}

const KB_EXTENSIONS = [".md", ".yaml", ".json", ".csv"];

function walkKnowledge(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith(".") || entry === "INDEX.md") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkKnowledge(full));
    else if (KB_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

function grepSearch(knowledgeDir: string, query: string): string {
  const q = query.toLowerCase();
  const results: string[] = [];
  for (const file of walkKnowledge(knowledgeDir)) {
    const content = readFileSync(file, "utf-8");
    const lower = content.toLowerCase();
    let from = 0;
    let count = 0;
    while (count < 3) {
      const idx = lower.indexOf(q, from);
      if (idx === -1) break;
      const start = Math.max(0, idx - 80);
      const end = Math.min(content.length, idx + q.length + 120);
      const excerpt = content.slice(start, end).replace(/\n/g, " ");
      results.push(`### ${relative(knowledgeDir, file)}${count > 0 ? ` (match ${count + 1})` : ""}\n...${excerpt}...`);
      from = idx + q.length;
      count++;
    }
  }
  return results.length > 0 ? results.join("\n\n") : "(no results)";
}

function fts5Search(root: string, nsDir: string, query: string): string {
  const script = join(root, "scripts", "kb_search.py");
  try {
    const result = spawnSync("python3", [script, query], {
      cwd: nsDir,
      encoding: "utf-8",
      timeout: 15000,
    });
    if (result.status !== 0 || !result.stdout) {
      return grepSearch(join(nsDir, "knowledge"), query);
    }
    return result.stdout;
  } catch {
    return grepSearch(join(nsDir, "knowledge"), query);
  }
}

export function nsTools(state: NsState, root: string): AgentTool[] {
  const ns_list: AgentTool = {
    name: "ns_list",
    label: "NS list",
    description: "List all discoverable namespaces with owner and status.",
    parameters: Type.Object({}),
    async execute() {
      state.refresh();
      const lines = state.catalog.map(
        (ns) =>
          `${ns.manifest.name === state.active?.manifest.name ? "*" : " "} ${ns.manifest.name} [${ns.source}] owner=${ns.manifest.owner} skills=${ns.skills.length} mcp=${Object.keys(ns.mcpServers).length}`
      );
      return { content: [{ type: "text", text: lines.join("\n") || "(empty)" }], details: {} };
    },
  };

  const ns_activate: AgentTool = {
    name: "ns_activate",
    label: "NS activate",
    description: "Activate a namespace for this session: loads its manifest, knowledge index, SOP list, connects its MCP servers, applies its model preference. Pass null to deactivate.",
    parameters: Type.Object({ name: Type.Optional(Type.String({ description: "namespace name, or omit/null to deactivate" })) }),
    async execute(_id, raw: unknown) {
      const params = raw as { name?: string };
      const summary = await state.activate(params.name ?? null);
      return { content: [{ type: "text", text: summary }], details: {} };
    },
  };

  const ns_knowledge: AgentTool = {
    name: "ns_knowledge",
    label: "NS knowledge",
    description: "Read a knowledge entry of the active namespace, relative to its knowledge/ dir (see the injected knowledge index).",
    parameters: Type.Object({ path: Type.String({ description: "path relative to knowledge/, e.g. structured/rules.yaml" }) }),
    async execute(_id, raw: unknown) {
      const params = raw as { path: string };
      const ns = requireActive(state);
      const abs = guardInside(join(ns.dir, "knowledge"), params.path);
      const text = readFileSync(abs, "utf-8");
      return { content: [{ type: "text", text }], details: { path: abs } };
    },
  };

  const ns_knowledge_search: AgentTool = {
    name: "ns_knowledge_search",
    label: "NS knowledge search",
    description: "Full-text search across the active namespace's knowledge/ directory. Strategy depends on the NS's knowledge.search config (default: grep).",
    parameters: Type.Object({ query: Type.String({ description: "search query" }) }),
    async execute(_id, raw: unknown) {
      const params = raw as { query: string };
      const ns = requireActive(state);
      const knowledgeDir = join(ns.dir, "knowledge");
      const strategy = ns.manifest.knowledge?.search ?? "grep";
      if (strategy === "none") {
        return { content: [{ type: "text", text: "knowledge search disabled (knowledge.search: none)" }], details: {} };
      }
      if (!params.query) {
        return { content: [{ type: "text", text: "(no query)" }], details: {} };
      }
      const text = strategy === "fts5"
        ? fts5Search(root, ns.dir, params.query)
        : grepSearch(knowledgeDir, params.query);
      return { content: [{ type: "text", text }], details: { strategy } };
    },
  };

  const ns_skill: AgentTool = {
    name: "ns_skill",
    label: "NS skill",
    description: "Load the full SOP flow (SKILL.md body) of the active namespace by skill name.",
    parameters: Type.Object({ name: Type.String({ description: "skill name from the active NS skill list" }) }),
    async execute(_id, raw: unknown) {
      const params = raw as { name: string };
      const ns = requireActive(state);
      const skill = ns.skills.find((s) => s.name === params.name);
      if (!skill) throw new Error(`skill not found in ${ns.manifest.name}: ${params.name} (have: ${ns.skills.map((s) => s.name).join(", ")})`);
      return { content: [{ type: "text", text: readFileSync(skill.path, "utf-8") }], details: { path: skill.path } };
    },
  };

  const ns_tool: AgentTool = {
    name: "ns_tool",
    label: "NS tool",
    description: "Run a deterministic script from the active namespace's tools/ dir, with the NS context as cwd.",
    parameters: Type.Object({
      tool: Type.String({ description: "file name inside tools/" }),
      args: Type.Optional(Type.String({ description: "argument string appended to the command" })),
    }),
    async execute(_id, raw: unknown, signal?: AbortSignal) {
      const params = raw as { tool: string; args?: string };
      const ns = requireActive(state);
      if (!ns.tools.includes(params.tool)) throw new Error(`tool not in ${ns.manifest.name}/tools: ${params.tool} (have: ${ns.tools.join(", ") || "none"})`);
      const script = guardInside(join(ns.dir, "tools"), params.tool);
      const cmd = `"${script}"${params.args ? ` ${params.args}` : ""}`;
      const output = await new Promise<string>((res, rej) => {
        const child = spawn(cmd, { shell: true, cwd: ns.contextDir, env: process.env });
        let buf = "";
        child.stdout.on("data", (d: Buffer) => (buf += d.toString()));
        child.stderr.on("data", (d: Buffer) => (buf += d.toString()));
        signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
        child.on("error", rej);
        child.on("close", (code) => res(`[exit ${code}]\n${buf}`));
      });
      return { content: [{ type: "text", text: output }], details: { script } };
    },
  };

  return [ns_list, ns_activate, ns_knowledge, ns_knowledge_search, ns_skill, ns_tool];
}
