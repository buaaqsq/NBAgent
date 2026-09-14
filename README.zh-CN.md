# NS-Agent — Namespace-Based Agent（个人工作台 v0）

> ⚠️ **存档说明（2026-09-10）**：本文件为 v0 内部中文草稿，正式规范以英文 [README.md](README.md) 为准（项目已更名为 NS-Agent；下文中 `nsb.` 前缀等为 v0 历史设计，仅作存档）。差异：`nsb.version` / `nsb.depends` 字段已移除（git tag 为唯一版本源；depends 待有真实组合场景再加）、模板移至 `templates/`、新增 `examples/` 公开样例与 `scripts/ns-agent.py` CLI、`namespaces/` 已 gitignore。

一个 **namespace = 一个业务交付最小单元**：业务方维护自己的 SOP、知识入口、能力说明与验收判据；Agent 运行时负责发现、渐进加载、执行。namespace 不绑定运行时——任何兼容 [Agent Skills 标准](https://agentskills.io/specification) 的 harness（pi / OpenCode / Claude Code / Codex CLI）都能加载同一份定义。

## 核心决策（v0 只做这些）

1. **格式零发明**：namespace 就是一个 Agent Skills 目录（`SKILL.md` + frontmatter）。NSB 的扩展全部放进标准允许的 `metadata`（string→string map），用 `nsb.` 前缀。兼容 harness 会忽略未知字段——永不破坏标准。
2. **数据不复制**：业务数据（结构化知识、口径、私有配置）留在业务 repo。namespace 用 `nsb.context` 声明它在哪个 repo 上操作。SOP 进 namespace，数据进 context——这就是「把提供数据的服务剥离到体系外」。
3. **发现 = symlink**：把 `namespaces/<ns>/` 链到各 harness 的 skills 目录（`.agents/skills/`、`.opencode/skills/`、`.pi/skills/`）。单一源，多运行时，零同步。
4. **Git 即版本化/组合**：namespace 目录进 git，tag 即版本，`nsb.depends` 声明对其他 namespace/context 的引用。不建 registry——registry 是 ≥3 个 namespace 且跨机器分发时才需要的东西。

## 目录约定

```
nsb/
├── README.md               ← 本文件即规范 v0
├── namespaces/             ← ⚠️ 私有（业务实体内容）。开源时只公开 README + scripts + _template
│   ├── _template/          ← 新 namespace 从这里复制
│   └── <ns-name>/
│       ├── SKILL.md        ← 必须：frontmatter + SOP
│       ├── references/     ← 可选：namespace 自带的知识（随 NS 走的内容）
│       └── scripts/        ← 可选：计算口径、确定性操作脚本
└── scripts/
    └── validate.py         ← 平台唯一的「逻辑」：结构校验 + 自检
```

## frontmatter 约定

标准字段照旧（`name` / `description` 必须；`license` / `compatibility` / `allowed-tools` 可选）。NSB 扩展：

| key | 必须 | 含义 |
|---|---|---|
| `nsb.owner` | 是 | 谁对这个 namespace 的准确度和运营效果负责（人，不是团队名） |
| `nsb.context` | 是 | 业务数据所在 repo 的绝对路径。Agent 加载本 NS 后以它为工作根 |
| `nsb.acceptance` | 是 | 验收判据文件路径（相对 context）。结果怎么算数、谁验证、失败算不算 |
| `nsb.version` | 否 | 语义化版本。不写则以 git tag 为准 |
| `nsb.depends` | 否 | 逗号分隔的其他 namespace 名。组合引用，渐进加载 |
| `nsb.compatibility` | 否 | 运行时要求，如 `requires-mcp`（pi 原生无 MCP，命中则留在 OpenCode 跑） |

## 接线（每个业务 repo 一次）

```bash
# pi（从 cwd 向上发现 .agents/skills/，到 git repo 根为止 → repo 间天然隔离）
mkdir -p <业务repo>/.agents/skills
ln -s ~/Documents/ai/nsb/namespaces/<ns> <业务repo>/.agents/skills/<ns>

# OpenCode
mkdir -p <业务repo>/.opencode/skills
ln -s ~/Documents/ai/nsb/namespaces/<ns> <业务repo>/.opencode/skills/<ns>

# 全局可见（所有 session）：链到 ~/.agents/skills/
```

## 运行时使用（以 pi 为例，零改造，全部原生机制）

- **调用**：description 匹配自动触发（level-1 只占 ~100 tokens/NS），或 `/skill:<name>` 强制（settings 里 `enableSkillCommands: true`）
- **按 session 切换 NS**：
  ```bash
  cd <业务repo> && pi                                            # A. cwd 隔离：只见本 repo 接线的 NS
  pi --no-skills --skill ~/Documents/ai/nsb/namespaces/<ns>      # B. CLI 精确装配（--skill 可重复=组合）
  # C. repo 级 .pi/settings.json: {"skills": [".../namespaces/<ns>"]} 钉死集合
  # 并行多 NS：tmux 每窗一条 B 命令
  ```
- **注意**：`metadata` 不进 system prompt，模型触发后 read 全文才可见。因此 SOP body 首行必须写明工作根绝对路径（模板已含）——cwd 不在 context repo 时 NS 仍能正确执行。

## 校验

```bash
python3 scripts/validate.py            # 校验全部 namespace
python3 scripts/validate.py --self-test # 校验器自身的 assert 检查
```

## 故意不做的（触发条件到了再加）

| 不做 | 加回来的触发条件 |
|---|---|
| usage/成本聚合脚本 | 装上 pi、有真实 session JSONL 后（格式文档化）。OpenCode 的 sqlite schema 未核实，不猜 |
| 计费 | 永远是配置不是产品（Stripe+Metronome / Lago），且个人工作台用不到 |
| registry / 包分发 | ≥3 个 namespace 且需要跨机器分发 → 直接用 pi packages（`pi install git:`），不自建 |
| pydantic schema 校验 | validate.py 的 plain-yaml 检查开始漏掉真实错误时 |
| 评测执行 | acceptance 字段先只做「声明在哪」；跑评测是 context repo 自己的事 |
