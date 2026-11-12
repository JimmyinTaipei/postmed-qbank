"""pmq anki import：把 Anki .apkg 的指定牌組連同進度搬進網站（規格書 §9.5、分階段計畫第 5 階段）。

做法：
- 一張 Anki 卡 → 網站一張卡（card 表）。ID 由 Anki 筆記的 guid 與卡片序號決定，同一個檔匯入兩次不會重複。
- 正面／背面：照 Anki 樣板（qfmt／afmt）用到哪些欄位決定，pmq.toml [anki.models] 可以個別指定。
  欄位的 HTML 轉成 Markdown（anki_html.py）。克漏字卡保留 {{c1::…}}，由網站遮蓋第 ord+1 個。
- 進度：Anki 的 FSRS 穩定度／難度（cards.data 的 s、d）與到期日直接搬進 srs_state；
  複習紀錄（revlog）搬進 review_log（device = "anki"）。暫停的卡維持暫停。
- 媒體：卡片用到的圖與聲音上傳到 R2 的 m/<sha256>.<副檔名>。
- 單字卡（第 8B-1 階段，規格書 §9.11）：[anki] vocab_models 列出的筆記類型（預設「0_後醫單字基本型」）
  匯成 kind = "vocab"，11 個欄位各自轉成 Markdown 存進 card.fields；front_md／back_md 仍照樣板產生（搜尋、TSV 用）。
- 寫入走管理 API /api/admin/rows。預設「已存在就不動」：重新匯入不會蓋掉網站上改過的內容與進度。
  --update 只覆寫卡片內容與牌組名稱（進度不動）。
"""
from __future__ import annotations

import hashlib
import json
import re
import time
import zipfile
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .anki import SEP, open_package, pb_get
from .anki_html import html_to_md, media_refs

VOCAB_MODEL = "0_後醫單字基本型"

SPECIAL = {"FrontSide", "Tags", "Deck", "Subdeck", "Card", "CardFlag", "Type", "CardID"}
SKIP_MOD = {"type", "tts", "tts-voices"}
DAY = 86400
MIME_EXT = {b"\x89PNG": "png", b"\xff\xd8\xff": "jpg", b"GIF8": "gif", b"RIFF": "webp", b"ID3": "mp3", b"\xff\xfb": "mp3", b"\xff\xf3": "mp3", b"OggS": "ogg"}
CTYPE = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
         "bmp": "image/bmp", "avif": "image/avif", "mp3": "audio/mpeg", "m4a": "audio/mp4", "aac": "audio/aac", "wav": "audio/wav",
         "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/ogg", "flac": "audio/flac"}
