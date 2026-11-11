"""pmq anki inspect：只讀地檢查 Anki 匯出的 .apkg／.colpkg（規格書 §9.5、分階段計畫第 5 階段）。

- 全程在記憶體裡讀：zip 不解壓到磁碟，SQLite 用 deserialize 載入，不留任何暫存檔。
- 支援新封裝（collection.anki21b＝zstd 壓縮、media＝zstd 壓縮的 protobuf）與舊封裝
  （collection.anki21／anki2、media＝JSON）。
- 只出報告，不改 .apkg、不連網站。
"""
from __future__ import annotations

import json
import re
import sqlite3
import time
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote

SEP = "\x1f"
IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "tif", "tiff", "heic", "avif"}
AUDIO_EXT = {"mp3", "m4a", "wav", "ogg", "oga", "opus", "aac", "flac", "spx", "amr"}
VIDEO_EXT = {"mp4", "webm", "mov", "mkv", "avi", "ogv", "mpg", "mpeg", "3gp"}

RE_IMG = re.compile(r"""<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^"'>\s]+))""", re.I)
RE_SOUND = re.compile(r"\[sound:([^\]]+)\]")
RE_CLOZE = re.compile(r"\{\{c(\d+)::")
RE_TAG = re.compile(r"<[a-zA-Z/][^>]*>")
RE_MATH = re.compile(r"\\\(|\\\[|\[\$\]|\[\$\$\]|\[latex\]", re.I)


# ── protobuf 極簡解碼（只取需要的欄位） ──────────────────────────────

def _varint(b: bytes, i: int) -> tuple[int, int]:
    n = s = 0
    while True:
        c = b[i]
        i += 1
        n |= (c & 0x7F) << s
        if c < 0x80:
            return n, i
        s += 7


def pb_fields(b: bytes) -> list[tuple[int, int, object]]:
    """回傳 [(欄位號, wire type, 值)]；長度型回傳 bytes。解不動就停在那裡。"""
    out, i = [], 0
    try:
        while i < len(b):
            key, i = _varint(b, i)
            no, wt = key >> 3, key & 7
            if wt == 0:
                v, i = _varint(b, i)
            elif wt == 2:
                ln, i = _varint(b, i)
                v, i = b[i:i + ln], i + ln
            elif wt == 1:
                v, i = b[i:i + 8], i + 8
            elif wt == 5:
                v, i = b[i:i + 4], i + 4
            else:
                break
            out.append((no, wt, v))
    except IndexError:
        pass
    return out


def pb_get(b: bytes, no: int, default=None):
    for n, _, v in pb_fields(b):
        if n == no:
            return v
    return default


# ── 讀封裝 ─────────────────────────────────────────────────────────

@dataclass
class Media:
    name: str
    size: int          # 解壓後大小（新封裝取自索引；舊封裝取自 zip）
    stored: int        # 在 .apkg 裡佔的大小


@dataclass
class Package:
    path: Path
    fmt: str
    db: sqlite3.Connection
    media: list[Media] = field(default_factory=list)


def _load_db(raw: bytes) -> sqlite3.Connection:
    raw = bytearray(raw)
    # WAL 模式的檔頭（18、19 位元組＝2）在 deserialize 後打不開；改回傳統模式。
    if raw[:16] == b"SQLite format 3\x00" and raw[18] == 2:
        raw[18] = raw[19] = 1
    db = sqlite3.connect(":memory:")
    db.deserialize(bytes(raw))
    db.create_collation("unicase", lambda a, b: (a.casefold() > b.casefold()) - (a.casefold() < b.casefold()))
    return db


def open_package(path: Path) -> Package:
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    infos = {i.filename: i for i in z.infolist()}
    if "collection.anki21b" in names:
        import zstandard
        dz = zstandard.ZstdDecompressor()
        db = _load_db(dz.decompress(z.read("collection.anki21b"), max_output_size=1 << 32))
        media = []
        if "media" in names:
            idx = dz.decompress(z.read("media"), max_output_size=1 << 30)
            for k, (no, _, entry) in enumerate(f for f in pb_fields(idx) if f[0] == 1):
                name = pb_get(entry, 1, b"").decode("utf-8", "replace")
                size = pb_get(entry, 2, 0)
                zi = infos.get(str(k))
                media.append(Media(name, size, zi.compress_size if zi else 0))
        return Package(path, "新（anki21b）", db, media)
    col = "collection.anki21" if "collection.anki21" in names else "collection.anki2"
    db = _load_db(z.read(col))
    media = []
    if "media" in names:
        mp = json.loads(z.read("media") or b"{}")
        for k, name in mp.items():
            zi = infos.get(k)
            media.append(Media(name, zi.file_size if zi else 0, zi.compress_size if zi else 0))
    return Package(path, f"舊（{col.split('.')[-1]}）", db, media)


