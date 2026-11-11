"""pmq patches list／pull／resolve：把網站上的修訂寫回 Mac 主檔（規格書 §7.3）。

這是整個專案裡唯一會寫主檔的程式。安全規則：
- 目標檔有未 commit 的變更 → 整批拒絕，什麼都不寫。
- 只替換該欄位的位元組範圍（物理：`## ques／idea／sol` 的本文、front matter 的單一鍵的行；
  生化：`02_原卷題庫/` 考卷檔裡該題該欄位的行）。其餘位元組不動；front matter 不整份重新序列化。
- `03_分章題庫/` 一律不碰（找檔只在 `02_原卷題庫/*/*.md`）。
- `base_h` 與主檔目前的雜湊不同 → 不寫，標 conflict（note 裡放主檔目前的版本，網站並排顯示）。
- 寫之前在記憶體裡重新解析新檔：該欄位轉成網站格式後必須和修訂內容一字不差、其他欄位的雜湊不變，
  否則不寫（標 conflict 並說明原因）。
- 每筆修訂一個 commit，訊息含修訂 ID 與「來源｜ID」。
- 寫回後狀態仍是 pending（note 記下 commit 與寫入後的雜湊）；下次 `pmq publish` 確認線上內容已是新版才改 merged。

網站上的題圖是 `![alt](fig:<fid>)`，主檔是相對路徑；寫回時用發佈時的改寫紀錄（adapters 的 sub_spans）
把沒被改到的連結原樣換回，使用者新打的 `fig:` 也換回該圖的原路徑。
"""
import datetime
import difflib
import json
import re
import subprocess
import time
from pathlib import Path

from .adapters.biochem import FOLDER_KIND, KEY_LINE, BiochemAdapter
from .adapters.common import MD_LINK, Assets, Report, load_yaml
from .adapters.physics import FRONT, SECTION, PhysicsAdapter
from .cache import HashCache
from .remote import Remote
from .textutil import sha1

FIELD_NAME = {"ques": "題幹與選項", "idea": "思路", "sol": "詳解", "answer": "答案", "chap": "章節", "tags": "標籤",
              "human_verified": "已確認"}
TEXT_FIELDS = ("ques", "idea", "sol")
FIG_LINK = re.compile(r"!\[([^\]\n]*)\]\(fig:([0-9A-Za-z_-]+)\)")


class Refuse(Exception):
    """這一筆不能安全寫回；原因寫進 note，狀態標 conflict。"""


# ---------- 欄位雜湊（App 的 src/data/patches.ts 用同一套算法） ----------

def canon(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def answer_obj(q):
    a = q["answer"]
    return {"mode": a["mode"], "keys": list(a["keys"]), "text": a["text"]}


def tags_obj(q):
    return {k: list(q["tags"][k]) for k in sorted(q["tags"])}


def field_h(q, field):
    if field in TEXT_FIELDS:
        return q["h"][field]
    if field == "answer":
        return sha1(canon(answer_obj(q)))
    if field == "chap":
        return sha1(q["chap"] or "")
    if field == "tags":
        return sha1(canon(tags_obj(q)))
    if field == "human_verified":
        return "-"
    raise Refuse(f"不認得的欄位 {field}")


def field_display(q, field):
    """衝突時給網站並排顯示的「主檔目前的版本」（與修訂的 value 同格式）。"""
    if field in TEXT_FIELDS:
        return q[field]
    if field == "answer":
        return canon(answer_obj(q))
    if field == "chap":
        return q["chap"] or ""
    if field == "tags":
        return canon(tags_obj(q))
    return ""


# ---------- 內容 git ----------

class ContentGit:
    def __init__(self, cfg):
        self.cfg = cfg
        if not Path(cfg.content_git).is_dir():
            raise SystemExit(f"找不到內容 git：{cfg.content_git}（見 docs/規劃/02_搬遷步驟.md）")

    def run(self, *args, check=True):
        cmd = ["git", "-c", "core.quotepath=off", f"--git-dir={self.cfg.content_git}", f"--work-tree={self.cfg.root}", *args]
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=self.cfg.root)
        if check and r.returncode != 0:
            raise SystemExit(f"git {' '.join(args[:2])} 失敗：{r.stderr.strip()[:400]}")
        return r

    def rel(self, path):
        return str(Path(path).relative_to(self.cfg.root))

    def dirty(self, path):
        return self.run("status", "--porcelain", "--", self.rel(path)).stdout.strip()

    def grep_id(self, qid, pathspecs):
        pat = r"^ID:[ \t]?" + re.escape(qid) + r"[ \t]*$"
        r = self.run("grep", "--cached", "-l", "-z", "-E", pat, "--", *pathspecs, check=False)
        if r.returncode not in (0, 1):
            raise SystemExit(f"git grep 失敗：{r.stderr.strip()[:300]}")
        return [self.cfg.root / p for p in r.stdout.split("\0") if p]

    def commit(self, path, message):
        rel = self.rel(path)
        self.run("add", "--", rel)
        self.run("commit", "-q", "-m", message, "--only", "--", rel)
        return self.run("rev-parse", "--short=10", "HEAD").stdout.strip()


