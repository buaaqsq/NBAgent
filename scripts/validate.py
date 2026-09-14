#!/usr/bin/env python3
"""NS-Agent namespace 校验器 v2：NS.yaml manifest + 资产结构一致性。

用法:
    python3 validate.py             # 校验 namespaces/（若存在）与 examples/ 下全部 namespace
    python3 validate.py --self-test # 校验器自身检查（assert，无需外部文件）

退出码: 0 = 全部通过, 1 = 有错误。
"""
import json
import re
import sys
import tempfile
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def parse_frontmatter(skill_md: Path):
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return None, "缺少 frontmatter（文件必须以 --- 开头）"
    end = text.find("\n---", 3)
    if end == -1:
        return None, "frontmatter 未闭合（找不到第二个 ---）"
    try:
        fm = yaml.safe_load(text[3:end])
    except yaml.YAMLError as e:
        return None, f"frontmatter YAML 解析失败: {e}"
    if not isinstance(fm, dict):
        return None, "frontmatter 不是键值映射"
    return fm, None


def resolve_path(raw: str, root: Path) -> Path:
    p = Path(raw).expanduser()
    return p if p.is_absolute() else root / p


def validate_namespace(ns_dir: Path, root: Path = ROOT) -> list:
    nsyaml = ns_dir / "NS.yaml"
    if not nsyaml.is_file():
        return ["缺少 NS.yaml"]
    try:
        m = yaml.safe_load(nsyaml.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        return [f"NS.yaml YAML 解析失败: {e}"]
    if not isinstance(m, dict):
        return ["NS.yaml 不是键值映射"]

    errors = []
    name = m.get("name")
    if not isinstance(name, str) or not name:
        errors.append("name 缺失或非字符串")
    elif len(name) > 64 or not NAME_RE.match(name):
        errors.append(f"name 不合规（≤64，小写字母/数字/单连字符）: {name!r}")

    desc = m.get("description")
    if not isinstance(desc, str) or not desc.strip():
        errors.append("description 缺失或为空")
    elif len(desc) > 1024:
        errors.append(f"description 超过 1024 字符（{len(desc)}）")

    owner = m.get("owner")
    if not isinstance(owner, str) or not owner.strip():
        errors.append("owner 缺失（谁对准确度负责）")

    context_raw = m.get("context")
    context = None
    if not isinstance(context_raw, str) or not context_raw:
        errors.append("context 缺失（业务数据所在 repo）")
    else:
        context = resolve_path(context_raw, root)
        if not context.is_dir():
            errors.append(f"context 不存在: {context}")

    acceptance = m.get("acceptance")
    if not isinstance(acceptance, str) or not acceptance:
        errors.append("acceptance 缺失（NS 内验收判据路径）")
    elif not (ns_dir / acceptance).is_file():
        errors.append(f"acceptance 在 NS 目录下不存在: {ns_dir / acceptance}")

    model = m.get("model")
    if model is not None:
        if not isinstance(model, dict) or not isinstance(model.get("provider"), str) or not isinstance(model.get("id"), str):
            errors.append("model 必须是 {provider: str, id: str}")

    skills_dir = ns_dir / "skills"
    skill_count = 0
    if skills_dir.is_dir():
        for child in sorted(skills_dir.iterdir()):
            if not child.is_dir():
                continue
            skill_md = child / "SKILL.md"
            if not skill_md.is_file():
                errors.append(f"skills/{child.name}/ 缺少 SKILL.md")
                continue
            fm, err = parse_frontmatter(skill_md)
            if err:
                errors.append(f"skills/{child.name}/SKILL.md {err}")
            elif not fm.get("name") or not fm.get("description"):
                errors.append(f"skills/{child.name}/SKILL.md frontmatter 缺 name/description")
            else:
                skill_count += 1
    if skill_count == 0 and not (ns_dir / "SKILL.md").is_file():
        errors.append("无任何 SOP 流程（skills/<flow>/SKILL.md 或根 SKILL.md）")

    knowledge_dir = ns_dir / "knowledge"
    if knowledge_dir.is_dir() and not (knowledge_dir / "INDEX.md").is_file():
        errors.append("knowledge/ 存在但缺 INDEX.md（L2 披露入口）")

    mcp_path = ns_dir / "mcp.json"
    if mcp_path.is_file():
        try:
            parsed = json.loads(mcp_path.read_text(encoding="utf-8"))
            servers = parsed.get("mcpServers")
            if not isinstance(servers, dict):
                errors.append("mcp.json 缺 mcpServers 对象")
            else:
                for srv, cfg in servers.items():
                    if not isinstance(cfg, dict) or not (cfg.get("command") or cfg.get("url")):
                        errors.append(f"mcp.json server {srv!r} 需要 command 或 url")
        except json.JSONDecodeError as e:
            errors.append(f"mcp.json 解析失败: {e}")

    return errors


def iter_namespaces(root: Path = ROOT):
    for base in ("namespaces", "examples"):
        d = root / base
        if d.is_dir():
            yield from sorted(p for p in d.iterdir() if p.is_dir())


def validate_all(root: Path = ROOT) -> int:
    seen = {}
    failed = False
    count = 0
    for ns_dir in iter_namespaces(root):
        count += 1
        label = f"{ns_dir.parent.name}/{ns_dir.name}"
        errors = validate_namespace(ns_dir, root)
        name = None
        nsyaml = ns_dir / "NS.yaml"
        if nsyaml.is_file():
            try:
                loaded = yaml.safe_load(nsyaml.read_text(encoding="utf-8"))
                name = loaded.get("name") if isinstance(loaded, dict) else None
            except yaml.YAMLError:
                pass
        if isinstance(name, str):
            if name in seen:
                errors.append(f"name 冲突: {name!r} 已被 {seen[name]} 使用")
            else:
                seen[name] = label
        if errors:
            failed = True
            print(f"✗ {label}")
            for e in errors:
                print(f"    - {e}")
        else:
            print(f"✓ {label}")
    if count == 0:
        print("错误: namespaces/ 与 examples/ 均不存在")
        return 1
    return 1 if failed else 0


def self_test():
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        ctx = root / "biz"
        ctx.mkdir()

        def run(files: dict) -> list:
            ns = root / "ns"
            for rel, content in files.items():
                p = ns / rel
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(content, encoding="utf-8")
            return validate_namespace(ns, root)

        good_yaml = ("name: my-ns\ndescription: 做什么、何时加载。\nowner: qsq\n"
                     "context: biz\nacceptance: acceptance/criteria.md\n")
        good = {
            "NS.yaml": good_yaml,
            "acceptance/criteria.md": "判据",
            "skills/flow/SKILL.md": "---\nname: flow\ndescription: 流程。\n---\n# SOP\n",
        }
        assert run(good) == [], "合规样例应通过"
        assert any("name" in e for e in run({**good, "NS.yaml": good_yaml.replace("name: my-ns", "name: Bad_Name")})), "非法 name 应报错"
        assert any("owner" in e for e in run({**good, "NS.yaml": good_yaml.replace("owner: qsq\n", "")})), "缺 owner 应报错"
        assert any("context" in e for e in run({**good, "NS.yaml": good_yaml.replace("context: biz", "context: nope")})), "context 不存在应报错"
        assert any("acceptance" in e for e in run({**good, "NS.yaml": good_yaml.replace("acceptance/criteria.md", "missing.md")})), "acceptance 不存在应报错"
        assert any("SKILL.md" in e for e in run({**good, "skills/flow/SKILL.md": "# 无 frontmatter\n"})), "skill 缺 frontmatter 应报错"
        assert any("SOP" in e for e in run({k: v for k, v in good.items() if "skills" not in k})), "无任何 SOP 应报错"
        assert any("INDEX" in e for e in run({**good, "knowledge/structured/x.yaml": "a: 1"})), "knowledge 缺 INDEX 应报错"
        assert any("mcp" in e for e in run({**good, "mcp.json": '{"mcpServers": {"s": {}}}'})), "mcp server 缺 command/url 应报错"
        assert validate_namespace(root / "not-exist", root) == ["缺少 NS.yaml"], "缺 NS.yaml 应报错"
    print("self-test: 10/10 通过")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        sys.exit(validate_all())