# ── 分析 ───────────────────────────────────────────────────────────

def img_refs(html: str) -> set[str]:
    """<img src> 的檔名；Anki 存的是 HTML 跳脫過的名稱（&amp;），有時又經過網址編碼。"""
    from html import unescape
    from urllib.parse import unquote
    out = set()
    for m in RE_IMG.finditer(html):
        v = unescape(next(g for g in m.groups() if g is not None))
        out.add(v)
        if "%" in v:
            out.add(unquote(v))
    return out


def _kind(name: str, img: set | None = None) -> str:
    if img and name in img:
        return "圖片"
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext in IMAGE_EXT:
        return "圖片"
    if ext in AUDIO_EXT:
        return "聲音"
    if ext in VIDEO_EXT:
        return "影片"
    return "其他"


def _deck_names(db) -> dict[int, str]:
    out = {}
    if db.execute("select 1 from sqlite_master where name='decks' and type='table'").fetchone():
        for did, name, kind in db.execute("select id, name, kind from decks"):
            out[did] = name.replace(SEP, "::") + ("（篩選牌組）" if pb_get(kind, 2) is not None else "")
    else:   # 舊格式：col.decks 是 JSON
        for did, d in json.loads(db.execute("select decks from col").fetchone()[0]).items():
            out[int(did)] = d["name"] + ("（篩選牌組）" if d.get("dyn") else "")
    return out


def _notetypes(db) -> dict[int, dict]:
    out = {}
    if db.execute("select 1 from sqlite_master where name='notetypes' and type='table'").fetchone():
        for ntid, name, cfg in db.execute("select id, name, config from notetypes"):
            out[ntid] = {"name": name, "cloze": pb_get(cfg, 1, 0) == 1, "fields": [], "templates": []}
        for ntid, _, name in db.execute("select ntid, ord, name from fields order by ntid, ord"):
            if ntid in out:
                out[ntid]["fields"].append(name)
        for ntid, _, name, cfg in db.execute("select ntid, ord, name, config from templates order by ntid, ord"):
            if ntid in out:
                q = (pb_get(cfg, 1, b"") or b"").decode("utf-8", "replace")
                out[ntid]["templates"].append(name)
                if "{{cloze:" in q:
                    out[ntid]["cloze"] = True
    else:
        for ntid, m in json.loads(db.execute("select models from col").fetchone()[0]).items():
            out[int(ntid)] = {"name": m["name"], "cloze": m.get("type") == 1,
                              "fields": [f["name"] for f in m["flds"]], "templates": [t["name"] for t in m["tmpls"]]}
    return out


def _fmt_mb(n: int) -> str:
    return f"{n / 1e6:,.1f} MB"


