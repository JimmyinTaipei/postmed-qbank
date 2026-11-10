// Reads NDJSON {k, tex, display} on stdin; writes NDJSON {k, error} for every formula KaTeX rejects.
// Same options as the app (規格書 §6.1) except throwOnError, which we need to detect failures.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import katex from "katex";
import "katex/contrib/mhchem";

const macros = JSON.parse(readFileSync(new URL("../../schema/katex-macros.json", import.meta.url), "utf8"));
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let n = 0, bad = 0;
for await (const line of rl) {
  if (!line) continue;
  const { k, tex, display } = JSON.parse(line);
  n++;
  try {
    katex.renderToString(tex, { displayMode: !!display, throwOnError: true, strict: "ignore", trust: false, macros: { ...macros } });
  } catch (e) {
    bad++;
    process.stdout.write(JSON.stringify({ k, error: String(e.message || e).replace(/^KaTeX parse error: /, "") }) + "\n");
  }
}
process.stderr.write(`katex ${katex.version}: ${n} formulas, ${bad} failed\n`);
