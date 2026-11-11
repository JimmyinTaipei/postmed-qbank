"""pmq check：讀全部主檔 → 內容契約 → 驗證 → 驗證報告。不寫任何主檔。"""
import collections
import json
import re
import shutil
import time
from pathlib import Path

import jsonschema

from . import mathcheck
from .build import Contract, SUBJECTS
from .figs import SVG_SIZE_LIMIT


def disk_guard(path="/"):
    free = shutil.disk_usage(path).free
    if free < 2 * 1024 ** 3:
        raise SystemExit(f"磁碟剩餘 {free / 1024 ** 3:.1f} GB，低於 2 GB，停止（規格書 §3.2）。")
    return free


def validators(cfg):
    load = lambda n: json.loads((cfg.schema / n).read_text("utf-8"))
    mk = lambda s: jsonschema.Draft202012Validator(s, format_checker=None)
    return {n: mk(load(n + ".schema.json")) for n in ("question", "index-row", "taxonomy", "kb")}


def run_check(cfg, with_math=True, answers_file=None):
    disk_guard()
    t0 = time.time()
    c = Contract(cfg).run()
    rep = c.report
    v = validators(cfg)

    # ---- structural checks ----
    patterns = {s["id"]: re.compile(s["id_pattern"]) for s in SUBJECTS}
    chapter_ids = {ch["id"] for ch in c.chapters}
    ids = collections.Counter(q["id"] for q in c.questions)
    for qid, n in ids.items():
        if n > 1:
            rep.error("ID 重複（跨科或跨檔）", id=qid, count=n)
    for q in c.questions:
        if not patterns[q["subject"]].match(q["id"] or ""):
            rep.error("ID 不符科目格式", id=q["id"], subject=q["subject"])
        if q["chap"] not in chapter_ids:
            rep.error("chap 不在章節樹", id=q["id"], chap=q["chap"], file=q["file"])
        for x in q["xchap"]:
            if x not in chapter_ids:
                rep.warn("xchap_not_in_tree", id=q["id"], xchap=x)
    schema_fail = 0
    for q in c.questions:
        errs = list(v["question"].iter_errors(c.public(q)))
        if errs:
            schema_fail += 1
            rep.error("JSON Schema 不過", id=q["id"], message="; ".join(f"{'/'.join(map(str, e.path))}: {e.message}" for e in errs[:3]))
    index_fail = sum(1 for s in SUBJECTS for row in c.index(s["id"]) if not v["index-row"].is_valid(row))
    tax_errs = [e.message for e in v["taxonomy"].iter_errors(c.taxonomy)]
    for e in tax_errs:
        rep.error("taxonomy JSON Schema 不過", message=e)

    # ---- figures ----
    pub = c.assets.published()
    for key, info in pub.items():
        if info["ext"] == "svg":
            if info.get("bad_fonts"):
                rep.warn("svg_font_not_whitelisted", file=cfg.rel(info["path"]), fonts=info["bad_fonts"])
            if info.get("text_without_font"):
                rep.warn("svg_text_without_font", file=cfg.rel(info["path"]))
            if info["bytes"] > SVG_SIZE_LIMIT:
                rep.warn("svg_over_500kb", file=cfg.rel(info["path"]), kb=round(info["bytes"] / 1024))
            rep.count("svg_mono", "mono" if info.get("mono") else "color")
        if not info.get("w"):
            rep.warn("image_size_unknown", file=cfg.rel(info["path"]))

    # ---- math ----
    math_stats = None
    math_fail = []
    if with_math:
        items = []
        for q in c.questions:
            for f in ("ques", "idea", "sol"):
                items.append((q["id"], f, q[f]))
            if q["answer"]["text"]:
                items.append((q["id"], "answer", q["answer"]["text"]))
            for t in q["teacher"]:
                items.append((q["id"], "teacher", t["md"]))
        for path in note_files(cfg):
            items.append((cfg.rel(path), "note", path.read_text("utf-8")))
        math_fail, math_stats = mathcheck.run(items, cfg)

    note_link_stats(cfg, rep)

    # ---- 資料庫（講義筆記，第 4 階段）----
    from .kb import build_kb, count_blocks
    c.kb_docs, c.kb_catalog, c.kb_related = build_kb(cfg, c)
    kb_fail = 0
    for key, d in c.kb_docs.items():
        errs = list(v["kb"].iter_errors(d))
        if errs:
            kb_fail += 1
            rep.error("筆記 JSON Schema 不過", doc=key, message="; ".join(f"{'/'.join(map(str, e.path))}: {e.message}" for e in errs[:3]))
    kb_rows = [{"key": k, "file": d["file"], **count_blocks(d["blocks"]), "refs": len(d["refs"]), "refs_unmapped": sum(1 for r in d["refs"] if not r["qid"])}
               for k, d in c.kb_docs.items()]
    c.cache.save()
    elapsed = time.time() - t0
    result = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "elapsed_s": round(elapsed, 1),
        "cache": {"hits": c.cache.hits, "misses": c.cache.misses},
        "counts": {s["id"]: sum(1 for q in c.questions if q["subject"] == s["id"]) for s in SUBJECTS},
        "by_kind": dict(collections.Counter(f"{q['subject']}:{q['source']['kind']}" for q in c.questions)),
        "errors": rep.errors,
        "warnings": {k: v for k, v in rep.warnings.items()},
        "tallies": {k: dict(v) for k, v in rep.counts.items()},
        "schema": {"questions_failed": schema_fail, "index_rows_failed": index_fail, "taxonomy_errors": len(tax_errs)},
        "assets": {"files": len(pub), "bytes": sum(i["bytes"] for i in pub.values()),
                   "svg": sum(1 for i in pub.values() if i["ext"] == "svg"),
                   "raster": sum(1 for i in pub.values() if i["ext"] != "svg")},
        "math": {"stats": math_stats, "failures": math_fail},
        "kb": {"docs": kb_rows, "schema_failed": kb_fail, "related_questions": len(c.kb_related),
               "outline": {s["id"]: [g["title"] for g in s["groups"]] for s in c.kb_catalog["subjects"] if not s["imported"]}},
        "chapters": len(c.chapters),
        "sources": len(c.sources),
    }
    if answers_file and Path(answers_file).exists():
        result["answer_spotcheck"] = json.loads(Path(answers_file).read_text("utf-8"))
    return c, result


def note_files(cfg):
    """Current (non-archived) biochem and physics notes; used by check math and the link statistics."""
    out = []
    for sub in ("02_生化", "03_物理"):
        base = cfg.notes / sub
        if base.exists():
            out += [p for p in sorted(base.rglob("*.md")) if "_archive" not in p.parts and " 2." not in p.name]
    return out


def note_link_stats(cfg, rep):
    link = re.compile(r"\]\(\s*<([^>\n]+)>|\]\(\s*([^)\s]+)|src=\"([^\"]+)\"|src='([^']+)'")
    for path in note_files(cfg):
        for m in link.finditer(path.read_text("utf-8")):
            t = next(g for g in m.groups() if g)
            if re.match(r"^[a-z]+:", t) or t.startswith("#"):
                continue
            if t.startswith("/"):
                rep.count("note_link_folder", "(絕對路徑) " + "/".join(Path(t).parts[1:4]))
                rep.warn("note_absolute_path", file=cfg.rel(path), target=t)
                continue
            rep.count("note_link_folder", cfg.rel_folder((path.parent / t.split("#")[0]).resolve()))
