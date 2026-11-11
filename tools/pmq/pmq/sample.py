"""pmq sample：把真實資料轉成介面開發用的樣本（第 0 階段 → 第 1A 階段）。

寫到 app/fixtures/，版面與正式內容包相同（c/manifest.json、c/taxonomy-…、c/index/…、
c/pack/…、c/kb/…、a/<sha>.<ext>），所以 1B 換成真實內容包時畫面程式不用改。
索引是兩科完整的；本文只有樣本題。總量 < 10 MB。
"""
import hashlib
import json
import random
import re
import shutil
import time
from pathlib import Path

from .build import Contract, dumps
from .check import disk_guard, validators
from .kb import KbBuilder, count_blocks
from .textutil import math_ranges

PER_KIND = 20
BUDGET = 9.5 * 1024 * 1024
SEED = "pmq-sample-2026-11-10"

KIND_NAME = {"postmed_w": "後西醫", "postmed_c": "後中醫", "postmed_v": "後獸醫", "private_med": "私醫",
             "transfer": "轉學考", "national": "醫事國考", "textbook": "原文書", "cram": "補習班教材"}


def _u16(s, a, b):
    e = s.encode("utf-16-le")
    return e[a * 2:b * 2].decode("utf-16-le")


def _opts(q):
    return [_u16(q["ques"], a, b) for _, a, b in q["opt"]] if q["opt"] else []


def _max_formula(q):
    best = 0
    for f in ("ques", "sol"):
        for a, b, _ in math_ranges(q[f]):
            best = max(best, b - a)
    return best


def _table_cols(text):
    cols = 0
    for line in text.split("\n"):
        if line.lstrip().startswith("|"):
            cols = max(cols, line.count("|") - 1)
    return cols


def _figs(q, role=None, ext=None):
    return [f for f in q["figs"] if (role is None or f["role"] == role) and (ext is None or f["src"].endswith("." + ext))]


