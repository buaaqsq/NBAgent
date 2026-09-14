import { appendFileSync } from "node:fs";
import { join } from "node:path";

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// usage shapes differ across providers/versions; inspect at runtime instead of trusting one schema
export function readUsage(message: unknown): { input?: number; output?: number; costTotal?: number } | null {
  if (!message || typeof message !== "object") return null;
  const usage = (message as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  const input = num(u.input) ?? num(u.inputTokens) ?? num(u.input_tokens) ?? num(u.promptTokens);
  const output = num(u.output) ?? num(u.outputTokens) ?? num(u.output_tokens) ?? num(u.completionTokens);
  const cost = u.cost;
  const costTotal =
    cost && typeof cost === "object" ? num((cost as Record<string, unknown>).total) : num(u.costTotal ?? u.cost);
  if (input === undefined && output === undefined && costTotal === undefined) return null;
  return { input, output, costTotal };
}

export class UsageTracker {
  constructor(
    private nsDir: () => string | null,
    private nsName: () => string | null
  ) {}

  record(kind: string, entry: Record<string, unknown>): void {
    const dir = this.nsDir();
    if (!dir) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), kind, ns: this.nsName(), ...entry });
    try {
      appendFileSync(join(dir, ".usage.jsonl"), `${line}\n`);
    } catch {
      // usage is best-effort telemetry; never break a session for it
    }
  }
}