OK_EXT = {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"}


def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def card_id(guid: str, ord_: int) -> str:
    return f"anki-{sha1(guid)[:16]}-{ord_}"


def deck_id(full: str) -> str:
    return "anki-" + sha1(full)[:12]


def template_fields(tmpl: str) -> tuple[list[str], list[str]]:
    """樣板裡「顯示出來」的欄位（依出現順序），以及用 {{cloze:X}} 顯示的欄位。"""
    shown, cloze = [], []
    for m in re.finditer(r"\{\{([#^/]?)\s*([^}]+?)\s*\}\}", tmpl):
        if m.group(1):
            continue
        parts = m.group(2).split(":")
        name = parts[-1].strip()
        mods = {p.strip().lower() for p in parts[:-1]}
        if name in SPECIAL or mods & SKIP_MOD:
            continue
        if "cloze" in mods:
            if name not in cloze:
                cloze.append(name)
        elif name not in shown:
            shown.append(name)
    return shown, cloze


class Model:
    def __init__(self, ntid, name, is_cloze, fields, templates, cfg):
        self.id, self.name, self.cloze, self.fields = ntid, name, is_cloze, fields
        self.vocab = not is_cloze and name in (cfg.get("vocab_models") or [VOCAB_MODEL])
        over = (cfg.get("models") or {}).get(name, {})
        self.labels = {**(cfg.get("labels") or {}), **(over.get("labels") or {})}
        self.layout = []   # 每個樣板：(front fields, back fields)
        for q, a in templates:
            qs, qc = template_fields(q)
            as_, ac = template_fields(a)
            if is_cloze:
                front = qc or ac or fields[:1]
            else:
                front = over.get("front") or qs or fields[:1]
            back = over.get("back") or [f for f in qs + as_ if f not in front and f not in (qc + ac)]
            self.layout.append(([f for f in front if f in fields], [f for f in back if f in fields]))

    def render(self, ord_: int, values: dict[str, str], media: dict[str, str]) -> tuple[str, str]:
        front_f, back_f = self.layout[0 if self.cloze else min(ord_, len(self.layout) - 1)]
        front = "\n\n".join(x for x in (html_to_md(values.get(f, ""), media) for f in front_f) if x)
        parts = []
        for f in back_f:
            md = html_to_md(values.get(f, ""), media)
            if not md:
                continue
            label = "" if not parts else self.labels.get(f, f)
            parts.append((f'<div class="card-label">{label}</div>\n\n' if label else "") + md)
        return front, "\n\n".join(parts)


def _models(db, cfg) -> dict[int, Model]:
    out = {}
    for ntid, name, conf in db.execute("select id, name, config from notetypes"):
        fields = [n for (n,) in db.execute("select name from fields where ntid = ? order by ord", (ntid,))]
        tmpls = [((pb_get(c, 1, b"") or b"").decode("utf-8", "replace"), (pb_get(c, 2, b"") or b"").decode("utf-8", "replace"))
                 for (c,) in db.execute("select config from templates where ntid = ? order by ord", (ntid,))]
        is_cloze = pb_get(conf, 1, 0) == 1 or any("{{cloze:" in q for q, _ in tmpls)
        out[ntid] = Model(ntid, name, is_cloze, fields, tmpls, cfg)
    return out


def _legacy_models(db, cfg) -> dict[int, Model]:
    out = {}
    for ntid, m in json.loads(db.execute("select models from col").fetchone()[0]).items():
        tmpls = [(t["qfmt"], t["afmt"]) for t in m["tmpls"]]
        out[int(ntid)] = Model(int(ntid), m["name"], m.get("type") == 1, [f["name"] for f in m["flds"]], tmpls, cfg)
    return out


def _ext(name: str, data: bytes) -> str:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext == "jpe":
        ext = "jpg"
    if ext in OK_EXT:
        return ext
    if data[:5] == b"<?xml" or data.lstrip()[:4] == b"<svg":
        return "svg"
    for magic, e in MIME_EXT.items():
        if data.startswith(magic):
            return e
    return "bin"


def _wanted(name: str, decks: list[str]) -> bool:
    return any(name == d or name.startswith(d + "::") for d in decks)


class Importer:
    def __init__(self, cfg, decks: list[str]):
        self.cfg = cfg
        self.decks = decks
        self.t0 = int(time.time() * 1000)
        self.deck_rows: dict[str, dict] = {}
        self.cards: dict[str, dict] = {}
        self.srs: dict[str, dict] = {}
        self.logs: dict[str, dict] = {}
        self.media: dict[str, tuple[bytes, str]] = {}   # key m/<sha>.<ext> → (data, mime 副檔名)
        self.stats = defaultdict(Counter)
        self.missing_media: list[str] = []
        self.new_pos = 0

    def subject(self, full: str) -> str | None:
        return (self.cfg.get("subjects") or {}).get(full.split("::")[0])

    def add_deck(self, full: str):
        if full in self.deck_rows:
            return
        parts = full.split("::")
        parent = "::".join(parts[:-1]) if len(parts) > 1 else None
        if parent:
            self.add_deck(parent)
        self.deck_rows[full] = {"id": deck_id(full), "name": parts[-1], "subject": self.subject(full),
                                "parent": deck_id(parent) if parent else None, "updated_at": self.t0, "deleted": 0}

    def read(self, path: Path):
        pkg = open_package(path)
        db = pkg.db
        z = zipfile.ZipFile(path)
        is_new = "collection.anki21b" in z.namelist()
        dz = None
        if is_new:
            import zstandard
            dz = zstandard.ZstdDecompressor()
        index = {m.name: str(i) for i, m in enumerate(pkg.media)}
        if not is_new:
            index = {v: k for k, v in json.loads(z.read("media") or b"{}").items()} if "media" in z.namelist() else {}
        models = _models(db, self.cfg) if db.execute("select 1 from sqlite_master where name='notetypes'").fetchone() else _legacy_models(db, self.cfg)
        if db.execute("select 1 from sqlite_master where name='decks'").fetchone():
            dnames = {i: n.replace(SEP, "::") for i, n in db.execute("select id, name from decks")}
        else:
            dnames = {int(k): v["name"] for k, v in json.loads(db.execute("select decks from col").fetchone()[0]).items()}
        crt = db.execute("select crt from col").fetchone()[0]
        notes = {nid: (guid, mid, tags, flds) for nid, guid, mid, tags, flds in db.execute("select id, guid, mid, tags, flds from notes")}
        revs = defaultdict(list)
        for rid, cid, ease, ivl, last, typ, tm in db.execute("select id, cid, ease, ivl, lastIvl, type, time from revlog order by id"):
            revs[cid].append((rid, ease, ivl, last, typ, tm))
        media_cache: dict[str, str | None] = {}

        def media_path(name: str) -> str | None:
            if name in media_cache:
                return media_cache[name]
            k = index.get(name)
            if k is None or k not in z.namelist():
                media_cache[name] = None
                self.missing_media.append(name)
                return None
            data = z.read(k)
            if dz and data[:4] == b"\x28\xb5\x2f\xfd":
                data = dz.decompress(data, max_output_size=1 << 30)
            ext = _ext(name, data)
            key = f"m/{hashlib.sha256(data).hexdigest()}.{ext}"
            self.media[key] = (data, ext)
            media_cache[name] = key
            return key

        rows = db.execute("select id, nid, case when odid != 0 then odid else did end, ord, type, queue, due, ivl, factor, reps, lapses, data, "
                          "case when odid != 0 then odue else due end from cards order by did, due, id").fetchall()
        for cid, nid, did, ord_, typ, queue, _due, ivl, factor, reps, lapses, data, due in rows:
            dname = dnames.get(did, "")
            if not _wanted(dname, self.decks) or nid not in notes:
                continue
            guid, mid, tags, flds = notes[nid]
            model = models.get(mid)
            if not model:
                continue
            sid = card_id(guid, ord_)
            if sid in self.cards:
                continue
            self.add_deck(dname)
            values = dict(zip(model.fields, flds.split(SEP)))
            refs = set()
            for v in values.values():
                i, s = media_refs(v)
                refs |= i | s
            mp = {}
            for r in refs:
                p = media_path(r)
                if p:
                    mp[r] = p
            front, back = model.render(ord_, values, mp)
            self.cards[sid] = {
                "id": sid, "deck_id": deck_id(dname), "kind": "vocab" if model.vocab else "cloze" if model.cloze else "basic",
                "front_md": front, "back_md": back, "tags": tags.split() or None,
                "fields": {f: html_to_md(values.get(f, ""), mp) for f in model.fields} if model.vocab else None,
                "origin": {"from": "anki", "guid": guid, "model": model.name, "ord": ord_, "nid": nid, "cid": cid, "deck": dname,
                           **({"mid": model.id} if model.vocab else {})},
                "updated_at": self.t0, "deleted": 0,
            }
            st = self.stats[dname]
            st["卡片"] += 1
            st["單字卡"] += model.vocab
            st["暫停"] += queue == -1
            # 進度
            try:
                d = json.loads(data) if data else {}
            except ValueError:
                d = {}
            logs = revs.get(cid, [])
            last_review = logs[-1][0] if logs else None
            item = f"card:{sid}"
            if typ == 0:
                self.new_pos += 1
                srs = {"item": item, "due": self.t0, "stability": None, "difficulty": None, "reps": 0, "lapses": 0, "state": 0,
                       "last_review": None, "suspended": 1 if queue == -1 else 0, "updated_at": self.t0 + self.new_pos}
                st["新卡"] += 1
            else:
                due_ms = due * 1000 if due > 1_000_000_000 else (crt + due * DAY) * 1000
                if last_review is None:
                    last_review = due_ms - max(1, ivl) * DAY * 1000
                s, dif = d.get("s"), d.get("d")
                if s is None or dif is None:
                    s, dif = float(max(ivl, 1)), 5.0
                    st["沒有 FSRS 狀態"] += 1
                srs = {"item": item, "due": int(due_ms), "stability": float(s), "difficulty": float(dif), "reps": reps, "lapses": lapses,
                       "state": typ if typ in (1, 2, 3) else 2, "last_review": int(last_review),
                       "suspended": 1 if queue == -1 else 0, "updated_at": self.t0}
                st["已學"] += 1
            self.srs[item] = srs
            for i, (rid, ease, rivl, last, rtyp, tm) in enumerate(logs):
                if ease not in (1, 2, 3, 4) or rtyp not in (0, 1, 2, 3):
                    continue
                before = 0 if i == 0 else {0: 1, 1: 2, 2: 3, 3: 2}[rtyp]
                self.logs[f"anki-{rid}"] = {
                    "id": f"anki-{rid}", "item": item, "rating": ease, "state_before": before,
                    "elapsed_days": float(last) if last > 0 else 0.0, "scheduled_days": float(rivl) if rivl > 0 else 0.0,
                    "duration_ms": tm, "attempt_id": None, "device": "anki", "reviewed_at": rid,
                }
                st["複習紀錄"] += 1
        db.close()

    def media_rows(self) -> list[dict]:
        out = []
        for key, (data, ext) in self.media.items():
            out.append({"sha": key[2:], "mime": ext, "bytes": len(data), "created_at": self.t0})
        return out

    def sample_md(self, n=4) -> str:
        """每個筆記類型抽幾張，給使用者在匯入前看轉換結果。"""
        by = defaultdict(list)
        for c in self.cards.values():
            by[c["origin"]["model"]].append(c)
        L = ["# Anki 匯入預覽（pmq anki import --dry-run）", ""]
        for model, cs in sorted(by.items(), key=lambda x: -len(x[1])):
            L += [f"## {model}（{len(cs):,} 張）", ""]
            step = max(1, len(cs) // n)
            for c in cs[::step][:n]:
                L += [f"### {c['id']}（{c['origin']['deck']}）", "", "**正面**", "", "```", c["front_md"], "```", "", "**背面**", "", "```", c["back_md"], "```", ""]
                if c.get("fields"):
                    L += ["**欄位**", ""] + [f"- {k}：`{v[:120]}`" for k, v in c["fields"].items() if v] + [""]
        return "\n".join(L)


def upload_media(remote, media: dict, log=print):
    keys = sorted(media)
    missing = set(remote.have(keys)) if keys else set()
    todo = [k for k in keys if k in missing]
    total = sum(len(media[k][0]) for k in todo)
    log(f"媒體 {len(keys):,} 個，要上傳 {len(todo):,} 個（{total / 1e6:,.1f} MB）")

    def put(k):
        data, ext = media[k]
        remote.put_blob(k, data, CTYPE.get(ext, "application/octet-stream"))

    done = 0
    with ThreadPoolExecutor(8) as ex:
        for _ in ex.map(put, todo):
            done += 1
            if done % 500 == 0:
                log(f"  已上傳 {done:,} / {len(todo):,}")


def push_rows(remote, table: str, rows: list[dict], mode: str, log=print) -> int:
    written = 0
    rejected = 0
    for i in range(0, len(rows), 500):
        r = remote.post_rows([{"table": table, "row": x} for x in rows[i:i + 500]], mode)
        written += r.get("written", 0)
        rejected += len(r.get("rejected", []))
        if r.get("rejected"):
            log(f"  {table} 被拒：{r['rejected'][:3]}")
    log(f"  {table}：{len(rows):,} 列，寫入 {written:,}" + (f"，被拒 {rejected}" if rejected else "") + (f"（{len(rows) - written - rejected:,} 列已存在、沒動）" if mode == "insert" and len(rows) - written - rejected else ""))
    return written


def run_import(cfg, paths: list[str], decks: list[str] | None, dry_run: bool, update: bool, url: str | None, log=print) -> dict:
    acfg = cfg.anki
    decks = decks or acfg.get("import") or []
    if not decks:
        raise SystemExit("沒有指定要匯入的牌組：用 --deck，或在 pmq.toml 的 [anki] import 列出")
    files = []
    for p in paths:
        p = Path(p).expanduser()
        files += sorted(p.glob("*.apkg")) + sorted(p.glob("*.colpkg")) if p.is_dir() else [p]
    imp = Importer(acfg, decks)
    for f in files:
        before = len(imp.cards)
        imp.read(f)
        if len(imp.cards) > before:
            log(f"{f.name}：{len(imp.cards) - before:,} 張")
    found = {d for d in decks if any(_wanted(n, [d]) for n in imp.deck_rows)}
    for d in decks:
        if d not in found:
            log(f"⚠ 找不到牌組：{d}")
    media_bytes = sum(len(v[0]) for v in imp.media.values())
    log(f"牌組 {len(imp.deck_rows)}、卡片 {len(imp.cards):,}、有進度 {sum(1 for s in imp.srs.values() if s['state']):,}、"
        f"複習紀錄 {len(imp.logs):,}、媒體 {len(imp.media):,} 個（{media_bytes / 1e6:,.1f} MB）")
    if imp.missing_media:
        log(f"⚠ 卡片引用但檔裡沒有的媒體 {len(imp.missing_media)} 個：{imp.missing_media[:5]}")
    cfg.reports.mkdir(parents=True, exist_ok=True)
    (cfg.reports / "anki_import_preview.md").write_text(imp.sample_md(), "utf-8")
    summary = {"decks": {k: dict(v) for k, v in sorted(imp.stats.items())}, "cards": len(imp.cards), "logs": len(imp.logs),
               "media": len(imp.media), "media_bytes": media_bytes, "missing_media": imp.missing_media}
    (cfg.reports / "anki_import.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), "utf-8")
    log(f"預覽：{cfg.reports / 'anki_import_preview.md'}")
    if dry_run:
        return summary
    from .remote import Remote
    remote = Remote(url)
    upload_media(remote, imp.media, log)
    mode = "upsert" if update else "insert"
    push_rows(remote, "media", imp.media_rows(), "insert", log)
    push_rows(remote, "deck", list(imp.deck_rows.values()), mode, log)
    push_rows(remote, "card", list(imp.cards.values()), mode, log)
    push_rows(remote, "srs_state", list(imp.srs.values()), "insert", log)
    push_rows(remote, "review_log", list(imp.logs.values()), "insert", log)
    log("完成。裝置下次同步就會拿到（開著的網頁重新整理一次）。")
    return summary
