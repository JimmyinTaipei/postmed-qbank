"""講義筆記 → 區塊樹與目錄（規格書 §9.4、搬遷步驟 9）。主檔唯讀。

一份 .md → 區塊樹：標題、列點（含層級與續行）、段落、表格（Markdown、HTML、引言包表格）、
physics-table-group（表格群組）、$$ 公式、程式碼區塊、圖、引言、分隔線、HTML（網站上不顯示）。
縮排比目前列點深的區塊掛在該列點底下。每個區塊記下主檔行範圍 [起, 訖)（第 4 階段後半寫回用），
整份原文放在 src（匯出 .md 用）。

不在 .md 裡插入任何 ID：bid ＝ 雜湊（文件、標題路徑、內文正規化後前 40 字、同路徑下第幾個）。
句尾考古題出處（中興-115-42、醫學-115-1-93）→ 題目 ID；筆記之間的相對連結 → /kb/<key>。
"""
import hashlib
import re
from pathlib import Path
from urllib.parse import quote, unquote

from .adapters.common import ALT_ATTR, MD_LINK, SRC_ATTR, WIDTH_ATTR, attr, sub_spans

HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
LIST = re.compile(r"^([ \t]*)([-*+]|\d+[.)])(?:\s+(.*)|$)")
FENCE = re.compile(r"^(\s*)(`{3,}|~{3,})")
TG_START = "<!-- physics-table-group:start -->"
TG_END = "<!-- physics-table-group:end -->"
REF = re.compile(r"([一-鿿]{2})-(\d{2,3})(?:-(\d))?-(\d{1,3})(?!\d)")
HTML_BLOCK = re.compile(r"^\s*<(table|div|details|figure|style|center|p)\b", re.I)
COMMENT = re.compile(r"^\s*<!--")
TABLE_LINE = re.compile(r"^\s*(?:>\s*)*\|")
QUOTE_LINE = re.compile(r"^\s{0,3}>")
RULE = re.compile(r"^\s*(-{3,}|\*{3,}|_{3,})\s*$")
# 改寫一次掃完：HTML <img> 或 Markdown 連結（第 1 組是 <img>，其餘同 MD_LINK 往後移一組）
KB_LINK = re.compile(r"(<img\b[^>]*>)|" + MD_LINK.pattern, re.I)
INBOX = "_收件匣"     # 網站上「新增一份空白筆記」寫回的位置（規格書 §14-2）
FIG_LINE = re.compile(r"^\s*(?:<img\b[^>]*>|!\[[^\]]*\]\([^)]*\))\s*$")
# 獨立成區塊的開頭（列點的續行遇到這些就結束）
BLOCK_START = (HEADING, FENCE, TABLE_LINE, QUOTE_LINE, RULE, FIG_LINE, HTML_BLOCK, COMMENT)


def _indent(line):
    ws = re.match(r"^[ \t]*", line).group(0)
    return len(ws.replace("\t", "    "))


def natural_key(s):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


def pretty(name):
    """資料夾或檔名 → 顯示名稱：「B1_基礎篇」→「B1 基礎篇」、「Ch01_生命的研究」→「Ch01 生命的研究」。"""
    return re.sub(r"_+", " ", name).strip()


