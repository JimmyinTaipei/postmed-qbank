// TypeScript twin of tools/pmq/pmq/textutil.py (math_ranges / parse_options).
// Both are tested against schema/fixtures/options.json and must agree exactly.
// Offsets are UTF-16 code units (JavaScript string indices).
// The app (phase 1A) imports this file as-is; do not fork it.

export type MathRange = [start: number, end: number, display: boolean];
export type OptionSpan = [letter: string, start: number, end: number];
export interface ParsedOptions {
  opt: OptionSpan[];
  /** [stemEnd, tailStart]: ques.slice(0, stemEnd) is the stem, ques.slice(tailStart) is the after-options text. */
  span: [number, number];
}

const BLANK_LINE = /\n[ \t]*\n/g;
const WS = new Set([" ", "\t", "\n", "\r", "\f", "\v", " ", "　"]);
const FULLWIDTH_PUNCT = new Set(Array.from("，。、；：！？（）「」『』【】《》〈〉…—｜．・"));
const OPEN: Record<string, string> = { "(": ")", "（": "）" };
const LETTERS = "ABCDEFGH";

function findUnescaped(s: string, token: string, start: number): number {
  let i = start;
  while (i < s.length) {
    if (s[i] === "\\") { i += 2; continue; }
    if (s.startsWith(token, i)) return i;
    i += 1;
  }
  return -1;
}

function blankBetween(s: string, from: number, to: number): boolean {
  BLANK_LINE.lastIndex = from;
  const m = BLANK_LINE.exec(s);
  return m !== null && m.index + m[0].length <= to;
}

export function mathRanges(s: string): MathRange[] {
  const out: MathRange[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "$") {
      if (s.startsWith("$$", i)) {
        const j = findUnescaped(s, "$$", i + 2);
        if (j >= 0) { out.push([i, j + 2, true]); i = j + 2; continue; }
        i += 2; continue;
      }
      const j = findUnescaped(s, "$", i + 1);
      if (j >= 0 && !blankBetween(s, i + 1, j)) {
        out.push([i, j + 1, false]); i = j + 1; continue;
      }
      i += 1; continue;
    }
    i += 1;
  }
  return out;
}

function inRanges(pos: number, ranges: MathRange[]): boolean {
  for (const [a, b] of ranges) {
    if (a <= pos && pos < b) return true;
    if (a > pos) return false;
  }
  return false;
}

type Marker = [letter: string, start: number, end: number];

export function optionMarkers(s: string, ranges: MathRange[] = mathRanges(s)): Marker[] {
  const out: Marker[] = [];
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s[i];
    if (!(c in OPEN) || i + 2 >= n) continue;
    const letter = s[i + 1];
    if (!LETTERS.includes(letter) || s[i + 2] !== OPEN[c]) continue;
    if (i > 0) {
      const prev = s[i - 1];
      if (!(WS.has(prev) || FULLWIDTH_PUNCT.has(prev))) continue;
    }
    if (i + 3 < n && (s[i + 3] === ")" || s[i + 3] === "）")) continue;
    if (inRanges(i, ranges)) continue;
    out.push([letter, i, i + 3]);
  }
  return out;
}

function paragraphEnd(s: string, start: number, ranges: MathRange[]): number {
  let pos = start;
  for (;;) {
    BLANK_LINE.lastIndex = pos;
    const m = BLANK_LINE.exec(s);
    if (m === null) return s.length;
    if (inRanges(m.index, ranges)) { pos = m.index + 1; continue; }
    return m.index;
  }
}

function trim(s: string, a: number, b: number): [number, number] {
  while (a < b && WS.has(s[a])) a++;
  while (b > a && WS.has(s[b - 1])) b--;
  return [a, b];
}

function spansOf(s: string, run: Marker[], ranges: MathRange[]): OptionSpan[] {
  return run.map(([letter, , end], k) => {
    const stop = k + 1 < run.length ? run[k + 1][1] : paragraphEnd(s, end, ranges);
    const [a, b] = trim(s, end, stop);
    return [letter, a, b] as OptionSpan;
  });
}

export function parseOptions(s: string): ParsedOptions | null {
  const ranges = mathRanges(s);
  const marks = optionMarkers(s, ranges);
  const runs: Marker[][] = [];
  marks.forEach((m, i) => {
    if (m[0] !== "A") return;
    const run: Marker[] = [m];
    for (let j = i + 1; j < marks.length; j++) {
      if (LETTERS.indexOf(marks[j][0]) === LETTERS.indexOf(run[run.length - 1][0]) + 1) run.push(marks[j]);
    }
    if (run.length >= 2) runs.push(run);
  });
  if (!runs.length) return null;
  const best = Math.max(...runs.map((r) => r.length));
  const longest = runs.filter((r) => r.length === best);
  const spans = longest.map((r) => spansOf(s, r, ranges));
  const full = spans.map((sp, k) => (sp.every(([, a, b]) => b > a) ? k : -1)).filter((k) => k >= 0);
  const pick = full.length ? full[full.length - 1] : longest.length - 1;
  const run = longest[pick];
  const opt = spans[pick];
  const tail = paragraphEnd(s, run[run.length - 1][2], ranges);
  return { opt, span: [run[0][1], tail] };
}
