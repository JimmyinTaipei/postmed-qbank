"""交給 Antigravity 3.8 Flash 的英文單字批次工作（第 8B-3 階段，規格書 §9.11「8B（5）」）。

三種工作，每批一個資料夾，放在 90_工作暫存/英文單字/：

| 種類 | 資料夾 | pmq vocab todo 產生 | Flash 產生 | pmq vocab import |
|---|---|---|---|---|
| 單字欄位 | V001… | 輸入.json（字＋考古題原句）、任務單.md | 輸出.json（每字一筆，9 個欄位） | 建立新的單字卡 |
| 片語     | P001… | 輸入.json（一份考卷的題目文字）、任務單.md | 輸出.json（每題的片語） | 不建卡；用 `todo --phrases` 把沒有卡的片語排成單字欄位批次 |
| 義項     | S001… | 輸入.json（一字多義的字＋出現的句子）、任務單.md | 輸出.json（每個出現位置用第幾個字義） | 還沒有（網站還沒有顯示的地方）；只做檢查 |

防跑偏（使用者提醒 Flash 沒給限制常常跑偏）：任務單寫死輸入、輸出檔與格式；`pmq vocab check` 逐筆檢查，
沒過就把「檢查結果.md」整份貼回給 Flash 重做；`import` 前會再檢查一次。
主檔、Anki 檔都不碰：題目只讀（build.Contract），寫的只有 90_工作暫存/英文單字/ 與網站的 card／deck／srs_state。
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from collections import defaultdict
from pathlib import Path

from .vocab import BASIC, Lemmatizer, _plain

SUBJECT = "ENG"
WORK_DIR = "90_工作暫存/英文單字"
TEMPLATES = Path(__file__).resolve().parents[3] / "docs/外包任務單"
DECK_PATH = ["05_English", "考古題單字"]          # 規格書 §14-15；與網站 app/src/data/vocab.ts 的 VOCAB_DECK 相同
AI_TAG = "AI"
# Flash 要填的欄位（Image、Source 由 import 處理：Image 留空、Source 填所選例句的「來源｜ID」）
AI_FIELDS = ["Word", "Part of Speech", "Meaning and Definition", "Sentence", "Memo & Confusable", "Derivative",
             "Synonyms", "Antonyms", "Prefix & Roots"]
REQUIRED = {"Word", "Part of Speech", "Meaning and Definition"}
ALL_FIELDS = AI_FIELDS + ["Image", "Source"]
# 與網站 card-core.ts 的 VOCAB_BACK／VOCAB_LABEL 相同
VOCAB_BACK = ["Part of Speech", "Meaning and Definition", "Sentence", "Derivative", "Memo & Confusable", "Synonyms",
              "Antonyms", "Prefix & Roots", "Image", "Source"]
VOCAB_LABEL = {"Sentence": "例句", "Derivative": "衍生字", "Memo & Confusable": "辨析", "Synonyms": "同義字",
               "Antonyms": "反義字", "Prefix & Roots": "字根字首"}
# 詞性：使用者 Anki 單字卡實際用的寫法（13,877 張統計）；多個詞性用全形分號「；」接起來
POS = ["n.", "v.", "adj.", "adv.", "phr.", "prep.", "pron.", "conj.", "aux.", "det.", "interj."]
BLANK = re.compile(r"_{3,}|＿{2,}")
SENT_SPLIT = re.compile(r"(?<=[.!?])[\"”’)]?\s+(?=[\"“(]?[A-Z0-9])|\n\s*\n")
COMMON_FILE = Path(__file__).resolve().parent / "data/common_en.txt"
CJK = re.compile(r"[㐀-鿿]")
LATIN_WORD = re.compile(r"[A-Za-z]")
HTML = re.compile(r"<[A-Za-z/!][^>]*>")
PHRASE_OK = re.compile(r"^[A-Za-z][A-Za-z'’\-]*(?: [A-Za-z][A-Za-z'’\-/]*)+$")
DAY_MS = 86400000


# ---------------------------------------------------------------- 共用

def is_simplified(ch: str) -> bool:
    """簡體字：繁體的 Big5（cp950）編不出來、但簡體的 GB2312 編得出來。不用額外套件。"""
    if not CJK.match(ch):
        return False
    try:
        ch.encode("cp950")
        return False
    except UnicodeEncodeError:
        pass
    try:
        ch.encode("gb2312")
        return True
    except UnicodeEncodeError:
        return False


def simplified_in(text: str) -> str:
    return "".join(dict.fromkeys(c for c in text if is_simplified(c)))


def word_key(md: str) -> str:
    """與網站 vocab-core.ts 的 wordKey 相同：去掉聲音、標籤、Markdown 記號，小寫。"""
    t = re.sub(r"\[sound:[^\]]*\]", "", md or "")
    t = re.sub(r"<[^>]+>", " ", t).replace("&nbsp;", " ")
    t = re.sub(r"[*_`#]", "", t)
    return re.sub(r"\s+", " ", t).strip().lower()


def norm_sentence(s: str) -> str:
    """比對原句用：引號、空白統一，去掉粗體記號。"""
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("**", "")
    return re.sub(r"\s+", " ", s).strip()


def work_root(cfg) -> Path:
    return cfg.root / WORK_DIR


def next_batch(root: Path, prefix: str) -> Path:
    n = 1
    for p in root.glob(prefix + "[0-9][0-9][0-9]"):
        n = max(n, int(p.name[1:]) + 1)
    return root / f"{prefix}{n:03d}"


def load_questions(cfg):
    from .build import Contract
    c = Contract(cfg, only=SUBJECT).run()
    return [q for q in c.questions if q["subject"] == SUBJECT], c


def question_parts(q):
    """一題的文字分段：(位置, 文字)。正確選項代進空格，成為完整的例句。"""
    ques = q["ques"] or ""
    opts = q.get("opt") or []
    keys = set((q.get("answer") or {}).get("keys") or [])
    stem = ques[: opts[0][1]] if opts else ques
    # 選項文字去掉「(A) 」
    clean = lambda t: re.sub(r"^\s*\(?[A-Z]\)?[.\s]\s*", "", t).strip()
    out = [("s", stem)]
    for letter, a, b in opts:
        text = clean(ques[a:b])
        if letter in keys:
            out.append(("a", text))
            if len(BLANK.findall(stem)) == 1:
                out.append(("f", BLANK.sub(text, stem, count=1)))
        else:
            out.append(("o", text))
    return out


CLOZE = re.compile(r'<span class="cloze-blank">\s*(\d+)\s*</span>')


def passage_filled(q) -> str | None:
    """克漏字：這一小題的空格代入正確選項（其他空格維持空格），成為完整的例句。"""
    g = q.get("group") or {}
    no = str(int(q["source"].get("qno") or 0)) if str(q["source"].get("qno") or "").isdigit() else None
    ans = next((t for w, t in question_parts(q) if w == "a"), None)
    if not g.get("stem") or not no or not ans:
        return None
    return CLOZE.sub(lambda m: ans if m.group(1) == no else "_____", g["stem"])


def sentences_of(text: str) -> list[str]:
    plain = _plain(CLOZE.sub("_____", text))
    plain = re.sub(r"^\s*\d+\.\s*", "", plain)
    plain = re.sub(r"(?<!\n)\n(?!\n)", " ", plain)       # 主檔裡文章的硬換行：接回同一句
    out = []
    for s in SENT_SPLIT.split(plain):
        s = re.sub(r"\s+", " ", s).strip()
        s = re.sub(r"^\(?\d+\)?[.)]\s+", "", s)          # 開頭的題號
        if re.search(r"\([A-E]\)", s):
            continue                                    # 挑錯題的句子本身有錯，不當例句
        if len(s.split()) >= 4 and not BLANK.search(s):
            out.append(s)
    return out


PROMPT = re.compile(r"^(Which|What|According to|The (word|phrase|underlined)|Choose|In paragraph|It can be inferred)\b|\b(paragraph|passage|the author|TRUE|NOT TRUE|EXCEPT)\b")


def rank_sentences(sents: list[dict]) -> list[dict]:
    """文章、題幹裡的句子優先；作答說明（Which of the following…、in paragraph 2…）排後面。"""
    return sorted(sents, key=lambda x: bool(PROMPT.search(x["text"])))


def fetch_cards(url):
    from .remote import Remote
    remote = Remote(url)
    return remote, remote.get_cards()


def vocab_cards(dump) -> dict[str, list[dict]]:
    """Word（小寫）→ 單字卡。"""
    out = defaultdict(list)
    for c in dump.get("cards", []):
        if c.get("deleted") or c.get("kind") != "vocab":
            continue
        f = c.get("fields") or {}
        if isinstance(f, str):
            f = json.loads(f or "{}")
        k = word_key(f.get("Word") or c.get("front_md") or "")
        if k:
            out[k].append(c)
    return out


def covered_lemmas(cards: dict, forms: dict) -> set[str]:
    """有卡的原形：Word 本身，以及 Word 是變化形（例如 mitigated）時它的原形。"""
    return set(cards) | {forms[k][0] for k in cards if k in forms}


def pending_words(root: Path) -> set[str]:
    """已經排進任何單字欄位批次的字（不論匯入了沒），todo 不會再排一次。要重排就刪掉那個批次資料夾。"""
    out = set()
    for f in root.glob("V[0-9][0-9][0-9]/輸入.json"):
        try:
            out |= {w["word"] for w in json.loads(f.read_text("utf-8"))["words"]}
        except (ValueError, KeyError):
            pass
    return out


def fill_template(name: str, values: dict) -> str:
    t = (TEMPLATES / name).read_text("utf-8")
    for k, v in values.items():
        t = t.replace("{{" + k + "}}", str(v))
    left = re.findall(r"\{\{[^}]+\}\}", t)
    if left:
        raise SystemExit(f"任務單範本 {name} 有沒填到的欄位：{left}")
    return t


def write_batch(folder: Path, inp: dict, template: str, values: dict, log=print):
    folder.mkdir(parents=True, exist_ok=False)
    (folder / "輸入.json").write_text(json.dumps(inp, ensure_ascii=False, indent=1), "utf-8")
    (folder / "任務單.md").write_text(fill_template(template, {"batch": folder.name, "dir": str(folder), **values}), "utf-8")
    log(f"批次 {folder.name}：{folder}")
    log(f"  把「任務單.md」整份貼給 Flash（或叫它讀這個檔），做完後：bin/pmq vocab check \"{folder / '輸出.json'}\"")


# ---------------------------------------------------------------- todo

def common_words() -> set[str]:
    return {x.strip() for x in COMMON_FILE.read_text("utf-8").splitlines() if x.strip() and not x.startswith("#")}


def todo_fields(cfg, url, limit=100, min_papers=2, phrases=None, include_common=False, cards_dump=None, log=print) -> Path | None:
    """常考但沒有卡片的字 → 單字欄位批次。phrases＝片語批次的輸出.json：改排那些片語。
    常見字（data/common_en.txt）預設不排：使用者的牌組沒有 effect、argue 這種字，但他都會。"""
    from .build import SOURCE_KINDS
    from .vocab import build_vocab_index
    qs, _ = load_questions(cfg)
    ix = build_vocab_index(qs, SUBJECT, SOURCE_KINDS)
    if cards_dump is None:
        _, cards_dump = fetch_cards(url)
    cards = vocab_cards(cards_dump)
    root = work_root(cfg)
    root.mkdir(parents=True, exist_ok=True)
    pending = pending_words(root)
    byid = {q["id"]: q for q in qs}
    label = {q["id"]: f"{q['label']}｜{q['id']}" for q in qs}

    if phrases:
        out = json.loads(Path(phrases).read_text("utf-8"))
        errs = check_phrases_file(Path(phrases))
        if errs:
            raise SystemExit(f"{phrases} 沒通過檢查（{len(errs)} 個問題），先 pmq vocab check 它")
        want = {}
        for item in out:
            for ph in item["phrases"]:
                w = ph["phrase"].strip().lower()
                if w in cards or w in pending:
                    continue
                want.setdefault(w, []).append((item["id"], ph["text"]))
        words = []
        for w, places in want.items():
            sents = []
            for qid, text in places:
                q = byid.get(qid.removeprefix("g:"))
                if not q:
                    continue
                for _, part in question_parts(q) + ([("g", q["group"]["stem"])] if q.get("group") else []):
                    for s in sentences_of(part):
                        if text in s and s not in [x["text"] for x in sents]:
                            sents.append({"text": s, "source": label[q["id"]]})
            words.append({"word": w, "forms": [], "papers": 1, "questions": len(places), "sentences": rank_sentences(sents)[:3]})
        words = words[:limit]
    else:
        forms_of = defaultdict(set)
        for f, c in ix["forms"].items():
            forms_of[c[0]].add(f)
        rows = []
        covered = covered_lemmas(cards, ix["forms"])
        if not include_common:
            covered |= common_words()
        for lm, (p, nq, o, a, at) in ix["lemmas"].items():
            if p < min_papers or lm in pending or lm in covered:
                continue
            rows.append((p * 3 + a * 4 + o * 2 + nq, lm, p, nq, at))
        rows.sort(key=lambda r: (-r[0], r[1]))
        words = []
        for score, lm, p, nq, at in rows[:limit]:
            look = {lm} | forms_of[lm]
            sents = []
            for code in at:
                qid, where = code[:-1], code[-1]
                q = byid.get(qid)
                if not q:
                    continue
                parts = [("g", q["group"]["stem"])] if where == "g" and q.get("group") else [x for x in question_parts(q) if x[0] in ("s", "f")]
                if where == "a" and passage_filled(q):
                    parts.append(("g", passage_filled(q)))
                for _, text in parts:
                    for s in sentences_of(text):
                        toks = {t.lower() for t in re.findall(r"[A-Za-z]+", s)}
                        if toks & look and s not in [x["text"] for x in sents]:
                            sents.append({"text": s, "source": label[qid]})
                if sum(1 for x in sents if not PROMPT.search(x["text"])) >= 3:
                    break
            words.append({"word": lm, "forms": sorted(forms_of[lm]), "papers": p, "questions": nq, "sentences": rank_sentences(sents)[:3]})
    if not words:
        log("沒有要排的字（常考的字都有卡片了，或都已經排進之前的批次）。")
        return None
    folder = next_batch(root, "V")
    inp = {"kind": "fields", "batch": folder.name, "created": time.strftime("%Y-%m-%d %H:%M"), "words": words}
    write_batch(folder, inp, "單字欄位.md", {"n": len(words), "pos": "、".join(POS)}, log)
    no_sent = sum(1 for w in words if not w["sentences"])
    log(f"  {len(words)} 個字（{no_sent} 個沒有可用的原句，只當過錯誤選項；這些字的 Sentence 要留空）")
    return folder


def todo_phrases(cfg, paper: str, log=print) -> Path:
    qs, _ = load_questions(cfg)
    mine = [q for q in qs if q["source"]["sid"] == paper]
    if not mine:
        papers = sorted({q["source"]["sid"] for q in qs})
        raise SystemExit(f"找不到考卷 {paper}。可用的：{' '.join(papers)}")
    items, seen = [], set()
    for q in mine:
        g = q.get("group")
        if g and g.get("stem") and g["gid"] not in seen:
            seen.add(g["gid"])
            items.append({"id": "g:" + q["id"], "text": re.sub(r"[ \t]+", " ", _plain(g["stem"])).strip()})
        items.append({"id": q["id"], "text": re.sub(r"[ \t]+", " ", _plain(q["ques"] or "")).strip()})
    root = work_root(cfg)
    root.mkdir(parents=True, exist_ok=True)
    folder = next_batch(root, "P")
    label = mine[0]["label"].rsplit(" ", 1)[0]
    inp = {"kind": "phrases", "batch": folder.name, "paper": paper, "label": label, "items": items}
    write_batch(folder, inp, "片語.md", {"n": len(items), "paper": f"{label}（{paper}）"}, log)
    return folder


def split_senses(meaning: str) -> list[str]:
    return [s.strip() for s in re.split(r"[；;\n]", meaning or "") if s.strip()]


def todo_senses(cfg, url, limit=50, cards_dump=None, log=print) -> Path | None:
    from .build import SOURCE_KINDS
    from .vocab import build_vocab_index
    qs, _ = load_questions(cfg)
    ix = build_vocab_index(qs, SUBJECT, SOURCE_KINDS)
    if cards_dump is None:
        _, cards_dump = fetch_cards(url)
    cards = vocab_cards(cards_dump)
    byid = {q["id"]: q for q in qs}
    forms_of = defaultdict(set)
    for f, c in ix["forms"].items():
        forms_of[c[0]].add(f)
    rows = []
    common = common_words()
    for lm, (p, nq, o, a, at) in ix["lemmas"].items():
        if p < 2 or lm not in cards or lm in common:
            continue
        f = cards[lm][0].get("fields") or {}
        if isinstance(f, str):
            f = json.loads(f)
        senses = split_senses(f.get("Meaning and Definition", ""))
        if len(senses) < 2:
            continue
        look = {lm} | forms_of[lm]
        places = []
        for code in at:
            qid, where = code[:-1], code[-1]
            q = byid.get(qid)
            if not q or where not in ("s", "g", "a"):
                continue
            text = q["group"]["stem"] if where == "g" else dict(question_parts(q)).get("f" if where == "a" else "s", "")
            for s in sentences_of(text or ""):
                if PROMPT.search(s) or any(x["sentence"] == s for x in places):
                    continue
                if {t.lower() for t in re.findall(r"[A-Za-z]+", s)} & look:
                    places.append({"at": code, "sentence": s})
                    break
            if len(places) >= 5:
                break
        if places:
            rows.append((p * 3 + nq, lm, senses, places))
    rows.sort(key=lambda r: (-r[0], r[1]))
    words = [{"word": lm, "senses": [f"{i}. {s}" for i, s in enumerate(senses, 1)], "places": places}
             for _, lm, senses, places in rows[:limit]]
    if not words:
        log("沒有一字多義而且出現在考古題的單字卡。")
        return None
    root = work_root(cfg)
    root.mkdir(parents=True, exist_ok=True)
    folder = next_batch(root, "S")
    inp = {"kind": "senses", "batch": folder.name, "words": words}
    write_batch(folder, inp, "義項.md", {"n": len(words), "places": sum(len(w["places"]) for w in words)}, log)
    return folder


# ---------------------------------------------------------------- check

class Problems:
    def __init__(self):
        self.items: list[str] = []

    def add(self, where: str, msg: str):
        self.items.append(f"{where}：{msg}")

    def __bool__(self):
        return bool(self.items)


def _load_output(path: Path, p: Problems):
    try:
        raw = path.read_text("utf-8")
    except FileNotFoundError:
        p.add("檔案", f"找不到 {path}")
        return None
    raw = raw.strip()
    if raw.startswith("```"):
        p.add("檔案", "整個檔案要是 JSON 本身，不能用 ``` 包起來")
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        p.add("檔案", f"不是合法的 JSON（第 {e.lineno} 行第 {e.colno} 欄：{e.msg}）")
        return None


def check_fields(out, inp, p: Problems):
    words = inp["words"]
    want = [w["word"] for w in words]
    sents = {w["word"]: {norm_sentence(s["text"]): s for s in w["sentences"]} for w in words}
    if not isinstance(out, list):
        p.add("檔案", "最外層要是一個陣列 [ … ]，每個字一筆")
        return
    got = []
    for i, rec in enumerate(out, 1):
        where = f"第 {i} 筆"
        if not isinstance(rec, dict):
            p.add(where, "不是 { … } 物件")
            continue
        word = rec.get("Word")
        where = f"第 {i} 筆（{word}）" if isinstance(word, str) else where
        keys = set(rec)
        extra = keys - set(AI_FIELDS)
        missing = set(AI_FIELDS) - keys
        if extra:
            p.add(where, f"多了不該有的欄位 {sorted(extra)}（Image、Source 也不要填）")
        if missing:
            p.add(where, f"少了欄位 {sorted(missing)}（沒有內容也要寫成 \"\"）")
        for k in AI_FIELDS:
            v = rec.get(k)
            if k in keys and not isinstance(v, str):
                p.add(where, f"{k} 要是字串")
        if not isinstance(word, str):
            continue
        got.append(word)
        if word not in want:
            p.add(where, f"「{word}」不在這一批的清單上（不能自己加字、不能改拼法或大小寫）")
        for k in REQUIRED:
            if isinstance(rec.get(k), str) and not rec[k].strip():
                p.add(where, f"{k} 不能空白")
        ps = rec.get("Part of Speech")
        if isinstance(ps, str) and ps.strip():
            parts = ps.split("；")
            bad = [x for x in parts if x not in POS]
            if bad or len(set(parts)) != len(parts):
                p.add(where, f"詞性「{ps}」不對：只能用 {' '.join(POS)}，兩個以上用全形分號「；」接，不加空白")
        mean = rec.get("Meaning and Definition")
        if isinstance(mean, str) and mean.strip() and not CJK.search(mean):
            p.add(where, "字義要用繁體中文寫")
        for k in AI_FIELDS:
            v = rec.get(k)
            if not isinstance(v, str):
                continue
            s = simplified_in(v)
            if s:
                p.add(where, f"{k} 有簡體字「{s}」")
            if HTML.search(v):
                p.add(where, f"{k} 有 HTML 標籤（只能用純文字，換行用 \\n）")
            if k != "Word" and "**" in v:
                p.add(where, f"{k} 不要加 ** 粗體")
        sent = rec.get("Sentence")
        if isinstance(sent, str) and sent.strip() and word in sents:
            given = sents[word]
            if not given:
                p.add(where, "這個字沒有提供原句，Sentence 要留空 \"\"（不能自己造句或找別的例句）")
            else:
                for line in [x for x in sent.split("\n") if x.strip()]:
                    if CJK.search(line):
                        if len(re.findall(r"[A-Za-z]{2,}", line)) > 3:
                            p.add(where, f"「{line[:60]}」英文例句與中文翻譯要分成兩行（例句一行、翻譯下一行）")
                        continue            # 中文翻譯那一行
                    if norm_sentence(line) not in given:
                        p.add(where, f"例句「{line[:60]}」不是輸入裡給的原句（要一字不差地複製，不能改寫、刪減或自己造句）")
    for w, n in ((w, got.count(w)) for w in dict.fromkeys(got)):
        if n > 1:
            p.add(f"「{w}」", f"出現 {n} 次，每個字只能一筆")
    lost = [w for w in want if w not in got]
    if lost:
        p.add("清單", f"少了 {len(lost)} 個字：{'、'.join(lost[:20])}{'…' if len(lost) > 20 else ''}")


def check_phrases(out, inp, p: Problems):
    items = {it["id"]: it["text"] for it in inp["items"]}
    if not isinstance(out, list):
        p.add("檔案", "最外層要是一個陣列 [ … ]，每題一筆")
        return
    got = []
    for i, rec in enumerate(out, 1):
        where = f"第 {i} 筆"
        if not isinstance(rec, dict) or set(rec) != {"id", "phrases"}:
            p.add(where, "每筆只能有 id 與 phrases 兩個欄位")
            continue
        qid = rec["id"]
        where = f"第 {i} 筆（{qid}）"
        got.append(qid)
        if qid not in items:
            p.add(where, "這個 id 不在輸入裡（不能自己編 id）")
            continue
        if not isinstance(rec["phrases"], list):
            p.add(where, "phrases 要是陣列（沒有片語就寫 []）")
            continue
        seen = set()
        for j, ph in enumerate(rec["phrases"], 1):
            w2 = f"{where} 第 {j} 個片語"
            if not isinstance(ph, dict) or set(ph) != {"phrase", "text"} or not all(isinstance(ph[k], str) for k in ph):
                p.add(w2, "要寫成 {\"phrase\": \"原形\", \"text\": \"題目裡的原文\"}")
                continue
            phrase, text = ph["phrase"].strip(), ph["text"]
            if not PHRASE_OK.match(phrase) or not 2 <= len(phrase.split()) <= 6:
                p.add(w2, f"「{phrase}」不是 2–6 個英文字的片語")
            if CJK.search(phrase) or CJK.search(text):
                p.add(w2, "片語與原文都只能是英文")
            if text not in items[qid]:
                p.add(w2, f"text「{text}」在題目裡找不到（要一字不差地從題目複製，含大小寫與時態）")
            if phrase.lower() in seen:
                p.add(w2, f"「{phrase}」重複")
            seen.add(phrase.lower())
    for qid in dict.fromkeys(got):
        if got.count(qid) > 1:
            p.add(qid, f"出現 {got.count(qid)} 次，每題只能一筆")
    lost = [q for q in items if q not in got]
    if lost:
        p.add("清單", f"少了 {len(lost)} 題（沒有片語的題目也要寫，phrases 寫 []）：{'、'.join(lost[:20])}")


def check_senses(out, inp, p: Problems):
    want = {(w["word"], pl["at"]): len(w["senses"]) for w in inp["words"] for pl in w["places"]}
    if not isinstance(out, list):
        p.add("檔案", "最外層要是一個陣列 [ … ]，每個出現位置一筆")
        return
    got = []
    for i, rec in enumerate(out, 1):
        where = f"第 {i} 筆"
        if not isinstance(rec, dict) or set(rec) != {"word", "at", "sense"}:
            p.add(where, "每筆只能有 word、at、sense 三個欄位")
            continue
        key = (rec["word"], rec["at"])
        where = f"第 {i} 筆（{rec['word']} {rec['at']}）"
        got.append(key)
        if key not in want:
            p.add(where, "這個字與位置的組合不在輸入裡")
            continue
        if not isinstance(rec["sense"], int) or isinstance(rec["sense"], bool) or not 1 <= rec["sense"] <= want[key]:
            p.add(where, f"sense 要是 1 到 {want[key]} 的整數（字義清單的編號）")
    for k in dict.fromkeys(got):
        if got.count(k) > 1:
            p.add(f"{k[0]} {k[1]}", "重複")
    lost = [k for k in want if k not in got]
    if lost:
        p.add("清單", f"少了 {len(lost)} 個位置：{'、'.join(f'{w} {a}' for w, a in lost[:20])}")


def check_file(path: Path) -> tuple[dict | None, list | None, Problems]:
    """回傳 (輸入, 輸出, 問題)。輸入.json 要和輸出檔在同一個批次資料夾。"""
    path = Path(path).expanduser()
    p = Problems()
    inp_path = path.parent / "輸入.json"
    if not inp_path.exists():
        p.add("檔案", f"同一個資料夾裡找不到 輸入.json（輸出檔要放在批次資料夾 {path.parent.name} 裡）")
        return None, None, p
    inp = json.loads(inp_path.read_text("utf-8"))
    if path.name != "輸出.json":
        p.add("檔案", f"檔名要是「輸出.json」，不是「{path.name}」")
    extra = sorted(x.name for x in path.parent.iterdir() if x.name not in {"輸入.json", "任務單.md", "輸出.json", "檢查結果.md", "匯入紀錄.json"} and not x.name.startswith("."))
    if extra:
        p.add("資料夾", f"批次資料夾裡多了任務單沒要求的檔：{'、'.join(extra)}（請刪掉；Flash 只能建立 輸出.json）")
    out = _load_output(path, p)
    if out is not None:
        {"fields": check_fields, "phrases": check_phrases, "senses": check_senses}[inp["kind"]](out, inp, p)
    return inp, out, p


def check_phrases_file(path: Path) -> list[str]:
    return check_file(path)[2].items


def run_check(path, log=print) -> int:
    path = Path(path).expanduser()
    inp, out, p = check_file(path)
    report = path.parent / "檢查結果.md"
    if p:
        L = [f"# {path.parent.name} 檢查沒過（{len(p.items)} 個問題）", "",
             "請照下面的清單修正「輸出.json」，**整個檔重新輸出**；其他規定照任務單，不要動清單以外的東西。", ""]
        L += [f"- {x}" for x in p.items]
        report.write_text("\n".join(L) + "\n", "utf-8")
        log(f"✗ 沒過：{len(p.items)} 個問題")
        for x in p.items[:30]:
            log(f"  - {x}")
        if len(p.items) > 30:
            log(f"  …其餘 {len(p.items) - 30} 個見檔案")
        log(f"整份錯誤清單：{report}（貼回給 Flash 重做）")
        return 1
    report.write_text(f"# {path.parent.name} 檢查通過\n\n{time.strftime('%Y-%m-%d %H:%M')}，{len(out)} 筆。\n", "utf-8")
    n = len(out)
    nxt = {"fields": f"bin/pmq vocab import \"{path}\"",
           "phrases": f"bin/pmq vocab todo --phrases \"{path}\"（把還沒有卡的片語排成單字欄位批次）",
           "senses": "（義項的結果網站還沒有顯示的地方，先保留檔案）"}[inp["kind"]]
    log(f"✓ 通過：{n} 筆。下一步：{nxt}")
    return 0


# ---------------------------------------------------------------- import

def bold_word(sentence_line: str, look: set[str]) -> str:
    """例句裡第一個對得到的字形加粗（和網站「新增單字卡」一樣）。"""
    for lk in sorted(look, key=len, reverse=True):
        m = re.search(r"(?<![A-Za-z])" + re.escape(lk) + r"(?![A-Za-z])", sentence_line, re.I)
        if m:
            return sentence_line[: m.start()] + "**" + m.group(0) + "**" + sentence_line[m.end():]
    return sentence_line


def vocab_md(f: dict) -> tuple[str, str]:
    parts = []
    for k in VOCAB_BACK:
        md = (f.get(k) or "").strip()
        if not md:
            continue
        label = VOCAB_LABEL.get(k, "") if parts else ""
        parts.append((f'<div class="card-label">{label}</div>\n\n' if label else "") + md)
    return (f.get("Word") or "").strip(), "\n\n".join(parts)


def card_id(word: str) -> str:
    return "ai-" + hashlib.sha1(f"{SUBJECT}:{word}".encode()).hexdigest()[:16]


def build_rows(inp, out, dump, forms_of=None, t0=None):
    """回傳 (deck 列, card 列, srs 列, 略過的字)。"""
    from .anki_import import deck_id
    t0 = t0 or int(time.time() * 1000)
    decks = [d for d in dump.get("decks", []) if not d.get("deleted")]
    deck_rows, parent = [], None
    for i, name in enumerate(DECK_PATH):
        hit = next((d for d in decks if d.get("parent") == parent and d.get("name") == name), None)
        if hit:
            parent = hit["id"]
            continue
        did = deck_id("::".join(DECK_PATH[: i + 1]))
        deck_rows.append({"id": did, "name": name, "subject": SUBJECT if i == 0 else None, "parent": parent, "updated_at": t0, "deleted": 0})
        parent = did
    cards = vocab_cards(dump)
    srcs = {w["word"]: w for w in inp["words"]}
    card_rows, srs_rows, skipped = [], [], []
    for i, rec in enumerate(out):
        word = rec["Word"]
        if word in cards:
            skipped.append(word)
            continue
        w = srcs[word]
        f = {k: rec[k].strip() for k in AI_FIELDS if rec[k].strip()}
        sent = f.get("Sentence")
        source = ""
        if sent:
            given = {norm_sentence(s["text"]): s for s in w["sentences"]}
            lines = []
            for line in sent.split("\n"):
                hit = given.get(norm_sentence(line))
                if hit:
                    source = source or hit["source"]
                    lines.append(bold_word(hit["text"], {word, *w.get("forms", [])}))
                else:
                    lines.append(line)
            f["Sentence"] = "\n".join(lines)
        elif w["sentences"]:
            source = w["sentences"][0]["source"]
        if source:
            f["Source"] = source
        front, back = vocab_md(f)
        cid = card_id(word)
        ai = [k for k in AI_FIELDS if k != "Word" and f.get(k)]
        card_rows.append({"id": cid, "deck_id": parent, "kind": "vocab", "front_md": front, "back_md": back,
                          "fields": f, "tags": [AI_TAG], "updated_at": t0, "deleted": 0,
                          "origin": {"from": "ai", "batch": inp["batch"], "ai": ai}})
        srs_rows.append({"item": f"card:{cid}", "due": t0, "stability": None, "difficulty": None, "reps": 0, "lapses": 0,
                         "state": 0, "last_review": None, "suspended": 0, "updated_at": t0 + i})
    return deck_rows, card_rows, srs_rows, skipped


def run_import(path, url, dry_run=False, log=print) -> int:
    path = Path(path).expanduser()
    inp, out, p = check_file(path)
    if p:
        log("檢查沒過，不匯入：")
        for x in p.items[:20]:
            log(f"  - {x}")
        return 1
    if inp["kind"] != "fields":
        log("只有單字欄位（V 開頭）的批次可以匯入。片語批次請用 pmq vocab todo --phrases；義項還沒有匯入的地方。")
        return 1
    remote, dump = fetch_cards(url)
    deck_rows, card_rows, srs_rows, skipped = build_rows(inp, out, dump)
    from .anki_import import push_rows
    log(f"{inp['batch']}：新卡 {len(card_rows)} 張" + (f"；已經有卡、略過 {len(skipped)} 個：{'、'.join(skipped[:10])}" if skipped else ""))
    if dry_run:
        for c in card_rows[:3]:
            log(json.dumps(c["fields"], ensure_ascii=False, indent=1))
        return 0
    if deck_rows:
        push_rows(remote, "deck", deck_rows, "insert", log)
    push_rows(remote, "card", card_rows, "insert", log)
    push_rows(remote, "srs_state", srs_rows, "insert", log)
    rec = {"imported": time.strftime("%Y-%m-%d %H:%M"), "cards": [c["id"] for c in card_rows], "skipped": skipped}
    (path.parent / "匯入紀錄.json").write_text(json.dumps(rec, ensure_ascii=False, indent=1), "utf-8")
    log("完成。卡片在「05_English › 考古題單字」，標籤 AI；裝置下次同步就會拿到。")
    return 0
