import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// jiti resolves relative imports from the symlinked location; realpath + absolute
// file URLs make the extension work when symlinked into ~/.pi/agent/extensions/
const HERE = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
const REAL_HERE = realpathSync(HERE);
const dist = (name: string) => pathToFileURL(join(REAL_HERE, "..", "runtime", "dist", name)).href;

function findRoot(pkgRoot: string, flagVal?: string): string | null {
  if (flagVal && flagVal !== "true") return resolve(flagVal);
  if (process.env.NS_AGENT_ROOT) return resolve(process.env.NS_AGENT_ROOT);
  if (existsSync(join(pkgRoot, "namespaces")) || existsSync(join(pkgRoot, "examples"))) return pkgRoot;
  let cur = process.cwd();
  for (;;) {
    if (existsSync(join(cur, "namespaces")) || existsSync(join(cur, "examples"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export default async function (pi: ExtensionAPI) {
  const { discoverCatalog } = await import(dist("ns.js"));
  const { buildNsBlock } = await import(dist("prompt.js"));
  const { McpManager } = await import(dist("mcp.js"));
  const { UsageTracker, readUsage } = await import(dist("usage.js"));
  const { nsTools } = await import(dist("tools/ns.js"));

  const PKG_ROOT = resolve(REAL_HERE, "..");

  pi.registerFlag("ns-agent-root", { type: "string", description: "NS-Agent repo root (dir containing namespaces/)" });
  pi.registerFlag("ns", { type: "string", description: "Activate this namespace at startup" });

  let root = findRoot(PKG_ROOT, String(pi.getFlag("ns-agent-root") ?? ""));
  const loadWarnings: string[] = [];
  let catalog = root ? discoverCatalog(root, loadWarnings) : [];
  let active = null;
  const mcp = new McpManager();
  const usage = new UsageTracker(
    () => active?.dir ?? null,
    () => active?.manifest.name ?? null
  );

  const state = {
    catalog,
    active,
    refresh: () => {
      if (!root) root = findRoot(PKG_ROOT);
      if (!root) return;
      catalog = discoverCatalog(root, loadWarnings);
      state.catalog = catalog;
      if (active && !catalog.some((n) => n.manifest.name === active?.manifest.name)) {
        active = null;
        state.active = null;
      }
    },
    activate: (name) => activate(name),
  };

  async function activate(name) {
    await mcp.disconnectAll();
    if (name === null) {
      active = null;
      state.active = null;
      return "namespace deactivated";
    }
    state.refresh();
    if (!root) throw new Error("no NS-Agent root found — set NS_AGENT_ROOT or pass --ns-agent-root");
    const ns = catalog.find((n) => n.manifest.name === name);
    if (!ns) throw new Error(`namespace not found: ${name} (catalog: ${catalog.map((n) => n.manifest.name).join(", ") || "empty"})`);
    active = ns;
    state.active = ns;
    // pi 0.74 has no unregisterTool: tools of previously connected MCP servers stay registered
    // but their clients are closed — calling them yields a clear error instead of stale access
    const { tools: mcpTools, notes } = await mcp.connect(ns.mcpServers, {
      "{nsDir}": ns.dir,
      "{context}": ns.contextDir,
    });
    for (const t of mcpTools) pi.registerTool(t);
    usage.record("activate", { mcp: notes });
    return [
      `activated ${ns.manifest.name}`,
      `working root: ${ns.contextDir}`,
      `skills: ${ns.skills.map((s) => s.name).join(", ") || "none"}`,
      notes.join("; ") || "mcp: none declared",
    ].join("\n");
  }

  for (const t of nsTools(state, root ?? PKG_ROOT)) pi.registerTool(t);

  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${buildNsBlock(catalog, active)}`,
  }));

  pi.on("resources_discover", async () => ({
    skillPaths: catalog.map((ns) => join(ns.dir, "skills")).filter((p) => existsSync(p)),
  }));

  pi.on("session_start", async (_event, ctx) => {
    for (const w of loadWarnings) ctx.ui.notify(`ns-agent: ${w}`, "warning");
    const nsFlag = String(pi.getFlag("ns") ?? "");
    if (nsFlag && nsFlag !== "true") {
      try {
        ctx.ui.notify(`ns-agent: ${await activate(nsFlag)}`, "info");
      } catch (e) {
        ctx.ui.notify(`ns-agent activate failed: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    }
  });

  pi.on("tool_execution_end", async (event) => {
    if (event.toolName.startsWith("ns_") || event.toolName.startsWith("mcp__")) {
      usage.record("tool", { tool: event.toolName, isError: event.isError });
    }
  });

  pi.on("message_end", async (event) => {
    const u = readUsage(event.message);
    if (u) usage.record("tokens", u);
  });

  pi.registerCommand("ns", {
    description: "NS-Agent namespaces: /ns · /ns use <name> · /ns off · /ns status",
    handler: async (args, ctx) => {
      const a = args.trim();
      const say = (text) => pi.sendMessage({ customType: "ns-agent", content: text, display: true, details: {} });
      try {
        if (!a) {
          state.refresh();
          const lines = catalog.map(
            (ns) =>
              `${ns.manifest.name === active?.manifest.name ? "*" : " "} ${ns.manifest.name} [${ns.source}] owner=${ns.manifest.owner} skills=${ns.skills.map((s) => s.name).join("|") || "-"}`
          );
          say(lines.length ? `NS-Agent root: ${root}\n${lines.join("\n")}` : `no namespaces under ${root}`);
          return;
        }
        if (a.startsWith("use ")) {
          say(await activate(a.slice(4).trim()));
          return;
        }
        if (a === "off") {
          say(await activate(null));
          return;
        }
        if (a === "status") {
          say(
            [
              `root: ${root}`,
              `active: ${active?.manifest.name ?? "(none)"}`,
              active ? `working root: ${active.contextDir}` : "",
              active ? `mcp connected: ${mcp.status().join(", ") || "none"}` : "",
            ].filter(Boolean).join("\n")
          );
          return;
        }
        say(`unknown: /ns ${a}\nusage: /ns · /ns use <name> · /ns off · /ns status`);
      } catch (e) {
        ctx.ui.notify(`ns-agent: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    },
  });
}
