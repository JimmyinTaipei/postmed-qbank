"""「共用格式」轉接器（英文；之後生物、化學的新題庫也用）→ 內容契約（規格書 §4.3、§9.11「8A」）。

主檔格式見 `01_題庫製作/共用規格/README.md`（schema 1.0）：一份考卷（或一章原文書）一個 `.md`，
開頭 `---` 區塊是 JSON；正文用 `## question <ID>`、`## passage <ID>` 分段，每段緊接一個 ```json 區塊，
題目本文是 `### stem`、`### option A`…、`### solution`，題組（共用文章）是 `### content`。

唯讀：這裡只讀 `02_原卷題庫/**/*.md`；`03_分章題庫`、`04_輸出` 是那一套工具重建出來的，不讀。
主檔格式與 `scripts/題庫/bank.py` 由另一套工具維護，這裡不改它們。

對應規則（規格書 §9.11 的表）：
- passage 的 `### content` → group.stem；group.gid ＝ passage id；group.order ＝ 原卷題號
- chapter（EN01…）→ chap（ENG:EN01）；8C 的子章節分類檔（文法 G01–G25）→ xchap；講義題用它所在的章
- source_section → tags.type（中文名）；講義的考點寫在 tags.topic
- answer.accepted 一個 → single；多個 → any（多個答案皆可）；award_all → any＋全部選項（送分）
- type=short_answer（作文、問答）→ 自評題
- issues、source_issues → sol_meta.issues（題目上的疑點）
"""
import json
import re
from pathlib import Path

from ..textutil import parse_options, sha1, utf16_map
from .common import MD_LINK, link_target

FRONT = re.compile(r"\A---\n(.*?)\n---\n", re.S)
SECTION = re.compile(r"^## (question|passage) (\S+)[ \t]*$", re.M)
META = re.compile(r"\A\s*```json\n(.*?)\n```[ \t]*\n?", re.S)
SUB = re.compile(r"^### (.+?)[ \t]*$", re.M)
LETTERS = "ABCDEFGH"

# 考試類別（主檔的 exam_category，沒有時看資料夾名稱）→ 來源類型
CATEGORY_KIND = {"後西醫": "postmed_w", "後中醫": "postmed_c", "後獸醫": "postmed_v", "私醫聯招": "private_med",
                 "私醫": "private_med", "轉學考": "transfer"}
SOURCE_KIND = {"textbook": "textbook", "lecture_handout": "cram", "ai": "ai"}

# source_section → 出題設定與題目上顯示的題型（tags.type）
SECTION_NAME = {
    "vocabulary": "字彙", "vocabulary_completion": "字彙", "vocabulary_and_usage": "字彙", "vocabulary_usage": "字彙",
    "vocabulary_synonym": "同義字", "usage": "用法", "grammar": "文法", "grammar_completion": "文法",
    "grammar_error_identification": "文法挑錯", "sentence_completion": "句子完成", "cloze": "克漏字",
    "discourse_cloze": "篇章結構", "discourse_structure": "篇章結構", "reading": "閱讀", "essay_writing": "作文",
    "translation": "翻譯",
}
TRUST = {"school_key": "official", "school_corrected": "official", "publisher_key": "key", "missing": "pending"}


