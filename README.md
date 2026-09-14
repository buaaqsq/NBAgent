# NS-Agent — Namespace-Based Agent

A **namespace (NS)** is the smallest unit of business delivery for AI agents: one Git-versioned directory bundling everything a business entity needs to be understood and operated by any agent —

```
namespaces/<ns>/
├── NS.yaml              # manifest: identity, owner, context, acceptance, model preference, boundaries
├── skills/<flow>/       # SOP flows (Agent Skills standard — the process-expression layer)
├── knowledge/           # knowledge base: structured/ (yaml/json/csv) + docs/ + INDEX.md
├── tools/               # deterministic scripts (calculation standards, validators)
├── mcp.json             # MCP server bindings (stdio / streamable-http)
└── acceptance/          # acceptance criteria: what counts as done, who verifies, when humans take over
```

**A namespace is not a skill.** A skill is process expression; an NS is an *operating entity*: it adds knowledge bases, deterministic tools, MCP bindings, acceptance semantics, and a named owner accountable for accuracy — plus a runtime that discovers, activates, and operates it.

**This repo ships two things:**
1. **The NS format** (spec below) — runtime-agnostic; `skills/` conforms to [Agent Skills](https://agentskills.io/specification), so bare harnesses (pi, OpenCode, Claude Code, Codex) still see the SOP flows in degraded mode
2. **`ns-agent`** — the reference runtime built on [pi-agent-core](https://github.com/badlogic/pi-mono) (`@earendil-works/pi-agent-core` + `pi-ai`), with **native MCP support** (which pi deliberately omits)

## How the runtime works

Three-level progressive disclosure, at namespace granularity:

| Level | When | What enters context |
|---|---|---|
| **L0 catalog** | startup | each NS: name + description + owner (~80 tokens/NS) |
| **L1 activation** | `/ns use <name>` or the agent calls `ns_activate` | NS.yaml manifest, knowledge INDEX, skill list, boundaries, working root; MCP servers connect; model preference applies |
| **L2 on-demand** | agent tool calls | `ns_knowledge` (read entries) · `ns_skill` (full SOP) · `ns_tool` (run scripts) · `mcp__<server>__<tool>` |

Agent tools: `read` / `write` / `bash` (resolve against the active NS **context** — business data is *referenced, never copied*) + the five `ns_*` tools + MCP tools of the active NS.

Operations: every activation, tool call, and token usage attributed to the active NS appends to `namespaces/<ns>/.usage.jsonl` — the operational record (who used it, how much, what it cost) that makes namespaces *business entities*, not just folders.

Per-session NS switching: run one `ns-agent` per session with `--ns <name>`, or switch mid-session with `/ns use`. Sessions are independent processes/tmux panes — no cross-talk.

## Install & run

```bash
git clone <this-repo> && cd ns-agent/runtime
npm install && npm run build          # node ≥ 22; deps: pi-agent-core, pi-ai, MCP SDK, typebox, yaml

export ANTHROPIC_API_KEY=...          # or OPENAI_API_KEY / google — pi-ai provider env vars
node dist/index.js                    # REPL; or:
node dist/index.js --ns invoice-helper --prompt "整理发票并写 summary"   # one-shot
```

CLI: `--root <ns-agent-repo>` (default: `$NS_AGENT_ROOT`, package root, or nearest ancestor containing `namespaces/`) · `--ns <name>` · `--model <provider/id>` (default `$NS_AGENT_MODEL`, then the first provider whose API key env is set) · `--prompt <text>`.

### Providers

Built in: `anthropic` (`ANTHROPIC_API_KEY`) · `openai` (`OPENAI_API_KEY`) · `google` (`GEMINI_API_KEY`) · **Aliyun Bailian / Model Studio** · Qwen Token Plan (pi-ai native).

**Bailian pay-as-you-go** (按量计费, the safe choice for custom agent apps):

```bash
export DASHSCOPE_API_KEY=sk-...
# optional overrides:
export NS_AGENT_BAILIAN_BASE_URL="https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"  # workspace-scoped endpoint
export NS_AGENT_BAILIAN_MODELS="qwen3.8-max,qwen3-max,qwen-plus"   # comma list; default qwen3-max,qwen-plus,qwen-turbo
node dist/index.js --model bailian/qwen3-max
```

**Qwen Token Plan** (个人版/团队版/Coding Plan subscription keys):

```bash
export QWEN_TOKEN_PLAN_CN_API_KEY=...    # CN endpoint (Beijing); or QWEN_TOKEN_PLAN_API_KEY (intl)
node dist/index.js --model qwen-token-plan-cn/qwen3.8-max
# native catalog also routes deepseek / glm / kimi / minimax through the plan endpoint
```

⚠️ Per [Aliyun's tool policy](https://help.aliyun.com/zh/model-studio/more-tools), Token/Coding Plan keys are limited to AI coding tools and OpenClaw-type agents; workflow platforms and custom backend apps must use pay-as-you-go keys. When in doubt, use `DASHSCOPE_API_KEY`.

REPL commands: `/ns` (catalog) · `/ns use <name>` · `/ns off` · `/status` · `/exit`.

### Verify without an API key

```bash
python3 scripts/validate.py --self-test   # spec validator, 10 asserts
npm run selftest --prefix runtime         # runtime, 13/13 (catalog/prompt/guards/tool-exec/usage/MCP var-substitution)
python3 scripts/validate.py               # validates examples/ + your namespaces/
```

## NS.yaml spec v1

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | lowercase/digits/hyphens, ≤64, unique across the catalog |
| `description` | yes | ≤1024 chars; what the entity provides + when to activate it (the L0 discovery text) |
| `owner` | yes | person accountable for accuracy and operational results |
| `context` | yes | business-data repo: absolute path, `~/…`, or relative to the ns-agent root. **Referenced, never copied** |
| `acceptance` | yes | NS-relative path to the acceptance-criteria file |
| `model` | no | `{provider, id}` — applied on activation when available |
| `requires.mcp` | no | declare MCP as a hard dependency |
| `boundaries` | no | what this NS does not do; when to hand off to humans |

`mcp.json` follows the Claude-Desktop convention (`mcpServers.<name>` with `command/args/env` or `url/headers`), plus two substitution variables so configs stay portable: `{context}` and `{nsDir}`.

## Managing namespaces

```bash
python3 scripts/ns-agent.py list                    # catalog with owner/flows/mcp/context
python3 scripts/ns-agent.py new my-biz              # scaffold from templates/ into namespaces/ (gitignored)
python3 scripts/ns-agent.py validate                # structure + contract + name-collision checks
python3 scripts/ns-agent.py link my-biz ~/my/repo   # degraded mode: symlink skills/ flows into bare harnesses
```

`namespaces/` is **gitignored by design**: namespaces may carry private config. Public samples live in `examples/` (self-contained: relative `context` + fixture data, validate-clean on a fresh clone).

## Design decisions

1. **NS ⊃ skill** — `skills/` conforms to Agent Skills so bare harnesses degrade gracefully; everything above process expression (knowledge/tools/MCP/acceptance/owner) is NS-level
2. **Data is never copied** — the SOP travels with the NS; business data stays in the `context` repo; working root follows the active NS
3. **Manifest is structured, body is prose** — NS.yaml is for machines (validator, runtime, future registries); markdown layers are for models and humans
4. **Git is the versioning** — tags are the single source of truth; no registry until ≥3 namespaces need cross-machine distribution
5. **Declare before enforce** — the validator checks existence/shape/consistency; keeping acceptance content true is the owner's job
6. **Usage is a first-class output** — `.usage.jsonl` per NS, written by the runtime itself (no parsers against guessed third-party schemas)

## Deliberately not built (and when to revisit)

| Skipped | Revisit trigger |
|---|---|
| TUI (readline REPL only) | when daily use demands it — pi-tui is available |
| Session persistence/resume | when sessions must survive restarts — pi-agent-core has session backends (sqlite) |
| Billing | forever a config problem (Stripe+Metronome, Lago), not a product problem |
| Registry / package distribution | ≥3 namespaces + cross-machine → pi packages or OCI registries |
| Per-NS enforcement (RBAC/quota) | when isolation must be technical, i.e. multi-tenant days |
| Concurrent multi-NS activation | when a real workflow needs two active contexts at once |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The spec lives in this README — changes to NS.yaml semantics start as issues.

## License

Apache 2.0 — see [LICENSE](LICENSE). 中文存档（v0 草稿）：[README.zh-CN.md](README.zh-CN.md)
