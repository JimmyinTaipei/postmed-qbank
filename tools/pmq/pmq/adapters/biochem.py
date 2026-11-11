"""Biochem adapter: 01_題庫製作/生化/02_原卷題庫 → content contract (規格書 §4, 搬遷步驟 5).

Read-only. 03_分章題庫/ and _raw_backup/ are never opened.
"""
import json
import re
from pathlib import Path

from ..labels import biochem_label
from ..textutil import math_ranges, parse_options, sha1
from .common import ALT_ATTR, HTML_IMG, MD_LINK, SRC_ATTR, WIDTH_ATTR, attr, link_target, sub_spans
from ..figs import CM_TO_PX

FOLDER_KIND = {"01_後西醫": "postmed_w", "02_後中醫": "postmed_c", "03_後獸醫": "postmed_v",
               "04_私醫": "private_med", "05_醫事國考": "national"}
KEYS = ("ID", "source", "chap", "xchap", "ques", "ans", "sol", "verified")
KEY_LINE = re.compile(r"^(ID|source|chap|xchap|ques|ans|sol|verified):[ \t]?(.*)$")
ID_RE = re.compile(r"^[A-Z]+-[0-9A-Za-z-]+$")


class BiochemAdapter:
    subject = "BCH"

    def __init__(self, cfg, cache, report, assets):
        self.cfg = cfg
        self.root = cfg.biochem
        self.cache = cache
        self.report = report
        self.assets = assets

    def chapters(self):
        books = json.loads((self.root / "analysis/biochem_taxonomy.json").read_text("utf-8"))
        out = []
        order = 0
        for book in books:
            for ch in book["chapters"]:
                order += 1
                cid = ch["chapter_code"]
                out.append({"id": f"BCH:{cid}", "subject": "BCH", "parent": None, "title": ch["chapter_title"],
                            "order": order, "book": book.get("book_name")})
                for i, sec in enumerate(ch.get("sections", []), 1):
                    out.append({"id": f"BCH:{sec['section_code']}", "subject": "BCH", "parent": f"BCH:{cid}",
                                "title": sec["section_title"], "order": i})
                    for j, sub in enumerate(sec.get("subsections", []), 1):
                        out.append({"id": f"BCH:{sub['code']}", "subject": "BCH", "parent": f"BCH:{sec['section_code']}",
                                    "title": sub["title"], "order": j})
        return out

    def files(self):
        bank = self.root / "02_原卷題庫"
        for folder in sorted(bank.iterdir()):
            if not folder.is_dir() or folder.name not in FOLDER_KIND:
                continue
            for path in sorted(folder.glob("*.md")):   # not recursive: _raw_backup/ stays unread
                if path.name.lower() == "readme.md" or " 2." in path.name:
                    continue
                yield folder.name, path

    def load(self):
        out = []
        seen = {}
        for folder, path in self.files():
            data = path.read_bytes()
            self.cache.sha256(path, data)
            text = data.decode("utf-8")
            for block in self._blocks(text):
                qid = block["fields"].get("ID", "").strip()
                self.report.count("bch_blocks", FOLDER_KIND[folder])
                if qid in seen:
                    first = seen[qid]
                    same = first["_raw"] == block["raw"]
                    info = dict(id=qid, first=f"{first['file']}:{first['line']}", second=f"{self.cfg.rel(path)}:{block['line']}")
                    if same:
                        self.report.warn("duplicate_identical", **info)
                    else:
                        self.report.error("ID 重複且內容不同", **info)
                    continue
                q = self._question(folder, path, block)
                seen[qid] = q
                out.append(q)
        return out

    def _blocks(self, text):
        lines = text.split("\n")
        blocks = []
        cur = None
        for i, line in enumerate(lines):
            m = KEY_LINE.match(line)
            if m and m.group(1) == "ID":
                cur = {"line": i + 1, "start": i, "fields": {}, "spans": {}, "order": []}
                blocks.append(cur)
            if cur is None:
                if line.strip():
                    self.report.warn("biochem_text_before_first_id", line=i + 1, text=line[:60])
                continue
            if m:
                key = m.group(1)
                if key in cur["fields"]:
                    self.report.warn("biochem_key_repeated", id=cur["fields"].get("ID"), key=key, line=i + 1)
                cur["order"].append(key)
                cur["spans"][key] = [i, i + 1]
                cur["fields"][key] = m.group(2)
                cur["_last"] = key
            else:
                key = cur.get("_last")
                if key:
                    cur["fields"][key] += "\n" + line
                    cur["spans"][key][1] = i + 1
            cur["end"] = i + 1
        for b in blocks:
            b["raw"] = "\n".join(lines[b["start"]:b["end"]]).rstrip()
            b["lines"] = lines
        return blocks

    def _rewrite(self, qid, text, base, figs, role, collect=None, key=None):
        ranges = math_ranges(text)

        def html(m):
            if any(a <= m.start() < b for a, b, _ in ranges):
                return m.group(0)
            tag = m.group(0)
            src = attr(SRC_ATTR, tag)
            if not src or re.match(r"^[a-z]+:", src):
                return tag
            path = (base / src).resolve()
            self.report.count("link_folder", self.cfg.rel_folder(path))
            info = self.assets.get(path, qid)
            self.report.count("bch_fig_refs", "png" if info else "missing")
            if info is None:
                return ""
            width = attr(WIDTH_ATTR, tag)
            max_w = None
            if width:
                mm = re.match(r"^\s*([\d.]+)\s*(cm|px)?\s*$", width)
                if mm:
                    max_w = round(float(mm.group(1)) * (CM_TO_PX if mm.group(2) == "cm" else 1))
            fid = "B" + info["sha"][:10]
            alt = attr(ALT_ATTR, tag) or "題圖"
            if not any(f["fid"] == fid and f["role"] == role for f in figs):
                figs.append({"fid": fid, "role": role, "src": info["key"], "w": info.get("w"), "h": info.get("h"),
                             "mono": False, "fallback": None, "alt": alt, "max_w": max_w})
            return f"![{alt}](fig:{fid})"

        def md(m):
            if any(a <= m.start() < b for a, b, _ in ranges):
                return m.group(0)
            target = link_target(m)
            if re.match(r"^[a-z]+:", target) or target.startswith("#"):
                return m.group(0)
            path = (base / target.split("#")[0]).resolve()
            self.report.count("link_folder", self.cfg.rel_folder(path))
            self.report.warn("biochem_md_link", id=qid, target=target)
            return m.group(2)
        mid, spans = sub_spans(HTML_IMG, html, text)
        out, spans2 = sub_spans(MD_LINK, md, mid)
        if collect is not None:
            # 第二輪（相對連結 → 純文字）的位置是對第一輪結果算的；這種欄位不寫回（極少，見 patches.py）
            collect[key] = None if spans2 else spans
        return out

    def _question(self, folder, path, block):
        f = block["fields"]
        qid = f.get("ID", "").strip()
        src = f.get("source", "").strip()
        parts = src.split("-")
        school = parts[0] if parts else None
        year = _int(parts[1]) if len(parts) > 1 else None
        session = parts[2] if len(parts) == 4 else None
        qno = parts[-1] if len(parts) >= 3 else None
        kind = FOLDER_KIND[folder]
        stem = path.stem
        paper = f"第{session}次" if session else (stem.split("_", 2)[2] if stem.count("_") >= 2 else None)
        figs = []
        self.last_spans = {}
        ques = self._rewrite(qid, f.get("ques", "").rstrip(), path.parent, figs, "q", self.last_spans, "ques")
        sol = self._rewrite(qid, f.get("sol", "").rstrip(), path.parent, figs, "sol", self.last_spans, "sol")
        verified = f.get("verified", "").strip()
        parsed = parse_options(ques)
        letters = [o[0] for o in parsed["opt"]] if parsed else []
        raw_ans = f.get("ans", "").strip()
        note = ""
        if re.fullmatch(r"[A-H]", raw_ans):
            mode, keys = "single", [raw_ans]
        elif re.fullmatch(r"(本題)?送分", raw_ans):
            mode, keys, note = "any", letters, raw_ans
            self.report.warn("biochem_answer_special", id=qid, ans=raw_ans, mapped="any（任一選項皆對）")
        elif re.fullmatch(r"[A-H](或[A-H])+", raw_ans):
            mode, keys, note = "any", raw_ans.split("或"), raw_ans
            self.report.warn("biochem_answer_special", id=qid, ans=raw_ans, mapped="any")
        elif re.fullmatch(r"[A-H](\s*[,，、]?\s*[A-H])+", raw_ans):
            mode, keys = "all", re.findall(r"[A-H]", raw_ans)
            self.report.warn("biochem_answer_special", id=qid, ans=raw_ans, mapped="all（複選）")
        else:
            mode, keys, note = "pending", [], raw_ans
            self.report.warn("biochem_answer_unparsed", id=qid, ans=raw_ans)
        qtype = {"single": "single", "any": "single", "all": "multi"}.get(mode, "text")
        if parsed is None:
            self.report.warn("option_parse_failed", id=qid, mode=mode, label=biochem_label(src))
        elif any(k not in letters for k in keys):
            self.report.warn("answer_key_not_in_options", id=qid, keys=keys, options=letters)
        chap = f.get("chap", "").strip()
        xchap = [x for x in re.split(r"[\s,，、;；]+", f.get("xchap", "").strip()) if x]
        raw_fields = {k: "\n".join(block["lines"][a:b]) for k, (a, b) in block["spans"].items()}
        self.report.count("category", kind)
        return {
            "id": qid,
            "subject": "BCH",
            "label": biochem_label(src) if src else qid,
            "source": {"sid": f"BCH-SRC-{stem}", "kind": kind, "school": school, "year": year, "paper": paper,
                       "book": None, "unit": None, "qno": qno},
            "alt_sources": [],
            "canonical": qid,
            "chap": f"BCH:{chap}" if chap else None,
            "xchap": [f"BCH:{x}" for x in xchap],
            "tags": {},
            "qtype": qtype,
            "group": None,
            "ques": ques,
            "opt": parsed["opt"] if parsed else None,
            "opt_span": parsed["span"] if parsed else None,
            "answer": {"mode": mode, "keys": keys, "text": None, "trust": "official", "ai_agree": False, "note": note},
            "source_answer": None,
            "idea": "",
            "sol": sol,
            "teacher": [],
            "sol_meta": {"origin": "ai", "model": None, "human_verified": bool(verified), "verified_at": verified or None,
                         "issues": [], "state": None, "raw": None},
            "figs": figs,
            "extraction": None,
            "file": self.cfg.rel(path),
            "line": block["line"],
            "h": {"ques": sha1(raw_fields.get("ques", "")), "idea": sha1(""), "sol": sha1(raw_fields.get("sol", ""))},
            "_raw": block["raw"],
            "_paper_file": stem,
            "_ans_raw": raw_ans,
        }


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
