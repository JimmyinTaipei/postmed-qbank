"""pmq — 後醫題庫網的 Mac 端指令。

第 0 階段：check、check math、check answers、sample。
第 1B 階段：publish、usage、backup pull、restore、auth hash。
第 3 階段：patches list／pull／resolve。
第 5 階段：anki inspect／import／export。
第 8B-3 階段：vocab todo／check／import（交給 Antigravity 3.8 Flash 的單字批次工作）。
"""
import argparse
import json
import sys
import time

from .config import Config


def main(argv=None):
    ap = argparse.ArgumentParser(prog="pmq")
    sub = ap.add_subparsers(dest="cmd", required=True)
    chk = sub.add_parser("check", help="讀全部主檔、轉成內容契約、驗證；只出報告")
    chk.add_argument("what", nargs="?", choices=["all", "math", "answers"], default="all")
    chk.add_argument("--no-math", action="store_true", help="略過公式檢查")
    chk.add_argument("--subject", help="只讀這一科的主檔（例如 ENG）；其他科的主檔在 iCloud 是雲端佔位時用")
    sub.add_parser("sample", help="產生介面開發用樣本到 app/fixtures/")
    pub = sub.add_parser("publish", help="驗證後上傳有變動的內容包與圖，最後換 manifest")
    pub.add_argument("--subject", help="只發佈這一科（例如 PHY）；其他科沿用線上版本")
    pub.add_argument("--dry-run", action="store_true", help="只列出要上傳什麼，不上傳")
    pub.add_argument("--url", help="網站網址（預設讀 pmq.toml 的 [site] url）")
    pa = sub.add_parser("patches", help="修訂佇列：list 看、pull 寫回主檔並 commit、resolve 處理衝突（規格書 §7.3）")
    pa.add_argument("what", choices=["list", "pull", "resolve"])
    pa.add_argument("id", nargs="?", help="resolve：修訂 ID（末 8 碼即可）")
    pa.add_argument("--all", action="store_true", help="list：連已合併、已放棄的也列")
    pa.add_argument("--dry-run", action="store_true", help="pull：只印出會怎麼改，不寫檔、不 commit、不回報")
    rg = pa.add_mutually_exclusive_group()
    rg.add_argument("--mine", action="store_true", help="resolve：用網站上的修訂蓋過主檔（下次 pull 寫回）")
    rg.add_argument("--theirs", action="store_true", help="resolve：放棄網站上的修訂，保留主檔")
    pa.add_argument("--url")
    pr = sub.add_parser("prune", help="列出（--yes 才刪）R2 上目前內容沒用到的圖，例如已經有 SVG 的物理原始 PNG")
    pr.add_argument("--yes", action="store_true", help="真的刪掉")
    pr.add_argument("--url")
    sub.add_parser("status", help="本機版（8787）與部署版並排：各有哪些題庫內容、個人資料、儲存空間（只讀）")
    us = sub.add_parser("usage", help="本專案 D1 大小與 R2 用量（規格書 §11-6）")
    us.add_argument("--url")
    bk = sub.add_parser("backup", help="pmq backup pull：下載個人資料整包")
    bk.add_argument("what", choices=["pull", "now"], help="pull＝下載整包到 backup_dir；now＝請伺服器立刻做一次每晚的 R2 備份")
    bk.add_argument("--url")
    rs = sub.add_parser("restore", help="把匯出的 zip 灌回空的資料庫")
    rs.add_argument("zip")
    g = rs.add_mutually_exclusive_group(required=True)
    g.add_argument("--sqlite", help="灌進這個本機 SQLite 檔（新檔或空檔）")
    g.add_argument("--remote", action="store_true", help="灌進線上的 D1（必須是空的）")
    rs.add_argument("--url")
    au = sub.add_parser("auth", help="pmq auth hash：把密碼轉成 Worker 的 AUTH_HASH（只印雜湊，不存密碼）")
    au.add_argument("what", choices=["hash"])
    au.add_argument("--local", action="store_true", help="本機測試版用：不限密碼長度")
    an = sub.add_parser("anki", help="pmq anki inspect：只讀檢查 Anki 匯出的 .apkg／.colpkg")
    an.add_argument("what", choices=["inspect", "import", "export"])
    an.add_argument("paths", nargs="*", help="inspect／import：.apkg／.colpkg 檔或放這些檔的資料夾；export：輸出的 .apkg 路徑")
    an.add_argument("--deck", action="append", help="import：要匯入的牌組（含子牌組，可重複）；預設讀 pmq.toml [anki] import。export：要匯出的網站牌組名稱")
    an.add_argument("--dry-run", action="store_true", help="import：只轉換、出預覽（reports/anki_import_preview.md），不上傳")
    an.add_argument("--update", action="store_true", help="import：已存在的卡片也覆寫內容（進度不動）")
    an.add_argument("--url")
    vo = sub.add_parser("vocab", help="英文單字的批次工作（交給 Flash）：todo 產生任務單、check 檢查輸出、import 建立單字卡")
    vo.add_argument("what", choices=["todo", "check", "import"])
    vo.add_argument("file", nargs="?", help="check／import：批次資料夾裡的 輸出.json")
    vo.add_argument("--kind", choices=["fields", "phrases", "senses"], default="fields",
                    help="todo：fields＝常考但沒有卡的字的欄位（預設）、phrases＝一份考卷的片語、senses＝一字多義用哪個意思")
    vo.add_argument("--limit", type=int, help="todo：每批最多幾個字（fields 預設 100、senses 預設 50）")
    vo.add_argument("--min-papers", type=int, default=2, help="todo fields：至少出現在幾份考卷（預設 2）")
    vo.add_argument("--paper", help="todo phrases：考卷代碼，例如 ENG-CMU-113")
    vo.add_argument("--phrases", help="todo fields：改排這個片語批次（P…/輸出.json）裡還沒有卡的片語")
    vo.add_argument("--include-common", action="store_true", help="todo fields：連常見字（effect、argue…）也排")
    vo.add_argument("--dry-run", action="store_true", help="import：只印出會建立什麼，不上傳")
    vo.add_argument("--url")
    args = ap.parse_args(argv)
    cfg = Config()
    cfg.reports.mkdir(parents=True, exist_ok=True)
    answers_file = cfg.project / "docs/生化答案抽查.json"

    if args.cmd == "check" and args.what == "answers":
        from .answers import spotcheck
        res = spotcheck(cfg)   # 擷取片段寫到 reports/answer_excerpts.md；判讀結果在 docs/生化答案抽查.json
        print(f"抽查 {len(res['items'])} 題：相符 {res['summary']['match']}、不符 {res['summary']['mismatch']}、無法判讀 {res['summary']['unknown']}")
        return 0
    if args.cmd == "check":
        from .check import run_check
        from .report import write_report
        c, result = run_check(cfg, with_math=not args.no_math, answers_file=answers_file, only=args.subject)
        if args.subject:
            from .report import write_subject_report
            (cfg.reports / f"check_{args.subject}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), "utf-8")
            print(write_subject_report(cfg, c, result))
            return 1 if result["errors"] else 0
        if args.what == "math":
            result = {"math": result["math"], "generated": result["generated"], "elapsed_s": result["elapsed_s"]}
            (cfg.reports / "math.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), "utf-8")
            st = result["math"]["stats"]
            print(f"公式 {st['formulas']} 個（不重複 {st['unique']}），排版失敗 {st['failed']} 處；KaTeX {st['katex']}；{result['elapsed_s']} 秒")
            return 0
        (cfg.reports / "check.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), "utf-8")
        md = write_report(cfg, c, result)
        print(md.split("\n## ", 2)[1] if "\n## " in md else md[:2000])
        print(f"報告：{cfg.reports / '驗證報告.md'}")
        return 1 if result["errors"] else 0
    if args.cmd == "anki" and args.what == "inspect":
        from .anki import run_inspect
        out = run_inspect(cfg, args.paths)
        print(f"報告：{out}")
        return 0
    if args.cmd == "anki" and args.what == "import":
        from .anki_import import run_import
        if not args.paths:
            ap.error("pmq anki import 要給 .apkg 檔或資料夾")
        run_import(cfg, args.paths, args.deck, args.dry_run, args.update, args.url or cfg.site_url)
        return 0
    if args.cmd == "anki" and args.what == "export":
        from .anki_export import run_export
        if len(args.paths) != 1:
            ap.error("pmq anki export 要給一個輸出檔路徑，例如 ~/Desktop/網站卡片.apkg")
        run_export(cfg, args.paths[0], args.deck, args.url or cfg.site_url)
        return 0
    if args.cmd == "vocab":
        from . import vocab_tasks as vt
        url = args.url or cfg.site_url
        if args.what == "todo":
            if args.kind == "phrases":
                if not args.paper:
                    ap.error("pmq vocab todo --kind phrases 要給 --paper 考卷代碼")
                vt.todo_phrases(cfg, args.paper)
            elif args.kind == "senses":
                vt.todo_senses(cfg, url, limit=args.limit or 50)
            else:
                vt.todo_fields(cfg, url, limit=args.limit or 100, min_papers=args.min_papers, phrases=args.phrases, include_common=args.include_common)
            return 0
        if not args.file:
            ap.error(f"pmq vocab {args.what} 要給批次資料夾裡的 輸出.json")
        if args.what == "check":
            return vt.run_check(args.file)
        return vt.run_import(args.file, url, dry_run=args.dry_run)
    if args.cmd == "sample":
        from .sample import make_sample
        make_sample(cfg)
        return 0
    url = getattr(args, "url", None) or cfg.site_url
    if args.cmd == "publish":
        from .publish import publish
        return publish(cfg, url, subject=args.subject, dry_run=args.dry_run)
    if args.cmd == "patches":
        from . import patches
        if args.what == "list":
            return patches.list_patches(cfg, url, show_all=args.all)
        if args.what == "pull":
            return patches.pull(cfg, url, dry_run=args.dry_run)
        if not args.id or not (args.mine or args.theirs):
            ap.error("resolve 要給修訂 ID 與 --mine 或 --theirs")
        return patches.resolve(cfg, url, args.id, mine=args.mine)
    if args.cmd == "status":
        from .status import status
        return status(cfg)
    if args.cmd == "prune":
        from .publish import prune
        return prune(cfg, url, yes=args.yes)
    if args.cmd == "usage":
        from .publish import usage
        return usage(cfg, url)
    if args.cmd == "backup":
        from .backup import backup_pull
        if args.what == "pull":
            return backup_pull(cfg, url)
        from .remote import Remote
        r = Remote(url).backup_now()
        print(f"已寫入 R2 {r['key']}：" + "、".join(f"{k} {v}" for k, v in r["counts"].items() if v))
        return 0
    if args.cmd == "restore":
        from .backup import restore_remote, restore_sqlite
        return restore_sqlite(cfg, args.zip, args.sqlite) if args.sqlite else restore_remote(cfg, args.zip, url)
    if args.cmd == "auth":
        from .authhash import main as hash_main
        return hash_main(min_len=1 if args.local else 12)


if __name__ == "__main__":
    sys.exit(main())
