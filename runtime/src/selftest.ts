import assert from "node:assert";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { discoverCatalog, parseFrontmatter } from "./ns.js";
import { buildActivePrompt } from "./prompt.js";
import { coreTools } from "./tools/core.js";
import { guardInside, nsTools, type NsState } from "./tools/ns.js";
import { readUsage, UsageTracker } from "./usage.js";
import { subVars } from "./mcp.js";

const REAL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function exec(t: AgentTool, params: Record<string, unknown>): Promise<string> {
  const res = await t.execute("t1", params, undefined, undefined);
  const first = res.content.find((c: { type: string }) => c.type === "text") as { text: string };
  return first.text;
}

// hermetic fixture root — selftest must pass on a fresh clone (namespaces/ is gitignored)
const root = mkdtempSync(join(tmpdir(), "ns-agent-selftest-"));
const nsDir = join(root, "examples", "fixture-ns");
const write = (rel: string, content: string) => {
  const p = join(nsDir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf-8");
};
mkdirSync(join(root, "biz"), { recursive: true });
write("NS.yaml", "name: fixture-ns\ndescription: selftest fixture.\nowner: tester\ncontext: biz\nacceptance: acceptance/criteria.md\n");
write("acceptance/criteria.md", "criteria");
write("skills/demo-flow/SKILL.md", "---\nname: demo-flow\ndescription: demo.\n---\n# SOP\n");
write("knowledge/INDEX.md", "- structured/rules.yaml: 缺失值规则\n");
write("knowledge/structured/rules.yaml", "rules:\n  - 金额缺失时标记 unknown\n");
write("tools/hello.sh", '#!/bin/sh\necho "hello $1"\n');
chmodSync(join(nsDir, "tools", "hello.sh"), 0o755);

let passed = 0;
const total = 13;

const catalog = discoverCatalog(root);
const fixture = catalog.find((n) => n.manifest.name === "fixture-ns");
assert.ok(fixture, "discoverCatalog finds fixture NS");
assert.equal(fixture.contextDir, resolve(root, "biz"), "relative context resolves against root");
passed++;

const fm = parseFrontmatter(readFileSync(fixture.skills[0].path, "utf-8"));
assert.ok(fm && fm.name === "demo-flow", "skill frontmatter parses");
passed++;

const prompt = buildActivePrompt(catalog, fixture);
assert.ok(prompt.includes("ACTIVE NS: fixture-ns"), "active prompt names the NS");
assert.ok(prompt.includes(fixture.contextDir), "active prompt carries working root");
assert.ok(prompt.includes("demo-flow"), "active prompt lists skills");
assert.ok(prompt.includes("rules.yaml"), "active prompt carries knowledge index");
passed++;

const state: NsState = { catalog, active: fixture, refresh: () => {}, activate: async () => "not used in selftest" };
const nsT = nsTools(state, root);

const knowledgeTool = nsT.find((t) => t.name === "ns_knowledge")!;
await assert.rejects(() => knowledgeTool.execute("t1", { path: "../../NS.yaml" }, undefined, undefined), /escapes/, "knowledge path traversal blocked");
passed++;

const searchResult = await exec(nsT.find((t) => t.name === "ns_knowledge_search")!, { query: "金额" });
assert.ok(!searchResult.includes("(no results)") && searchResult.includes("rules.yaml"), "knowledge search covers structured yaml");
passed++;

const listText = await exec(nsT.find((t) => t.name === "ns_list")!, {});
assert.ok(listText.includes("fixture-ns") && listText.includes("*"), "ns_list marks active NS");
const toolGuard = nsT.find((t) => t.name === "ns_tool")!;
await assert.rejects(() => toolGuard.execute("t1", { tool: "rm -rf" }, undefined, undefined), /not in/, "ns_tool rejects unknown script");
passed++;

const toolOut = await exec(toolGuard, { tool: "hello.sh", args: "world" });
assert.ok(toolOut.includes("[exit 0]") && toolOut.includes("hello world"), "ns_tool runs whitelisted script with args");
passed++;

const usageDir = mkdtempSync(join(tmpdir(), "ns-agent-usage-"));
const tracker = new UsageTracker(() => usageDir, () => "test-ns");
tracker.record("tokens", { input: 10, output: 5 });
const line = JSON.parse(readFileSync(join(usageDir, ".usage.jsonl"), "utf-8").trim());
assert.equal(line.ns, "test-ns");
assert.equal(line.kind, "tokens");
passed++;

mkdirSync(join(usageDir, "ctx"), { recursive: true });
writeFileSync(join(usageDir, "ctx", "hello.txt"), "world");
const readTool = coreTools({ cwd: () => join(usageDir, "ctx") }).find((t) => t.name === "read")!;
assert.equal(await exec(readTool, { path: "hello.txt" }), "world", "read resolves against ctx cwd");
passed++;

assert.deepEqual(readUsage({ usage: { input: 5, output: 7, cost: { total: 0.1 } } }), { input: 5, output: 7, costTotal: 0.1 });
assert.deepEqual(readUsage({ usage: { input_tokens: 3, output_tokens: 4 } }), { input: 3, output: 4, costTotal: undefined });
assert.equal(readUsage({ usage: {} }), null);
assert.equal(readUsage({}), null);
passed++;

assert.equal(subVars("npx -y server {context}".split(" ").pop()!, { "{context}": "/abs/ctx" }), "/abs/ctx");
assert.deepEqual(
  ["{nsDir}/tools", "{context}"].map((s) => subVars(s, { "{nsDir}": "/ns", "{context}": "/ctx" })),
  ["/ns/tools", "/ctx"]
);
assert.equal(subVars("no-vars", { "{context}": "/ctx" }), "no-vars");
passed++;

const guardRoot = mkdtempSync(join(tmpdir(), "ns-agent-guard-"));
mkdirSync(join(guardRoot, "knowledge"));
mkdirSync(join(guardRoot, "knowledge-evil"));
assert.throws(() => guardInside(join(guardRoot, "knowledge"), "../knowledge-evil/secret"), /escapes/, "sibling-prefix escape must be blocked");
assert.throws(() => guardInside(join(guardRoot, "knowledge"), ".."), /escapes/, "parent dir must be blocked");
assert.throws(() => guardInside(join(guardRoot, "knowledge"), "/etc/passwd"), /escapes/, "absolute path must be blocked");
assert.ok(guardInside(join(guardRoot, "knowledge"), "structured/rules.yaml").endsWith("rules.yaml"), "legit relative path passes");
passed++;

// committed examples/ must load on a fresh clone (namespaces/ is private and may be absent)
const invoice = discoverCatalog(REAL_ROOT).find((n) => n.manifest.name === "invoice-helper");
assert.ok(invoice, "invoice-helper example discoverable");
assert.equal(invoice.contextDir, resolve(REAL_ROOT, "examples/invoice-helper/context"), "example relative context resolves");
passed++;

console.log(`selftest: ${passed}/${total} passed`);
