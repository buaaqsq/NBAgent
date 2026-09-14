#!/usr/bin/env python3
"""kb_search.py — SQLite FTS5 search across knowledge/ markdown files.

Usage:
  python3 kb_search.py <query>           # search, auto-rebuild if stale
  python3 kb_search.py --rebuild         # force rebuild index
  python3 kb_search.py --rebuild <query> # rebuild then search

CJK characters are pre-split into individual tokens before indexing and
querying, so multi-character CJK terms work as phrase queries at any length.
The FTS5 index (.index.db) is a rebuildable cache in knowledge/.
Delete it to force a full rebuild on next search.
"""
import sqlite3
import sys
import os
import re
import hashlib
from pathlib import Path

KNOWLEDGE_DIR = Path(os.getcwd()) / "knowledge"
DB_PATH = KNOWLEDGE_DIR / ".index.db"

CJK = re.compile(r"([\u4e00-\u9fff\u3400-\u4dbf])")


def split_cjk(text):
    """Insert spaces between consecutive CJK characters so unicode61 tokenizes each as a separate token."""
    return CJK.sub(r" \1 ", text)


def clean_snippet(text):
    """Remove the extra spaces inserted by split_cjk for readable output."""
    pattern = re.compile(r"([\u4e00-\u9fff\u3400-\u4dbf])\s+([\u4e00-\u9fff\u3400-\u4dbf])")
    prev = None
    while prev != text:
        prev = text
        text = pattern.sub(r"\1\2", text)
    return text


def file_hash(path):
    return hashlib.md5(path.read_bytes()).hexdigest()[:12]


KB_EXTENSIONS = (".md", ".yaml", ".json", ".csv")


def list_files():
    return [
        (str(md.relative_to(KNOWLEDGE_DIR)), md)
        for md in sorted(KNOWLEDGE_DIR.rglob("*"))
        if md.is_file()
        and md.name != "INDEX.md"
        and not md.name.startswith(".")
        and md.suffix in KB_EXTENSIONS
    ]


def is_stale(conn):
    old = dict(conn.execute("SELECT path, hash FROM files").fetchall())
    current = {rel: file_hash(md) for rel, md in list_files()}
    return old != current


def build_index():
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, hash TEXT)")
    conn.execute("DROP TABLE IF EXISTS kb_fts")
    conn.execute(
        "CREATE VIRTUAL TABLE kb_fts USING fts5("
        "path, content, tokenize='unicode61 remove_diacritics 2'"
        ")"
    )
    for rel, md in list_files():
        content = split_cjk(md.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO kb_fts (path, content) VALUES (?, ?)", (rel, content))
        conn.execute("INSERT OR REPLACE INTO files (path, hash) VALUES (?, ?)", (rel, file_hash(md)))
    conn.commit()
    return conn


def search(conn, query, limit=10):
    terms = [t for t in query.split() if t]
    if not terms:
        return []
    q = " AND ".join(f'"{split_cjk(t).strip()}"' for t in terms)
    rows = conn.execute(
        "SELECT path, snippet(kb_fts, 1, '>>>', '<<<', '...', 15) as excerpt, rank "
        "FROM kb_fts WHERE kb_fts MATCH ? ORDER BY rank LIMIT ?",
        (q, limit),
    ).fetchall()
    return rows


def main():
    args = [a for a in sys.argv[1:] if a != "--rebuild"]
    force_rebuild = "--rebuild" in sys.argv[1:]
    query = " ".join(args)

    if not DB_PATH.exists() or force_rebuild:
        conn = build_index()
    else:
        conn = sqlite3.connect(str(DB_PATH))
        if is_stale(conn):
            conn.close()
            conn = build_index()

    if not query:
        print(f"Index ready: {DB_PATH}")
        return

    results = search(conn, query)
    if not results:
        conn.close()
        conn = build_index()
        results = search(conn, query)

    if not results:
        print("(no results)")
        return

    for path, excerpt, rank in results:
        print(f"### {path} (score={-rank:.2f})")
        print(clean_snippet(excerpt.replace("\n", " ")))
        print()


if __name__ == "__main__":
    main()
