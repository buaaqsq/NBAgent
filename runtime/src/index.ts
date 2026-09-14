#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NsAgentRuntime } from "./agent.js";

function findRoot(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.NS_AGENT_ROOT) return resolve(process.env.NS_AGENT_ROOT);
  const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  if (existsSync(join(pkgRoot, "namespaces")) || existsSync(join(pkgRoot, "examples"))) return pkgRoot;
  let cur = process.cwd();
  for (;;) {
    if (existsSync(join(cur, "namespaces")) || existsSync(join(cur, "examples"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error("no NS-Agent root found (a dir containing namespaces/ or examples/). Pass --root or set NS_AGENT_ROOT");
}

function parseArgs(argv: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`ns-agent — namespace-based agent runtime

usage: ns-agent [--root <ns-agent-repo>] [--ns <name>] [--model <provider/id>] [--prompt <text>]

  --root     ns-agent repo (dir containing namespaces/); default: $NS_AGENT_ROOT, package root, or nearest ancestor
  --ns       activate this namespace at startup
  --model    provider/id (anthropic|openai|google|bailian|qwen-token-plan-cn|qwen-token-plan); default: $NS_AGENT_MODEL, then the first provider whose API key env is set
  --prompt   one-shot mode: run prompt and exit (no REPL)

REPL commands: /ns  /ns use <name>  /ns off  /status  /help  /exit`);
    return;
  }

  const root = findRoot(args.root);
  let firstText = true;
  const runtime = new NsAgentRuntime({
    root,
    model: args.model,
    onText: (d) => {
      if (firstText) {
        firstText = false;
      }
      process.stdout.write(d);
    },
    onToolEvent: (line) => console.log(`\x1b[2m${line}\x1b[0m`),
  });

  console.log(`ns-agent · root=${root} · model=${runtime.modelName} · catalog: ${runtime.catalog.map((n) => n.manifest.name).join(", ") || "(empty)"}`);
  for (const w of runtime.loadWarnings) console.log(`\x1b[33mwarning: ${w}\x1b[0m`);

  if (args.ns && args.ns !== "true") {
    console.log(await runtime.activate(args.ns));
  }

  if (args.prompt && args.prompt !== "true") {
    await runtime.prompt(args.prompt);
    console.log();
    await runtime.shutdown();
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    firstText = true;
    let line: string;
    try {
      line = (await rl.question("\x1b[36m› \x1b[0m")).trim();
    } catch {
      break;
    }
    if (!line) continue;
    if (line === "/exit" || line === "/quit") break;
    if (line === "/help") {
      console.log("commands: /ns · /ns use <name> · /ns off · /status · /exit — anything else goes to the agent");
      continue;
    }
    if (line === "/status") {
      console.log(runtime.status());
      continue;
    }
    if (line === "/ns") {
      for (const ns of runtime.catalog) {
        const mark = ns.manifest.name === runtime.active?.manifest.name ? "*" : " ";
        console.log(`${mark} ${ns.manifest.name} [${ns.source}] owner=${ns.manifest.owner}`);
      }
      continue;
    }
    if (line.startsWith("/ns use ")) {
      try {
        console.log(await runtime.activate(line.slice(8).trim()));
      } catch (e) {
        console.error(`activate failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      continue;
    }
    if (line === "/ns off") {
      console.log(await runtime.activate(null));
      continue;
    }
    if (line.startsWith("/")) {
      console.log(`unknown command: ${line} (/help)`);
      continue;
    }
    try {
      await runtime.prompt(line);
      console.log();
    } catch (e) {
      console.error(`\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m`);
    }
  }
  rl.close();
  await runtime.shutdown();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
