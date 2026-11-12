"""筆記（資料庫）的修訂寫回 Mac 上的 .md（第 4 階段後半；pmq patches pull 呼叫）。

修訂的 target 與 field：
- `kb:<key>#<bid>` ＋ `md`：改一個區塊（標題、列點、段落、表格、引言、公式）。value＝網站格式的新 Markdown。
- `kb:<key>#<bid>` ＋ `insert_after`／`insert_child`：在這個列點後面（同一層）／底下（第一個子項）插入一個新列點。
  value＝新列點的 Markdown（不含 `- `）。
- `kb:<key>#<bid>` ＋ `delete`：刪除這個區塊（連同底下的子區塊）。標題不能刪。
- `kbnew:<科目>/<檔名>` ＋ `create`：新增一份筆記，寫到 `02_學習筆記/<科目>/_收件匣/<檔名>.md`（規格書 §14-2）。

base_h＝發佈時那個區塊網站格式 md 的 SHA-1（App 的 kbPatches.ts 用同一套）；create 是 "-"。

安全規則沿用題目寫回（patches.py 開頭的 8 條，Fable 審查過）：
1. 目標檔有未 commit 的變更 → 整批拒絕（patches.pull 統一檢查）。
2. 找檔只照 pmq.toml [kb] 匯入的筆記；新增的筆記只寫 `_收件匣/`，檔名已存在（或同一科已有同名筆記）就拒絕，不覆寫。
3. 只換那個區塊的行；其他行一個位元組都不動。沒改到的行原樣保留（含行尾空白）。
4. 網站文字 → 主檔：用發佈時的改寫紀錄（KbBuilder.pre）換回圖路徑與筆記連結；沒被原樣換回的非圖改寫 → 拒絕。
5. 寫檔前在記憶體裡重新解析整份：目標區塊的網站格式要和修訂一字不差；其他區塊（網站格式與原始位元組）
   全部相同，數量與順序不變（插入／刪除只多或少那幾個）。
6. 區塊目前的雜湊 ≠ base_h（也 ≠ 上次寫回後的雜湊）→ 不寫，標 conflict，note 放 Mac 上目前的版本。
7. CRLF 換行的檔 → 拒絕。
8. 每筆一個 commit。
"""
import difflib
import re
import time
from pathlib import Path

from .adapters.common import Assets, Report
from .kb import FIG_LINE, HEADING, INBOX, LIST, KbBuilder, discover, doc_names, walk
from .patches import FIG_LINK, Refuse, keep_edges, unrewrite
from .textutil import sha1

FIELD_NAME = {"md": "筆記區塊", "insert_after": "插入列點", "insert_child": "插入子列點", "delete": "刪除區塊", "create": "新增筆記"}
KB_FIELDS = set(FIELD_NAME)
EDITABLE = {"heading", "list_item", "paragraph", "table", "quote", "math"}
DELETABLE = {"list_item", "paragraph", "table", "quote", "math", "figure", "code", "table_group", "rule"}
BAD_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def _ws(line):
    return re.match(r"^[ \t]*", line).group(0)


def subtree_end(b):
    end = b["lines"][1]
    for k in b["children"]:
        end = max(end, subtree_end(k))
    return end


def entries(blocks, parent=None, depth=0, out=None):
    """依文件順序：{b, parent, depth}。"""
    out = [] if out is None else out
    for b in blocks:
        out.append({"b": b, "parent": parent, "depth": depth})
        entries(b["children"], b, depth + 1, out)
    return out


def signature(doc, lines):
    """每個區塊：(深度, 類型, 層級, 有序, 網站 md, 主檔原文)。不含 bid 與行號（插入、刪除會讓它們位移）。"""
    return [(e["depth"], e["b"]["type"], e["b"].get("level"), e["b"].get("ordered"), e["b"]["md"],
             "\n".join(lines[e["b"]["lines"][0]:e["b"]["lines"][1]])) for e in entries(doc["blocks"])]


def parse_target(target):
    """"kb:BCH/2-3_PDH#0123456789ab" → ("BCH/2-3_PDH", "0123456789ab")。"""
    if not target.startswith("kb:") or "#" not in target:
        raise Refuse(f"看不懂的筆記修訂對象 {target}")
    key, bid = target[3:].rsplit("#", 1)
    return key, bid