# ---------- 把網站上的文字對回主檔 ----------

def segments(raw, spans):
    """發佈時的改寫紀錄 → 在網站文字（R）裡的位置。順便組出 R 做檢查。"""
    segs, parts, last, rpos = [], [], 0, 0
    for s, e, rep in spans:
        parts.append(raw[last:s])
        rpos += s - last
        segs.append({"ra": rpos, "rb": rpos + len(rep), "orig": raw[s:e], "rep": rep})
        parts.append(rep)
        rpos += len(rep)
        last = e
    parts.append(raw[last:])
    return segs, "".join(parts)


def fig_map(segs, subject):
    """fid → 換回主檔時要用的東西。物理：連結目標（保留使用者改的 alt）；生化：整個 <img> 標籤。"""
    out = {}
    for sg in segs:
        m = FIG_LINK.fullmatch(sg["rep"])
        if not m:
            continue
        if subject == "PHY":
            lm = MD_LINK.fullmatch(sg["orig"])
            if lm:
                target = lm.group(3)
                out[m.group(2)] = ("target", f"<{target}>" if target else lm.group(4))
        else:
            out[m.group(2)] = ("tag", sg["orig"])
    return out


def unrewrite(raw, spans, R, V, subject):
    """V（網站上改過的文字）→ 主檔的新位元組。R 是發佈時由 raw 改寫來的網站文字。"""
    segs, rebuilt = segments(raw, spans)
    if rebuilt != R:
        raise Refuse("主檔與網站內容的對照不一致（改寫紀錄對不上），不寫回")
    out, done = [], set()
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, R, V, autojunk=False).get_opcodes():
        if op == "equal":
            p = i1
            for k, sg in enumerate(segs):
                if k in done or sg["ra"] < p:
                    continue
                zero = sg["ra"] == sg["rb"]
                if (zero and i1 <= sg["ra"] <= i2) or (not zero and sg["ra"] >= i1 and sg["rb"] <= i2):
                    out.append(R[p:sg["ra"]])
                    out.append(sg["orig"])
                    p = sg["rb"]
                    done.add(k)
            out.append(R[p:i2])
        elif op in ("replace", "insert"):
            out.append(V[j1:j2])
    # 沒被原樣換回的改寫紀錄：題圖還能靠 fig: 換回路徑；其他的（PDF／老師解析連結、網站上不顯示的圖）
    # 在網站上看不到原本的連結，照寫會把主檔的連結悄悄變成純文字或整個消失 → 不寫。
    lost = [sg for k, sg in enumerate(segs) if k not in done and not FIG_LINK.fullmatch(sg["rep"])]
    if lost:
        raise Refuse("這次修改碰到主檔裡的連結（" + "、".join(sg["orig"][:50] for sg in lost[:2])
                     + "），自動寫回會把連結弄丟，請在 Mac 上手動改")
    text = "".join(out)
    figs = fig_map(segs, subject)

    def back(m):
        fid = m.group(2)
        if fid not in figs:
            raise Refuse(f"修訂裡的圖 fig:{fid} 不是這一題原本的圖，不知道主檔路徑")
        kind, val = figs[fid]
        return f"![{m.group(1)}]({val})" if kind == "target" else val
    return FIG_LINK.sub(back, text)