class KbBuilder:
    def __init__(self, cfg, assets, report, source_to_id, doc_keys=None):
        self.cfg = cfg
        self.assets = assets
        self.report = report
        self.source_to_id = source_to_id
        self.doc_keys = doc_keys or {}     # 主檔絕對路徑 → kb key（筆記之間的連結）

    def build(self, path, subject, doc=None, text=None):
        """text：寫回前在記憶體裡重新解析時傳入（不讀檔）。"""
        path = Path(path)
        text = path.read_text("utf-8") if text is None else text
        lines = text.split("\n")
        doc = doc or path.stem
        self.key = f"{subject}/{doc}"
        self.doc, self.figs, self.refs, self.base = doc, [], [], path.parent
        # bid → (改寫前的 md, 改寫紀錄)：寫回（kb_patches）用
        self.pre = {}
        root = []
        stack = [(0, root)]          # 標題層級 → 子區塊清單
        list_stack = []              # (縮排, 列點區塊)
        seen = {}
        heading_path = []
        para = None                  # 可以接續行的區塊（列點、段落）
        i = 0

        def bid(md):
            key = "/".join(heading_path) + "|" + re.sub(r"\s+", " ", md).strip()[:40]
            n = seen.get(key, 0)
            seen[key] = n + 1
            return hashlib.sha1(f"{doc}|{key}|{n}".encode()).hexdigest()[:12]

        def owner(line):
            """縮排比目前列點深 → 掛在那個列點底下；否則結束列點。"""
            nonlocal list_stack
            ind = _indent(line)
            while list_stack and ind <= list_stack[-1][0]:
                list_stack.pop()
            return list_stack[-1][1]["children"] if list_stack else stack[-1][1]

        def emit(block, parent):
            parent.append(block)
            return block

        def make(kind, md, a, b, **extra):
            # md 先放改寫前的原文；整份讀完再一次改寫（續行也併進來）
            blk = {"bid": bid(md), "type": kind, "md": md, "lines": [a, b], "children": []}
            blk.update(extra)
            return blk

        def until(j, pred):
            while j < len(lines) and pred(lines[j]):
                j += 1
            return j

        while i < len(lines):
            line = lines[i]
            if not line.strip():
                para = None
                i += 1
                continue
            m = HEADING.match(line)
            if m:
                para, list_stack = None, []
                level = len(m.group(1))
                while stack[-1][0] >= level:
                    stack.pop()
                    heading_path.pop()
                blk = emit(make("heading", line.strip(), i, i + 1, level=level), stack[-1][1])
                stack.append((level, blk["children"]))
                heading_path.append(m.group(2).strip())
                i += 1
                continue
            fm = FENCE.match(line)
            if fm:
                mark = fm.group(2)
                j = i + 1
                while j < len(lines) and not lines[j].strip().startswith(mark[0] * len(mark)):
                    j += 1
                j = min(j + 1, len(lines))
                parent = owner(line)
                ind = _indent(line)
                body = "\n".join(l[ind:] if _indent(l) >= ind else l.lstrip() for l in lines[i:j])
                emit(make("code", body, i, j), parent)
                para = None
                i = j
                continue
            if line.strip() == TG_START:
                j = until(i + 1, lambda l: l.strip() != TG_END)
                list_stack = []
                emit(make("table_group", "\n".join(lines[i + 1:j]).strip("\n"), i, min(j + 1, len(lines))), stack[-1][1])
                para = None
                i = j + 1
                continue
            if line.strip().startswith("$$"):
                s = line.strip()
                j = i
                if s == "$$" or not s.endswith("$$") or len(s) < 4:
                    j = until(i + 1, lambda l: "$$" not in l)
                j = min(j, len(lines) - 1)
                parent = owner(line)
                emit(make("math", "\n".join(l.strip() for l in lines[i:j + 1]), i, j + 1), parent)
                para = None
                i = j + 1
                continue
            if TABLE_LINE.match(line):
                j = until(i, lambda l: bool(TABLE_LINE.match(l)))
                parent = owner(line)
                emit(make("table", "\n".join(l.strip() for l in lines[i:j]), i, j), parent)
                para = None
                i = j
                continue
            if COMMENT.match(line):
                j = until(i, lambda l: "-->" not in l)
                emit(make("html", "\n".join(lines[i:j + 1]), i, min(j + 1, len(lines))), stack[-1][1])
                para = None
                i = j + 1
                continue
            hm = HTML_BLOCK.match(line)
            if hm:
                tag = hm.group(1).lower()
                j = until(i, lambda l: f"</{tag}>" not in l.lower())
                j = min(j, len(lines) - 1)
                parent = owner(line)
                emit(make("table" if tag == "table" else "html", "\n".join(lines[i:j + 1]), i, j + 1), parent)
                para = None
                i = j + 1
                continue
            if FIG_LINE.match(line):
                parent = owner(line)
                emit(make("figure", line.strip(), i, i + 1), parent)
                para = None
                i += 1
                continue
            if RULE.match(line):
                list_stack = []
                emit(make("rule", line.strip(), i, i + 1), stack[-1][1])
                para = None
                i += 1
                continue
            m = LIST.match(line)
            if m:
                ind = _indent(line)
                while list_stack and list_stack[-1][0] >= ind:
                    list_stack.pop()
                parent = list_stack[-1][1]["children"] if list_stack else stack[-1][1]
                blk = make("list_item", m.group(3) or "", i, i + 1, level=len(list_stack), ordered=m.group(2)[0].isdigit())
                if blk["ordered"]:
                    blk["num"] = int(re.match(r"\d+", m.group(2)).group(0))
                emit(blk, parent)
                list_stack.append((ind, blk))
                para = blk
                i += 1
                continue
            if QUOTE_LINE.match(line):
                j = until(i, lambda l: bool(QUOTE_LINE.match(l)))
                parent = owner(line)
                emit(make("quote", "\n".join(l.strip() for l in lines[i:j]), i, j), parent)
                para = None
                i = j
                continue
            # 接續行：列點或段落的下一行（沒有空行隔開）
            if para is not None:
                extra = line.strip() if para["type"] == "list_item" else line
                para["md"] += "\n" + extra
                para["lines"][1] = i + 1
                i += 1
                continue
            parent = owner(line)
            blk = emit(make("paragraph", line.strip(), i, i + 1), parent)
            para = blk
            i += 1

        for b, _ in walk(root):
            pre = b["md"]
            b["md"], spans = self._rewrite(pre)
            self.pre[b["bid"]] = (pre, spans)
            self._refs(b, b["md"])

        title = next((re.sub(r"^#+\s*", "", b["md"]).strip() for b in root if b["type"] == "heading" and b.get("level") == 1), None)
        return {"doc": doc, "key": self.key, "subject": subject, "title": title or pretty(doc), "file": self.cfg.rel(path),
                "blocks": root, "figs": self.figs, "refs": self.refs, "src": text}

    # ---- helpers ----
    def _refs(self, block, md):
        for m in REF.finditer(md):
            school, year, sess, qno = m.groups()
            key = (school, int(year), sess, int(qno))
            self.refs.append({"bid": block["bid"], "text": m.group(0), "qid": self.source_to_id.get(key)})

    def _fig(self, path, width, alt):
        p = Path(path)
        sdb = self.cfg.structure_db_out.resolve() / "svg"
        try:
            rel = p.relative_to(sdb)
            manual = self.cfg.structure_db_src / "data/manual" / rel
            if manual.is_file():
                p = manual
                self.report.count("kb_fig", "structure_db 手修版")
            else:
                self.report.count("kb_fig", "structure_db")
        except ValueError:
            self.report.count("kb_fig", "其他")
        if not p.is_file():
            # 筆記的圖讀不到只警告（不擋整站發佈）；網站上那張圖顯示「圖檔不在這個內容包裡」
            self.report.warn("kb_image_missing", doc=self.key, path=self.cfg.rel(p))
            return None
        info = self.assets.get(p, self.key)
        if info is None:
            return None
        fid = "K" + info["sha"][:10]
        if not any(f["fid"] == fid for f in self.figs):
            self.figs.append({"fid": fid, "role": "kb", "src": info["key"], "w": info.get("w"), "h": info.get("h"),
                              "mono": bool(info.get("mono")) if info["ext"] == "svg" else False, "fallback": None,
                              "alt": alt or "", "max_w": width})
        return fid

    def _rewrite(self, md):
        """主檔的 md → 網站的 md，回傳 (新文字, 改寫紀錄)。改寫紀錄給寫回時換回原本的連結（patches.unrewrite）。"""
        def html(tag):
            src = attr(SRC_ATTR, tag)
            if not src or src.startswith(("http:", "https:", "data:")):
                return tag
            if src.startswith("/"):
                self.report.warn("kb_absolute_image", doc=self.key, src=src)
                return tag
            w = attr(WIDTH_ATTR, tag)
            width = int(float(w.rstrip("px"))) if w and re.fullmatch(r"[\d.]+(px)?", w) else None
            alt = attr(ALT_ATTR, tag) or ""
            fid = self._fig((self.base / unquote(src)).resolve(), width, alt)
            return f"![{alt}](fig:{fid})" if fid else f"![{alt}](fig:missing)"

        def fn(m):
            if m.group(1):
                return html(m.group(1))
            bang, text = m.group(2), m.group(3)
            t = unquote(m.group(4) or m.group(5))
            if t.startswith(("http:", "https:", "fig:", "#", "mailto:")):
                return m.group(0)
            if bang == "!":
                if t.startswith("/"):
                    self.report.warn("kb_absolute_image", doc=self.key, src=t)
                    return m.group(0)
                fid = self._fig((self.base / t).resolve(), None, text)
                return f"![{text}](fig:{fid or 'missing'})"
            # 連到另一份筆記
            target = (self.base / t.split("#", 1)[0]).resolve()
            key = self.doc_keys.get(str(target))
            if key:
                return f"[{text}](/kb/{quote(key)})"
            self.report.warn("kb_link_unresolved", doc=self.key, link=t)
            return text
        return sub_spans(KB_LINK, fn, md)


