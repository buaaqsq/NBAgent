import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types.js";
import type { TSchema } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { McpServerConfig } from "./ns.js";

export function subVars(value: string, vars: Record<string, string>): string {
  let out = value;
  for (const [k, v] of Object.entries(vars)) out = out.split(k).join(v);
  return out;
}

export class McpManager {
  private clients = new Map<string, Client>();

  async connect(
    servers: Record<string, McpServerConfig>,
    vars: Record<string, string> = {}
  ): Promise<{ tools: AgentTool[]; notes: string[] }> {
    const tools: AgentTool[] = [];
    const notes: string[] = [];
    for (const [name, rawCfg] of Object.entries(servers)) {
      const cfg: McpServerConfig = {
        ...rawCfg,
        command: rawCfg.command ? subVars(rawCfg.command, vars) : undefined,
        args: rawCfg.args?.map((a) => subVars(a, vars)),
        url: rawCfg.url ? subVars(rawCfg.url, vars) : undefined,
      };
      try {
        const client = new Client({ name: "ns-agent", version: "0.1.0" });
        const transport = cfg.command
          ? new StdioClientTransport({
              command: cfg.command,
              args: cfg.args ?? [],
              env: { ...getDefaultEnvironment(), ...(cfg.env ?? {}) },
            })
          : new StreamableHTTPClientTransport(new URL(cfg.url ?? ""), {
              requestInit: cfg.headers ? { headers: cfg.headers } : undefined,
            });
        await client.connect(transport);
        this.clients.set(name, client);
        const listed = await client.listTools();
        for (const t of listed.tools) {
          const toolName = `mcp__${name}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          // MCP inputSchema is JSON Schema; TypeBox schemas are JSON Schema objects, structural cast
          const parameters = t.inputSchema as unknown as TSchema;
          const boundClient = client;
          const boundToolName = t.name;
          tools.push({
            name: toolName,
            label: toolName,
            description: `[mcp:${name}] ${t.description ?? t.name}`,
            parameters,
            async execute(_id, raw: unknown) {
              const params = raw as Record<string, unknown>;
              const res = (await boundClient.callTool({ name: boundToolName, arguments: params })) as CallToolResult;
              const blocks = Array.isArray(res.content) ? res.content : [];
              const text = blocks
                .filter((c): c is TextContent => c.type === "text")
                .map((c) => c.text)
                .join("\n");
              if (res.isError) throw new Error(text || `mcp tool ${boundToolName} failed`);
              return { content: [{ type: "text", text: text || "(no text content)" }], details: { server: name, tool: boundToolName } };
            },
          });
        }
        notes.push(`mcp:${name} connected (${listed.tools.length} tools)`);
      } catch (e) {
        notes.push(`mcp:${name} FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { tools, notes };
  }

  async disconnectAll(): Promise<void> {
    for (const c of this.clients.values()) {
      try {
        await c.close();
      } catch {
        // closing an already-dead transport is not an error
      }
    }
    this.clients.clear();
  }

  status(): string[] {
    return [...this.clients.keys()];
  }
}