def keep_edges(R, V):
    """編輯器會去掉頭尾空白；這裡補回原本的（避免只因空行不同就改到主檔）。"""
    lead = R[: len(R) - len(R.lstrip())]
    trail = R[len(R.rstrip()):]
    return lead + V.strip() + trail if V.strip() else V


# ---------- front matter 的行級替換（物理） ----------

def fm_lines(text):
    m = FRONT.match(text)
    if not m:
        raise Refuse("缺少 YAML front matter")
    return m, m.group(1).split("\n")


def top_block(lines, key):
    """front matter 頂層鍵 key 的行範圍 [a, b)；沒有回 None。"""
    for i, ln in enumerate(lines):
        if re.match(rf"^{re.escape(key)}:(\s|$)", ln):
            j = i + 1
            while j < len(lines) and (lines[j] == "" or lines[j][0] in " \t" or lines[j].startswith("- ")):
                j += 1
            while j > i + 1 and lines[j - 1].strip() == "":
                j -= 1
            return i, j
    return None


def child_block(lines, a, b, key, indent="  "):
    """頂層區塊 [a, b) 裡第一層子鍵 key 的行範圍。"""
    for i in range(a + 1, b):
        if re.match(rf"^{indent}{re.escape(key)}:(\s|$)", lines[i]):
            j = i + 1
            while j < b and (lines[j].startswith(indent + " ") or lines[j].startswith(indent + "- ")):
                j += 1
            return i, j
    return None


def yq(s):
    """YAML 純量：一律寫成雙引號字串（JSON 字串是合法的 YAML），不猜型別。"""
    return json.dumps(s, ensure_ascii=False)


def replace_fm(text, m, lines):
    return text[: m.start(1)] + "\n".join(lines) + text[m.end(1):]


# ---------- 主程式 ----------

