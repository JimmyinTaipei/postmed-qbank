"""pmq anki export：把網站的牌組連同進度匯出成 Anki 可以匯入的 .apkg（規格書 §9.5）。

- 封裝用 Anki 的舊格式（collection.anki2，schema 11；Anki 2.1 以後都能匯入，匯入時勾「包含排程」）。
- 筆記類型三種：後醫網站・問答（正面、背面）、後醫網站・正反（兩張卡）、後醫網站・克漏字（內文、補充）。
  單字卡（kind = "vocab"，第 8B-1 階段）還原成使用者原本的「0_後醫單字基本型」：同一個筆記類型 ID、11 個欄位、
  原本的樣板與 CSS（anki_models/vocab/，2026-11-12 從使用者的 05_English.apkg 取出）。
- 牌組：網站上的牌組階層照搬（名稱用 :: 連起來）。
- 進度：srs_state → cards（到期日、間隔、複習次數、忘記次數、暫停）；FSRS 的穩定度與難度寫進 cards.data。
  review_log → revlog。
- guid：每則筆記由網站上的筆記鍵算出固定的 guid，同一份匯出匯入兩次不會重複。
- 以牌組為單位搬家（§14-3）：Anki 裡如果還有搬來前的舊牌，先刪掉再匯入，或當成一副新牌。
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import sqlite3
import tempfile
import time
import zipfile
from html import escape
from pathlib import Path

from .textutil import math_ranges

SCHEMA = """
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null,
  dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null,
  tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null,
  usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null,
  reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null,
  data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null,
  lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
