"""Physics adapter: 01_題庫製作/物理 → content contract (規格書 §4, 搬遷步驟 4、6).

Read-only. The master `.md` is the source of truth; question_index.jsonl is
only used to cross-check the count.
"""
import json
import re
from pathlib import Path
from urllib.parse import unquote

from ..labels import source_label
from ..textutil import math_ranges, parse_options, sha1
from .common import MD_LINK, load_yaml, link_target, sub_spans

FRONT = re.compile(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", re.S)
SECTION = re.compile(r"^## (ques|idea|sol)[ \t]*\r?\n", re.M)
CATEGORY_KIND = {"後醫": "postmed_w", "轉學考": "transfer", "原文書題庫": "textbook", "其他教材": "cram"}
SOURCE_PRIORITY = ["後醫", "轉學考", "原文書題庫", "其他教材"]
ID_RE = re.compile(r"^PHY-\d{6}$")

# status 文字 → 固定代碼（規格書 §4.4；「對應不到」= 下列規則都不中）
ANSWER_STATE = [
    ("key_ai_agree", r"^書附答案與AI盲解一致"),
    ("teacher_check", r"老師原答"),
    ("ai_reviewed", r"已驗證|AI複核|AI已複核|AI裁決"),
    ("needs_check", r"需確認|待確認|條件不足|待驗證"),
    ("ai_candidate", r"候選|推導|重算|核算"),
]
SOLUTION_STATE = [
    ("ai_unreviewed", r"^AI生成待人工抽查$|^待獨立驗證$"),
    ("ai_reviewed", r"已驗證|AI複核通過|AI已複核|第二輪AI補正"),
    ("incomplete", r"待補來源|待生成|缺漏"),
    ("needs_check", r"需確認"),
]
QUESTION_STATE = [
    ("text_layer", r"^文字層擷取"),
    ("checked", r"核對|已核對|已補齊"),
    ("source_missing", r"原PDF缺漏"),
    ("needs_check", r"需確認"),
]


def classify(rules, text):
    for code, pattern in rules:
        if re.search(pattern, text or ""):
            return code
    return None


class PhysicsAdapter:
    subject = "PHY"

    def __init__(self, cfg, cache, report, assets):
        self.cfg = cfg
        self.root = cfg.physics
        self.cache = cache
        self.report = report
        self.assets = assets

    # ---------- taxonomy ----------
    def chapters(self):
        data = load_yaml((self.root / "analysis/chapters.yaml").read_text("utf-8"))
        out, groups = [], []
        for c in data["chapters"]:
            g = c.get("group") or "其他"
            if g not in groups:
                groups.append(g)
        for i, g in enumerate(groups, 1):
            out.append({"id": f"PHY:{g}", "subject": "PHY", "parent": None, "title": g, "order": i})
        for c in data["chapters"]:
            n = int(c["id"][2:])
            out.append({"id": f"PHY:{c['id']}", "subject": "PHY", "parent": f"PHY:{c.get('group') or '其他'}",
                        "title": c["title"], "order": n})
        return out

    # ---------- figures ----------
    def _load_registry(self):
        items = json.loads((self.root / "analysis/圖片審核/registry.json").read_text("utf-8"))["items"]
        self.reg_by_id = {i["id"]: i for i in items}
        self.reg_by_slug = {i["slug"]: i for i in items if i.get("slug")}
        self.reg_by_img = {}
        for i in items:
            for p in i.get("images", []):
                self.reg_by_img[p] = i
        self.redraw_dirs = {}
        base = self.root / "assets/重繪"
        for ch in base.iterdir():
            if ch.is_dir() and ch.name.startswith("Ch"):
                for d in ch.iterdir():
                    if d.is_dir():
                        self.redraw_dirs.setdefault(d.name, d)
        self.registry_items = items

    def _item_folder(self, item, seen=()):
        """Folder that holds the SVG for this registry item, following reuse_of."""
        if item["id"] in seen:
            return None, item
        ref = item.get("reuse_of")
        if ref:
            target = self.reg_by_id.get(ref) or self.reg_by_slug.get(ref)
            if target is None:
                self.report.warn("registry_reuse_of_missing", fid=item["id"], reuse_of=ref)
                return None, item
            return self._item_folder(target, seen + (item["id"],))
        if item.get("dir"):
            return self.root / item["dir"], item
        return self.redraw_dirs.get(item["id"]), item

    def _image(self, qid, section, alt, path, figs, counts):
        """Decide what one body image reference becomes. Returns replacement markdown."""
        role = "q" if section == "ques" else "sol"
        try:
            rel = str(path.relative_to(self.root))
        except ValueError:
            rel = str(path)
        top = rel.split("/")[1] if rel.startswith("assets/") else "其他"
        if top == "原題圖":
            item = self.reg_by_img.get(rel)
            png = self.assets.get(path, qid)
            if item and item["status"] == "text":
                counts["text"] += 1
                self.report.count("fig_dest", "text")
                return ""
            if item and item["status"] == "approved":
                folder, master = self._item_folder(item)
                svg = None
                if folder is not None:
                    if role == "q" and (folder / "traced_q.svg").is_file():
                        svg = folder / "traced_q.svg"
                        self.report.count("fig_variant", "traced_q")
                    elif (folder / "traced.svg").is_file():
                        svg = folder / "traced.svg"
                if svg is not None:
                    info = self.assets.get(svg, qid)
                    if info:
                        counts["svg"] += 1
                        self.report.count("fig_dest", "svg")
                        fid = master["id"]
                        # 有核可的 SVG 就只用 SVG：原始 PNG 不當備援、不上傳（規格書：PNG 只給沒有 SVG 的圖）
                        self._add_fig(figs, fid, role, info, None, alt or "題圖")
                        if master.get("manual_edit"):
                            self.report.count("fig_manual_edit_used", "yes")
                        return f"![{alt}](fig:{fid})"
                self.report.warn("fig_approved_without_svg", id=qid, image=rel, fid=item["id"])
            elif item is None:
                self.report.warn("fig_not_in_registry", id=qid, image=rel)
            else:
                self.report.warn("fig_not_approved", id=qid, image=rel, fid=item["id"], status=item["status"])
            if png is None:
                return f"![{alt}]()"
            counts["png"] += 1
            self.report.count("fig_dest", "png")
            fid = item["id"] if item else "P" + png["sha"][:10]
            self._add_fig(figs, fid, role, png, None, alt or "題圖")
            return f"![{alt}](fig:{fid})"
        # assets/重繪, 解析圖, 原卷 … : take the file as-is
        info = self.assets.get(path, qid)
        if info is None:
            return f"![{alt}]()"
        dest = "svg" if info["ext"] == "svg" else "png"
        counts[dest] += 1
        self.report.count("fig_dest", dest)
        self.report.count("fig_direct", top)
        fid = path.parent.name if top == "重繪" and re.match(r"^F[0-9a-f]{10}$", path.parent.name) else "P" + info["sha"][:10]
        self._add_fig(figs, fid, role, info, None, alt or "題圖")
        return f"![{alt}](fig:{fid})"

    @staticmethod
    def _add_fig(figs, fid, role, info, fallback, alt):
        for f in figs:
            if f["fid"] == fid and f["role"] == role:
                return
        figs.append({
            "fid": fid, "role": role, "src": info["key"],
            "w": info.get("w"), "h": info.get("h"), "mono": bool(info.get("mono")) if info["ext"] == "svg" else False,
            "fallback": fallback["key"] if fallback else None, "alt": alt, "max_w": None,
        })

    # ---------- body rewriting ----------
    def _rewrite(self, qid, section, text, base, figs, counts, teacher, collect=None):
        ranges = math_ranges(text)

        def repl(m):
            if any(a <= m.start() < b for a, b, _ in ranges):
                return m.group(0)
            target = link_target(m)
            label = m.group(2)
            is_img = m.group(1) == "!"
            if re.match(r"^[a-z]+:", target) or target.startswith("#"):
                self.report.count("link_kind", "external" if not is_img else "external_image")
                return m.group(0)
            path = (base / target.split("#")[0]).resolve()
            self.report.count("link_folder", self.cfg.rel_folder(path))
            if is_img:
                self._bip.setdefault(qid, set()).add(str(path))
                return self._image(qid, section, label, path, figs, counts)
            if path.suffix.lower() == ".pdf":
                page = re.search(r"#page=(\d+)", target)
                self.report.count("link_kind", "pdf→純文字")
                return f"{label} p.{page.group(1)}" if page else label
            if path.suffix.lower() == ".md" and "教師解析" in path.parts:
                self.report.count("link_kind", "老師轉錄→老師原解")
                teacher.add(path)
                return label
            self.report.count("link_kind", "其他相對連結→純文字")
            self.report.warn("link_other", id=qid, target=target)
            return label
        out, spans = sub_spans(MD_LINK, repl, text)
        if collect is not None:
            collect[section] = spans
        return out

    # ---------- questions ----------
    def load(self):
        self._load_registry()
        self._bip = {}
        bank = self.root / "02_原卷題庫"
        out = []
        for path in sorted(bank.rglob("*.md")):
            if path.name.lower() == "readme.md" or " 2." in path.name or "講義例題" in path.parts:
                continue
            data = path.read_bytes()
            self.cache.sha256(path, data)
            try:
                q = self._question(path, data.decode("utf-8"))
            except Exception as e:  # noqa: BLE001 — report and keep going
                self.report.error("主檔解析失敗", path=self.cfg.rel(path), message=str(e))
                continue
            out.append(q)
        self._link_groups(out)
        self._check_registry_coverage(out)
        return out

    def _question(self, path, text):
        m = FRONT.match(text)
        if not m:
            raise ValueError("缺少 YAML front matter")
        meta = load_yaml(m.group(1))
        body = text[m.end():]
        marks = list(SECTION.finditer(body))
        if [x.group(1) for x in marks] != ["ques", "idea", "sol"]:
            raise ValueError("正文必須依序有 ## ques、## idea、## sol")
        raw = {}
        for i, x in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(body)
            raw[x.group(1)] = body[x.end():end]
        qid = meta.get("ID", "")
        src = meta.get("source") or {}
        cat = src.get("category")
        kind = CATEGORY_KIND.get(cat)
        if kind is None:
            self.report.error("來源類別未登記", id=qid, category=cat)
        ans = meta.get("ans") or {}
        mode = ans.get("mode") or "pending"
        value = ans.get("value")
        status = meta.get("status") or {}

        figs, counts, teacher = [], {"svg": 0, "png": 0, "text": 0}, _Ordered()
        self.last_spans = {}
        fields = {k: self._rewrite(qid, k, raw[k], path.parent, figs, counts, teacher, self.last_spans) for k in ("ques", "idea", "sol")}
        for o in meta.get("origin") or []:
            if o.get("transcript"):
                teacher.add((path.parent / o["transcript"]).resolve())
        teacher_blocks = []
        for tpath in teacher:
            if not tpath.is_file():
                self.report.warn("teacher_transcript_missing", id=qid, path=self.cfg.rel(tpath))
                continue
            tdata = tpath.read_bytes()
            self.cache.sha256(tpath, tdata)
            md = self._rewrite(qid, "sol", tdata.decode("utf-8"), tpath.parent, figs, counts, _Ordered())
            teacher_blocks.append({"title": "老師原解", "md": md, "file": self.cfg.rel(tpath)})
        for k, v in counts.items():
            self.report.count("phy_fig_refs", k, v)

        parsed = parse_options(fields["ques"])
        if isinstance(value, list):
            keys = [str(v) for v in value]
        elif mode in ("single", "all", "any") and isinstance(value, str) and re.fullmatch(r"[A-H]", value.strip()):
            keys = [value.strip()]
        else:
            keys = []
        text_ans = None if mode in ("single", "all", "any") else (None if value is None else str(value))
        qtype = {"single": "single", "any": "single", "all": "multi", "text": "text", "numeric": "numeric"}.get(mode)
        if mode == "pending":
            qtype = "single" if parsed else "text"
        if mode in ("single", "all", "any") and parsed is None:
            self.report.warn("option_parse_failed", id=qid, mode=mode, label=source_label({"file": str(path), "category": cat}))
        if mode in ("single", "all", "any") and parsed is not None:
            letters = {o[0] for o in parsed["opt"]}
            missing = [k for k in keys if k not in letters]
            if missing:
                self.report.warn("answer_key_not_in_options", id=qid, keys=keys, options=sorted(letters))

        prov = [p.get("kind") for p in ans.get("provenance") or []]
        sa = meta.get("source_answer")
        if "official" in prov:
            trust = "official"
        elif "annotated" in prov:
            trust = "key"
        elif "tutor" in prov or (isinstance(sa, dict) and sa.get("kind") == "teacher_solution" and sa.get("value") == value):
            trust = "teacher"
        elif mode == "pending":
            trust = "pending"
        else:
            trust = "ai"
        for k in prov:
            if k not in ("official", "annotated", "tutor", "ai"):
                self.report.warn("provenance_kind_unknown", id=qid, kind=k)
        r2 = meta.get("round2_verification") or {}
        ai_agree = "兩道AI一致" in str(r2.get("state", "")) or str(status.get("answer", "")).startswith("書附答案與AI盲解一致")

        origins = [o for o in meta.get("origin") or [] if o.get("kind") == "teacher_solution"]
        full = any(o.get("transcript") and re.search(r"完整逐字", str(o.get("transcription_status"))) and not re.search(r"非|未", str(o.get("transcription_status"))) for o in origins)
        if full:
            sol_origin = "teacher"
        elif any(o.get("transcript") for o in origins):
            sol_origin = "mixed"
        else:
            sol_origin = "ai"
        model = (meta.get("ai_solution") or {}).get("model") or r2.get("model")
        # 使用者在網站上標「已確認」或修訂過答案／詳解（規格書 §4.4；pmq patches pull 寫入）
        hr = meta.get("human_review") if isinstance(meta.get("human_review"), dict) else {}
        hr_ok = hr.get("by") == "user"
        issues = []
        for i in status.get("issues") or []:
            if isinstance(i, dict):
                if i.get("resolved") is True:
                    continue
                issues.append(str(i.get("note") or i.get("kind") or i))
            else:
                issues.append(str(i))
        raw_status = {k: (None if status.get(k) is None else str(status.get(k))) for k in ("question", "answer", "solution")}
        state = {
            "question": classify(QUESTION_STATE, raw_status["question"]),
            "answer": classify(ANSWER_STATE, raw_status["answer"]),
            "solution": classify(SOLUTION_STATE, raw_status["solution"]),
        }
        for k, v in state.items():
            self.report.count(f"status_{k}", f"{v}｜{raw_status[k]}")
            if v is None:
                self.report.warn("status_unmapped", id=qid, field=k, text=raw_status[k])

        source_answer = None
        if isinstance(sa, dict) and sa.get("value") != value:
            source_answer = {"value": sa.get("value"), "mode": sa.get("mode"), "kind": sa.get("kind"), "note": sa.get("note") or ""}
        group = None
        if src.get("shared_question") is not None:
            group = {"gid": f"{src.get('source_id')}#Q{src['shared_question']}", "stem": None,
                     "order": _int(src.get("question")), "parts": []}
        if src.get("subquestions"):
            group = dict(group or {"gid": qid, "stem": None, "order": None}, parts=[str(p) for p in src["subquestions"]])

        chapter = meta.get("chap")
        unit = src.get("session")
        if unit is None and src.get("chapter") is not None and cat == "原文書題庫":
            unit = f"Ch{int(src['chapter']):02d}" if str(src["chapter"]).isdigit() else str(src["chapter"])
        q = {
            "id": qid,
            "subject": "PHY",
            "label": source_label({"file": str(path), "category": cat}),
            "source": {
                "sid": src.get("source_id"), "kind": kind,
                "school": src.get("school"), "year": _int(src.get("year")), "paper": src.get("paper"),
                "book": src.get("short_name") or src.get("book"), "unit": None if unit is None else str(unit),
                "qno": None if src.get("question") is None else str(src.get("question")),
            },
            "alt_sources": [],
            "canonical": qid,
            "chap": f"PHY:{chapter}" if chapter else None,
            "xchap": [],
            "tags": {k: list(v or []) for k, v in (meta.get("tag") or {}).items()},
            "qtype": qtype or "text",
            "group": group,
            "ques": fields["ques"],
            "opt": parsed["opt"] if parsed else None,
            "opt_span": parsed["span"] if parsed else None,
            "answer": {"mode": mode, "keys": keys, "text": text_ans, "trust": trust, "ai_agree": ai_agree, "note": ""},
            "source_answer": source_answer,
            "idea": fields["idea"],
            "sol": fields["sol"],
            "teacher": teacher_blocks,
            "sol_meta": {
                "origin": sol_origin, "model": model if sol_origin in ("ai", "mixed") else None,
                "human_verified": hr_ok, "verified_at": str(hr.get("date")) if hr_ok else None, "issues": issues, "state": state, "raw": raw_status,
            },
            "figs": figs,
            "extraction": src.get("extraction"),
            "file": self.cfg.rel(path),
            "line": None,
            "h": {k: sha1(raw[k]) for k in ("ques", "idea", "sol")},
            "_related": meta.get("related") or [],
            "_category": cat,
            "_registered_figs": [f.get("path") if isinstance(f, dict) else f for f in meta.get("figure") or []],
            "_base": str(path.parent),
        }
        self.report.count("trust", trust)
        self.report.count("sol_origin", sol_origin)
        self.report.count("category", cat)
        return q

    def _link_groups(self, qs):
        by_id = {q["id"]: q for q in qs}
        parent = {k: k for k in by_id}

        def find(k):
            while parent[k] != k:
                parent[k] = parent[parent[k]]
                k = parent[k]
            return k
        for q in qs:
            for e in q["_related"]:
                t = e.get("ID")
                if t in by_id:
                    rel = "same" if e.get("relation") == "exact" else "adapted"
                    q["alt_sources"].append({"id": t, "label": by_id[t]["label"], "relation": rel,
                                             "confirmed": e.get("confirmed") is True})
                    if e.get("relation") == "exact" and e.get("confirmed") is True:
                        parent[find(t)] = find(q["id"])
                elif t:
                    self.report.warn("related_target_missing", id=q["id"], target=t)
        prio = SOURCE_PRIORITY
        pf = self.root / "analysis/source_priority.yaml"
        if pf.exists():
            prio = (load_yaml(pf.read_text("utf-8")) or {}).get("priority", prio)

        def rank(q):
            s = q["source"]
            return (prio.index(q["_category"]) if q["_category"] in prio else len(prio), -(s["year"] or 0),
                    str(s["school"] or ""), str(s["paper"] or ""), str(s["qno"] or "").zfill(6), q["id"])
        groups = {}
        for q in qs:
            groups.setdefault(find(q["id"]), []).append(q)
        for members in groups.values():
            head = min(members, key=rank)["id"]
            for q in members:
                q["canonical"] = head

    def _check_registry_coverage(self, qs):
        """Front matter `figure` entries that the body never references (1,488 vs 1,473)."""
        for q in qs:
            base = Path(q["_base"])
            used = self._bip.get(q["id"], set())
            for p in q["_registered_figs"]:
                if not p:
                    continue
                path = (base / p).resolve()
                self.report.count("fig_registered", "total")
                if str(path) not in used:
                    self.report.warn("fig_registered_not_referenced", id=q["id"], path=self.cfg.rel(path))


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class _Ordered:
    def __init__(self):
        self._d = {}

    def add(self, p):
        self._d[str(p)] = Path(p)

    def __iter__(self):
        return iter(self._d.values())