def count_blocks(blocks, out=None):
    out = out if out is not None else {}
    for b in blocks:
        out[b["type"]] = out.get(b["type"], 0) + 1
        count_blocks(b["children"], out)
    return out


def walk(blocks, path=()):
    """依序走過每個區塊：(區塊, 它上面的標題文字路徑)。"""
    for b in blocks:
        yield b, path
        sub = path + (re.sub(r"^#+\s*", "", b["md"]).strip(),) if b["type"] == "heading" else path
        yield from walk(b["children"], sub)


def coverage(doc):
    """每一行非空白的主檔行都恰好屬於一個區塊。回傳 (沒被涵蓋的行號, 重疊的行號)。"""
    lines = doc["src"].split("\n")
    owner = {}
    overlap = []
    for b, _ in walk(doc["blocks"]):
        a, z = b["lines"]
        for n in range(a, z):
            if n in owner:
                overlap.append(n)
            owner[n] = b["bid"]
    missing = [n for n, l in enumerate(lines) if l.strip() and n not in owner]
    return missing, overlap


# ---------------------------------------------------------------------------
# 整個資料庫：找出要匯入的筆記、建區塊樹、目錄、題目 → 筆記的反查

SUBJECT_NAMES = {"BCH": "生化", "PHY": "物理", "BIO": "生物", "CHE": "化學", "ENG": "英文"}


