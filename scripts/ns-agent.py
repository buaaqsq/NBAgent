#!/usr/bin/env python3
"""ns-agent — namespace 管理 CLI。

用法:
    python3 ns-agent.py list                                        # 列出全部 namespace
    python3 ns-agent.py new <name>                                  # 从 templates/ 脚手架到 namespaces/
    python3 ns-agent.py link <ns> <repo> [--harness pi,opencode]    # 降级模式：把 NS 的 skills 流程 symlink 进裸 harness
    python3 ns-agent.py validate                                    # 跑校验器
"""
import argparse
import shutil
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate as v

ROOT = Path(__file__).resolve().parent.parent
HARNESS_DIRS = {
    "pi": ".agents/skills",
    "opencode": ".opencode/skills",
    "claude": ".claude/skills",
    "codex": ".codex/skills",
}


def read_manifest(ns: Path):
    p = ns / "NS.yaml"
    if not p.is_file():
        return None
    try:
        m = yaml.safe_load(p.read_text(encoding="utf-8"))
        return m if isinstance(m, dict) else None
    except yaml.YAMLError:
        return None


def find_ns(name: str) -> Path:
    for base in ("namespaces", "examples"):
        p = ROOT / base / name
        if (p / "NS.yaml").is_file():
            return p
    sys.exit(f"namespace 未找到: {name}（在 namespaces/ 与 examples/ 下找过，需含 NS.yaml）")


def skill_flows(ns: Path) -> list:
    skills = ns / "skills"
    flows = sorted(p for p in skills.iterdir() if (p / "SKILL.md").is_file()) if skills.is_dir() else []
    if not flows and (ns / "SKILL.md").is_file():
        flows = [ns]
    return flows


def cmd_list(_args):
    for ns in v.iter_namespaces(ROOT):
        m = read_manifest(ns)
        if m is None:
            print(f"{ns.name:<24} ✗ 缺 NS.yaml 或解析失败")
            continue
        flows = ",".join(f.name for f in skill_flows(ns)) or "-"
        mcp = (ns / "mcp.json").is_file()
        print(f"{str(m.get('name', ns.name)):<24} owner={str(m.get('owner', '?')):<16} flows={flows:<24} mcp={'yes' if mcp else 'no':<4} context={m.get('context', '?')}")


def cmd_new(args):
    if not v.NAME_RE.match(args.name):
        sys.exit("name 必须为小写字母/数字/单连字符（≤64）")
    dest = ROOT / "namespaces" / args.name
    if dest.exists():
        sys.exit(f"已存在: {dest}")
    shutil.copytree(ROOT / "templates", dest)
    print(f"已创建 {dest}")
    print("下一步: 编辑 NS.yaml + skills/flow/SKILL.md + acceptance/criteria.md，然后 python3 scripts/ns-agent.py validate")


def cmd_link(args):
    ns = find_ns(args.ns)
    repo = Path(args.repo).expanduser().resolve()
    if not repo.is_dir():
        sys.exit(f"不是目录: {repo}")
    flows = skill_flows(ns)
    if not flows:
        sys.exit(f"{args.ns} 无可链接的 skills/ 流程")
    dirs = []
    for h in args.harness.split(","):
        h = h.strip()
        if h not in HARNESS_DIRS:
            sys.exit(f"未知 harness: {h}（可用: {','.join(HARNESS_DIRS)}）")
        if HARNESS_DIRS[h] not in dirs:
            dirs.append(HARNESS_DIRS[h])
    for d in dirs:
        skills_dir = repo / d
        skills_dir.mkdir(parents=True, exist_ok=True)
        for flow in flows:
            link = skills_dir / flow.name
            if link.is_symlink() or link.exists():
                print(f"跳过（已存在）: {link}")
                continue
            link.symlink_to(flow, target_is_directory=True)
            print(f"已链接: {link} -> {flow}")
    print("提示: link 是降级模式（裸 harness 只见 SOP 流程）；完整 NS 语义用 runtime: ns-agent --ns " + args.ns)


def cmd_validate(_args):
    sys.exit(v.validate_all(ROOT))


def main():
    parser = argparse.ArgumentParser(prog="ns-agent", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="列出全部 namespace").set_defaults(fn=cmd_list)
    p_new = sub.add_parser("new", help="从 templates/ 脚手架新 namespace")
    p_new.add_argument("name")
    p_new.set_defaults(fn=cmd_new)
    p_link = sub.add_parser("link", help="降级模式：把 NS 的 skills 流程 symlink 进业务 repo")
    p_link.add_argument("ns")
    p_link.add_argument("repo")
    p_link.add_argument("--harness", default="pi,opencode")
    p_link.set_defaults(fn=cmd_link)
    sub.add_parser("validate", help="跑校验器").set_defaults(fn=cmd_validate)
    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