def inspect(path: Path) -> dict:
    t0 = time.time()
    pkg = open_package(path)
    db = pkg.db
    decks = _deck_names(db)
    nts = _notetypes(db)

    notes = {nid: (guid, mid, tags, flds) for nid, guid, mid, tags, flds in db.execute("select id, guid, mid, tags, flds from notes")}
    cards = db.execute("select id, nid, case when odid != 0 then odid else did end, ord, type, queue, ivl, reps, lapses, data from cards").fetchall()
    rev_by_card = Counter(cid for (cid,) in db.execute("select cid from revlog"))
    rev_total = sum(rev_by_card.values())
    first_rev = db.execute("select min(id), max(id) from revlog").fetchone()

    media_names = {m.name for m in pkg.media}
    per_deck = defaultdict(lambda: Counter())
    nt_cards = Counter()
    nt_notes = defaultdict(set)
    fsrs = 0
    tags = Counter()
    refs_img, refs_snd = set(), set()
    deck_img, deck_snd = Counter(), Counter()
    note_feat = {}
    for nid, (guid, mid, tg, flds) in notes.items():
        img = img_refs(flds)
        snd = set(RE_SOUND.findall(flds))
        refs_img |= img
        refs_snd |= snd
        note_feat[nid] = (bool(img), bool(snd), bool(RE_CLOZE.search(flds)), bool(RE_TAG.search(flds)), bool(RE_MATH.search(flds)))
        for t in tg.split():
            tags[t] += 1
    for cid, nid, did, ord_, typ, queue, ivl, reps, lapses, data in cards:
        c = per_deck[did]
        c["卡片"] += 1
        c["複習紀錄"] += rev_by_card.get(cid, 0)
        if queue == -1:
            c["暫停"] += 1
        elif queue in (-2, -3):
            c["擱置"] += 1
        if typ == 0:
            c["新卡"] += 1
        elif typ in (1, 3):
            c["學習中"] += 1
        else:
            c["複習中"] += 1
        try:
            d = json.loads(data) if data else {}
        except ValueError:
            d = {}
        if "s" in d and "d" in d:
            fsrs += 1
            c["有 FSRS 狀態"] += 1
        f = note_feat.get(nid)
        if f:
            c["含圖片"] += f[0]
            c["含聲音"] += f[1]
            c["含公式"] += f[4]
        mid = notes[nid][1] if nid in notes else None
        nt_cards[mid] += 1
        nt_notes[mid].add(nid)

    by_kind = defaultdict(lambda: [0, 0, 0])   # 檔數、大小、在 apkg 裡的大小
    for m in pkg.media:
        k = by_kind[_kind(m.name, refs_img)]
        k[0] += 1
        k[1] += m.size
        k[2] += m.stored
    missing_img = sorted(r for r in refs_img if r not in media_names and not r.startswith(("http:", "https:", "data:", "//"))
                         and not (("%" in r) and unquote(r) in media_names))
    missing_snd = sorted(r for r in refs_snd if r not in media_names)
    unused = [m for m in pkg.media if m.name not in refs_img and m.name not in refs_snd]

    # 範例：每個樣板取 2 則筆記的第一個欄位
    samples = {}
    for mid in nt_notes:
        ex = []
        for nid in sorted(nt_notes[mid])[:2]:
            first = notes[nid][3].split(SEP)[0]
            first = re.sub(r"\s+", " ", RE_TAG.sub(" ", first)).strip()
            ex.append(first[:80])
        samples[mid] = ex

    deck_rows = []
    for did, name in sorted(decks.items(), key=lambda x: x[1]):
        own = per_deck.get(did, Counter())
        sub = Counter()
        for d2, n2 in decks.items():
            if n2 == name or n2.startswith(name + "::"):
                sub.update(per_deck.get(d2, Counter()))
        if not sub["卡片"] and name == "Default":
            continue
        deck_rows.append({"deck": name, "own": dict(own), "total": dict(sub)})

    res = {
        "file": path.name,
        "size": path.stat().st_size,
        "format": pkg.fmt,
        "notes": len(notes),
        "cards": len(cards),
        "revlog": rev_total,
        "revlog_span": [first_rev[0], first_rev[1]],
        "fsrs_cards": fsrs,
        "decks": deck_rows,
        "notetypes": [{"name": nts.get(mid, {}).get("name", f"（不明 {mid}）"), "cloze": nts.get(mid, {}).get("cloze", False),
                       "fields": nts.get(mid, {}).get("fields", []), "templates": nts.get(mid, {}).get("templates", []),
                       "notes": len(nt_notes[mid]), "cards": nt_cards[mid], "samples": samples.get(mid, [])}
                      for mid in sorted(nt_cards, key=lambda m: -nt_cards[m])],
        "media": {k: {"files": v[0], "bytes": v[1], "stored": v[2]} for k, v in sorted(by_kind.items())},
        "media_missing": {"圖片": missing_img[:20], "圖片數": len(missing_img), "聲音": missing_snd[:20], "聲音數": len(missing_snd)},
        "media_unused": {"files": len(unused), "bytes": sum(m.size for m in unused)},
        "tags": tags.most_common(15),
        "tag_count": len(tags),
        "guids": [g for g, *_ in notes.values()],
        "elapsed_s": round(time.time() - t0, 1),
    }
    db.close()
    return res


def _ts(ms):
    return time.strftime("%Y-%m-%d", time.localtime(ms / 1000)) if ms else "—"


