"""pmq — 後醫題庫網的 Mac 端指令（第 0 階段：check、check math、check answers、sample）。"""
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


if __name__ == "__main__":
    sys.exit(main())
