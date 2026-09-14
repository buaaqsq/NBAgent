import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const MAX_OUTPUT = 50_000;

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n...[truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

export interface CoreToolCtx {
  cwd(): string;
}

export function coreTools(ctx: CoreToolCtx): AgentTool[] {
  const read: AgentTool = {
    name: "read",
    label: "Read",
    description: "Read a file. Relative paths resolve against the active working root.",
    parameters: Type.Object({ path: Type.String({ description: "file path" }) }),
    async execute(_id, raw: unknown) {
      const params = raw as { path: string };
      const text = readFileSync(resolve(ctx.cwd(), params.path), "utf-8");
      return { content: [{ type: "text", text: truncate(text) }], details: { path: params.path } };
    },
  };

  const write: AgentTool = {
    name: "write",
    label: "Write",
    description: "Write content to a file (creates parent dirs, overwrites). Relative paths resolve against the active working root.",
    parameters: Type.Object({
      path: Type.String({ description: "file path" }),
      content: Type.String({ description: "full file content" }),
    }),
    async execute(_id, raw: unknown) {
      const params = raw as { path: string; content: string };
      const abs = resolve(ctx.cwd(), params.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, params.content, "utf-8");
      return { content: [{ type: "text", text: `wrote ${params.content.length} chars to ${abs}` }], details: { path: abs } };
    },
  };

  const bash: AgentTool = {
    name: "bash",
    label: "Bash",
    description: "Run a shell command in the active working root. Returns stdout+stderr and exit code.",
    parameters: Type.Object({
      command: Type.String({ description: "shell command" }),
      timeout_ms: Type.Optional(Type.Number({ description: "timeout in ms, default 120000" })),
    }),
    async execute(_id, raw: unknown, signal?: AbortSignal) {
      const params = raw as { command: string; timeout_ms?: number };
      const output = await new Promise<string>((res, rej) => {
        const child = spawn(params.command, {
          shell: true,
          cwd: ctx.cwd(),
          env: process.env,
        });
        let buf = "";
        child.stdout.on("data", (d: Buffer) => (buf += d.toString()));
        child.stderr.on("data", (d: Buffer) => (buf += d.toString()));
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          rej(new Error(`timeout after ${params.timeout_ms ?? 120000}ms`));
        }, params.timeout_ms ?? 120_000);
        signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
        child.on("error", (e) => {
          clearTimeout(timer);
          rej(e);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          res(`[exit ${code}]\n${truncate(buf)}`);
        });
      });
      return { content: [{ type: "text", text: output }], details: {} };
    },
  };

  return [read, write, bash];
}