"""

DAY = 86400
CSS = ".card { font-family: -apple-system, 'PingFang TC', sans-serif; font-size: 20px; text-align: left; color: black; background: white; }\n.card-label { margin-top: 1em; font-size: 13px; font-weight: 600; color: #777; }\n.cloze { font-weight: bold; color: #2f6fde; }"

_GUID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~"


def guid_for(key: str) -> str:
    n = int(hashlib.sha1(("pmq:" + key).encode()).hexdigest()[:16], 16)
    s = ""
    while n:
        n, r = divmod(n, len(_GUID_CHARS))
        s += _GUID_CHARS[r]
    return s or "a"


def md_to_html(md: str) -> str:
    """網站 Markdown → Anki 欄位 HTML：粗斜體、換行、列點、公式改回 \\( \\)、圖與聲音改成 Anki 的檔名。"""
    def inline(t: str) -> str:
        t = escape(t, quote=False)
        t = re.sub(r"&lt;(/?(?:u|sub|sup|s|span|div|b|i|br|table|tr|td|th|mark)\b.*?)&gt;", lambda m: "<" + m.group(1).replace("&quot;", '"') + ">", t)
        t = re.sub(r"!\[[^\]]*\]\(m/([0-9a-f]{64}\.[a-z0-9]+)\)", r'<img src="\1">', t)
        t = re.sub(r"\[sound:m/([0-9a-f]{64}\.[a-z0-9]+)\]", r"[sound:\1]", t)
        t = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", t)
        t = re.sub(r"(^|[^*\\])\*([^*\n]+)\*", r"\1<i>\2</i>", t)
        t = re.sub(r"==([^=\n]+)==", r"<mark>\1</mark>", t)
        t = re.sub(r"\\([*_`$#>\\])", r"\1", t)
        t = re.sub(r"(?m)^(\s*)[-*] ", lambda m: "&nbsp;" * (2 * len(m.group(1))) + "• ", t)
        t = t.replace("\n", "<br>")
        return re.sub(r'(?:<br>)*(<div class="card-label">.*?</div>)(?:<br>)*', r"\1", t)

    out, last = "", 0
    for a, b, display in math_ranges(md):
        out += inline(md[last:a])
        tex = md[a + 2:b - 2] if display else md[a + 1:b - 1]
        tex = escape(tex, quote=False)
        out += f"\\[{tex}\\]" if display else f"\\({tex}\\)"
        last = b
    return out + inline(md[last:])


_VOCAB_DIR = Path(__file__).with_name("anki_models") / "vocab"


def vocab_model() -> dict:
    """使用者的「0_後醫單字基本型」：{id, name, template, fields, front, back, css}。"""
    m = json.loads((_VOCAB_DIR / "model.json").read_text("utf-8"))
    m["front"] = (_VOCAB_DIR / "front.html").read_text("utf-8")
    m["back"] = (_VOCAB_DIR / "back.html").read_text("utf-8")
    m["css"] = (_VOCAB_DIR / "style.css").read_text("utf-8")
    return m


def _strip(html: str) -> str:
    return re.sub(r"<[^>]+>", "", html).strip()


def _model(mid: int, name: str, fields: list[str], tmpls: list[tuple[str, str, str]], cloze: bool, now: int, css: str | None = None) -> dict:
    return {
        "id": mid, "name": name, "type": 1 if cloze else 0, "mod": now, "usn": -1, "sortf": 0, "did": 1,
        "tmpls": [{"name": n, "ord": i, "qfmt": q, "afmt": a, "bqfmt": "", "bafmt": "", "did": None, "bfont": "", "bsize": 0}
                  for i, (n, q, a) in enumerate(tmpls)],
        "flds": [{"name": f, "ord": i, "sticky": False, "rtl": False, "font": "Arial", "size": 20, "media": []} for i, f in enumerate(fields)],
        "css": css or CSS, "latexPre": "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
        "latexPost": "\\end{document}", "latexsvg": False,
        "req": [[i, "any", [0]] for i in range(len(tmpls))] if not cloze else [[0, "any", [0]]],
        "tags": [], "vers": [],
    }


def build_apkg(data: dict, deck_filter: list[str] | None, blob, now_ms: int | None = None) -> tuple[bytes, dict]:
    """data：/api/admin/cards 的回傳。blob(key) → bytes。回傳 (.apkg 內容, 統計)。"""
    now_ms = now_ms or int(time.time() * 1000)
    now = now_ms // 1000
    decks = {d["id"]: d for d in data["decks"]}

    def full(did: str) -> str:
        parts, seen = [], set()
        while did in decks and did not in seen:
            seen.add(did)
            parts.append(decks[did]["name"])
            did = decks[did]["parent"]
        return "::".join(reversed(parts))

    names = {did: full(did) for did in decks}
    if deck_filter:
        keep = {did for did, n in names.items() if any("::" + f.strip(":") + "::" in "::" + n + "::" for f in deck_filter)}
    else:
        keep = set(decks)
    if not keep:
        raise SystemExit(f"網站上找不到牌組：{'、'.join(deck_filter or [])}")
    cards = [c for c in data["cards"] if c["deck_id"] in keep]
    srs = {s["item"][5:]: s for s in data["srs_state"]}
    logs: dict[str, list] = {}
    for l in data["review_log"]:
        logs.setdefault(l["item"][5:], []).append(l)

    # crt＝今天凌晨 4 點（Anki 的預設換日時間）
    lt = time.localtime(now)
    crt = int(time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, 4, 0, 0, 0, 0, -1)))
    if crt > now:
        crt -= DAY
    today = (now - crt) // DAY

    M_BASIC, M_REV, M_CLOZE = 1_700_000_000_001, 1_700_000_000_002, 1_700_000_000_003
    a_tmpl = '{{FrontSide}}\n<hr id=answer>\n{{Back}}'
    models = {
        str(M_BASIC): _model(M_BASIC, "後醫網站・問答", ["Front", "Back"], [("卡片 1", "{{Front}}", a_tmpl)], False, now),
        str(M_REV): _model(M_REV, "後醫網站・正反", ["Front", "Back"], [("卡片 1", "{{Front}}", a_tmpl), ("卡片 2", "{{Back}}", "{{FrontSide}}\n<hr id=answer>\n{{Front}}")], False, now),
        str(M_CLOZE): _model(M_CLOZE, "後醫網站・克漏字", ["Text", "Back Extra"], [("克漏字", "{{cloze:Text}}", "{{cloze:Text}}<br>\n{{Back Extra}}")], True, now),
    }
    vm = vocab_model()
    M_VOCAB = int(vm["id"])
    if any(c["kind"] == "vocab" and c.get("fields") for c in cards):
        models[str(M_VOCAB)] = _model(M_VOCAB, vm["name"], vm["fields"], [(vm["template"], vm["front"], vm["back"])], False, now, vm["css"])
    anki_did = {did: 1_700_000_001_000 + i for i, did in enumerate(sorted(keep, key=lambda d: names[d]))}
    deck_json = {"1": _deck(1, "Default", now)}
    for did, aid in anki_did.items():
        deck_json[str(aid)] = _deck(aid, names[did], now)
    # 上層牌組沒被選到但子牌組有：Anki 會自己補，不用另建

    db_path = Path(tempfile.mkdtemp(prefix="pmq-anki-")) / "collection.anki2"
    db = sqlite3.connect(db_path)
    db.executescript(SCHEMA)
    conf = {"activeDecks": [1], "curDeck": 1, "newSpread": 0, "collapseTime": 1200, "timeLim": 0, "estTimes": True, "dueCounts": True,
            "curModel": str(M_BASIC), "nextPos": 1, "sortType": "noteFld", "sortBackwards": False, "addToCur": True, "schedVer": 2, "sched2021": True}
    db.execute("insert into col values (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')",
               (crt, now_ms, now_ms, json.dumps(conf), json.dumps(models), json.dumps(deck_json), json.dumps({"1": _dconf(now)})))

    media_names: dict[str, int] = {}
    notes: dict[str, int] = {}
    stats = {"notes": 0, "cards": 0, "revlog": 0, "media": 0, "decks": len(anki_did)}
    nid_seq = now_ms
    cid_seq = now_ms
    new_pos = 0
    rev_ids: set[int] = set()
    group = {}
    for c in cards:
        o = c.get("origin") or {}
        group.setdefault(o.get("guid") or o.get("note") or c["id"], []).append(c)
    for key, cs in group.items():
        cs.sort(key=lambda c: (c.get("origin") or {}).get("ord", 0))
        first = cs[0]
        kind = first["kind"]
        if kind == "reverse":
            # 第 0 張是正向；只剩第 1 張時把它的正反面換回來
            front, back = (first["front_md"], first["back_md"]) if (first.get("origin") or {}).get("ord", 0) == 0 else (first["back_md"], first["front_md"])
            mid = M_REV
        elif kind == "cloze":
            front, back, mid = first["front_md"], first["back_md"], M_CLOZE
        elif kind == "vocab" and first.get("fields"):
            front, back, mid = first["front_md"], first["back_md"], M_VOCAB
        else:
            front, back, mid = first["front_md"], first["back_md"], M_BASIC
        if mid == M_VOCAB:
            vals = [md_to_html(first["fields"].get(f) or "") for f in vm["fields"]]
            src = "".join(first["fields"].get(f) or "" for f in vm["fields"])
            stats["vocab"] = stats.get("vocab", 0) + 1
        else:
            vals = [md_to_html(front), md_to_html(back)]
            src = front + back
        for m in re.findall(r"m/([0-9a-f]{64}\.[a-z0-9]+)", src):
            media_names.setdefault(m, len(media_names))
        nid_seq += 1
        sf = _strip(vals[0])
        db.execute("insert into notes values (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')",
                   (nid_seq, guid_for(key), mid, now, " " + " ".join(first.get("tags") or []) + " " if first.get("tags") else "",
                    "\x1f".join(vals), sf, int(hashlib.sha1(sf.encode()).hexdigest()[:8], 16)))
        stats["notes"] += 1
        for c in cs:
            o = c.get("origin") or {}
            ord_ = o.get("ord", 0) if kind in ("cloze", "reverse") else 0
            s = srs.get(c["id"])
            cid_seq += 1
            data_json = ""
            if not s or s["state"] == 0:
                new_pos += 1
                typ, queue, due, ivl, reps, lapses = 0, 0, new_pos, 0, 0, 0
            else:
                due_day = (int(s["due"]) // 1000 - crt) // DAY  # 以 crt 那天為第 0 天；過期的是負數
                last = s.get("last_review") or s["due"]
                ivl = max(1, round((s["due"] - last) / 1000 / DAY))
                typ, queue, due, reps, lapses = 2, 2, int(due_day), s.get("reps") or 0, s.get("lapses") or 0
                if s.get("stability") is not None and s.get("difficulty") is not None:
                    data_json = json.dumps({"s": round(float(s["stability"]), 4), "d": round(float(s["difficulty"]), 4)})
            if s and s.get("suspended"):
                queue = -1
            db.execute("insert into cards values (?, ?, ?, ?, ?, -1, ?, ?, ?, ?, 2500, ?, ?, 0, 0, 0, 0, ?)",
                       (cid_seq, nid_seq, anki_did[c["deck_id"]], ord_, now, typ, queue, due, ivl, reps, lapses, data_json))
            stats["cards"] += 1
            for l in sorted(logs.get(c["id"], []), key=lambda x: x["reviewed_at"]):
                rid = int(l["reviewed_at"])
                while rid in rev_ids:
                    rid += 1
                rev_ids.add(rid)
                rtype = {0: 0, 1: 0, 2: 1, 3: 2}.get(l.get("state_before") or 0, 1)
                db.execute("insert into revlog values (?, ?, -1, ?, ?, ?, 0, ?, ?)",
                           (rid, cid_seq, l["rating"], round(l.get("scheduled_days") or 0), round(l.get("elapsed_days") or 0),
                            min(int(l.get("duration_ms") or 0), 60000), rtype))
                stats["revlog"] += 1
    db.commit()
    db.close()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(db_path, "collection.anki2")
        z.writestr("media", json.dumps({str(i): name for name, i in media_names.items()}))
        for name, i in media_names.items():
            z.writestr(str(i), blob("m/" + name))
            stats["media"] += 1
    db_path.unlink()
    db_path.parent.rmdir()
    stats["today"] = today
    return buf.getvalue(), stats


def _deck(did: int, name: str, now: int) -> dict:
    return {"id": did, "name": name, "mod": now, "usn": -1, "lrnToday": [0, 0], "revToday": [0, 0], "newToday": [0, 0],
            "timeToday": [0, 0], "collapsed": False, "browserCollapsed": False, "desc": "", "dyn": 0, "conf": 1, "extendNew": 0, "extendRev": 0}


def _dconf(now: int) -> dict:
    return {"id": 1, "name": "Default", "mod": now, "usn": -1, "maxTaken": 60, "autoplay": True, "timer": 0, "replayq": True, "dyn": False,
            "new": {"delays": [1, 10], "ints": [1, 4, 0], "initialFactor": 2500, "order": 1, "perDay": 20, "bury": False},
            "lapse": {"delays": [10], "mult": 0, "minInt": 1, "leechFails": 8, "leechAction": 1},
            "rev": {"perDay": 200, "ease4": 1.3, "maxIvl": 36500, "hardFactor": 1.2, "bury": False}}


def run_export(cfg, out: str, decks: list[str] | None, url: str, log=print) -> dict:
    from .remote import Remote
    remote = Remote(url)
    data = remote.get_cards()
    pkg, stats = build_apkg(data, decks, remote.get_blob)
    path = Path(out).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pkg)
    log(f"已匯出 {path}：牌組 {stats['decks']}、筆記 {stats['notes']:,}、卡片 {stats['cards']:,}、複習紀錄 {stats['revlog']:,}、媒體 {stats['media']:,}（{len(pkg) / 1e6:,.1f} MB）")
    log("匯入 Anki 時勾「包含排程資訊」。Anki 裡如果還有同一副牌的舊版，先刪掉再匯入（規格書 §14-3）。")
    return stats