CASES = [
    # (key, 說明, predicate, sort key — larger first; None = deterministic random)
    ("longest_ques", "最長的題幹", lambda q: True, lambda q: len(q["ques"])),
    ("longest_formula", "最長的公式（題幹或詳解）", lambda q: True, _max_formula),
    ("longest_sol", "最長的詳解", lambda q: True, lambda q: len(q["sol"])),
    ("table", "題幹含表格", lambda q: _table_cols(q["ques"]) > 0 or "<table" in q["ques"], lambda q: _table_cols(q["ques"])),
    ("table_in_sol", "詳解含寬表格", lambda q: _table_cols(q["sol"]) > 0, lambda q: _table_cols(q["sol"])),
    ("fig_svg", "題圖是 SVG", lambda q: bool(_figs(q, "q", "svg")), None),
    ("fig_svg_mono", "SVG 只用黑白灰（可反相）", lambda q: any(f["mono"] for f in _figs(q, "q", "svg")), None),
    ("fig_svg_color", "彩色 SVG（不可反相）", lambda q: any(not f["mono"] for f in _figs(q, "q", "svg")), None),
    ("fig_png", "題圖是 PNG", lambda q: bool(_figs(q, "q", "png")), None),
    ("fig_png_max_w", "PNG 有最大寬度（生化 width=…cm）", lambda q: any(f["max_w"] for f in q["figs"]), None),
    ("fig_q_and_sol", "題目版與解答版兩張圖（traced_q／traced）",
     lambda q: bool(_figs(q, "q")) and bool(_figs(q, "sol")) and {f["src"] for f in _figs(q, "q")} != {f["src"] for f in _figs(q, "sol")}, None),
    ("fig_many", "一題多張圖", lambda q: len(q["figs"]) >= 3, lambda q: len(q["figs"])),
    ("options_one_line", "選項擠在同一行", lambda q: q["opt"] and "\n" not in q["ques"][q["opt_span"][0]:q["opt"][-1][1]], None),
    ("options_image", "選項是圖", lambda q: any("fig:" in o for o in _opts(q)), None),
    ("options_math", "選項是公式", lambda q: len(_opts(q)) >= 3 and all(o.startswith("$") for o in _opts(q)), None),
    ("options_long", "選項文字很長", lambda q: bool(q["opt"]), lambda q: max((len(o) for o in _opts(q)), default=0)),
    ("options_many", "選項最多（8 個以上）", lambda q: q["opt"] and len(q["opt"]) >= 6, lambda q: len(q["opt"] or [])),
    ("options_tail", "選項後還有補充文字或圖", lambda q: q["opt_span"] and q["ques"][q["opt_span"][1]:].strip() != "", None),
    ("non_choice_text", "非選擇題（文字答案，自評）", lambda q: q["qtype"] == "text" and q["answer"]["mode"] == "text", None),
    ("non_choice_numeric", "非選擇題（數值答案，自評）", lambda q: q["qtype"] == "numeric", None),
    ("multi_answer", "複選題（answer.mode = all）", lambda q: q["answer"]["mode"] == "all", None),
    ("any_answer", "多個答案皆可／送分（mode = any）", lambda q: q["answer"]["mode"] == "any", None),
    ("pending_answer", "答案待定（mode = pending）", lambda q: q["answer"]["mode"] == "pending", None),
    ("group_shared", "題組：共用前提（group.gid）", lambda q: q["group"] and not q["group"]["parts"], None),
    ("group_parts", "一題多小題（group.parts）", lambda q: q["group"] and q["group"]["parts"], None),
    ("opt_parse_failed", "選擇題但選項解析失敗（自評顯示）", lambda q: q["answer"]["mode"] in ("single", "all", "any") and q["opt"] is None, None),
    ("issues", "有疑點（sol_meta.issues）", lambda q: bool(q["sol_meta"]["issues"]), lambda q: sum(len(i) for i in q["sol_meta"]["issues"])),
    ("no_sol", "沒有詳解", lambda q: not q["sol"].strip(), None),
    ("no_idea", "沒有思路（生化全部沒有）", lambda q: not q["idea"].strip(), None),
    ("teacher", "有老師原解（折疊區）", lambda q: bool(q["teacher"]), None),
    ("source_answer", "教材原答與現行答案不同", lambda q: q["source_answer"] is not None, None),
    ("alt_same", "有同題出處（alt_sources same）", lambda q: any(a["relation"] == "same" for a in q["alt_sources"]), None),
    ("canonical_other", "同題群組的非代表題（canonical ≠ 自己）", lambda q: q["canonical"] != q["id"], None),
    ("trust_official", "官方答案", lambda q: q["answer"]["trust"] == "official", None),
    ("trust_key", "答案表", lambda q: q["answer"]["trust"] == "key", None),
    ("trust_teacher", "老師答案", lambda q: q["answer"]["trust"] == "teacher", None),
    ("trust_ai", "AI 答案", lambda q: q["answer"]["trust"] == "ai", None),
    ("long_label", "最長的來源名稱", lambda q: True, lambda q: len(q["label"])),
    ("unicode_subsup", "Unicode 上下標（CO₂、NAD⁺）", lambda q: bool(re.search(r"[₀-₉⁰-⁹⁺⁻]", q["ques"])), None),
]


