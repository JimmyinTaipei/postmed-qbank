"""Anki 欄位的 HTML → 網站卡片的 Markdown（規格書 §9.5）。

網站的 Markdown 規則與題目相同（app/src/ui/content/render.ts）：
- 公式 `$…$`、`$$…$$`；Anki 的 `\\(…\\)`、`\\[…\\]`、`[$]…[/$]`、`[$$]…[/$$]`、`[latex]…[/latex]` 都轉過來。
- 圖：`![](m/<sha256>.<副檔名>)`；聲音：`[sound:m/<sha256>.<副檔名>]`。檔名對照由呼叫者給（media 參數）。
- 克漏字標記 `{{c1::答案::提示}}` 原樣保留，由網站遮蓋。
- 粗體、斜體、底線、上下標、列點、表格保留；顏色、字型、版面用的 div 不保留。
"""
from __future__ import annotations

import re
from html import unescape
from html.parser import HTMLParser

PH = "\u0000"
_MATH = re.compile(r"\\\((.+?)\\\)|\\\[(.+?)\\\]|\[\$\$\](.+?)\[/\$\$\]|\[\$\](.+?)\[/\$\]|\[latex\](.+?)\[/latex\]", re.S | re.I)
_TAG = re.compile(r"<[^>]+>")
_SOUND = re.compile(r"\[sound:([^\]]+)\]")
_BLOCK = {"div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "section", "article", "header", "footer", "center", "dl", "dt", "dd"}
_INLINE_KEEP = {"u": "u", "sub": "sub", "sup": "sup", "s": "s", "strike": "s", "del": "s"}
_SKIP = {"script", "style", "button", "head", "title", "audio", "video", "object", "svg"}


def _tex(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = _TAG.sub("", s)
    return unescape(s).replace("\xa0", " ").strip()


def _esc_text(s: str) -> str:
    s = s.replace("\\", "\\\\")
    s = re.sub(r"([*_`$])", r"\\\1", s)
    return s.replace("<", "&lt;").replace("==", "=\\=")


class _Conv(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0
        self.lists: list[list] = []   # [kind, 序號]
        self.table: list | None = None   # rows of cells；cell 是 list[str]
        self.cell: list[str] | None = None
        self.link: list | None = None
        self.pending: str | None = None

    # 輸出到目前的容器（表格儲存格或主文）
    def emit(self, s: str):
        (self.cell if self.cell is not None else self.out).append(s)

    def nl(self, n=1):
        tgt = self.cell if self.cell is not None else self.out
        if self.cell is not None:
            tgt.append("<br>")
            return
        tail = "".join(tgt[-3:])
        have = len(tail) - len(tail.rstrip("\n")) if tail.strip("\n") or tgt else n
        if not "".join(tgt).strip():
            return
        tgt.append("\n" * max(0, n - have))

    # 粗體、斜體：記號緊貼文字（「** a **」不會被當成粗體），空白移到記號外面；沒有內容就整個拿掉
    def open_mark(self, m):
        self.emit(m)
        self.pending = m

    def close_mark(self, m):
        tgt = self.cell if self.cell is not None else self.out
        if tgt and tgt[-1] == m and self.pending == m:
            tgt.pop()
            self.pending = None
            return
        trail = ""
        while tgt and tgt[-1] and not tgt[-1].strip(" "):
            trail = tgt.pop() + trail
        if tgt:
            last = tgt[-1]
            stripped = last.rstrip(" ")
            trail = last[len(stripped):] + trail
            tgt[-1] = stripped
        tgt.append(m + trail)
        self.pending = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in _SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        if tag == "br":
            if self.cell is not None:
                self.emit("<br>")
            else:
                self.out.append("\n")
        elif tag in _BLOCK:
            self.nl()
        elif tag in ("b", "strong"):
            self.open_mark("**")
        elif tag in ("i", "em"):
            self.open_mark("*")
        elif tag in _INLINE_KEEP:
            self.emit(f"<{_INLINE_KEEP[tag]}>")
        elif tag == "hr":
            self.nl(2)
            self.emit("---")
            self.nl(2)
        elif tag in ("ul", "ol"):
            self.nl()
            self.lists.append([tag, 0])
        elif tag == "li":
            self.nl()
            depth = max(0, len(self.lists) - 1)
            if self.lists and self.lists[-1][0] == "ol":
                self.lists[-1][1] += 1
                self.emit("   " * depth + f"{self.lists[-1][1]}. ")
            else:
                self.emit("  " * depth + "- ")
        elif tag == "img":
            src = a.get("src") or ""
            self.emit(f"{PH}IMG:{src}{PH}")
        elif tag == "a":
            href = a.get("href") or ""
            self.link = [href, len(self.cell if self.cell is not None else self.out)]
        elif tag == "table":
            self.nl(2)
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.table.append([])
        elif tag in ("td", "th") and self.table is not None:
            if not self.table:
                self.table.append([])
            self.cell = []

    def handle_endtag(self, tag):
        if tag in _SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag in _BLOCK:
            self.nl()
        elif tag in ("b", "strong"):
            self.close_mark("**")
        elif tag in ("i", "em"):
            self.close_mark("*")
        elif tag in _INLINE_KEEP:
            self.emit(f"</{_INLINE_KEEP[tag]}>")
        elif tag in ("ul", "ol"):
            if self.lists:
                self.lists.pop()
            self.nl(1 if self.lists else 2)
        elif tag == "a" and self.link:
            href, start = self.link
            self.link = None
            tgt = self.cell if self.cell is not None else self.out
            text = "".join(tgt[start:]).strip()
            if re.match(r"https?://", href) and text:
                del tgt[start:]
                tgt.append(f"[{text}]({href.replace(')', '%29').replace(' ', '%20')})")
        elif tag in ("td", "th") and self.table is not None and self.cell is not None:
            self.table[-1].append("".join(self.cell).strip())
            self.cell = None
        elif tag == "table" and self.table is not None:
            rows = [r for r in self.table if r]
            self.table = None
            if rows:
                html = "<table>" + "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows) + "</table>"
                self.out.append(html)
                self.nl(2)

    def handle_data(self, data):
        if self.skip:
            return
        data = re.sub(r"[ \t\r\n\f\v]+", " ", data.replace("\xa0", " "))
        if self.pending and data.startswith(" "):
            tgt = self.cell if self.cell is not None else self.out
            if tgt and tgt[-1] == self.pending:
                tgt[-1] = " " + self.pending
                data = data.lstrip(" ")
        if data:
            self.pending = None
        parts = data.split(PH)
        # 佔位字（公式、圖）不跳脫
        out = []
        for i, p in enumerate(parts):
            out.append(p if i % 2 else _esc_text(p))
        self.emit(PH.join(out))


def html_to_md(html: str, media: dict[str, str] | None = None) -> str:
    """media：Anki 檔名 → 網站路徑（m/<sha>.<ext>）。找不到的圖留下說明文字。"""
    if not html or not html.strip():
        return ""
    media = media or {}
    maths: list[tuple[str, bool]] = []

    def take_math(m):
        g = m.groups()
        tex = next(x for x in g if x is not None)
        display = g[1] is not None or g[2] is not None
        maths.append((_tex(tex), display))
        return f"{PH}M{len(maths) - 1}{PH}"

    sounds: list[str] = []

    def take_sound(m):
        sounds.append(unescape(m.group(1)).strip())
        return f"{PH}S{len(sounds) - 1}{PH}"

    s = _MATH.sub(take_math, html)
    s = _SOUND.sub(take_sound, s)
    c = _Conv()
    c.feed(s)
    c.close()
    md = "".join(c.out)

    def put(m):
        k = m.group(1)
        if k.startswith("M"):
            tex, display = maths[int(k[1:])]
            if not tex:
                return ""
            return f"\n$${tex}$$\n" if display else f"${tex}$"
        if k.startswith("S"):
            name = sounds[int(k[1:])]
            path = media.get(name)
            return f"[sound:{path}]" if path else f"（聲音檔不見了：{_esc_text(name)}）"
        if k.startswith("IMG:"):
            name = unescape(k[4:])
            path = media.get(name)
            if path:
                return f"![]({path})"
            if re.match(r"https?://", name):
                return ""
            return f"（圖不見了：{_esc_text(name)}）"
        return ""

    md = re.sub(PH + r"(M\d+|S\d+|IMG:[^" + PH + r"]*)" + PH, put, md)
    md = md.replace(PH, "")
    # 每行去頭尾空白（列點的縮排保留）；多個空行併成一個
    lines = []
    for ln in md.split("\n"):
        ln = ln.rstrip()
        if re.match(r"^\s*(- |\d+\. )", ln):
            lines.append(ln)
        else:
            lines.append(ln.strip())
    md = "\n".join(lines)
    md = re.sub(r"\*\*\s*\*\*", "", md)          # 空的粗體
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    # 行首的 # 與 > 會被當成標題、引用
    md = re.sub(r"(?m)^([#>])", r"\\\1", md)
    return md


def media_refs(html: str) -> tuple[set[str], set[str]]:
    """欄位裡引用的圖與聲音（Anki 檔名，已解 HTML 跳脫）。"""
    imgs = set()
    for m in re.finditer(r"""<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"'>\s]+))""", html, re.I):
        imgs.add(unescape(next(g for g in m.groups() if g is not None)))
    snds = {unescape(m.group(1)).strip() for m in _SOUND.finditer(html)}
    return imgs, snds