class Writer:
    def __init__(self, cfg, today=None):
        self.cfg = cfg
        self.git = ContentGit(cfg)
        self.cache = HashCache(cfg.cache)
        self.report = Report()
        self.assets = Assets(self.cache, self.report)
        self.phy = PhysicsAdapter(cfg, self.cache, self.report, self.assets)
        self.bch = BiochemAdapter(cfg, self.cache, self.report, self.assets)
        self._phy_ready = False
        self._chapters = None
        self.today = today or datetime.date.today().isoformat()

    # ----- 找檔、解析 -----
    def subject_of(self, qid):
        return "PHY" if re.fullmatch(r"PHY-\d{6}", qid) else "BCH"

    def locate(self, qid):
        subj = self.subject_of(qid)
        if subj == "PHY":
            base = self.git.rel(self.cfg.physics / "02_原卷題庫")
            hits = [p for p in self.git.grep_id(qid, [base])
                    if p.name.lower() != "readme.md" and " 2." not in p.name and "講義例題" not in p.parts]
        else:
            base = self.git.rel(self.cfg.biochem / "02_原卷題庫")
            hits = [p for p in self.git.grep_id(qid, [f":(glob){base}/*/*.md"])
                    if p.parent.name in FOLDER_KIND and " 2." not in p.name]
        if not hits:
            raise Refuse(f"在主檔裡找不到 {qid}（只找 02_原卷題庫，而且要已經 commit 進內容 git）")
        if len(hits) > 1:
            raise Refuse(f"{qid} 出現在 {len(hits)} 個檔：" + "、".join(self.git.rel(h) for h in hits[:3]))
        return subj, hits[0]

    def parse(self, subj, path, text):
        """物理：回傳 (q, {"spans": 各段的改寫紀錄})。"""
        if not self._phy_ready:
            self.phy._load_registry()
            self.phy._bip = {}
            self._phy_ready = True
        q = self.phy._question(path, text)
        return q, {"spans": dict(self.phy.last_spans)}

    def bch_question(self, path, text, qid):
        blocks = self.bch._blocks(text)
        found = [b for b in blocks if b["fields"].get("ID", "").strip() == qid]
        if len(found) != 1:
            raise Refuse(f"{qid} 在 {path.name} 裡有 {len(found)} 個區塊")
        b = found[0]
        q = self.bch._question(path.parent.name, path, b)
        return q, b, dict(self.bch.last_spans)

    def chapters(self):
        if self._chapters is None:
            self._chapters = {c["id"] for c in self.phy.chapters() + self.bch.chapters()}
        return self._chapters

    # ----- 套用一筆修訂（只在記憶體裡；回傳新的全文） -----
    def apply(self, subj, path, text, qid, field, value):
        if "\r" in text:
            raise Refuse("主檔是 CRLF 換行，為了安全不自動寫回")
        if subj == "PHY":
            return self._apply_phy(path, text, field, value)
        return self._apply_bch(path, text, qid, field, value)

    def current(self, subj, path, text, qid):
        if subj == "PHY":
            q, _ = self.parse(subj, path, text)
            return q
        return self.bch_question(path, text, qid)[0]

    def _apply_phy(self, path, text, field, value):
        q, extra = self.parse("PHY", path, text)
        if field in TEXT_FIELDS:
            m = FRONT.match(text)
            body_off = m.end()
            body = text[body_off:]
            marks = list(SECTION.finditer(body))
            idx = [x.group(1) for x in marks].index(field)
            a = body_off + marks[idx].end()
            b = body_off + (marks[idx + 1].start() if idx + 1 < len(marks) else len(body))
            raw = text[a:b]
            V = keep_edges(q[field], value)
            if re.search(r"^## (ques|idea|sol)[ \t]*$", V, re.M):
                raise Refuse("修訂內容裡有「## ques／idea／sol」標題行，會弄壞主檔結構")
            new_raw = unrewrite(raw, extra["spans"][field], q[field], V, "PHY")
            return text[:a] + new_raw + text[b:], V
        m, lines = fm_lines(text)
        if field == "answer":
            val = json.loads(value)
            blk = top_block(lines, "ans")
            if not blk:
                raise Refuse("front matter 沒有 ans:")
            vb = child_block(lines, blk[0], blk[1], "value")
            if not vb:
                raise Refuse("ans 底下沒有 value:")
            mode = val["mode"]
            if mode in ("single", "all", "any"):
                keys = [k for k in val["keys"] if re.fullmatch(r"[A-H]", k)]
                if not keys:
                    raise Refuse("選擇題的答案至少要一個字母")
                was_list = lines[vb[0]].rstrip().endswith(":") and vb[1] > vb[0] + 1
                new = ["  value:"] + [f"  - {k}" for k in keys] if (was_list or len(keys) > 1) else [f"  value: {keys[0]}"]
            else:
                new = [f"  value: {yq(val.get('text') or '')}"]
            lines[vb[0]:vb[1]] = new
            blk = top_block(lines, "ans")
            mb = child_block(lines, blk[0], blk[1], "mode")
            if mb:
                lines[mb[0]:mb[1]] = [f"  mode: {mode}"]
            else:
                lines.insert(blk[0] + 1, f"  mode: {mode}")
            return replace_fm(text, m, lines), None
        if field == "chap":
            if value and value not in self.chapters():
                raise Refuse(f"章節 {value} 不在章節樹裡")
            code = value.split(":", 1)[1] if ":" in value else value
            blk = top_block(lines, "chap")
            if not blk:
                raise Refuse("front matter 沒有 chap:")
            lines[blk[0]:blk[1]] = [f"chap: {code}"]
            return replace_fm(text, m, lines), None
        if field == "tags":
            import yaml
            tags = json.loads(value)
            dumped = yaml.safe_dump({"tag": {k: list(v) for k, v in tags.items() if v}}, allow_unicode=True,
                                    sort_keys=False, default_flow_style=False, width=10 ** 6).rstrip("\n").split("\n")
            blk = top_block(lines, "tag")
            if blk:
                lines[blk[0]:blk[1]] = dumped
            else:
                lines += dumped
            return replace_fm(text, m, lines), None
        if field == "human_verified":
            new = ["human_review:", f"  date: '{self.today}'", "  by: user"]
            blk = top_block(lines, "human_review")
            if blk:
                lines[blk[0]:blk[1]] = new
            else:
                lines += new
            return replace_fm(text, m, lines), None
        raise Refuse(f"物理不支援欄位 {field}")

    def _apply_bch(self, path, text, qid, field, value):
        q, b, spans = self.bch_question(path, text, qid)
        lines = text.split("\n")
        key = {"answer": "ans"}.get(field, field)
        if field == "human_verified":
            if "verified" in b["fields"]:
                a, e = b["spans"]["verified"]
                lines[a:a + 1] = [f"verified: {self.today}"]
            else:
                # 放在 ID 那一行的正下方：不會動到任何欄位（含 sol 結尾的空行）的位元組
                lines.insert(b["spans"]["ID"][1], f"verified: {self.today}")
            return "\n".join(lines), None
        if key not in b["spans"]:
            raise Refuse(f"這一題沒有 {key}: 欄位")
        a, e = b["spans"][key]
        km = KEY_LINE.match(lines[a])
        prefix = lines[a][: km.start(2)]
        if field in ("ques", "sol"):
            fv = b["fields"][key]
            stripped = fv.rstrip()
            trail = fv[len(stripped):]
            if spans.get(key) is None:
                raise Refuse("這個欄位有相對連結（會被網站改成純文字），請在 Mac 上手動改")
            V = keep_edges(q[field], value)
            if any(KEY_LINE.match(ln) for ln in V.split("\n")):
                raise Refuse("修訂內容裡有一行以「ID:／ques:／ans:…」開頭，會弄壞考卷檔結構")
            new = prefix + unrewrite(stripped, spans[key], q[field], V, "BCH") + trail
            lines[a:e] = new.split("\n")
            return "\n".join(lines), V
        if field in ("answer", "chap"):
            if any(lines[i].strip() for i in range(a + 1, e)):
                raise Refuse(f"{key}: 有多行內容，為了安全不自動寫回")
            if field == "chap":
                if value and value not in self.chapters():
                    raise Refuse(f"章節 {value} 不在章節樹裡")
                new = value.split(":", 1)[1] if ":" in value else value
            else:
                val = json.loads(value)
                keys = [k for k in val["keys"] if re.fullmatch(r"[A-H]", k)]
                if val["mode"] == "single" and len(keys) == 1:
                    new = keys[0]
                elif val["mode"] == "all" and len(keys) > 1:
                    new = ",".join(keys)
                elif val["mode"] == "any" and keys:
                    new = "或".join(keys)
                else:
                    raise Refuse("生化的答案只支援選擇題字母")
            lines[a] = prefix + new
            return "\n".join(lines), None
        raise Refuse(f"生化不支援欄位 {field}")

    # ----- 檢查：新全文重新解析後，只有這個欄位變了 -----
    def verify(self, subj, path, old_text, new_text, qid, field, value, web_text):
        old = self.current(subj, path, old_text, qid)
        new = self.current(subj, path, new_text, qid)
        for f in TEXT_FIELDS:
            if f != field and old["h"][f] != new["h"][f]:
                raise Refuse(f"寫回後 {f} 也變了（不應該），不寫回")
        if field in TEXT_FIELDS:
            if new[field] != web_text:
                raise Refuse("寫回後轉成網站格式和修訂內容不一致，不寫回")
        elif field == "answer":
            want = json.loads(value)
            got = answer_obj(new)
            if got["mode"] != want["mode"] or got["keys"] != [k for k in want["keys"]] or (want["mode"] in ("text", "numeric") and (got["text"] or "") != (want.get("text") or "")):
                raise Refuse(f"寫回後答案解析成 {canon(got)}，和修訂 {value} 不一致，不寫回")
            if old["answer"]["trust"] != new["answer"]["trust"] and subj == "PHY":
                pass  # 答案來源（provenance）沒動，trust 理論上不會變
        elif field == "chap":
            if (new["chap"] or "") != value:
                raise Refuse("寫回後章節不一致，不寫回")
        elif field == "tags":
            want = {k: list(v) for k, v in sorted(json.loads(value).items()) if v}
            if canon(tags_obj(new)) != canon(want):
                raise Refuse("寫回後標籤不一致，不寫回")
        elif field == "human_verified":
            if not new["sol_meta"]["human_verified"]:
                raise Refuse("寫回後沒有讀到已確認標記，不寫回")
        if subj == "BCH":
            # 同一份考卷其他題的區塊不能變
            ob = [x["raw"] for x in self.bch._blocks(old_text) if x["fields"].get("ID", "").strip() != qid]
            nb = [x["raw"] for x in self.bch._blocks(new_text) if x["fields"].get("ID", "").strip() != qid]
            if ob != nb:
                raise Refuse("寫回會動到同一份考卷的其他題，不寫回")
            # 這一題的其他欄位（ans、chap、source…）也不能變
            key = {"answer": "ans", "human_verified": "verified"}.get(field, field)
            mine = [[{k: v for k, v in x["fields"].items() if k != key}
                     for x in self.bch._blocks(t) if x["fields"].get("ID", "").strip() == qid] for t in (old_text, new_text)]
            if mine[0] != mine[1]:
                raise Refuse("寫回會動到這一題的其他欄位，不寫回")
        else:
            self._phy_guard(old_text, new_text, field)
        return new

    def _phy_guard(self, old_text, new_text, field):
        """物理：改正文就不能動 front matter；改 front matter 就不能動正文，也不能動別的鍵。"""
        mo, mn = FRONT.match(old_text), FRONT.match(new_text)
        if not mo or not mn:
            raise Refuse("寫回後 front matter 讀不到，不寫回")
        if field in TEXT_FIELDS:
            if old_text[: mo.end()] != new_text[: mn.end()]:
                raise Refuse("寫回後 front matter 也變了（不應該），不寫回")
            return
        if old_text[mo.end():] != new_text[mn.end():]:
            raise Refuse("寫回後正文也變了（不應該），不寫回")
        a, b = load_yaml(mo.group(1)) or {}, load_yaml(mn.group(1)) or {}
        key = {"answer": "ans", "chap": "chap", "tags": "tag", "human_verified": "human_review"}[field]
        if field == "answer":
            rest = [{k: v for k, v in (d.get("ans") or {}).items() if k not in ("value", "mode")} for d in (a, b)]
            if rest[0] != rest[1]:
                raise Refuse("寫回後 ans 底下 value／mode 以外的內容也變了（不應該），不寫回")
        if {k: v for k, v in a.items() if k != key} != {k: v for k, v in b.items() if k != key}:
            raise Refuse("寫回後 front matter 的其他欄位也變了（不應該），不寫回")


