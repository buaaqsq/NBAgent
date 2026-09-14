import { join } from "node:path";
import type { Namespace } from "./ns.js";

const IDENTITY = `You are ns-agent, a namespace-based AI agent runtime.`;

const RULES = `A namespace (NS) is a business delivery unit bundling: SOP flows (skills), a knowledge base, deterministic tools, MCP bindings, acceptance criteria, and a named owner accountable for accuracy.

Operating rules:
- At start only the NS catalog is in context. Before doing real work for a business domain, activate its namespace via ns_activate.
- After activation, the NS context dir is your working root: resolve relative paths for read/write/bash against it (use absolute paths when the harness cwd differs).
- Load lazily: ns_knowledge for knowledge entries, ns_skill for a full SOP flow, ns_tool for deterministic scripts.
- Respect the active NS boundaries. When its acceptance criteria demand a human, stop and say so.`;

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function buildNsBlock(catalog: Namespace[], active: Namespace | null): string {
  const lines = catalog.map(
    (ns) =>
      `- ${ns.manifest.name}: ${oneLine(ns.manifest.description)} [owner=${ns.manifest.owner}${
        ns.manifest.requires?.mcp ? ", requires-mcp" : ""
      }]`
  );
  let block = `${RULES}\n\n## NS catalog (activate with ns_activate)\n${lines.join("\n") || "(no namespaces found)"}`;
  if (!active) return block;
  const m = active.manifest;
  const skills =
    active.skills.map((s) => `  - ${s.name}: ${oneLine(s.description)} (load full flow via ns_skill)`).join("\n") ||
    "  (none)";
  const mcp = Object.keys(active.mcpServers);
  block += `

## ACTIVE NS: ${m.name}
Working root (context): ${active.contextDir}
Owner: ${m.owner}
Acceptance criteria: ${join(active.dir, m.acceptance)} (read it before declaring done)
${m.boundaries ? `Boundaries: ${oneLine(m.boundaries)}\n` : ""}Skills (SOP flows):
${skills}
Knowledge: ${active.knowledgeIndex ? "index below; fetch entries via ns_knowledge, search via ns_knowledge_search" : "(none)"}
Knowledge search: ${m.knowledge?.search ?? "grep"}${m.knowledge?.search === "fts5" ? " (FTS5 + CJK, BM25 ranked)" : m.knowledge?.search === "none" ? " (disabled)" : " (substring match)"}
Deterministic tools: ${active.tools.length ? active.tools.join(", ") + " (run via ns_tool)" : "(none)"}
MCP servers: ${mcp.length ? mcp.join(", ") + " (their tools are exposed as mcp__<server>__<tool>)" : "(none)"}
${active.knowledgeIndex ? `\n### Knowledge index\n${active.knowledgeIndex}\n` : ""}`;
  return block;
}

export function buildCatalogPrompt(catalog: Namespace[]): string {
  return `${IDENTITY}\n${buildNsBlock(catalog, null)}`;
}

export function buildActivePrompt(catalog: Namespace[], active: Namespace | null): string {
  return `${IDENTITY}\n${buildNsBlock(catalog, active)}`;
}