def make_sample(cfg):
    disk_guard()
    t0 = time.time()
    c = Contract(cfg).run()
    rng = random.Random(SEED)
    by_sub = {"PHY": [q for q in c.questions if q["subject"] == "PHY"], "BCH": [q for q in c.questions if q["subject"] == "BCH"]}
    chosen = {}          # id -> list of case keys
    case_rows = []
    budget = {"bytes": 0}

    def size_of(q):
        return sum(c.assets.published()[f["src"]]["bytes"] for f in q["figs"] if f["src"] in c.assets.published())

    def take(q, key):
        if q["id"] not in chosen:
            budget["bytes"] += size_of(q)
        chosen.setdefault(q["id"], []).append(key)

    for key, desc, pred, sortkey in CASES:
        for sub, qs in by_sub.items():
            pool = [q for q in qs if pred(q)]
            if not pool:
                continue
            if sortkey is not None:
                pool.sort(key=lambda q: (-sortkey(q), q["id"]))
                picks = pool[:1]
            else:
                pool.sort(key=lambda q: q["id"])
                light = [q for q in pool if size_of(q) < 400 * 1024] or pool
                picks = rng.sample(light, min(2, len(light)))
            for q in picks:
                take(q, key)
                case_rows.append((key, desc, sub, q))

    for sub, qs in by_sub.items():
        kinds = sorted({q["source"]["kind"] for q in qs})
        for kind in kinds:
            pool = sorted((q for q in qs if q["source"]["kind"] == kind and size_of(q) < 300 * 1024), key=lambda q: q["id"])
            for q in rng.sample(pool, min(PER_KIND, len(pool))):
                take(q, f"kind:{kind}")

    out = cfg.fixtures
    for sub in ("c", "a"):
        if (out / sub).exists():
            shutil.rmtree(out / sub)
    (out / "c").mkdir(parents=True, exist_ok=True)
    (out / "a").mkdir(parents=True, exist_ok=True)
    files = {}

    def write(prefix, obj):
        data = dumps(obj).encode("utf-8")
        h = hashlib.sha256(data).hexdigest()[:12]
        rel = f"c/{prefix}-{h}.json"
        (out / rel).parent.mkdir(parents=True, exist_ok=True)
        (out / rel).write_bytes(data)
        return rel

    files["taxonomy"] = write("taxonomy", c.taxonomy)
    files["index"] = {s: write(f"index/{s}", c.index(s)) for s in by_sub}
    sample_qs = [q for q in c.questions if q["id"] in chosen]
    packs = {}
    for q in sample_qs:
        packs.setdefault(q["pack"], []).append(c.public(q))
    files["packs"] = {p: write(f"pack/{p}", {"pack": p, "questions": qs}) for p, qs in sorted(packs.items())}

    # notes
    kb_docs = build_kb_docs(cfg, c)
    files["kb"] = {k: write(f"kb/{k}", d) for k, d in kb_docs.items()}

    # assets: sample questions + notes; fallback PNGs only while under budget
    pub = c.assets.published()
    need = []
    for q in sample_qs:
        for f in q["figs"]:
            need.append(f["src"])
    for d in kb_docs.values():
        need += [f["src"] for f in d["figs"]]
    fallbacks = [f["fallback"] for q in sample_qs for f in q["figs"] if f["fallback"]]
    copied = set()
    total = sum((out / p).stat().st_size for p in _walk(out / "c"))

    def copy(key):
        nonlocal total
        if key in copied or key not in pub:
            return
        info = pub[key]
        shutil.copyfile(info["path"], out / key)
        copied.add(key)
        total += info["bytes"]
    for k in need:
        copy(k)
    dropped = 0
    for k in fallbacks:
        if total + pub[k]["bytes"] > BUDGET:
            dropped += 1
            continue
        copy(k)

    cases = {}
    for key, desc, sub, q in case_rows:
        cases.setdefault(key, {"desc": desc, "ids": []})["ids"].append(q["id"])
    sample = {"ids": sorted(chosen), "cases": cases, "kb": list(kb_docs)}
    files["sample"] = write("sample", sample)
    manifest = {
        "version": 1, "sample": True, "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "counts": {s: len(qs) for s, qs in by_sub.items()},
        "sample_counts": {s: sum(1 for q in sample_qs if q["subject"] == s) for s in by_sub},
        "files": files,
        "missing_fallbacks": dropped,
    }
    (out / "c/manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), "utf-8")

    # validate everything that went out with the same schemas
    v = validators(cfg)
    bad = [q["id"] for q in sample_qs if not v["question"].is_valid(c.public(q))]
    bad_idx = sum(1 for s in by_sub for r in c.index(s) if not v["index-row"].is_valid(r))
    bad_tax = not v["taxonomy"].is_valid(c.taxonomy)
    bad_kb = [k for k, d in kb_docs.items() if not v["kb"].is_valid(d)]
    missing_assets = [k for k in need if not (out / k).exists()]
    total = sum(p.stat().st_size for p in _walk(out))
    write_cases_md(cfg, case_rows, chosen, sample_qs, kb_docs, total, manifest)
    c.cache.save(prune=False)
    print(f"樣本 {len(sample_qs)} 題（物理 {manifest['sample_counts']['PHY']}、生化 {manifest['sample_counts']['BCH']}），"
          f"情況 {len(cases)} 種；筆記 {len(kb_docs)} 份；圖 {len(copied)} 個；總量 {total / 1e6:.2f} MB；"
          f"略過的 fallback PNG {dropped}；{time.time() - t0:.1f} 秒")
    print(f"Schema：題目不過 {len(bad)}、索引列不過 {bad_idx}、taxonomy {'不過' if bad_tax else '通過'}、筆記不過 {len(bad_kb)}；缺圖 {len(missing_assets)}")
    for k, d in kb_docs.items():
        print(f"  {k}: {json.dumps(count_blocks(d['blocks']), ensure_ascii=False)}；圖 {len(d['figs'])}；考古題出處 {len(d['refs'])}（對應不到 {sum(1 for r in d['refs'] if not r['qid'])}）")
    if bad or bad_idx or bad_tax or bad_kb or missing_assets:
        raise SystemExit("樣本沒有通過檢查")


def build_kb_docs(cfg, c):
    """pmq.toml [sample] 指定的兩份筆記 → 區塊樹（第 4 階段做完整的筆記轉接器之前，sample 與 publish 共用）。"""
    source_to_id = {}
    for q in c.questions:
        if q["subject"] != "BCH":
            continue
        s = q["source"]
        sess = q["id"].split("-")[2] if s["kind"] == "national" else None
        try:
            source_to_id[(s["school"], s["year"], sess, int(s["qno"]))] = q["id"]
        except (TypeError, ValueError):
            pass
    kbb = KbBuilder(cfg, c.assets, c.report, source_to_id)
    kb_docs = {}
    for sub, key in (("BCH", "kb_biochem"), ("PHY", "kb_physics")):
        rel = cfg.sample.get(key)
        if not rel:
            continue
        doc = kbb.build(cfg.notes / rel, sub)
        kb_docs[f"{sub}/{doc['doc']}"] = doc
    return kb_docs


def pick_cases(c):
    """每種特殊情況、每科挑 1–2 題（與 sample 相同的規則，但不受樣本大小限制）。給 /dev/ui 的特殊情況連結用。"""
    rng = random.Random(SEED)
    cases = {}
    for key, desc, pred, sortkey in CASES:
        for sub in ("PHY", "BCH"):
            pool = [q for q in c.questions if q["subject"] == sub and pred(q)]
            if not pool:
                continue
            if sortkey is not None:
                pool.sort(key=lambda q: (-sortkey(q), q["id"]))
                picks = pool[:1]
            else:
                pool.sort(key=lambda q: q["id"])
                picks = rng.sample(pool, min(2, len(pool)))
            cases.setdefault(key, {"desc": desc, "ids": []})["ids"] += [q["id"] for q in picks]
    return cases


def _walk(p):
    return [x for x in Path(p).rglob("*") if x.is_file()]


def write_cases_md(cfg, case_rows, chosen, sample_qs, kb_docs, total, manifest):
    L = ["# 樣本情況對照表", "",
         f"由 `bin/pmq sample` 產生（{manifest['generated']}）。樣本 {len(sample_qs)} 題、總量 {total / 1e6:.2f} MB。",
         "索引（`c/index/`）是兩科完整的，篩選器顯示的是真實題數；本文（`c/pack/`）只有下表與各來源類別隨機抽的題目。",
         "樣本題的 ID 清單在 `c/sample-*.json` 的 `ids`；某題不在樣本裡時，畫面應顯示「本文未下載」而不是壞掉。", "",
         "| 情況 | 科目 | 題目 | 說明 |", "|---|---|---|---|"]
    for key, desc, sub, q in case_rows:
        L.append(f"| `{key}` | {sub} | {q['label']}｜{q['id']} | {desc} |")
    L += ["", "## 各來源類別隨機題", "", "| 科目 | 類別 | 題數 |", "|---|---|---|"]
    counts = {}
    for q in sample_qs:
        for k in chosen[q["id"]]:
            if k.startswith("kind:"):
                counts[(q["subject"], k[5:])] = counts.get((q["subject"], k[5:]), 0) + 1
    for (sub, kind), n in sorted(counts.items()):
        L.append(f"| {sub} | {KIND_NAME.get(kind, kind)} | {n} |")
    L += ["", "## 筆記區塊樹", ""]
    for k, d in kb_docs.items():
        L.append(f"- `{k}`（{d['file']}）：{json.dumps(count_blocks(d['blocks']), ensure_ascii=False)}；圖 {len(d['figs'])}；考古題出處 {len(d['refs'])}")
    (cfg.fixtures / "CASES.md").write_text("\n".join(L) + "\n", "utf-8")