def _note(p):
    try:
        n = json.loads(p.get("note") or "{}")
        return n if isinstance(n, dict) else {}
    except ValueError:
        return {}


def _qid(p):
    t = p["target"]
    return t[2:] if t.startswith("q:") else None


def _short(pid):
    return pid[-8:]


def list_patches(cfg, url, show_all=False):
    remote = Remote(url)
    ps = remote._req("GET", "/api/admin/patches" + ("?status=all" if show_all else ""))["patches"]
    if not ps:
        print("修訂佇列是空的。")
        return 0
    for p in ps:
        n = _note(p)
        state = {"pending": "已寫回・待發佈" if n.get("written") and n.get("wv") == sha1(p["value"]) else "待寫回",
                 "conflict": "衝突", "merged": "已合併", "rejected": "已放棄"}[p["status"]]
        when = time.strftime("%m-%d %H:%M", time.localtime(p["created_at"] / 1000))
        print(f"{_short(p['id'])}  {state:<8} {p['target'][2:]:<16} {FIELD_NAME.get(p['field'], p['field']):<6} {p['device']:<10} {when}")
        if p["status"] == "conflict" and n.get("reason"):
            print(f"          原因：{n['reason']}")
    print(f"共 {len(ps)} 筆。寫回：bin/pmq patches pull；處理衝突：bin/pmq patches resolve <ID 末 8 碼> --mine｜--theirs")
    return 0


