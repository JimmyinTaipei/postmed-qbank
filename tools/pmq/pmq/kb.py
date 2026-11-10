"""講義筆記 → 區塊樹（規格書 §9.4）。第 0 階段的簡化版：給介面樣板用，第 4 階段再做完整的。

做到的：標題層級、巢狀列點（含續行）、段落、Markdown 表格、引言包表格、
physics-table-group、HTML 區塊、$$ 公式區塊、圖、分隔線；句尾考古題出處 → 題目 ID。
不在 .md 裡插入任何 ID；bid 由（文件、標題路徑、內文前 40 字、同路徑序號）雜湊而來。
"""
import hashlib
import re
from pathlib import Path

from .adapters.common import ALT_ATTR, HTML_IMG, MD_LINK, SRC_ATTR, WIDTH_ATTR, attr, link_target

HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
LIST = re.compile(r"^([ \t]*)([-*+]|\d+[.)])\s+(.*)$")
TG_START = "<!-- physics-table-group:start -->"
TG_END = "<!-- physics-table-group:end -->"
REF = re.compile(r"([一-鿿]{2})-(\d{2,3})(?:-(\d))?-(\d{1,3})")


def _indent(ws):
    return len(ws.replace("\t", "    "))


class KbBuilder:
    def __init__(self, cfg, assets, report, source_to_id):
        self.cfg = cfg
        self.assets = assets
        self.report = report
        self.source_to_id = source_to_id

    def build(self, path, subject):
        text = Path(path).read_text("utf-8")
        lines = text.split("\n")
        doc = Path(path).stem
        self.doc, self.figs, self.refs, self.base = doc, [], [], Path(path).parent
        root = []
        stack = [(0, root)]          # heading level → children list
        list_stack = []              # (indent, block)
        seen = {}
        heading_path = []
        i = 0
        para = None

        def bid(md):
            key = "/".join(heading_path) + "|" + re.sub(r"\s+", " ", md).strip()[:40]
            n = seen.get(key, 0)
            seen[key] = n + 1
            return hashlib.sha1(f"{doc}|{key}|{n}".encode()).hexdigest()[:12]

        def container():
            return stack[-1][1]

        def emit(block, parent=None):
            (parent if parent is not None else container()).append(block)
            self._refs(block)
            return block

        def make(kind, md, a, b, **extra):
            md2 = self._rewrite(md)
            blk = {"bid": bid(md), "type": kind, "md": md2, "lines": [a, b], "children": []}
            blk.update(extra)
            return blk

        while i < len(lines):
            line = lines[i]
            if not line.strip():
                para = None
                i += 1
                continue
            m = HEADING.match(line)
            if m:
                para = None
                list_stack = []
                level = len(m.group(1))
                while stack[-1][0] >= level:
                    stack.pop()
                    heading_path.pop()
                blk = make("heading", line, i, i + 1, level=level)
                emit(blk)
                stack.append((level, blk["children"]))
                heading_path.append(m.group(2).strip())
                i += 1
                continue
            if line.strip() == TG_START:
                j = i + 1
                while j < len(lines) and lines[j].strip() != TG_END:
                    j += 1
                emit(make("table_group", "\n".join(lines[i + 1:j]).strip("\n"), i, min(j + 1, len(lines))))
                para, list_stack = None, []
                i = j + 1
                continue
            if line.strip().startswith("$$"):
                j = i
                if line.strip() == "$$" or not line.strip().endswith("$$") or len(line.strip()) < 4:
                    j = i + 1
                    while j < len(lines) and "$$" not in lines[j]:
                        j += 1
                emit(make("math", "\n".join(lines[i:j + 1]), i, j + 1))
                para = None
                i = j + 1
                continue
            if line.lstrip().startswith("|") or re.match(r"^>\s*\|", line):
                j = i
                while j < len(lines) and (lines[j].lstrip().startswith("|") or re.match(r"^>\s*\|", lines[j])):
                    j += 1
                blk = make("table", "\n".join(lines[i:j]), i, j)
                parent = list_stack[-1][1]["children"] if list_stack and _indent(re.match(r"^\s*", line).group(0)) > list_stack[-1][0] else None
                emit(blk, parent)
                para = None
                i = j
                continue
            if re.match(r"^\s*<(table|div|details|figure)\b", line, re.I):
                tag = re.match(r"^\s*<(\w+)", line).group(1).lower()
                j = i
                while j < len(lines) and f"</{tag}>" not in lines[j].lower():
                    j += 1
                emit(make("table" if tag == "table" else "html", "\n".join(lines[i:j + 1]), i, j + 1))
                para = None
                i = j + 1
                continue
            if re.fullmatch(r"\s*(?:<img\b[^>]*>|!\[[^\]]*\]\([^)]*\))\s*", line):
                blk = make("figure", line.strip(), i, i + 1)
                parent = list_stack[-1][1]["children"] if list_stack and _indent(re.match(r"^\s*", line).group(0)) > list_stack[-1][0] else None
                emit(blk, parent)
                para = None
                i += 1
                continue
            if re.fullmatch(r"\s*(-{3,}|\*{3,}|_{3,})\s*", line):
                emit(make("rule", line, i, i + 1))
                para, list_stack = None, []
                i += 1
                continue
            m = LIST.match(line)
            if m:
                ind = _indent(m.group(1))
                while list_stack and list_stack[-1][0] >= ind:
                    list_stack.pop()
                blk = make("list_item", m.group(3), i, i + 1, level=len(list_stack), ordered=m.group(2)[0].isdigit())
                emit(blk, list_stack[-1][1]["children"] if list_stack else None)
                list_stack.append((ind, blk))
                para = blk
                i += 1
                continue
            if line.startswith(">"):
                j = i
                while j < len(lines) and lines[j].startswith(">"):
                    j += 1
                emit(make("quote", "\n".join(lines[i:j]), i, j))
                para, list_stack = None, []
                i = j
                continue
            # continuation of a list item or paragraph
            if para is not None:
                para["md"] += "\n" + self._rewrite(line.strip() if para["type"] == "list_item" else line)
                para["lines"][1] = i + 1
                self._refs({"bid": para["bid"], "md": line})
                i += 1
                continue
            if list_stack and _indent(re.match(r"^\s*", line).group(0)) > list_stack[-1][0]:
                blk = make("paragraph", line.strip(), i, i + 1)
                emit(blk, list_stack[-1][1]["children"])
                para = blk
                i += 1
                continue
            list_stack = []
            blk = make("paragraph", line, i, i + 1)
            emit(blk)
            para = blk
            i += 1
        title = next((b["md"].lstrip("# ").strip() for b in root if b["type"] == "heading"), doc)
        return {"doc": doc, "subject": subject, "title": title, "file": self.cfg.rel(path), "blocks": root,
                "figs": self.figs, "refs": self.refs}

    # ---- helpers ----
    def _refs(self, block):
        for m in REF.finditer(block["md"]):
            school, year, sess, qno = m.groups()
            key = (school, int(year), sess, int(qno))
            self.refs.append({"bid": block["bid"], "text": m.group(0), "qid": self.source_to_id.get(key)})

    def _fig(self, path, width, alt):
        p = Path(path)
        sdb = self.cfg.structure_db_out / "svg"
        try:
            rel = p.relative_to(sdb.resolve())
            manual = self.cfg.structure_db_src / "data/manual" / rel
            if manual.is_file():
                p = manual
                self.report.count("kb_fig", "structure_db 手修版")
            else:
                self.report.count("kb_fig", "structure_db")
        except ValueError:
            self.report.count("kb_fig", "其他")
        info = self.assets.get(p, self.doc)
        if info is None:
            return None
        fid = "K" + info["sha"][:10]
        if not any(f["fid"] == fid for f in self.figs):
            self.figs.append({"fid": fid, "role": "kb", "src": info["key"], "w": info.get("w"), "h": info.get("h"),
                              "mono": bool(info.get("mono")) if info["ext"] == "svg" else False, "fallback": None,
                              "alt": alt or "", "max_w": width})
        return fid

    def _rewrite(self, md):
        def html(m):
            tag = m.group(0)
            src = attr(SRC_ATTR, tag)
            if not src or src.startswith(("http", "/")):
                if src and src.startswith("/"):
                    self.report.warn("kb_absolute_image", doc=self.doc, src=src)
                return tag
            w = attr(WIDTH_ATTR, tag)
            width = int(float(w)) if w and re.fullmatch(r"[\d.]+(px)?", w) else None
            alt = attr(ALT_ATTR, tag) or ""
            fid = self._fig((self.base / src).resolve(), width, alt)
            return f"![{alt}](fig:{fid})" if fid else tag

        def mdimg(m):
            if m.group(1) != "!":
                return m.group(0)
            t = link_target(m)
            if t.startswith(("http", "/", "fig:")):
                return m.group(0)
            fid = self._fig((self.base / t).resolve(), None, m.group(2))
            return f"![{m.group(2)}](fig:{fid})" if fid else m.group(0)
        return MD_LINK.sub(mdimg, HTML_IMG.sub(html, md))


def count_blocks(blocks, out=None):
    out = out if out is not None else {}
    for b in blocks:
        out[b["type"]] = out.get(b["type"], 0) + 1
        count_blocks(b["children"], out)
    return out