def _source_to_id(questions):
    """（學校, 年, 第幾次, 題號）→ 題目 ID（生化）。"""
    out = {}
    for q in questions:
        if q["subject"] != "BCH":
            continue
        s = q["source"]
        sess = q["id"].split("-")[2] if s["kind"] == "national" and q["id"].count("-") >= 3 else None
        try:
            out[(s["school"], s["year"], sess, int(s["qno"]))] = q["id"]
        except (TypeError, ValueError):
            pass
    return out


def discover(cfg):
    """依 pmq.toml [kb] 找出要匯入的筆記。回傳 [(科目, 群組資料夾名, 群組顯示名, [路徑…])]、只建目錄的科目。"""
    kb = cfg.kb
    skip = {"_archive", "pdf", "pdf檔", "assets"}
    exclude = {(cfg.notes / e).resolve() for e in kb.get("exclude", [])}
    groups = []
    for subj in ("BCH", "PHY"):
        for rel in kb.get(subj, []):
            base = cfg.notes / rel
            if not base.is_dir():
                continue
            # 直接放在這層的 .md → 一個群組；子資料夾各一個群組
            top = sorted((p for p in base.glob("*.md") if p.resolve() not in exclude), key=lambda p: natural_key(p.stem))
            subdirs = sorted((d for d in base.iterdir() if d.is_dir() and d.name not in skip and not d.name.startswith((".", "_"))),
                             key=lambda d: natural_key(d.name))
            if top:
                groups.append((subj, base.name if not subdirs else "_", pretty(base.name) if not subdirs else "總論", top))
            for d in subdirs:
                files = sorted((p for p in d.rglob("*.md") if p.resolve() not in exclude and not (set(p.relative_to(d).parts[:-1]) & skip)),
                               key=lambda p: natural_key(str(p.relative_to(d))))
                groups.append((subj, d.name, pretty(d.name), files))
            # 網站上新增的筆記（寫回到 _收件匣/）：放最後；整理好之後在 Mac 上搬到正式的資料夾
            inbox = base / INBOX
            if inbox.is_dir():
                files = sorted((p for p in inbox.glob("*.md") if p.resolve() not in exclude), key=lambda p: natural_key(p.stem))
                if files:
                    groups.append((subj, INBOX, "收件匣", files))
    outline = {}
    for subj in ("BIO", "CHE", "ENG"):
        rel = kb.get(subj)
        if not rel:
            continue
        base = cfg.notes / rel
        names = sorted((d.name for d in base.iterdir() if d.is_dir() and not d.name.startswith((".", "_"))), key=natural_key) if base.is_dir() else []
        outline[subj] = names
    return groups, outline


