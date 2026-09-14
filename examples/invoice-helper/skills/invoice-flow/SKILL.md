---
name: invoice-flow
description: 发票整理流程：读规则 → 读数据 → 确定性合计 → 标记缺失 → 写 summary.md。Use when asked to tidy, validate, or summarize invoices in the active namespace context.
---

# 发票整理流程

工作根 = 激活时注入的 NS context（`ns-agent` 激活本 NS 后相对路径以它为根）。

## SOP

1. `ns_knowledge structured/rules.yaml` — 先读校验规则（核心：**缺失 ≠ 0**）
2. `read invoices.csv` — 读数据
3. `ns_tool sum_valid.py` — 确定性合计（禁止心算，脚本是唯一口径）
4. 按脚本 flagged 输出核对每一行缺失/异常
5. `write summary.md` — 合计 + 被标记行清单 + 复算方式
6. 对照 `acceptance/criteria.md` 逐项自检后才算完成

## MCP（可选）

若 `mcp__fs__*` 工具可用（NS 激活时连接了 filesystem server），可用它浏览 context 目录；不可用不影响主流程。
