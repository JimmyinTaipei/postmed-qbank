"""pmq — 後醫題庫網的 Mac 端指令。

第 0 階段：check、check math、check answers、sample。
第 1B 階段：publish、usage、backup pull、restore、auth hash。
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
    sub.add_parser("sample", help="產生介面開發用樣本到 app/fixtures/")
    pub = sub.add_parser("publish", help="驗證後上傳有變動的內容包與圖，最後換 manifest")
    pub.add_argument("--subject", help="只發佈這一科（例如 PHY）；其他科沿用線上版本")
    pub.add_argument("--dry-run", action="store_true", help="只列出要上傳什麼，不上傳")
    pub.add_argument("--url", help="網站網址（預設讀 pmq.toml 的 [site] url）")
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
        c, result = run_check(cfg, with_math=not args.no_math, answers_file=answers_file)
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
    if args.cmd == "sample":
        from .sample import make_sample
        make_sample(cfg)
        return 0
    url = getattr(args, "url", None) or cfg.site_url
    if args.cmd == "publish":
        from .publish import publish
        return publish(cfg, url, subject=args.subject, dry_run=args.dry_run)
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
        return hash_main()


if __name__ == "__main__":
    sys.exit(main())