class SharedAdapter:
    """一科一個實例；subject、資料夾、章節名稱都從 pmq.toml 的 [subjects.<ID>] 來。"""

    def __init__(self, cfg, cache, report, assets, spec):
        self.cfg = cfg
        self.cache = cache
        self.report = report
        self.assets = assets
        self.subject = spec["id"]
        self.root = spec["path"]
        self.spec = spec
        self._catalog = {}

    # ---------- 章節 ----------

    def chapters(self):
        """章節目錄：各卷 front matter 的 chapter_catalog 合併（同一個代碼名稱要一致）。"""
        cat = {}
        for path in self.files():
            meta, _ = self._front(path)
            for code, title in (meta.get("chapter_catalog") or {}).items():
                if code in cat and cat[code] != title:
                    self.report.warn("shared_chapter_title_differs", subject=self.subject, code=code, a=cat[code], b=title, file=self.cfg.rel(path))
                cat.setdefault(code, title)
        self._catalog = cat
        out = [{"id": f"{self.subject}:{code}", "subject": self.subject, "parent": None, "title": title, "order": i}
               for i, (code, title) in enumerate(sorted(cat.items()), 1)]
        xc = self.load_xchap()
        if xc:
            parent = self.spec.get("xchap_parent")
            pid = f"{self.subject}:{parent}" if parent else None
            if parent and parent not in cat:
                self.report.error("子章節的上層章節不在章節目錄", subject=self.subject, parent=parent)
                pid = None
            out += [{"id": f"{self.subject}:{code}", "subject": self.subject, "parent": pid, "title": title, "order": i}
                    for i, (code, title) in enumerate(xc["chapters"].items(), 1)]
        return out

    # ---------- 子章節分類檔（第 8C 階段）----------

    XCHAP_MAX = 4

    def load_xchap(self):
        """子章節分類檔（pmq.toml 的 xchap_file，相對科目資料夾）。格式：
        {"chapters": {"G01": "基本句型", …}（順序就是章節樹的順序）,
         "questions": {"ENG-000123": ["G09", "G12"], …}（第一個是最主要的，最多 4 個）,
         "unsure": ["ENG-…"]（分得勉強、待複核；只是記錄）}
        講義題（front matter 的 book.chapter 是數字）不必寫進來：自動歸到代碼數字相同的那一章。
        回傳 None ＝ 這一科沒有分類檔。"""
        if hasattr(self, "_xchap"):
            return self._xchap
        self._xchap = None
        rel = self.spec.get("xchap_file")
        if not rel:
            return None
        path = self.root / rel
        if not path.exists():
            self.report.error("子章節分類檔不存在", subject=self.subject, file=self.cfg.rel(path))
            return None
        try:
            data = json.loads(path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            self.report.error("子章節分類檔讀不到或不是 JSON", file=self.cfg.rel(path), message=str(e))
            return None
        self.cache.sha256(path, path.read_bytes())
        chapters = data.get("chapters") if isinstance(data.get("chapters"), dict) else {}
        if not chapters:
            self.report.error("子章節分類檔沒有 chapters", file=self.cfg.rel(path))
        qmap = {}
        for qid, codes in (data.get("questions") or {}).items():
            if not isinstance(codes, list) or not codes:
                self.report.error("子章節分類檔：章節要是非空的清單", id=qid, file=self.cfg.rel(path))
                continue
            bad = [c for c in codes if c not in chapters]
            if bad:
                self.report.error("子章節分類檔：章節代碼不在章節表", id=qid, codes=bad, file=self.cfg.rel(path))
            if len(codes) > self.XCHAP_MAX:
                self.report.error("子章節分類檔：一題最多 4 個章節", id=qid, count=len(codes), file=self.cfg.rel(path))
            if len(set(codes)) != len(codes):
                self.report.warn("xchap_duplicate_code", id=qid, codes=codes)
            qmap[qid] = [c for c in dict.fromkeys(codes) if c in chapters][: self.XCHAP_MAX]
        bynum = {}
        for code in chapters:
            m = re.search(r"\d+", code)
            if m:
                bynum.setdefault(int(m.group()), code)
        self._xchap = {"chapters": chapters, "questions": qmap, "bynum": bynum, "file": self.cfg.rel(path),
                       "unsure": [x for x in data.get("unsure") or [] if isinstance(x, str)]}
        return self._xchap

    def _xchap_of(self, qid, fmeta):
        xc = self.load_xchap()
        if not xc:
            return []
        codes = xc["questions"].get(qid)
        if codes is None and fmeta.get("source_kind") == "lecture_handout":
            ch = (fmeta.get("book") or {}).get("chapter") if isinstance(fmeta.get("book"), dict) else None
            code = xc["bynum"].get(int(ch)) if isinstance(ch, int) or (isinstance(ch, str) and ch.isdigit()) else None
            codes = [code] if code else []
            self.report.count("xchap", "講義題（所在的章）" if code else "講義題（章號對不到）")
        elif codes is not None:
            self.report.count("xchap", "分類檔")
        return [f"{self.subject}:{c}" for c in codes or []]

    # ---------- 讀檔 ----------

    def files(self):
        bank = self.root / "02_原卷題庫"
        if not bank.exists():
            self.report.error("共用格式主檔資料夾不存在", subject=self.subject, path=str(bank))
            return []
        return [p for p in sorted(bank.rglob("*.md")) if p.name.lower() != "readme.md" and " 2." not in p.name]

    def _front(self, path):
        text = path.read_text("utf-8")
        m = FRONT.match(text)
        if not m:
            return {}, text
        return json.loads(m.group(1)), text

    def load(self):
        out = []
        seen = {}
        for path in self.files():
            data = path.read_bytes()
            self.cache.sha256(path, data)
            text = data.decode("utf-8")
            m = FRONT.match(text)
            if not m:
                self.report.error("共用格式主檔沒有 front matter", file=self.cfg.rel(path))
                continue
            try:
                meta = json.loads(m.group(1))
            except json.JSONDecodeError as e:
                self.report.error("共用格式 front matter 不是 JSON", file=self.cfg.rel(path), message=str(e))
                continue
            passages, questions = self._sections(path, text)
            n = 0
            for sec in questions:
                q = self._question(path, meta, sec, passages)
                if q is None:
                    continue
                if q["id"] in seen:
                    self.report.error("ID 重複（共用格式）", id=q["id"], first=seen[q["id"]], second=f"{q['file']}:{q['line']}")
                    continue
                seen[q["id"]] = f"{q['file']}:{q['line']}"
                out.append(q)
                n += 1
            exp = meta.get("expected_count")
            if isinstance(exp, int) and exp != n:
                self.report.warn("shared_expected_count", file=self.cfg.rel(path), expected=exp, actual=n)
            self.report.count(f"{self.subject.lower()}_papers", meta.get("id") or path.stem, n)
            used = {g for q in out if q["group"] for g in q["_passages"]}
            for pid in passages:
                if pid not in used:
                    self.report.warn("shared_passage_unused", file=self.cfg.rel(path), passage=pid)
        self._number_groups(out)
        xc = self.load_xchap()
        if xc:
            known = {q["id"] for q in out}
            for qid in xc["questions"]:
                if qid not in known:
                    self.report.error("子章節分類檔：題目 ID 不存在", id=qid, file=xc["file"])
            self.report.count("xchap", "待複核（unsure）", len(xc["unsure"]))
        return out

    def _sections(self, path, text):
        """[(kind, id, meta, {子節名: 本文}, 行號, 原文)]，passage 另外放成 dict。"""
        heads = list(SECTION.finditer(text))
        passages, questions = {}, []
        for i, h in enumerate(heads):
            end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
            body = text[h.end():end]
            line = text.count("\n", 0, h.start()) + 1
            mm = META.match(body.lstrip("\n"))
            if not mm:
                self.report.error("共用格式段落沒有 JSON 區塊", file=self.cfg.rel(path), line=line, id=h.group(2))
                continue
            try:
                meta = json.loads(mm.group(1))
            except json.JSONDecodeError as e:
                self.report.error("共用格式段落的 JSON 壞了", file=self.cfg.rel(path), line=line, id=h.group(2), message=str(e))
                continue
            rest = body.lstrip("\n")[mm.end():]
            subs = {}
            parts = list(SUB.finditer(rest))
            for j, s in enumerate(parts):
                e = parts[j + 1].start() if j + 1 < len(parts) else len(rest)
                subs[s.group(1)] = rest[s.end():e].strip("\n")
            sec = {"kind": h.group(1), "id": h.group(2), "meta": meta, "subs": subs, "line": line, "raw": body}
            if meta.get("id") and meta["id"] != h.group(2):
                self.report.error("共用格式段落標題與 JSON 的 id 不同", file=self.cfg.rel(path), line=line, head=h.group(2), id=meta["id"])
            if sec["kind"] == "passage":
                passages[sec["id"]] = sec
            else:
                questions.append(sec)
        return passages, questions

    # ---------- 文字 ----------

    def _md(self, qid, text, base, figs, role):
        """主檔的 Markdown → 網站用：`$` 一律跳脫（英文主檔沒有 LaTeX，`$3 billion` 不能變成公式）、相對圖片 → fig:<fid>。"""
        text = re.sub(r"(?<!\\)\$", r"\\$", text) if self.spec.get("escape_dollar", True) else text

        def img(m):
            target = link_target(m)
            if m.group(1) != "!" or re.match(r"^[a-z]+:", target) or target.startswith("#"):
                return m.group(0)
            info = self.assets.get((base / target.split("#")[0]).resolve(), qid)
            if info is None:
                return ""
            fid = "S" + info["sha"][:10]
            if not any(f["fid"] == fid and f["role"] == role for f in figs):
                figs.append({"fid": fid, "role": role, "src": info["key"], "w": info.get("w"), "h": info.get("h"),
                             "mono": False, "fallback": None, "alt": m.group(2) or "題圖", "max_w": None})
            return f"![{m.group(2) or '題圖'}](fig:{fid})"
        return MD_LINK.sub(img, text)

    def _passage_md(self, sec, qid, base, figs):
        meta = sec["meta"]
        md = self._md(qid, sec["subs"].get("content", ""), base, figs, "q")
        # 克漏字的空格編號（「  21  」「_____16_____」「_30_」「35_」）→ <span class="cloze-blank">21</span>，網站上點了捲到那一小題（規格書 §9.11）
        nums = meta.get("blank_numbers") or (meta.get("numbers") if meta.get("section") in ("cloze", "discourse_cloze") else None) or []
        for n in nums:
            N = str(n)
            pat = re.compile(
                r"(?<![\w\[])_+[^\S\n]*" + N + r"[^\S\n]*_*(?![\w\]])"          # _____16_____、_30_
                r"|(?<![\w\[_])" + N + r"[^\S\n]*_+(?![\w\]])"                     # 35_
                r"|(?:(?<=[^\S\n]{2})|(?<=^)|(?<=\n))" + N + r"(?=[^\S\n]{2}|[^\S\n]*\n|[^\S\n]*[.,;:!?)]|[^\S\n]*$)")  # 「  21  」
            md, k = pat.subn(f'<span class="cloze-blank">{n}</span>', md, count=1)
            if not k:   # 「trend. 36 AI-driven」：句號後只有一個空白
                md, k = re.subn(r"(?<=[.!?;:\u201d\u2019\"'][^\S\n])" + N + r"(?=[^\S\n])", f'<span class="cloze-blank">{n}</span>', md, count=1)
            self.report.count("shared_blank_links", "linked" if k else "not_found")
            if not k:
                self.report.warn("shared_blank_not_found", passage=sec["id"], number=n)
        return md

    # ---------- 一題 ----------

    def _question(self, path, fmeta, sec, passages):
        m = sec["meta"]
        qid = m.get("id") or sec["id"]
        base = path.parent
        subs = sec["subs"]
        figs = []
        stem_raw = subs.get("stem", "")
        letters = [l for l in LETTERS if f"option {l}" in subs]
        stem = self._md(qid, stem_raw, base, figs, "q")
        ques, opt, span = stem, None, None
        if letters:
            ques = stem.rstrip() + "\n\n"
            opt = []
            u_parts = []
            for l in letters:
                body = self._md(qid, subs[f"option {l}"].strip(), base, figs, "q")
                # 選項內的空行會讓選項解析（規格書 §4.5）在那裡斷開，收成單一換行
                body = re.sub(r"\n[ \t]*\n+", "\n", body)
                marker = f"({l}) "
                start = len(ques) + len(marker)
                ques += marker + body
                opt.append([l, start, start + len(body)])
                ques += "\n"
                u_parts.append(l)
            ques = ques.rstrip("\n")
            span = [len(stem.rstrip()) + 2, len(ques)]
            u = utf16_map(ques)
            opt = [[l, u(a), u(b)] for l, a, b in opt]
            span = [u(span[0]), u(span[1])]
            chk = parse_options(ques)
            if not chk or chk["opt"] != opt:
                self.report.warn("shared_option_reparse_differs", id=qid)
        sol = self._md(qid, subs.get("solution", ""), base, figs, "sol").strip()

        a = m.get("answer") or {}
        accepted = [x for x in (a.get("accepted") or []) if isinstance(x, str)]
        qtype_raw = m.get("type")
        note = ""
        text_ans = None
        if qtype_raw == "short_answer" or not letters:
            qtype = "text"
            mode = "text" if accepted else "pending"
            keys = []
            text_ans = "\n\n".join(accepted) if accepted else None
            if m.get("response_format") == "essay":
                note = "作文" + (f"（至少 {m['minimum_words']} 字）" if m.get("minimum_words") else "") + "：沒有標準答案，看完題目自己評分"
                mode = "text"
        elif a.get("award_all"):
            qtype, mode, keys, note = "single", "any", letters, "送分"
        elif len(accepted) == 1 and accepted[0] in letters:
            qtype, mode, keys = "single", "single", accepted
        elif len(accepted) > 1 and all(x in letters for x in accepted):
            qtype, mode, keys = "single", "any", sorted(accepted)
            note = a.get("appeal_note") or "多個答案皆可"
        else:
            qtype, mode, keys = "single", "pending", []
            self.report.warn("shared_answer_unparsed", id=qid, accepted=accepted, status=a.get("status"))
        trust = TRUST.get(a.get("status"), "pending")
        if a.get("source") == "lecture_handout" or fmeta.get("source_kind") == "lecture_handout":
            trust = "teacher" if trust != "pending" else trust
        if mode == "pending":
            trust = "pending"
        original = [x for x in (a.get("original") or []) if isinstance(x, str)]
        source_answer = None
        if original and sorted(original) != sorted(accepted):
            source_answer = {"value": original, "mode": None, "kind": "school_original", "note": "學校原公布答案（之後釋疑改過）"}

        # 題組
        pids = [p for p in (m.get("passage_ids") or []) if p]
        group = None
        if pids:
            missing = [p for p in pids if p not in passages]
            for p in missing:
                self.report.error("passage_ids 指到不存在的文章", id=qid, passage=p, file=self.cfg.rel(path))
            mds = [self._passage_md(passages[p], qid, base, figs) for p in pids if p in passages]
            order = m.get("source_number") if isinstance(m.get("source_number"), int) else None
            group = {"gid": "+".join(pids), "stem": "\n\n---\n\n".join(mds) if mds else None, "order": order, "parts": [], "members": []}
            self.report.count("shared_group", "in_group")
        else:
            self.report.count("shared_group", "single")

        # 來源
        cat = fmeta.get("exam_category")
        folders = [x for x in path.relative_to(self.root / "02_原卷題庫").parts[:-1]]
        sk = fmeta.get("source_kind")
        if sk == "exam":
            kind = CATEGORY_KIND.get(cat) or next((CATEGORY_KIND[f] for f in folders if f in CATEGORY_KIND), None)
            if kind is None:
                self.report.error("共用格式：認不出考試類別", file=self.cfg.rel(path), exam_category=cat)
                kind = "self"
        else:
            kind = SOURCE_KIND.get(sk, "self")
        book = fmeta.get("book") if isinstance(fmeta.get("book"), dict) else None
        book_name = None
        unit = None
        if book:
            book_name = (fmeta.get("title") or "").split("｜")[0] or book.get("title")
            ch = book.get("chapter")
            unit = f"Ch{int(ch):02d}" if isinstance(ch, int) or (isinstance(ch, str) and ch.isdigit()) else (str(ch) if ch else None)
        num = m.get("source_number")
        qno = None if num is None else (f"{num:02d}" if isinstance(num, int) else str(num))
        school = fmeta.get("school")
        year = fmeta.get("year_roc") if isinstance(fmeta.get("year_roc"), int) else None
        if book_name:
            label = " ".join(x for x in (book_name, unit, qno) if x)
        else:
            label = " ".join(str(x) for x in (school, year, qno) if x is not None)
        label = label.replace("Essay", "作文")

        # 題型與考點
        section = m.get("source_section") or ""
        tags = {}
        if section in SECTION_NAME:
            tags["type"] = [SECTION_NAME[section]]
        elif section:
            tags["topic"] = [section]
            self.report.count("shared_section_unnamed", section)
        if m.get("question_format") == "underlined_error_identification" and "文法挑錯" not in tags.get("type", []):
            tags.setdefault("type", []).append("畫線挑錯")
        if book:
            tp = [t for t in (m.get("tags") or []) if isinstance(t, str) and t.startswith("考點:")]
            if tp:
                tags.setdefault("topic", []).extend(tp)

        issues = [str(x) if not isinstance(x, dict) else (x.get("note") or json.dumps(x, ensure_ascii=False)) for x in (m.get("issues") or [])]
        for si in fmeta.get("source_issues") or []:
            if isinstance(si, dict) and si.get("source_number") == num and si.get("note"):
                issues.append("原卷：" + si["note"])

        chapter = m.get("chapter")
        if chapter and chapter not in self._catalog:
            self.report.warn("shared_chapter_not_in_catalog", id=qid, chapter=chapter)
        review = m.get("review") or {}
        sol_state = review.get("solution")
        origin = "teacher" if sol_state == "publisher_text" else ("official" if sol_state in ("official", "school") else "ai")
        raw_ques = "\n".join([stem_raw] + [subs[f"option {l}"] for l in letters])
        return {
            "id": qid,
            "subject": self.subject,
            "label": label or qid,
            "source": {"sid": fmeta.get("id") or f"{self.subject}-SRC-{path.stem}", "kind": kind, "school": school if sk == "exam" else None,
                       "year": year, "paper": None, "book": book_name, "unit": unit, "qno": qno},
            "alt_sources": [],
            "canonical": qid,
            "chap": f"{self.subject}:{chapter}" if chapter else None,
            "xchap": self._xchap_of(qid, fmeta),
            "tags": tags,
            "qtype": qtype,
            "group": group,
            "ques": ques,
            "opt": opt,
            "opt_span": span,
            "answer": {"mode": mode, "keys": keys, "text": text_ans, "trust": trust, "ai_agree": False, "note": note},
            "source_answer": source_answer,
            "idea": "",
            "sol": sol,
            "teacher": [],
            "sol_meta": {"origin": origin, "model": None, "human_verified": False, "verified_at": None,
                         "issues": issues, "state": None, "raw": None},
            "figs": figs,
            "extraction": None,
            "file": self.cfg.rel(path),
            "line": sec["line"],
            "h": {"ques": sha1(raw_ques), "idea": sha1(""), "sol": sha1(subs.get("solution", ""))},
            "_passages": pids,
            "_paper": fmeta.get("id"),
        }

    def _number_groups(self, qs):
        """題組裡的小題照原卷題號排；同一組的全部小題記在 group.members（整組出題、「41–45」顯示用）。"""
        by = {}
        for q in qs:
            if q["group"]:
                by.setdefault(q["group"]["gid"], []).append(q)
        for gid, members in by.items():
            members.sort(key=lambda q: (q["group"]["order"] is None, q["group"]["order"] or 0))
            ids = [q["id"] for q in members]
            for q in members:
                q["group"]["members"] = ids
            self.report.count("shared_group_size", str(len(members)))
