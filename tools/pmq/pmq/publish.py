"""pmq publish：驗證通過後上傳有變動的包與圖，最後換 manifest（規格書 §7.2）。

1. 跑與 pmq check 相同的檢查（不含公式）；有「擋發佈的錯誤」就停。
2. 組出內容包：taxonomy、各科索引、每章一包、筆記、特殊情況表。檔名含內容雜湊，內容沒變檔名就不變。
3. 問伺服器哪些檔已經有了（/api/admin/have），只傳沒有的；圖檔從主檔原位讀、直接傳，不在磁碟留暫存。
4. 全部傳完才換 manifest（原子；中途失敗，線上仍是舊版）。
5. 跑一次 pmq usage。

主檔唯讀：這裡只讀主檔。
"""
import hashlib
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .build import dumps
from .check import run_check
from .remote import Remote
from .sample import pick_cases

CTYPE = {"json": "application/json; charset=utf-8", "svg": "image/svg+xml", "png": "image/png", "jpg": "image/jpeg",
         "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}


def _named(prefix, obj):
    data = dumps(obj).encode("utf-8")
    return f"c/{prefix}-{hashlib.sha256(data).hexdigest()[:12]}.json", data


def build_bundle(cfg, c):
    """回傳 (manifest 的 files, {key: bytes}, {asset key: 本機路徑})。"""
    blobs = {}
    files = {}

    def add(prefix, obj):
        key, data = _named(prefix, obj)
        blobs[key] = data
        return key

    subjects = [s["id"] for s in c.taxonomy["subjects"]]
    files["taxonomy"] = add("taxonomy", c.taxonomy)
    files["index"] = {s: add(f"index/{s}", c.index(s)) for s in subjects}
    packs = {}
    for q in c.questions:
        packs.setdefault(q["pack"], []).append(c.public(q))
    files["packs"] = {p: add(f"pack/{p}", {"pack": p, "questions": qs}) for p, qs in sorted(packs.items())}
    kb_docs = c.kb_docs            # run_check 已經建好（kb.build_kb）
    files["kb"] = {k: add(f"kb/{k}", d) for k, d in sorted(kb_docs.items())}
    files["kbcat"] = add("kbcat", c.kb_catalog)
    files["kbrel"] = add("kbrel", c.kb_related)
    files["cases"] = add("cases", {"cases": pick_cases(c)})
    # 單字索引（第 8B-2 階段）：每個開了查單字的科目一份
    files["vocab"] = {s: add(f"vocab/{s}", ix) for s, ix in sorted(getattr(c, "vocab", {}).items())}

    pub = c.assets.published()
    need = set()
    for q in c.questions:
        for f in q["figs"]:
            need.add(f["src"])
            if f.get("fallback"):
                need.add(f["fallback"])
    for d in kb_docs.values():
        for f in d["figs"]:
            need.add(f["src"])
            if f.get("fallback"):
                need.add(f["fallback"])
    assets = {k: pub[k]["path"] for k in sorted(need) if k in pub}
    missing_local = sorted(k for k in need if k not in pub)
    return files, blobs, assets, missing_local


def publish(cfg, url, subject=None, dry_run=False, workers=6):
    t0 = time.time()
    # --subject：只讀這一科的主檔（其他科的主檔可能是 iCloud 雲端佔位，讀了會觸發下載）；其他科沿用線上版本
    c, result = run_check(cfg, with_math=False, only=subject)
    if result["errors"]:
        print(f"有 {len(result['errors'])} 個擋發佈的錯誤，停止。前幾個：")
        for e in result["errors"][:10]:
            print("  ", json.dumps(e, ensure_ascii=False))
        print("完整清單：bin/pmq check 的驗證報告。")
        return 1
    counts = result["counts"]
    base = json.loads(cfg.baseline.read_text("utf-8")) if cfg.baseline.exists() else {}
    files, blobs, assets, missing_local = build_bundle(cfg, c)
    if missing_local:
        print(f"有 {len(missing_local)} 個圖檔在主檔裡找不到，停止：", missing_local[:5])
        return 1

    remote = Remote(url)
    if subject:
        cur = remote.get_manifest()
        if not cur:
            # 空的網站（例如本機測試站）：只有這一科
            print(f"線上還沒有任何內容：這次只會有 {subject} 這一科。")
            cur = {"files": {"index": {}, "packs": {}, "kb": {}, "taxonomy": None}, "counts": {}}
        keep = lambda d, new: {**{k: v for k, v in d.items() if not k.startswith(subject + "/") and k != subject},
                               **{k: v for k, v in new.items() if k.startswith(subject + "/") or k == subject}}
        files["index"] = keep(cur["files"]["index"], files["index"])
        files["packs"] = keep(cur["files"]["packs"], files["packs"])
        # 筆記：換掉這一科的，其他科沿用線上的
        files["kb"] = keep(cur["files"].get("kb", {}), files["kb"])
        files["vocab"] = keep(cur["files"].get("vocab", {}), files["vocab"])
        # 資料庫目錄：線上那份換掉這一科；題目 → 相關筆記：拿掉這一科筆記的段落、加上新的
        own = lambda k: k.startswith(subject + "/")
        if cur["files"].get("kbcat"):
            old_cat = json.loads(remote.get_blob(cur["files"]["kbcat"]))
            cat = {"subjects": [x for x in old_cat["subjects"] if x["id"] != subject] + c.kb_catalog["subjects"]}
            files["kbcat"], data = _named("kbcat", cat)
            blobs[files["kbcat"]] = data
        if cur["files"].get("kbrel"):
            old_rel = json.loads(remote.get_blob(cur["files"]["kbrel"]))
            rel = {}
            for qid, lst in old_rel.items():
                lst = [r for r in lst if not own(r["key"])]
                if lst:
                    rel[qid] = lst
            for qid, lst in c.kb_related.items():
                rel.setdefault(qid, []).extend(lst)
            files["kbrel"], data = _named("kbrel", rel)
            blobs[files["kbrel"]] = data
        if cur["files"].get("cases"):
            files["cases"] = cur["files"]["cases"]
        # taxonomy：線上那份換掉這一科的科目、章節、來源
        old_tax = json.loads(remote.get_blob(cur["files"]["taxonomy"])) if cur["files"].get("taxonomy") else {"subjects": [], "chapters": [], "sources": []}
        tax = {
            "subjects": [x for x in old_tax["subjects"] if x["id"] != subject] + c.taxonomy["subjects"],
            "chapters": [x for x in old_tax["chapters"] if x["subject"] != subject] + c.taxonomy["chapters"],
            "source_kinds": c.taxonomy["source_kinds"],
            "sources": [x for x in old_tax["sources"] if x["subject"] != subject] + c.taxonomy["sources"],
        }
        files["taxonomy"], data = _named("taxonomy", tax)
        blobs[files["taxonomy"]] = data
        counts = {**cur.get("counts", {}), subject: counts[subject]}
        wanted = (set(files["index"].values()) | set(files["packs"].values()) | set(files["kb"].values()) | set(files["vocab"].values())
                  | {files["taxonomy"], files["kbcat"], files["kbrel"], files["cases"]})
        blobs = {k: v for k, v in blobs.items() if k in wanted}
        assets = {k: p for k, p in assets.items()}

    keys = sorted(blobs) + sorted(assets)
    missing = set(remote.have(keys))
    up_c = [k for k in sorted(blobs) if k in missing]
    up_a = [k for k in sorted(assets) if k in missing]
    up_bytes = sum(len(blobs[k]) for k in up_c) + sum(Path(assets[k]).stat().st_size for k in up_a)
    print(f"內容包 {len(blobs)} 個檔、圖 {len(assets)} 個；要上傳：包 {len(up_c)}、圖 {len(up_a)}，共 {up_bytes / 1e6:.1f} MB")
    for k in up_c:
        print("  ↑", k)
    if dry_run:
        print("--dry-run：沒有上傳。")
        return 0

    def send(key):
        if key in blobs:
            data, ctype = blobs[key], CTYPE["json"]
        else:
            data = Path(assets[key]).read_bytes()
            ctype = CTYPE.get(key.rsplit(".", 1)[-1], "application/octet-stream")
        remote.put_blob(key, data, ctype)
        return key

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(send, k) for k in up_c + up_a]
        for f in as_completed(futs):
            f.result()
            done += 1
            if done % 200 == 0:
                print(f"  已上傳 {done} / {len(futs)}")

    manifest = {"version": 1, "generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "counts": counts, "files": files}
    res = remote.put_manifest(manifest)
    print(f"已換版：manifest {res['manifest_h']}（{res['files']} 個內容檔）；{time.time() - t0:.0f} 秒")
    for s, n in counts.items():
        b = (base.get(s) or {}).get("questions_unique", (base.get(s) or {}).get("questions"))
        print(f"  {s} {n:,} 題" + (f"（基準 {b:,}{'，相同' if b == n else '，不同！'}）" if b is not None else ""))
    c.cache.save()
    from .patches import mark_merged
    mark_merged(c, remote, subject=subject)
    return usage(cfg, url, remote=remote)


LIMITS = {"d1": 1024 ** 3, "r2": 3 * 1024 ** 3}   # 規格書 §11-6


def usage(cfg, url, remote=None):
    remote = remote or Remote(url)
    u = remote.usage()
    d1 = u.get("d1_bytes")
    r2 = u.get("r2_bytes", 0)
    print(f"用量：D1 {d1 / 1e6:.1f} MB（上限 1 GB）" if d1 is not None else "用量：D1 大小讀不到", end="；")
    print(f"R2 {r2 / 1e6:.1f} MB（上限 3 GB）")
    for p, e in sorted(u.get("r2", {}).items()):
        print(f"  {p:<10} {e['objects']:>6} 個  {e['bytes'] / 1e6:8.1f} MB")
    over = (d1 or 0) > LIMITS["d1"] or r2 > LIMITS["r2"]
    if over:
        print("⚠ 超過規格書 §11-6 的用量上限：停止，不要再發佈；請先清理舊檔（pmq prune 清掉沒用到的圖）或調整上限。")
        return 2
    return 0


ASSET_RE = re.compile(rb"a/[0-9a-f]{64}\.[a-z0-9]{2,5}")


def _strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _strings(v)


def prune(cfg, url, yes=False, min_age_h=24, remote=None, workers=8):
    """pmq prune：R2 上目前 manifest 沒用到的內容圖（a/…）列出來；--yes 才刪。

    「用到」＝目前 manifest 列的每一個內容檔（題目包、筆記、索引…）裡出現的 a/<sha>.<ext>，
    包括 figs 的 src 與 fallback。不讀主檔。m/（Anki 媒體）、c/、備份都不動。
    最近 min_age_h 小時內上傳的不刪（可能是正在發佈、manifest 還沒換）。
    """
    remote = remote or Remote(url)
    m = remote.get_manifest()
    if not m:
        print("線上還沒有 manifest（沒發佈過）：不清。")
        return 1
    keys = sorted({k for k in _strings(m.get("files", {})) if k.startswith("c/")})
    print(f"目前的 manifest：{m.get('generated', '?')}，內容檔 {len(keys)} 個；讀取中…")
    used = set()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for data in ex.map(remote.get_blob, keys):
            used.update(x.decode() for x in ASSET_RE.findall(data))
    objs = remote.list_assets()
    now = time.time() * 1000
    unused = [(k, size, up) for k, size, up in objs if k not in used]
    recent = [o for o in unused if now - o[2] < min_age_h * 3600 * 1000]
    drop = [o for o in unused if o not in recent]
    by_ext = {}
    for k, size, _ in drop:
        e = by_ext.setdefault(k.rsplit(".", 1)[1], [0, 0])
        e[0] += 1
        e[1] += size
    total = sum(o[1] for o in objs)
    print(f"R2 的內容圖 {len(objs)} 個（{total / 1e6:.1f} MB）；用到的 {len(used)} 個；沒用到的 {len(unused)} 個")
    if recent:
        print(f"  其中 {len(recent)} 個是 {min_age_h} 小時內才上傳的，先不刪")
    if not drop:
        print("沒有要刪的。")
        return 0
    for ext, (n, b) in sorted(by_ext.items()):
        print(f"  可以刪：{ext:<4} {n:>6} 個  {b / 1e6:8.1f} MB")
    if not yes:
        print("這次只列出來（沒有刪）。確定要刪：加 --yes 再跑一次。")
        return 0
    n = remote.delete_assets([o[0] for o in drop])
    print(f"已刪除 {n} 個（{sum(o[1] for o in drop) / 1e6:.1f} MB）。")
    return usage(cfg, url, remote)
