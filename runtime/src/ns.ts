import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface NsModel {
  provider: string;
  id: string;
}

export interface NsManifest {
  name: string;
  description: string;
  owner: string;
  context: string;
  acceptance: string;
  model?: NsModel;
  requires?: { mcp?: boolean };
  boundaries?: string;
  knowledge?: { search?: "grep" | "fts5" | "none" };
}

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
}

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface Namespace {
  dir: string;
  source: string;
  manifest: NsManifest;
  skills: SkillEntry[];
  knowledgeIndex: string | null;
  tools: string[];
  mcpServers: Record<string, McpServerConfig>;
  contextDir: string;
}

export function parseFrontmatter(text: string): Record<string, unknown> | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return null;
  try {
    const fm = parseYaml(text.slice(3, end));
    return fm && typeof fm === "object" ? (fm as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function resolveContext(raw: string, root: string): string {
  const expanded = raw.startsWith("~") ? join(process.env.HOME ?? "", raw.slice(1)) : raw;
  return isAbsolute(expanded) ? expanded : resolve(root, expanded);
}

export function loadNamespace(dir: string, root: string, source: string): Namespace | null {
  const manifestPath = join(dir, "NS.yaml");
  if (!existsSync(manifestPath)) return null;
  let manifest: NsManifest;
  try {
    manifest = parseYaml(readFileSync(manifestPath, "utf-8")) as NsManifest;
  } catch {
    return null;
  }
  if (!manifest || typeof manifest.name !== "string" || typeof manifest.description !== "string") return null;

  const skills: SkillEntry[] = [];
  const skillsDir = join(dir, "skills");
  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir).sort()) {
      const skillMd = join(skillsDir, entry, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      const fm = parseFrontmatter(readFileSync(skillMd, "utf-8"));
      skills.push({
        name: String(fm?.name ?? entry),
        description: String(fm?.description ?? ""),
        path: skillMd,
      });
    }
  }
  const rootSkill = join(dir, "SKILL.md");
  if (skills.length === 0 && existsSync(rootSkill)) {
    const fm = parseFrontmatter(readFileSync(rootSkill, "utf-8"));
    skills.push({
      name: String(fm?.name ?? manifest.name),
      description: String(fm?.description ?? ""),
      path: rootSkill,
    });
  }

  const knowledgeIndexPath = join(dir, "knowledge", "INDEX.md");
  const knowledgeIndex = existsSync(knowledgeIndexPath) ? readFileSync(knowledgeIndexPath, "utf-8") : null;

  const toolsDir = join(dir, "tools");
  const tools = existsSync(toolsDir)
    ? readdirSync(toolsDir).filter((f) => statSync(join(toolsDir, f)).isFile()).sort()
    : [];

  let mcpServers: Record<string, McpServerConfig> = {};
  const mcpPath = join(dir, "mcp.json");
  if (existsSync(mcpPath)) {
    try {
      const parsed = JSON.parse(readFileSync(mcpPath, "utf-8")) as { mcpServers?: Record<string, McpServerConfig> };
      mcpServers = parsed.mcpServers ?? {};
    } catch {
      mcpServers = {};
    }
  }

  return {
    dir,
    source,
    manifest,
    skills,
    knowledgeIndex,
    tools,
    mcpServers,
    contextDir: resolveContext(manifest.context ?? ".", root),
  };
}

export function discoverCatalog(root: string, warnings?: string[]): Namespace[] {
  const out: Namespace[] = [];
  for (const source of ["namespaces", "examples"]) {
    const base = join(root, source);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base).sort()) {
      const dir = join(base, entry);
      const ns = loadNamespace(dir, root, source);
      if (ns) {
        out.push(ns);
      } else if (warnings && existsSync(join(dir, "NS.yaml"))) {
        warnings.push(`${source}/${entry}: NS.yaml parse failed or missing name/description, skipped`);
      }
    }
  }
  return out;
}
