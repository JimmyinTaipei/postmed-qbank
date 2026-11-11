"""pmq backup pull／pmq restore（規格書 §1.5、§7.1）。

backup pull：下載與設定頁「匯出全部」相同的 zip，存到 pmq.toml 的 backup_dir，只留最近 8 份。
restore：把 zip 灌回
  --sqlite <檔>  一個新的本機 SQLite（用 worker/migrations 建表；檔案已存在且有資料就拒絕）
  --remote       空的 D1（經管理 API；非空就拒絕）
"""
import base64
import io
import json
import re
import sqlite3
import time
import zipfile
from pathlib import Path

from .remote import Remote

KEEP = 8
NAME = re.compile(r"^題庫網備份_\d{4}-\d{2}-\d{2}_\d{6}\.zip$")


def backup_pull(cfg, url):
    data = Remote(url, timeout=300).export_zip()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        meta = json.loads(z.read("meta.json"))
    d = cfg.backup_dir
    d.mkdir(parents=True, exist_ok=True)
    out = d / f"題庫網備份_{time.strftime('%Y-%m-%d_%H%M%S')}.zip"
    out.write_bytes(data)
    old = sorted(p for p in d.iterdir() if NAME.match(p.name))[:-KEEP]
    for p in old:
        p.unlink()
    total = sum(meta["counts"].values())
    print(f"已存 {out}（{len(data) / 1e6:.2f} MB；{total} 列：" + "、".join(f"{k} {v}" for k, v in meta["counts"].items() if v) + "）")
    if old:
        print(f"刪掉較舊的 {len(old)} 份（只留最近 {KEEP} 份）")
    return 0


def read_zip(path):
    """zip → [(table, row)]，順序照 meta.json 的表。"""
    rows = []
    with zipfile.ZipFile(path) as z:
        meta = json.loads(z.read("meta.json"))
        for table in meta["counts"]:
            name = f"tables/{table}.ndjson"
            if name not in z.namelist():
                continue
            for line in z.read(name).decode("utf-8").splitlines():
                if line.strip():
                    rows.append((table, json.loads(line)))
    return meta, rows


def _val(v):
    if isinstance(v, dict) and "$b64" in v:
        return base64.b64decode(v["$b64"])
    return v


def restore_sqlite(cfg, zip_path, db_path):
    meta, rows = read_zip(zip_path)
    db_path = Path(db_path)
    con = sqlite3.connect(db_path)
    try:
        has = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not has:
            for f in sorted(cfg.migrations.glob("*.sql")):
                con.executescript(f.read_text("utf-8"))
        for t in meta["counts"]:
            if t in has and con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]:
                raise SystemExit(f"{db_path} 不是空的（{t} 已有資料），拒絕灌回。")
        for table, row in rows:
            cols = [k for k in row if k != "seq" and re.fullmatch(r"[a-z_]+", k)]
            con.execute(f'INSERT INTO {table} ({", ".join(chr(34) + c + chr(34) for c in cols)}) VALUES ({", ".join("?" * len(cols))})',
                        [_val(row[c]) for c in cols])
        con.commit()
        got = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in meta["counts"]}
    finally:
        con.close()
    return report(meta["counts"], got, str(db_path))


def restore_remote(cfg, zip_path, url):
    meta, rows = read_zip(zip_path)
    body = "".join(json.dumps({"table": t, "row": r}, ensure_ascii=False) + "\n" for t, r in rows).encode("utf-8")
    res = Remote(url, timeout=600).restore(body)
    if not res.get("ok"):
        raise SystemExit(res.get("message", "灌回失敗"))
    got = {t: res.get("counts", {}).get(t, 0) for t in meta["counts"]}
    return report(meta["counts"], got, url)


def report(want, got, where):
    bad = {t: (want[t], got.get(t, 0)) for t in want if want[t] != got.get(t, 0)}
    print(f"灌回 {where}：")
    for t in want:
        mark = "✓" if t not in bad else "✗"
        print(f"  {mark} {t:<14} zip {want[t]:>7}  灌回後 {got.get(t, 0):>7}")
    if bad:
        print("筆數不符：", bad)
        return 1
    print("各表筆數相同。")
    return 0