def report_md(results: list[dict]) -> str:
    L = ["# Anki 匯出檔檢查報告（pmq anki inspect）", "",
         f"產生時間：{time.strftime('%Y-%m-%d %H:%M')}。只讀：沒有解壓到磁碟、沒有改任何檔。", "",
         "## 總覽", "",
         "| 檔案 | 大小 | 封裝 | 筆記 | 卡片 | 有 FSRS 狀態 | 複習紀錄 | 紀錄期間 | 圖片 | 聲音 |",
         "|---|---:|---|---:|---:|---:|---:|---|---:|---:|"]
    for r in results:
        m = r["media"]
        img = m.get("圖片", {"files": 0, "bytes": 0})
        snd = m.get("聲音", {"files": 0, "bytes": 0})
        L.append(f"| {r['file']} | {_fmt_mb(r['size'])} | {r['format']} | {r['notes']:,} | {r['cards']:,} | {r['fsrs_cards']:,} | "
                 f"{r['revlog']:,} | {_ts(r['revlog_span'][0])}～{_ts(r['revlog_span'][1])} | "
                 f"{img['files']:,}（{_fmt_mb(img['bytes'])}） | {snd['files']:,}（{_fmt_mb(snd['bytes'])}） |")
    L.append("")
    allg = Counter(g for r in results for g in set(r["guids"]))
    dup = sum(1 for v in allg.values() if v > 1)
    L.append(f"跨檔重複的筆記（同一個 guid 出現在兩個以上的檔）：{dup} 則。")
    L.append("")
    for r in results:
        L += [f"## {r['file']}", ""]
        L += ["### 牌組", "",
              "「本身」是直接放在這副牌的卡；「含子牌組」是連同底下所有子牌組。",
              "",
              "| 牌組 | 本身 | 含子牌組 | 新卡 | 學習中 | 複習中 | 暫停 | 有 FSRS | 含圖片 | 含聲音 | 含公式 | 複習紀錄 |",
              "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
        for d in r["decks"]:
            t = d["total"]
            depth = d["deck"].count("::")
            label = ("　" * depth) + d["deck"].split("::")[-1]
            L.append(f"| {label} | {d['own'].get('卡片', 0):,} | {t.get('卡片', 0):,} | {t.get('新卡', 0):,} | {t.get('學習中', 0):,} | "
                     f"{t.get('複習中', 0):,} | {t.get('暫停', 0):,} | {t.get('有 FSRS 狀態', 0):,} | {t.get('含圖片', 0):,} | "
                     f"{t.get('含聲音', 0):,} | {t.get('含公式', 0):,} | {t.get('複習紀錄', 0):,} |")
        L += ["", "### 筆記類型（卡片樣板）", "",
              "| 類型 | 克漏字 | 欄位 | 卡片樣板 | 筆記 | 卡片 | 範例（第一個欄位） |", "|---|---|---|---|---:|---:|---|"]
        for n in r["notetypes"]:
            ex = "<br>".join(s.replace("|", "\\|") for s in n["samples"])
            L.append(f"| {n['name']} | {'是' if n['cloze'] else '否'} | {'、'.join(n['fields'])} | {'、'.join(n['templates'])} | "
                     f"{n['notes']:,} | {n['cards']:,} | {ex} |")
        L += ["", "### 媒體", "", "| 種類 | 檔數 | 大小 | 在 .apkg 裡 |", "|---|---:|---:|---:|"]
        for k, v in r["media"].items():
            L.append(f"| {k} | {v['files']:,} | {_fmt_mb(v['bytes'])} | {_fmt_mb(v['stored'])} |")
        mm = r["media_missing"]
        L.append("")
        L.append(f"- 卡片引用了但檔案不在 .apkg 裡：圖片 {mm['圖片數']}、聲音 {mm['聲音數']}"
                 + (f"（例：{'、'.join((mm['圖片'] + mm['聲音'])[:5])}）" if mm['圖片數'] + mm['聲音數'] else ""))
        L.append(f"- 在 .apkg 裡但沒有卡片引用：{r['media_unused']['files']:,} 個（{_fmt_mb(r['media_unused']['bytes'])}）")
        L += ["", f"### 標籤（共 {r['tag_count']:,} 種，列出最常用的 15 個）", ""]
        L.append("、".join(f"{t}（{n:,}）" for t, n in r["tags"]) or "（沒有標籤）")
        L.append("")
    return "\n".join(L) + "\n"


def run_inspect(cfg, paths: list[str]) -> Path:
    files = []
    for p in paths:
        p = Path(p).expanduser()
        files += sorted(p.glob("*.apkg")) + sorted(p.glob("*.colpkg")) if p.is_dir() else [p]
    if not files:
        raise SystemExit("找不到 .apkg／.colpkg")
    results = []
    for f in files:
        print(f"讀 {f.name}…", flush=True)
        r = inspect(f)
        print(f"  筆記 {r['notes']:,}、卡片 {r['cards']:,}、複習紀錄 {r['revlog']:,}；{r['elapsed_s']} 秒")
        results.append(r)
    out = cfg.reports / "anki_inspect.md"
    out.write_text(report_md(results), "utf-8")
    slim = [{k: v for k, v in r.items() if k != "guids"} for r in results]
    (cfg.reports / "anki_inspect.json").write_text(json.dumps(slim, ensure_ascii=False, indent=1), "utf-8")
    return out