def pull(cfg, url, dry_run=False):
    remote = Remote(url)
    ps = remote._req("GET", "/api/admin/patches?status=pending")["patches"]
    todo, skipped = [], []
    for p in ps:
        n = _note(p)
        if n.get("written") and n.get("wv") == sha1(p["value"]):
            continue                      # 已寫回、內容沒再改：等 publish 改 merged
        if not _qid(p):
            skipped.append(p)             # 筆記區塊、圖：第 4、7 階段
            continue
        todo.append(p)
    if skipped:
        print(f"略過 {len(skipped)} 筆非題目的修訂（筆記與圖的寫回在之後的階段）。")
    if not todo:
        print("沒有待寫回的修訂。")
        return 0

    w = Writer(cfg)
    located = {}
    for p in todo:
        qid = _qid(p)
        if qid in located:
            continue
        try:
            located[qid] = w.locate(qid)
        except Refuse as e:
            located[qid] = e
    dirty = sorted({w.git.rel(v[1]) for v in located.values() if not isinstance(v, Refuse) and w.git.dirty(v[1])})
    if dirty:
        print("✗ 下列主檔有還沒 commit 的變更，為了不蓋掉你在 Mac 上的修改，這次什麼都不寫：")
        for d in dirty:
            print("   ", d)
        print("  請先看過並 commit（bin/cgit add … && bin/cgit commit），或放棄那些變更，再執行一次 pull。")
        return 1

    written, conflicts, bch_ids, errors = [], [], [], []
    for p in sorted(todo, key=lambda x: x["created_at"]):
        qid, field, n = _qid(p), p["field"], _note(p)
        loc = located[qid]
        upd = None
        try:
            if isinstance(loc, Refuse):
                raise loc
            subj, path = loc
            text = path.read_bytes().decode("utf-8")
            cur = w.current(subj, path, text, qid)
            cur_h = field_h(cur, field)
            label = f"{cur['label']}｜{qid}"
            ok_bases = {p["base_h"], n.get("wh")} - {None}
            if field != "human_verified" and cur_h not in ok_bases:
                # 主檔已經是這個內容（例如上次寫了但沒來得及回報）→ 直接記成已寫回
                try:
                    new_text, web = w.apply(subj, path, text, qid, field, p["value"])
                    same = new_text == text
                except Refuse:
                    same = False
                if not same:
                    upd = {"status": "conflict", "note": {"conflict": {"theirs": field_display(cur, field), "theirs_h": cur_h,
                                                                       "at": int(time.time() * 1000)},
                                                          "reason": "Mac 上的主檔在這次修訂之後也改過這一段"}}
                    conflicts.append((p, label, upd["note"]["reason"]))
                else:
                    upd = {"status": "pending", "note": {"written": "（主檔已是此內容）", "wh": cur_h, "wv": sha1(p["value"])}}
                    written.append((p, label, "-"))
            else:
                new_text, web = w.apply(subj, path, text, qid, field, p["value"])
                if new_text == text:
                    new = cur
                    sha = "（主檔已是此內容）"
                else:
                    new = w.verify(subj, path, text, new_text, qid, field, p["value"], web)
                    if dry_run:
                        print(f"── {label} {FIELD_NAME.get(field, field)}（{_short(p['id'])}）")
                        for ln in difflib.unified_diff(text.split("\n"), new_text.split("\n"), lineterm="", n=1):
                            print("   " + ln)
                        continue
                    path.write_bytes(new_text.encode("utf-8"))
                    sha = w.git.commit(path, f"修訂 {p['id']}：{label} {FIELD_NAME.get(field, field)}（{p['device']}）")
                upd = {"status": "pending", "note": {"written": sha, "wh": field_h(new, field), "wv": sha1(p["value"]),
                                                     "at": int(time.time() * 1000)}}
                written.append((p, label, sha))
                if subj == "BCH":
                    bch_ids.append(qid)
        except Refuse as e:
            upd = {"status": "conflict", "note": {"reason": str(e), "at": int(time.time() * 1000)}}
            conflicts.append((p, f"{qid}", str(e)))
        except Exception as e:  # noqa: BLE001 — 主檔壞掉、修訂內容格式不對等：這筆不動（狀態也不改），其他筆照常處理
            upd = None
            errors.append((p, qid, f"{type(e).__name__}: {e}"))
        if upd and not dry_run:
            res = remote._req("POST", "/api/admin/patches", {"updates": [dict(upd, id=p["id"], expect=p["updated_at"])]})["results"][0]
            if not res["ok"]:
                print(f"  ⚠ {_short(p['id'])} 在網站上剛又被改過，狀態沒有更新；下次 pull 會再處理。")

    for p, label, why in errors:
        print(f"⚠ {label} {FIELD_NAME.get(p['field'], p['field'])}（{_short(p['id'])}）處理時出錯，這筆沒有寫、狀態沒改：{why}")
    if dry_run:
        print("--dry-run：沒有寫入任何檔案。")
        return 1 if errors else 0
    for p, label, sha in written:
        print(f"✓ {label} {FIELD_NAME.get(p['field'], p['field'])}  commit {sha}")
    for p, label, why in conflicts:
        print(f"✗ {label} {FIELD_NAME.get(p['field'], p['field'])}：{why}（網站的修訂佇列頁可看兩個版本；bin/pmq patches resolve {_short(p['id'])} --mine｜--theirs）")
    print(f"寫回 {len(written)} 筆、衝突 {len(conflicts)} 筆。網站上要顯示新內容請接著 bin/pmq publish。")
    if bch_ids:
        print("這次改到的生化題（03_分章題庫/ 沒有動，要不要手動同步到分章檔由你決定）：")
        print("   " + "、".join(dict.fromkeys(bch_ids)))
    return 1 if conflicts or errors else 0