def doc_names(groups):
    """doc 名稱：檔名（不含 .md）；同一科有重名時，重名的那幾份前面加群組代碼（B1_00_目錄與總覽）。
    回傳 ({主檔絕對路徑: kb key}, {主檔絕對路徑: doc 名稱})。"""
    names = {}
    for subj, gid, _, files in groups:
        for p in files:
            names.setdefault((subj, p.stem), []).append((gid, p))
    doc_keys, doc_of = {}, {}
    for (subj, stem), lst in names.items():
        for gid, p in lst:
            doc = stem if len(lst) == 1 else f"{gid.split('_')[0]}_{stem}"
            doc_keys[str(p.resolve())] = f"{subj}/{doc}"
            doc_of[str(p.resolve())] = doc
    return doc_keys, doc_of


def build_kb(cfg, c):
    """回傳 (docs {key: doc}, catalog, related {qid: [...]})。c 是 build.Contract（要用題目做出處對照）。"""
    groups, outline = discover(cfg)
    doc_keys, doc_of = doc_names(groups)
    kbb = KbBuilder(cfg, c.assets, c.report, _source_to_id(c.questions), doc_keys)
    docs = {}
    catalog = {"subjects": []}
    by_subj = {}
    for subj, gid, gtitle, files in groups:
        entry = by_subj.get(subj)
        if entry is None:
            entry = by_subj[subj] = {"id": subj, "name": SUBJECT_NAMES.get(subj, subj), "imported": True, "groups": []}
            catalog["subjects"].append(entry)
        g = {"id": gid, "title": gtitle, "docs": []}
        entry["groups"].append(g)
        for p in files:
            try:
                d = kbb.build(p, subj, doc_of[str(p.resolve())])
            except (OSError, UnicodeDecodeError) as e:
                c.report.error("筆記讀不到", doc=cfg.rel(p), detail=str(e))
                continue
            docs[d["key"]] = d
            cnt = count_blocks(d["blocks"])
            missing, overlap = coverage(d)
            if missing or overlap:
                c.report.warn("kb_lines_uncovered", doc=d["key"], missing=missing[:10], overlap=overlap[:10])
            heads = [re.sub(r"^#+\s*", "", b["md"]).strip() for b, _ in walk(d["blocks"]) if b["type"] == "heading" and b.get("level") == 2]
            g["docs"].append({"key": d["key"], "title": d["title"], "file": d["file"], "counts": cnt, "sections": heads[:40]})
            c.report.count("kb_docs", subj)
    for subj, names_ in outline.items():
        catalog["subjects"].append({"id": subj, "name": SUBJECT_NAMES.get(subj, subj), "imported": False,
                                    "groups": [{"id": n, "title": pretty(n), "docs": []} for n in names_]})
    # 題目 → 引用它的筆記段落
    related = {}
    unmapped = []
    for key, d in docs.items():
        paths = {b["bid"]: (path, b) for b, path in walk(d["blocks"])}
        seen = set()
        for r in d["refs"]:
            if not r["qid"]:
                unmapped.append({"doc": key, "text": r["text"]})
                continue
            if (r["qid"], r["bid"]) in seen:
                continue
            seen.add((r["qid"], r["bid"]))
            path, b = paths.get(r["bid"], ((), None))
            plain = re.sub(r"!\[[^\]]*\]\([^)]*\)|[*_`]|^#+\s*", "", b["md"] if b else "")
            snippet = re.sub(r"\s+", " ", re.sub(r"[（(][^（()）]*\d{2,3}-\d+[^（()）]*[）)]", "", plain)).strip()[:80]
            related.setdefault(r["qid"], []).append({"key": key, "bid": r["bid"], "title": d["title"], "path": [re.sub(r"[*`]|\$", "", p) for p in path[1:]] if path else [], "text": snippet})
    for u in unmapped:
        c.report.warn("kb_ref_unmapped", doc=u["doc"], text=u["text"])
    c.report.count("kb_refs", "對到題目", sum(1 for d in docs.values() for r in d["refs"] if r["qid"]))
    c.report.count("kb_refs", "對不到", len(unmapped))
    return docs, catalog, related
