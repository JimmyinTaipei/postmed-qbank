"""生化答案抽查（第 0 階段；規格書 §4.4）。

每個來源類別固定抽 4 題（種子固定，重跑結果相同），從來源 PDF 擷取該題附近的文字，
寫成 reports/answer_excerpts.md 供人工判讀。判讀結果記在 docs/生化答案抽查.json，
`pmq check` 會把它併進驗證報告。PDF 只讀，用 pdftotext 輸出到記憶體，不留暫存檔。
"""
import json
import random
import re
import subprocess
from pathlib import Path

from .adapters.biochem import BiochemAdapter
from .adapters.common import Assets, Report
from .cache import HashCache

KIND_DIR = {"postmed_w": "01_後西醫", "postmed_c": "02_後中醫", "private_med": "03_私醫", "postmed_v": "04_後獸醫"}
NATIONAL = {"MED": "醫學", "DEN": "牙醫學", "MLS": "生物化學與臨床生化學", "NUT": "生理學與生物化學"}
PER_KIND = 4
SEED = "pmq-answer-spotcheck-2026-11-10"


def pick(questions):
    rng = random.Random(SEED)
    out = []
    for kind in ("postmed_w", "postmed_c", "postmed_v", "private_med", "national"):
        pool = [q for q in questions if q["source"]["kind"] == kind and q["answer"]["mode"] == "single"]
        papers = sorted({q["_paper_file"] for q in pool})
        rng.shuffle(papers)
        for paper in papers[:PER_KIND]:
            cands = sorted((q for q in pool if q["_paper_file"] == paper), key=lambda q: q["id"])
            out.append(rng.choice(cands))
    return out


def candidate_pdfs(cfg, q):
    s = q["source"]
    if s["kind"] == "national":
        prefix, year, sess, _ = q["id"].split("-")
        folder = cfg.biochem / "01_來源索引/原始PDF/醫事國考" / f"{year}-{sess}"
        return sorted(p for p in folder.glob("*ANS*.pdf") if NATIONAL[prefix] in p.name) if folder.exists() else []
    base = cfg.exam_pdfs / KIND_DIR[s["kind"]]
    year = str(s["year"])
    hits = []
    for p in base.rglob("*.pdf"):
        if p.parent.name != year:
            continue
        if s["kind"] != "private_med" and s["school"] not in str(p.parent.parent.name) + p.name:
            continue
        if re.search(r"生|答案|解答", p.name):
            hits.append(p)
    return sorted(hits)


def pdf_text(path):
    r = subprocess.run(["pdftotext", "-layout", str(path), "-"], capture_output=True, text=True)
    return r.stdout


def excerpt(text, qno, kind):
    lines = text.split("\n")
    n = int(qno)
    out = []
    pat = re.compile(rf"^\s*(?:第\s*)?0?{n}\s*(?:[.、．)）]|題)")
    for i, line in enumerate(lines):
        if pat.match(line):
            out.append("\n".join(lines[i:i + 18]))
    ans_lines = [l for l in lines if re.search(r"解答|答案|Ans", l)]
    return out[:3], ans_lines[:6]


def spotcheck(cfg):
    report = Report()
    cache = HashCache(cfg.cache)
    adapter = BiochemAdapter(cfg, cache, report, Assets(cache, report))
    qs = adapter.load()
    chosen = pick(qs)
    md = ["# 生化答案抽查：PDF 擷取片段（人工判讀用）", ""]
    items = []
    for q in chosen:
        pdfs = candidate_pdfs(cfg, q)
        md.append(f"## {q['label']}｜{q['id']}（{q['source']['kind']}）主檔答案 {q['answer']['keys']}")
        md.append("")
        md.append("```")
        md.append(q["ques"][:600])
        md.append("```")
        for p in pdfs:
            text = pdf_text(p)
            hits, ans = excerpt(text, q["source"]["qno"], q["source"]["kind"])
            md.append(f"**{cfg.rel(p)}**（{len(text)} 字）")
            md.append("")
            for h in hits:
                md += ["```", h, "```"]
            if ans:
                md += ["答案相關行：", "```", *ans, "```"]
            md.append("")
        items.append({"id": q["id"], "label": q["label"], "kind": q["source"]["kind"], "bank": "".join(q["answer"]["keys"]),
                      "pdfs": [cfg.rel(p) for p in pdfs]})
    (cfg.reports / "answer_excerpts.md").write_text("\n".join(md), "utf-8")
    judged = cfg.project / "docs/生化答案抽查.json"
    if judged.exists():
        return json.loads(judged.read_text("utf-8"))
    return {"method": "尚未判讀", "items": items, "summary": {"match": 0, "mismatch": 0, "unknown": len(items)}}
