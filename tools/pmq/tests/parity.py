"""全庫一致性：把每一題的 ques 交給 Python 與 TypeScript 解析器，結果必須完全相同。
用法：bin/pmq 的環境下 `python tools/pmq/tests/parity.py`。不寫任何檔案（資料經 stdin 傳給 node）。"""
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pmq.build import Contract  # noqa: E402
from pmq.config import Config  # noqa: E402
from pmq.textutil import parse_options, math_ranges  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
JS = """
import { parseOptions, mathRanges } from "%s";
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of rl) { if (!line) continue; const { id, s } = JSON.parse(line);
  process.stdout.write(JSON.stringify({ id, o: parseOptions(s), m: mathRanges(s) }) + "\\n"); }
""" % (ROOT / "schema/ts/options.ts").as_uri()

c = Contract(Config()).run()
texts = [(q["id"] + "/" + f, q[f]) for q in c.questions for f in ("ques", "sol")]
payload = "".join(json.dumps({"id": i, "s": s}, ensure_ascii=False) + "\n" for i, s in texts)
out = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", JS],
                     input=payload, capture_output=True, text=True, check=True).stdout.splitlines()
ts = {r["id"]: r for r in map(json.loads, out)}
diff = 0
for i, s in texts:
    py_o = parse_options(s)
    u = __import__("pmq.textutil", fromlist=["utf16_map"]).utf16_map(s)
    py_m = [[u(a), u(b), d] for a, b, d in math_ranges(s)]
    if py_o != ts[i]["o"] or py_m != ts[i]["m"]:
        diff += 1
        if diff <= 5:
            print("DIFF", i)
print(f"{len(texts)} 段文字（ques＋sol），Python 與 TypeScript 不一致 {diff} 段")
sys.exit(1 if diff else 0)
