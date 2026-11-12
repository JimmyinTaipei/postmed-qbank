"""pmq status：本機版（http://127.0.0.1:8787）與部署版（pmq.toml [site] url）並排比較，看兩邊各有什麼資料。

只讀，不改任何東西。每一邊連不上就寫「連不上」，另一邊照樣列。
- 本機版的管理金鑰讀 worker/.dev.vars（scripts/local.sh password 設的）。
- 部署版的管理金鑰讀鑰匙圈（scripts/set-secrets.sh admin 設的）。
"""
import json
import re
import urllib.request
from pathlib import Path

from .remote import Remote, RemoteError, admin_token

LOCAL_URL = "http://127.0.0.1:8787"

TABLES = [  # 個人資料：(表, 中文)
    ("attempt", "作答紀錄"), ("session", "刷題場次"), ("review_log", "複習紀錄"), ("srs_state", "複習排程"),
    ("card", "卡片"), ("deck", "牌組"), ("note", "我的筆記"), ("highlight", "螢光"), ("ink", "手寫"),
    ("flag", "星號／存疑／錯題"), ("cloze_mark", "克漏字膠帶"), ("vocab_mark", "單字標記"),
    ("media", "卡片媒體"), ("content_patch", "網站上改的內容（修訂）"), ("setting", "設定"),
]


def _local_token(root):
    f = root / "worker" / ".dev.vars"
    if not f.exists():
        return None
    for line in f.read_text("utf-8").splitlines():
        if line.startswith("ADMIN_TOKEN="):
            return line.split("=", 1)[1].strip()
    return None


def _app_build(url):
    """登入頁引用的 login-xxxx.js（內容雜湊）：兩邊一樣＝網站程式（App）大概是同一版（登入頁沒改過時看不出差別）。"""
    try:
        with urllib.request.urlopen(urllib.request.Request(url + "/login", headers={"User-Agent": "pmq"}), timeout=15) as r:
            m = re.search(r"/assets/login-([\w-]+)\.js", r.read().decode("utf-8", "replace"))
            return m.group(1) if m else "?"
    except Exception:
        return None


def snapshot(url, token):
    out = {"url": url, "ok": False}
    try:
        r = Remote(url, token=token, timeout=60)
        u = r.usage()
    except (RemoteError, SystemExit) as e:
        out["error"] = str(e).split("\n")[0][:120]
        return out
    out["ok"] = True
    out["usage"] = u
    out["new_worker"] = "rows" in u           # 2026-11-12 以後的 Worker（有 pmq prune 用的 API）
    out["app"] = _app_build(url)
    m = r.get_manifest()
    out["manifest"] = m
    if m:
        try:
            tax = json.loads(r.get_blob(m["files"]["taxonomy"]))
            out["names"] = {s["id"]: s["name"] for s in tax.get("subjects", [])}
        except Exception:
            out["names"] = {}
    return out


def _fmt_n(v):
    return "—" if v is None else f"{v:,}"


def status(cfg, local_url=LOCAL_URL, site_url=None):
    root = Path(__file__).resolve().parents[3]
    site_url = site_url or cfg.site_url
    lt = _local_token(root)
    local = snapshot(local_url, lt) if lt else {"url": local_url, "ok": False, "error": "還沒設定本機密碼（scripts/local.sh password）"}
    if local.get("error", "").startswith("連不上"):
        local["error"] = "連不上：本機網站沒有在跑（scripts/local.sh start）"
    try:
        st = admin_token()
        site = snapshot(site_url, st)
    except (RemoteError, SystemExit) as e:
        site = {"url": site_url, "ok": False, "error": str(e)[:120]}

    cols = [("本機版", local), ("部署版", site)]
    rows = []   # (標題, 本機, 部署)；標題 None＝分節

    def row(label, f):
        rows.append((label, *[f(s) if s["ok"] else "" for _, s in cols]))

    rows.append(("網址", local["url"], site["url"]))
    rows.append(("狀態", *[("連得上" if s["ok"] else s.get("error", "連不上")) for _, s in cols]))
    if not (local["ok"] or site["ok"]):
        _print(rows)
        return 1
    rows.append((None, "網站程式", ""))
    row("App 版本（登入頁檔名）", lambda s: s.get("app") or "?")
    row("Worker 有清圖功能（11/12 版）", lambda s: "有" if s["new_worker"] else "沒有（要重新部署／重開）")

    rows.append((None, "題庫內容（最後一次 publish）", ""))
    row("發佈時間", lambda s: (s["manifest"] or {}).get("generated", "沒發佈過").replace("T", " "))
    subjects = []
    for _, s in cols:
        if s["ok"] and s["manifest"]:
            for k in s["manifest"].get("counts", {}):
                if k not in subjects:
                    subjects.append(k)
    names = {}
    for _, s in cols:
        names.update(s.get("names") or {})
    for k in subjects:
        row(f"{names.get(k, k)}（{k}）題數", lambda s, k=k: _fmt_n((s["manifest"] or {}).get("counts", {}).get(k)))
    row("資料庫筆記份數", lambda s: _fmt_n(len(((s["manifest"] or {}).get("files") or {}).get("kb", {}) or {})))
    row("單字索引（科目）", lambda s: ", ".join(sorted((((s["manifest"] or {}).get("files") or {}).get("vocab") or {}))) or "—")

    rows.append((None, "個人資料（作答、卡片…）", ""))
    for t, label in TABLES:
        row(label, lambda s, t=t: _fmt_n(s["usage"].get("rows", {}).get(t)) if s["new_worker"] else "?")

    rows.append((None, "儲存空間", ""))
    row("D1（個人資料庫）", lambda s: f"{(s['usage'].get('d1_bytes') or 0) / 1e6:.1f} MB")
    for p, label in [("a/", "題目／筆記的圖"), ("m/", "Anki 媒體"), ("c/", "內容包"), ("backup/", "每晚備份")]:
        row(f"R2 {label}（{p}）", lambda s, p=p: (lambda e: f"{e['objects']:,} 個、{e['bytes'] / 1e6:.1f} MB" if e else "—")(s["usage"].get("r2", {}).get(p)))

    _print(rows)
    if local["ok"] and site["ok"]:
        sec, diff = None, []
        for r in rows:
            if r[0] is None:
                sec = r[1]
            elif sec and (sec.startswith("網站程式") or sec.startswith("題庫內容")) and r[0] != "發佈時間" and r[1] != r[2] and "?" not in (r[1], r[2]):
                diff.append(f"{r[0]}（本機 {r[1]}／部署 {r[2]}）")
        print("\n網站程式與題庫內容，兩邊不一樣的：" + ("\n  " + "\n  ".join(diff) if diff else "沒有"))
        print("（個人資料兩邊本來就各自獨立：本機版是測試用，作答不會跑到部署版，反之亦然。）")
    return 0


def _w(s):
    return sum(2 if ord(ch) > 0x2E80 else 1 for ch in str(s))


def _pad(s, n):
    return str(s) + " " * max(0, n - _w(s))


def _print(rows):
    w0 = max(_w(r[0]) for r in rows if r[0]) + 2
    w1 = max([_w(r[1]) for r in rows if r[0]] + [8]) + 2
    print(_pad("", w0) + _pad("本機版", w1) + "部署版")
    for r in rows:
        if r[0] is None:
            print(f"\n■ {r[1]}")
        else:
            print(_pad(r[0], w0) + _pad(r[1], w1) + str(r[2]))