class KbWriter:
    def __init__(self, cfg, git, cache, report=None):
        self.cfg, self.git = cfg, git
        self.report = report or Report()
        self.assets = Assets(cache, self.report)
        groups, _ = discover(cfg)
        self.doc_keys, self.doc_of = doc_names(groups)
        self.path_of = {k: Path(p) for p, k in self.doc_keys.items()}
        self.subj_of = {k: k.split("/", 1)[0] for k in self.path_of}
        # target → 網站上對同一個區塊的「改內容」修訂的值的雜湊。錨點目前是這個內容＝是我們自己改的，不是 Mac 改的
        # （例如同一個列點先改字、再在底下插入子列點：第一筆寫回後錨點的字變了）
        self.own = {}

    def note_own(self, patches):
        for p in patches:
            if p.get("field") == "md" and p.get("status") in ("pending", "conflict"):
                self.own.setdefault(p["target"], set()).add(sha1(p["value"]))

    # ----- 找檔、解析 -----
    def locate(self, key):
        p = self.path_of.get(key)
        if not p:
            raise Refuse(f"Mac 上找不到筆記 {key}（可能改名或搬走了）")
        if not self.git.run("ls-files", "--error-unmatch", "--", self.git.rel(p), check=False).stdout.strip():
            raise Refuse(f"{self.git.rel(p)} 還沒有 commit 進內容 git，不自動寫回")
        return p

    def parse(self, key, path, text):
        kbb = KbBuilder(self.cfg, self.assets, self.report, {}, self.doc_keys)
        subj, doc = key.split("/", 1)
        d = kbb.build(path, subj, doc, text=text)
        return d, kbb.pre

    def find(self, doc, bid, ok):
        """bid 對到、雜湊也對 → 那個區塊；bid 對不到（標題或前面的字改過）→ 全文唯一一個雜湊相同的區塊。
        回傳 (entry 或 None, bid 對到但內容不同的 entry 或 None)。"""
        es = entries(doc["blocks"])
        own = next((e for e in es if e["b"]["bid"] == bid), None)
        if own and sha1(own["b"]["md"]) in ok:
            return own, None
        same = [e for e in es if sha1(e["b"]["md"]) in ok]
        if len(same) == 1:
            return same[0], None
        return None, own

    # ----- 改一個區塊 -----
    def rebuild(self, b, lines, pre, new_pre):
        """新的「改寫前 md」→ 區塊的新原始行。沒改到的行原樣保留。"""
        a, z = b["lines"]
        raw = lines[a:z]
        t = b["type"]
        old_l, new_l = pre.split("\n"), new_pre.split("\n")
        lead0 = _ws(raw[0])
        if t == "list_item":
            m = LIST.match(raw[0])
            prefix = raw[0][: m.start(3)] if m.group(3) is not None else raw[0].rstrip() + " "
            cont = _ws(raw[1]) if len(raw) > 1 else " " * len(prefix.expandtabs(4))

            def wrap(j, s):
                return prefix + s if j == 0 else (cont + s if s.strip() else s)
        elif t == "heading":
            def wrap(j, s):
                return s
        elif t == "paragraph":
            def wrap(j, s):
                return lead0 + s if j == 0 or (s.strip() and not s.startswith((" ", "\t"))) else s
        else:
            def wrap(j, s):
                return lead0 + s if s.strip() else s
        out = []
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, old_l, new_l, autojunk=False).get_opcodes():
            # 列點與段落的第一行帶著前綴（縮排、- ），和續行不能互換位置照搬
            if op == "equal" and (t not in ("list_item", "paragraph") or (i1 == 0) == (j1 == 0)):
                out += raw[i1:i2]
            else:
                out += [wrap(j, new_l[j]) for j in range(j1, j2)]
        return out

    def unrewrite_block(self, b, pre, spans, V):
        fids = {}
        for s, e, rep in spans:
            m = FIG_LINK.fullmatch(rep)
            if m:
                fids.setdefault(m.group(2), set()).add(pre[s:e])
        for m in FIG_LINK.finditer(V):
            if m.group(2) == "missing" or len(fids.get(m.group(2), ())) > 1:
                raise Refuse("這個區塊裡有讀不到或重複出現的圖，自動寫回分不清是哪一張，請在 Mac 上用 Typora 改")
        return unrewrite(pre, spans, b["md"], V, "KB")

    def edit(self, e, lines, pre_map, value):
        b = e["b"]
        if b["type"] not in EDITABLE:
            raise Refuse(f"這種區塊（{b['type']}）不在網站上改，請在 Mac 上用 Typora 改")
        V = keep_edges(b["md"], value)
        if not V.strip():
            raise Refuse("修訂把整個區塊清空了；要刪掉請用「刪除區塊」")
        if b["type"] == "heading":
            hm = HEADING.match(V)
            if "\n" in V or not hm or len(hm.group(1)) != b.get("level"):
                raise Refuse("標題只能改文字：要維持一行、開頭的 # 數量不變")
        pre, spans = pre_map[b["bid"]]
        new_pre = self.unrewrite_block(b, pre, spans, V)
        a, z = b["lines"]
        return lines[:a] + self.rebuild(b, lines, pre, new_pre) + lines[z:], V

    # ----- 插入列點 -----
    def insert(self, e, lines, value, child):
        b = e["b"]
        if b["type"] != "list_item":
            raise Refuse("只能在列點後面或底下插入新列點")
        V = value.strip()
        if not V:
            raise Refuse("新列點是空的")
        if FIG_LINK.search(V) or "](/kb/" in V:
            raise Refuse("新列點裡有圖或筆記連結，網站不知道主檔要寫成什麼路徑，請在 Mac 上用 Typora 加")
        a, _ = b["lines"]
        m = LIST.match(lines[a])
        indent, marker = m.group(1), m.group(2)
        kids = [k for k in b["children"] if k["type"] == "list_item"]
        if child:
            if kids:
                km = LIST.match(lines[kids[0]["lines"][0]])
                indent, marker = km.group(1), km.group(2)
                if marker[0].isdigit():
                    marker = f"{kids[0].get('num', 1)}{marker[-1]}"
            else:
                indent = indent + " " * (len(marker) + 1)
                marker = "-" if marker[0].isdigit() else marker
            at = b["lines"][1]
        else:
            if marker[0].isdigit():
                marker = f"{b.get('num', 1) + 1}{marker[-1]}"
            at = subtree_end(b)
        prefix = f"{indent}{marker} "
        cont = " " * len(prefix.expandtabs(4))
        vl = V.split("\n")
        new = [prefix + vl[0]] + [cont + s if s.strip() else s for s in vl[1:]]
        return lines[:at] + new + lines[at:], V, at

    # ----- 刪除區塊 -----
    def delete(self, e, lines):
        b = e["b"]
        if b["type"] not in DELETABLE:
            raise Refuse("標題不能在網站上刪（會連整節一起刪），請在 Mac 上用 Typora 改")
        a, z = b["lines"][0], subtree_end(b)
        # 前後都是空行 → 多刪一個空行，不留兩個連續空行
        if (a == 0 or not lines[a - 1].strip()) and z < len(lines) and not lines[z].strip():
            z += 1
        return lines[:a] + lines[z:]

    # ----- 檢查：重新解析後只有那幾個區塊不同 -----
    def verify(self, key, path, old_text, new_text, field, e, V, at=None):
        old_doc, _ = self.parse(key, path, old_text)
        new_doc, _ = self.parse(key, path, new_text)
        ol, nl = old_text.split("\n"), new_text.split("\n")
        os_, ns = signature(old_doc, ol), signature(new_doc, nl)
        oes = entries(old_doc["blocks"])
        k = next(i for i, x in enumerate(oes) if x["b"]["bid"] == e["b"]["bid"])
        if field == "md":
            if len(os_) != len(ns):
                raise Refuse("寫回後筆記的區塊數變了（修訂內容可能被當成新的區塊），不寫回")
            diff = [i for i in range(len(os_)) if os_[i] != ns[i]]
            if diff != [k] and diff != []:
                raise Refuse("寫回會動到別的區塊，不寫回")
            if ns[k][4] != V or ns[k][:4] != os_[k][:4]:
                raise Refuse("寫回後轉成網站格式和修訂內容不一致，不寫回")
        elif field in ("insert_after", "insert_child"):
            nes = entries(new_doc["blocks"])
            hit = [i for i, x in enumerate(nes) if x["b"]["lines"][0] == at]
            if len(hit) != 1 or len(ns) != len(os_) + 1:
                raise Refuse("寫回後新列點沒有變成一個獨立的列點，不寫回")
            j = hit[0]
            got = nes[j]
            if ns[:j] + ns[j + 1:] != os_:
                raise Refuse("插入新列點會動到別的區塊，不寫回")
            if got["b"]["type"] != "list_item" or got["b"]["md"] != V or got["b"]["children"]:
                raise Refuse("寫回後新列點的內容和修訂不一致，不寫回")
            par = got["parent"]
            if field == "insert_child":
                ok = par is not None and par["md"] == e["b"]["md"] and par["type"] == "list_item"
            else:
                sibs = par["children"] if par is not None else new_doc["blocks"]
                idx = next(i for i, x in enumerate(sibs) if x is got["b"])
                ok = idx > 0 and sibs[idx - 1]["md"] == e["b"]["md"] and got["depth"] == e["depth"]
            if not ok:
                raise Refuse("寫回後新列點掛到別的地方去了，不寫回")
        elif field == "delete":
            n = len(entries([e["b"]]))
            if ns != os_[:k] + os_[k + n:]:
                raise Refuse("刪除會動到別的區塊，不寫回")
        if not new_text.endswith("\n") and old_text.endswith("\n"):
            raise Refuse("寫回後檔尾的換行不見了，不寫回")

    # ----- 一筆修訂（只在記憶體裡）→ (新全文, 寫回後的雜湊, 衝突時 Mac 目前的版本) -----
    def apply(self, p, note, text, path):
        if "\r" in text:
            raise Refuse("筆記是 CRLF 換行，為了安全不自動寫回")
        key, bid = parse_target(p["target"])
        doc, pre_map = self.parse(key, path, text)
        lines = text.split("\n")
        field = p["field"]
        ok = {p["base_h"], note.get("wh")} - {None, "-"}
        if field != "md":
            ok |= self.own.get(p["target"], set())
        e, changed = self.find(doc, bid, ok)
        if field in ("insert_after", "insert_child") and e and note.get("written"):
            # 已經插入過、之後在網站上又改了新列點：改的是那個新列點
            ins = self._inserted(e, doc, field, note.get("wh"))
            if ins:
                new_lines, V = self.edit(ins, lines, pre_map, p["value"])
                return "\n".join(new_lines), sha1(V), ins, V, None
        if e is None:
            theirs = changed["b"]["md"] if changed else ""
            why = "Mac 上這個區塊在這次修訂之後也改過" if changed else "Mac 上這份筆記改過，找不到原本的區塊"
            raise Conflict(why, theirs, sha1(theirs) if changed else "")
        if field == "md":
            new_lines, V = self.edit(e, lines, pre_map, p["value"])
            return "\n".join(new_lines), sha1(V), e, V, None
        if field in ("insert_after", "insert_child"):
            if note.get("written"):
                raise Conflict("之前插入的新列點在 Mac 上改過或刪了", "", "")
            new_lines, V, at = self.insert(e, lines, p["value"], field == "insert_child")
            return "\n".join(new_lines), sha1(V), e, V, at
        if field == "delete":
            return "\n".join(self.delete(e, lines)), "-", e, None, None
        raise Refuse(f"筆記不支援欄位 {field}")

    def _inserted(self, anchor, doc, field, wh):
        """上次插入的新列點（同一層緊接在後／第一個子列點，雜湊等於 wh）。"""
        if not wh:
            return None
        es = entries(doc["blocks"])
        b = anchor["b"]
        if field == "insert_child":
            cand = [x for x in b["children"] if x["type"] == "list_item"][:1]
        else:
            par = anchor["parent"]
            sibs = par["children"] if par is not None else doc["blocks"]
            i = next(i for i, x in enumerate(sibs) if x is b)
            cand = sibs[i + 1:i + 2]
        hit = [x for x in cand if sha1(x["md"]) == wh]
        return next((x for x in es if x["b"] is hit[0]), None) if hit else None

    # ----- 新增一份筆記 -----
    def new_path(self, target):
        """"kbnew:BCH/我的新筆記" → 主檔路徑（_收件匣/）。"""
        if not target.startswith("kbnew:") or "/" not in target:
            raise Refuse(f"看不懂的新筆記 {target}")
        subj, name = target[6:].split("/", 1)
        roots = self.cfg.kb.get(subj)
        if not isinstance(roots, list) or not roots:
            raise Refuse(f"{subj} 不是可以新增筆記的科目")
        name = name.strip()
        if not name or BAD_NAME.search(name) or name.startswith(".") or len(name) > 80:
            raise Refuse(f"檔名「{name}」不能用（不能有 / \\ : * ? \" < > | 或以 . 開頭，最多 80 字）")
        path = self.cfg.notes / roots[0] / INBOX / f"{name}.md"
        return subj, name, path

    def create(self, p, note):
        subj, name, path = self.new_path(p["target"])
        text = p["value"].replace("\r\n", "\n")
        if not text.endswith("\n"):
            text += "\n"
        if "\r" in text:
            raise Refuse("新筆記裡有 CR 字元，不寫回")
        if FIG_LINK.search(text) or "](/kb/" in text:
            raise Refuse("新筆記裡有圖或筆記連結，網站不知道主檔要寫成什麼路徑；請先拿掉，寫回後在 Mac 上用 Typora 加")
        tracked = bool(self.git.run("ls-files", "--", self.git.rel(path), check=False).stdout.strip())
        if path.exists() or tracked:
            cur = path.read_bytes().decode("utf-8") if path.exists() else None
            if note.get("written") and cur is not None and tracked and sha1(cur) == note.get("wh"):
                return path, text      # 之前由網站新增、Mac 上沒動過：可以照網站的新版本蓋過
            raise Refuse(f"{self.git.rel(path)} 已經存在，不覆寫")
        if any(k.startswith(subj + "/") and p.stem == name for k, p in self.path_of.items()):
            raise Refuse(f"{subj} 已經有一份叫「{name}」的筆記；換個名字（同名會讓原本那份的網址改變）")
        # 解析看看（不寫檔）
        kbb = KbBuilder(self.cfg, self.assets, self.report, {}, self.doc_keys)
        kbb.build(path, subj, name, text=text)
        return path, text


