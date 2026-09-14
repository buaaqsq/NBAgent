# Contributing

## Dev setup

- Spec/validator: Python 3.10+, `pip install pyyaml`
- Runtime: Node ≥ 22, `cd runtime && npm install && npm run build`

## Before any PR (CI runs all of it)

```bash
python3 scripts/validate.py --self-test   # spec validator self-check
python3 scripts/validate.py               # examples/ stays ✓
cd runtime && npm run build && npm run selftest   # 13/13
```

## Adding an example namespace

1. Public examples go in `examples/<name>/` with the full layout: `NS.yaml` + `skills/<flow>/SKILL.md` + `acceptance/criteria.md` (+ optional `knowledge/`, `tools/`, `mcp.json`). Scaffold reference: `templates/`
2. Examples must be self-contained: `context` resolves **inside this repo** (relative path) with a fixture dir — copy `examples/invoice-helper/`
3. `description` ≤ 1024 chars with concrete trigger scenarios — it is the L0 discovery text
4. If `knowledge/` exists, `INDEX.md` is mandatory (the L2 entry point)
5. `mcp.json` must use `{context}`/`{nsDir}` variables instead of machine paths; keep MCP optional (`requires.mcp: false`) unless the example is specifically about MCP

## Changing the spec (NS.yaml fields)

Spec changes start as an **issue**. The fields are a contract: validator, runtime, examples, CI and downstream namespaces depend on their semantics. Removing/renaming a field requires a deprecation note in README first.

Upstream alignment: `skills/` conforms to [agentskills.io/specification](https://agentskills.io/specification). If upstream grows native accountability/knowledge fields, this repo adopts them — that outcome counts as success.

## Runtime code rules

- No parsers written against unverified third-party schemas (the OpenCode-sqlite lesson) — read only formats we produce ourselves (`.usage.jsonl`) or that are documented (MCP SDK, pi-ai usage shapes are probed defensively in `usage.ts`)
- Tools throw on failure; never return error text as success content (pi convention)
- MCP tool names are namespaced `mcp__<server>__<tool>`; keep the sanitizer
- New runtime deps need a justification in the PR — the bar is "a few lines can't do it"

## What this repo will not accept

- Registries, billing integrations, TUI frameworks (see README "Deliberately not built")
- Private or employer-specific config in `examples/` — that belongs in your gitignored `namespaces/`

## Translations

Welcome as `README.<lang>.md`. English `README.md` is canonical; on conflict, English wins.