def resolve(cfg, url, pid, mine):
    remote = Remote(url)
    ps = remote._req("GET", "/api/admin/patches?status=all")["patches"]
    hit = [p for p in ps if p["id"] == pid or p["id"].endswith(pid)]
    if len(hit) != 1:
        print(f"找到 {len(hit)} 筆符合 {pid} 的修訂；請給更長的 ID。")
        return 1
    p = hit[0]
    n = _note(p)
    if mine:
        c = n.get("conflict")
        if p["status"] != "conflict" or not c:
            print("這筆不是「主檔也改過」的衝突，不能用 --mine（原因：" + str(n.get("reason") or p["status"]) + "）。")
            return 1
        upd = {"id": p["id"], "status": "pending", "base_h": c["theirs_h"], "note": {"resolved": "mine"}, "expect": p["updated_at"]}
        msg = "改成「用網站的版本蓋過主檔」；下次 pull 會寫回。"
    else:
        upd = {"id": p["id"], "status": "rejected", "note": {"resolved": "theirs"}, "expect": p["updated_at"]}
        msg = "已放棄這筆修訂，網站改回顯示主檔的內容。"
    res = remote._req("POST", "/api/admin/patches", {"updates": [upd]})["results"][0]
    print(msg if res["ok"] else "網站上剛又改過這筆，請再執行一次。")
    return 0 if res["ok"] else 1


def mark_merged(c, remote, subject=None):
    """pmq publish 換版後：已寫回且線上內容已是新版的修訂 → merged。"""
    ps = remote._req("GET", "/api/admin/patches?status=pending")["patches"]
    by_id = {q["id"]: q for q in c.questions}
    ups = []
    for p in ps:
        n = _note(p)
        qid = _qid(p)
        q = by_id.get(qid) if qid else None
        if not q or not n.get("written") or (subject and q["subject"] != subject):
            continue
        if p["field"] == "human_verified":
            ok = q["sol_meta"]["human_verified"]
        else:
            ok = field_h(q, p["field"]) == n.get("wh") and n.get("wv") == sha1(p["value"])
        if ok:
            ups.append({"id": p["id"], "status": "merged", "note": dict(n, merged=int(time.time() * 1000)), "expect": p["updated_at"]})
    if ups:
        res = remote._req("POST", "/api/admin/patches", {"updates": ups})["results"]
        print(f"修訂佇列：{sum(1 for r in res if r['ok'])} 筆改為已合併。")
    return len(ups)
