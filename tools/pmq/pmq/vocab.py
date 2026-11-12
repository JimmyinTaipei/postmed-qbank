"""英文單字索引（第 8B-2 階段，規格書 §9.11「8B（4）」）。

pmq publish 時對開了查單字的科目（pmq.toml [vocab] subjects，預設只有英文）的題目與文章做一次：
斷詞 → 還原成原形（lemminflect，離線、確定性）→ 去掉最常見的基本字 → 產出索引放進內容包。

索引的格式（內容包 vocab/<科目>）：
{
  "v": 1, "subject": "ENG",
  "papers": {sid: "中國 113"},                    # 考卷（只算考試，不含講義、教材）
  "lemmas": {原形: [考卷數, 題數, 當選項次數, 當答案次數, [出現位置…]]},
  "forms": {字形: [原形, 其他可能的原形…]},          # 只列字形 ≠ 原形的；網站查單字直接查這張表
}
出現位置是「題目 ID＋一個字母」：s＝題幹、o＝選項、a＝正確選項、g＝題組的文章（記在該組第一小題）。
同一題同一處只記一次；題數、考卷數不重複計算。

不需要 AI：題庫每增加一份考卷，發佈時索引就跟著更新。主檔唯讀。
"""
import re
from collections import defaultdict

TOKEN = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
TAG = re.compile(r"<[^>]+>")
MD_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
# 考試類的來源（規格書 §4.3 source_kinds 的 group）；講義、教材、自編不算「考卷」
EXAM_GROUPS = {"postmed", "exam"}
WHERE = {"stem": "s", "option": "o", "answer": "a", "passage": "g"}
POS_ORDER = ("VERB", "NOUN", "ADJ", "ADV", "AUX", "PRON", "ADP", "CCONJ", "SCONJ", "DET", "NUM", "PART", "INTJ", "PROPN")
INFLECTED = ("s", "ed", "ing", "er", "est", "ies", "ied")

# 「最常見的基本字」：功能字與高中以前一定會的字（原形、小寫）。這些字不進索引，也不出現在 /vocab。
BASIC = set("""
a an the and or but nor so yet for if then than that this these those there here where when while what which who whom whose why how
i me my mine myself you your yours yourself yourselves he him his himself she her hers herself it its itself we us our ours ourselves
they them their theirs themselves one ones someone something anyone anything everyone everything nobody nothing none no not yes
be am is are was were been being have has had having do does did done doing will would shall should can could may might must
to of in on at by with from up down out off over under into onto upon about above below across after against along among around
before behind beside besides between beyond during except inside near since through throughout till toward towards until within without
all any both each either neither every few many much more most less least some such own other another same several enough
also just only very too quite rather really still even ever never always often sometimes usually again already almost soon now today
not no yes well however therefore thus because although though unless whether also instead
get go come make take give put set let see look watch hear say tell talk speak ask answer know think feel want need like love
use find keep help try call leave live work play run walk move turn start stop begin end open close show bring buy pay sell send
write read learn study teach become seem happen mean show grow lose win hold stand sit sleep eat drink wear carry cut add
good bad big small large little long short high low new old young great right wrong different important possible able sure
early late easy hard hot cold full whole real true free clear certain best better worse worst next last first second third
man men woman women child children people person boy girl family friend mother father parent son daughter
time year day week month hour minute today night morning evening life world way thing place home house room school country city
water food money name word part number group kind lot point fact case problem question story book page line end side area
mr mrs ms dr ok oh
passage paragraph author choose accord according follow following statement blank underline underlined option correct
""".split())


def _plain(md):
    """Markdown／HTML → 純文字（克漏字空格、底線、連結文字保留）。"""
    t = MD_LINK.sub(r"\1", md or "")
    t = TAG.sub(" ", t)
    t = re.sub(r"\$[^$]*\$", " ", t)
    return t.replace("’", "'").replace("‘", "'")