class Conflict(Refuse):
    """主檔也改過：note 放 Mac 目前的版本給網站並排顯示。"""

    def __init__(self, why, theirs, theirs_h):
        super().__init__(why)
        self.theirs, self.theirs_h = theirs, theirs_h


def process(kw, p, note, dry_run, log):
    """處理一筆筆記修訂；回傳要寫回網站的 {status, note}（或 None＝不更新）。寫檔與 commit 在這裡做。"""
    field = p["field"]
    label = f"{p['target'][3:].split('#')[0] if p['target'].startswith('kb:') else p['target'][6:]}"
    now = int(time.time() * 1000)
    if field == "create":
        path, text = kw.create(p, note)
        if dry_run:
            log(f"── 新增筆記 {kw.git.rel(path)}（{p['id'][-8:]}）")
            for ln in text.split("\n")[:20]:
                log("   +" + ln)
            return None, None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))
        sha = kw.git.commit(path, f"修訂 {p['id']}：新增筆記 {kw.git.rel(path)}（{p['device']}）")
        return {"status": "pending", "note": {"written": sha, "wh": sha1(text), "wv": sha1(p["value"]), "at": now}}, (label, sha)
    key, _ = parse_target(p["target"])
    path = kw.locate(key)
    text = path.read_bytes().decode("utf-8")
    new_text, wh, e, V, at = kw.apply(p, note, text, path)
    if new_text == text:
        return {"status": "pending", "note": {"written": "（主檔已是此內容）", "wh": wh, "wv": sha1(p["value"]), "at": now}}, (label, "-")
    kw.verify(key, path, text, new_text, "md" if at is None and field != "delete" else field, e, V, at)
    if dry_run:
        log(f"── {label} {FIELD_NAME[field]}（{p['id'][-8:]}）")
        for ln in difflib.unified_diff(text.split("\n"), new_text.split("\n"), lineterm="", n=1):
            log("   " + ln)
        return None, None
    path.write_bytes(new_text.encode("utf-8"))
    sha = kw.git.commit(path, f"修訂 {p['id']}：{label} {FIELD_NAME[field]}（{p['device']}）")
    return {"status": "pending", "note": {"written": sha, "wh": wh, "wv": sha1(p["value"]), "bf": sha1(text), "at": now}}, (label, sha)


def merged_ok(p, note, docs):
    """pmq publish 之後：這筆已寫回的筆記修訂，線上內容是不是已經是新版。"""
    if p["field"] == "create":
        subj, name = p["target"][6:].split("/", 1)
        return any(k == f"{subj}/{name}" or k == f"{subj}/_{name}" for k in docs)
    key = p["target"][3:].rsplit("#", 1)[0]
    d = docs.get(key)
    if not d:
        return False
    if note.get("bf") and sha1(d["src"]) == note["bf"]:
        return False                      # 線上還是寫回之前的版本
    if p["field"] == "delete":
        return bool(note.get("bf"))
    return any(sha1(b["md"]) == note.get("wh") for b, _ in walk(d["blocks"]))
