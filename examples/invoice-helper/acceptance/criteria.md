# 验收判据 — invoice-helper

| 项 | 判据 |
|---|---|
| 结果定义 | `summary.md` 存在；valid_total = 有效行金额之和；每个缺失/异常行都被标记 |
| 验证 | `ns_tool sum_valid.py` 复算，输出与 summary.md 完全一致 |
| 失败 | 任一缺失行未标记、或合计把缺失当零值 → 不通过，summary.md 不得交付 |
| 人工接管 | 税务口径、发票真伪判断 → 一律转人，本 NS 不做 |