class Lemmatizer:
    def __init__(self):
        from lemminflect import getAllLemmas   # tools/pmq/requirements.txt
        self._get = getAllLemmas
        self._memo = {}

    def lemmas(self, word):
        """小寫字形 → 原形清單（最可能的在前）。認不得的字回 [字形本身]。"""
        hit = self._memo.get(word)
        if hit is not None:
            return hit
        got = self._get(word) or {}
        votes = defaultdict(int)
        order = []
        for pos in sorted(got, key=lambda p: POS_ORDER.index(p) if p in POS_ORDER else 99):
            for lm in got[pos]:
                lm = lm.lower()
                votes[lm] += 1
                if lm not in order:
                    order.append(lm)
        if not order:
            out = [word]
        else:
            # 票數多的優先；同票時，有字尾變化的字（-s、-ed、-ing…）優先選「不是自己」的原形
            def key(lm):
                self_pen = 1 if (lm == word and word.endswith(INFLECTED)) else 0
                return (-votes[lm], self_pen, order.index(lm))
            out = sorted(order, key=key)
        self._memo[word] = out
        return out


def _tokens(text):
    for m in TOKEN.finditer(text):
        w = m.group(0)
        if w.endswith(("'s", "'S")):
            w = w[:-2]
        elif "'" in w:
            continue            # don't、I'm、we've 這類縮寫不收
        if len(w) < 3:
            continue
        yield w


def build_vocab_index(questions, subject, source_kinds):
    """questions：build.Contract 的題目（含 opt、group、source）。回傳索引（見檔頭）。"""
    lem = Lemmatizer()
    exam_kinds = {k["id"] for k in source_kinds if k.get("group") in EXAM_GROUPS}
    occ = defaultdict(set)                  # 原形 → {(qid, 位置)}
    papers_of = defaultdict(set)            # 原形 → {sid}
    qs_of = defaultdict(set)                # 原形 → {qid}
    lower_seen = set()                      # 以小寫出現過的原形
    forms = {}
    papers = {}
    hits = []                               # (字形, 原形候選, 大寫?, qid, 位置, sid)
    seen_groups = set()

    for q in questions:
        if q["subject"] != subject:
            continue
        sid = q["source"]["sid"]
        is_exam = q["source"]["kind"] in exam_kinds
        if is_exam and sid not in papers:
            s = q["source"]
            papers[sid] = " ".join(str(x) for x in (s.get("school"), s.get("year")) if x) or q["label"]
        ques = q["ques"] or ""
        opts = q.get("opt") or []
        keys = set((q.get("answer") or {}).get("keys") or [])
        parts = [("stem", ques[: opts[0][1]] if opts else ques)]
        for letter, a, b in opts:
            parts.append(("answer" if letter in keys else "option", ques[a:b]))
        g = q.get("group")
        if g and g.get("stem") and g["gid"] not in seen_groups:
            seen_groups.add(g["gid"])
            first = (g.get("members") or [q["id"]])[0]
            parts.append(("passage", g["stem"], first))
        for part in parts:
            where, text = part[0], part[1]
            qid = part[2] if len(part) > 2 else q["id"]
            for w in _tokens(_plain(text)):
                low = w.lower()
                cands = lem.lemmas(low)
                if w == low:
                    lower_seen.add(cands[0])
                hits.append((low, cands, w != low, qid, WHERE[where], sid if is_exam else None))

    for low, cands, cap, qid, code, sid in hits:
        lm = cands[0]
        # 只以大寫出現過的字（同一個原形從沒小寫出現過）當專有名詞，不收
        if cap and lm not in lower_seen:
            continue
        if lm in BASIC or low in BASIC or len(lm) < 3:
            continue
        if low != lm:
            forms[low] = cands
        occ[lm].add((qid, code))
        qs_of[lm].add(qid)
        if sid:
            papers_of[lm].add(sid)

    lemmas = {}
    for lm in sorted(occ):
        at = occ[lm]
        # 同一題同一個字：選項、答案各算一次
        o = sum(1 for _, c in at if c == "o")
        a = sum(1 for _, c in at if c == "a")
        # 同一題同一處只記一次；題幹與選項都出現時兩筆都留（位置不同）
        lemmas[lm] = [len(papers_of[lm]), len(qs_of[lm]), o + a, a, sorted(f"{qid}{c}" for qid, c in at)]
    # 字形表只留對得到索引裡原形的（被當成基本字刪掉的不用）
    forms = {f: c for f, c in sorted(forms.items()) if c[0] in lemmas}
    return {"v": 1, "subject": subject, "papers": dict(sorted(papers.items())), "lemmas": lemmas, "forms": forms}
