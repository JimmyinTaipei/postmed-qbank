// 克漏字（第 5B 階段，規格書 §9.8）的純函式：不碰資料庫、不碰畫面。cloze.ts 與測試用。
// 執行測試：cd app && node --experimental-strip-types --test src/data/cloze-core.test.ts
//
// 原文上的位置用「看得到的字」記（和螢光相同：quote＋前後文）。卡片要的是原始 Markdown，
// 所以這裡把 Markdown 轉成「看得到的字」並記下每個字在 Markdown 的位置，兩邊才對得起來。
// 公式在兩邊都當成一個字 MATH（畫面上是 KaTeX，原文是 $…$），選到公式的一部分 = 選到整個公式。

import { mathRanges } from "../../../schema/ts/options.ts";

/** 公式在「看得到的字」裡的代表字元 */
export const MATH = "";

// ---------- 膠帶顏色：答錯幾次 ----------

export type TapeLevel = 0 | 1 | 2;
export const TAPE_CLASS: Record<TapeLevel, string> = { 0: "tape-blue", 1: "tape-orange", 2: "tape-red" };
export const TAPE_NAME: Record<TapeLevel, string> = { 0: "藍", 1: "橘", 2: "紅" };

/**
 * 這張卡答錯過幾次（膠帶顏色）：卡片複習時按「重來」一次升一級（藍 → 橘 → 紅）；
 * 之後在不同的兩天連續答對，降一級（和錯題本的離開規則相同）。同一天答對很多次只算一天。
 * dayOf：把時間換成「哪一天」（台北時間的 0 點）。
 */
export function tapeLevel(logs: { rating: number; reviewed_at: number }[], dayOf: (t: number) => number): TapeLevel {
  let level = 0;
  let days: number[] = [];
  for (const l of [...logs].sort((a, b) => a.reviewed_at - b.reviewed_at)) {
    if (l.rating === 1) {
      level = Math.min(2, level + 1);
      days = [];
      continue;
    }
    const d = dayOf(l.reviewed_at);
    if (days.at(-1) !== d) days.push(d);
    if (days.length >= 2 && level > 0) {
      level--;
      days = [];
    }
  }
  return level as TapeLevel;
}

// ---------- Markdown ↔ 看得到的字 ----------

export interface Plain {
  /** 看得到的字（空白壓成一個空格） */
  text: string;
  /** text 第 i 個字在 Markdown 裡的起點 */
  at: number[];
  /** text 第 i 個字在 Markdown 裡的終點（不含） */
  to: number[];
}

/** 不顯示的語法：粗斜體、刪除線、螢光、行內程式碼的記號、HTML 標籤、跳脫、連結與圖的網址 */
const SKIP = /\*\*|__|~~|==|\*|`|<\/?[a-zA-Z][^>]*>|\\(?=[\\`*_{}[\]()#+\-.!|$~=<>])|!?\[|\]\([^)]*\)/y;

/** Markdown → 看得到的字（公式一個 MATH；空白壓成一個空格）。 */
export function mdPlain(md: string): Plain {
  const math = mathRanges(md);
  const text: string[] = [];
  const at: number[] = [];
  const to: number[] = [];
  const push = (ch: string, a: number, b: number) => {
    if (/\s/.test(ch)) {
      if (!text.length || text[text.length - 1] === " ") {
        if (text.length) to[to.length - 1] = b;
        return;
      }
      ch = " ";
    }
    text.push(ch);
    at.push(a);
    to.push(b);
  };
  let i = 0;
  let m = 0;
  while (i < md.length) {
    while (m < math.length && math[m][1] <= i) m++;
    if (m < math.length && math[m][0] === i) {
      push(MATH, math[m][0], math[m][1]);
      i = math[m][1];
      continue;
    }
    SKIP.lastIndex = i;
    const s = SKIP.exec(md);
    if (s) {
      i += s[0].length;
      continue;
    }
    // HTML 實體
    const ent = /^&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.exec(md.slice(i, i + 10));
    if (ent) {
      const el = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&nbsp;": " ", "&quot;": '"' }[ent[0].toLowerCase()];
      push(el ?? "?", i, i + ent[0].length);
      i += ent[0].length;
      continue;
    }
    // 表格的欄線
    if (md[i] === "|") {
      push(" ", i, i + 1);
      i++;
      continue;
    }
    push(md[i], i, i + 1);
    i++;
  }
  // 頭尾空白
  while (text.length && text[0] === " ") (text.shift(), at.shift(), to.shift());
  while (text.length && text[text.length - 1] === " ") (text.pop(), at.pop(), to.pop());
  return { text: text.join(""), at, to };
}

/** 畫面上的字 → 和 mdPlain 同一種寫法（空白壓成一個空格、頭尾去空白）。回傳新字串與每個新字對應的舊位置。 */
export function squash(s: string): { text: string; from: number[] } {
  let text = "";
  const from: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = /\s/.test(s[i]) ? " " : s[i];
    if (ch === " " && (!text.length || text.endsWith(" "))) continue;
    text += ch;
    from.push(i);
  }
  while (text.endsWith(" ")) {
    text = text.slice(0, -1);
    from.pop();
  }
  return { text, from };
}

function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * 會被切壞的範圍。whole＝裡面不能只挖一部分（公式、已有的克漏字、連結與圖）；
 * 其他（粗斜體、刪除線、HTML 成對標籤）可以只挖裡面的字，但不能切過記號。open／close 是記號的長度。
 */
export function atomicRanges(md: string): { a: number; b: number; open: number; close: number; whole: boolean }[] {
  const out = mathRanges(md).map(([a, b]) => ({ a, b, open: 0, close: 0, whole: true }));
  for (const m of md.matchAll(/\{\{c\d+::[\s\S]*?\}\}|!?\[[^\]\n]*\]\([^)\n]*\)/g)) out.push({ a: m.index, b: m.index + m[0].length, open: 0, close: 0, whole: true });
  const pairs: [RegExp, number, number][] = [
    [/\*\*[^*\n]+?\*\*/g, 2, 2],
    [/~~[^~\n]+?~~/g, 2, 2],
    [/==[^=\n]+?==/g, 2, 2],
    [/`[^`\n]+`/g, 1, 1],
    [/(?<![*\w])\*(?!\*)[^*\n]+?\*(?!\*)/g, 1, 1],
  ];
  for (const [re, o, c] of pairs) for (const m of md.matchAll(re)) out.push({ a: m.index, b: m.index + m[0].length, open: o, close: c, whole: false });
  for (const m of md.matchAll(/<(u|sup|sub|b|i|s|span|mark)\b[^>]*>[\s\S]*?<\/\1>/g)) {
    const open = m[0].indexOf(">") + 1;
    out.push({ a: m.index, b: m.index + m[0].length, open, close: m[1].length + 3, whole: false });
  }
  return out;
}

/** 把 [a, b) 擴大到不切到任何「會被切壞的範圍」。 */
export function expand(md: string, a: number, b: number): [number, number] {
  const rs = atomicRanges(md);
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of rs) {
      if (r.b <= a || b <= r.a) continue; // 沒碰到
      if (a <= r.a && r.b <= b) continue; // 整個包在裡面
      if (!r.whole && a >= r.a + r.open && b <= r.b - r.close) continue; // 只挖格式裡面的字
      const na = Math.min(a, r.a);
      const nb = Math.max(b, r.b);
      if (na !== a || nb !== b) {
        a = na;
        b = nb;
        changed = true;
      }
    }
  }
  return [a, b];
}

export interface Loc {
  quote: string;
  prefix?: string | null;
  suffix?: string | null;
}

/**
 * 在 Markdown 裡找回一處（quote 是畫面上看得到的字，公式是 MATH）。
 * 回傳 Markdown 的 [起, 訖)，已擴大到完整的公式與格式範圍；找不到回 null。
 */
export function findInMd(md: string, loc: Loc, p: Plain = mdPlain(md)): [number, number] | null {
  const q = squash(loc.quote).text;
  if (!q) return null;
  const pre = squash(loc.prefix ?? "").text;
  const suf = squash(loc.suffix ?? "").text;
  let best = -1;
  let score = -1;
  for (let i = p.text.indexOf(q); i >= 0; i = p.text.indexOf(q, i + 1)) {
    const s = commonSuffix(p.text.slice(Math.max(0, i - 40), i), pre) + commonPrefix(p.text.slice(i + q.length, i + q.length + 40), suf);
    if (s > score) {
      score = s;
      best = i;
    }
  }
  if (best < 0) return null;
  return expand(md, p.at[best], p.to[best + q.length - 1]);
}

export interface ClozeSpec extends Loc {
  n: number;
  hint?: string | null;
}

/**
 * 由原文與這一則筆記的所有克漏字產生卡片內容：每一處包成 {{cN::…}}（有提示加 ::提示）。
 * 表格只留表頭、分隔線與有挖空的那幾列。找不到的列在 missing（index）。
 */
export function buildFront(md: string, specs: ClozeSpec[]): { front: string; missing: number[] } {
  const p = mdPlain(md);
  const found: { a: number; b: number; s: ClozeSpec }[] = [];
  const missing: number[] = [];
  specs.forEach((s, k) => {
    const r = findInMd(md, s, p);
    if (!r) return missing.push(k);
    if (found.some((f) => f.a < r[1] && r[0] < f.b)) return missing.push(k); // 和別處重疊
    found.push({ a: r[0], b: r[1], s });
  });
  found.sort((x, y) => y.a - x.a);
  let out = md;
  for (const f of found) {
    const ans = out.slice(f.a, f.b);
    const hint = f.s.hint?.trim() ? `::${f.s.hint.trim().replace(/\}\}/g, "")}` : "";
    out = out.slice(0, f.a) + `{{c${f.s.n}::${ans.replace(/\}\}/g, "} }")}${hint}}}` + out.slice(f.b);
  }
  return { front: tableRows(out), missing };
}

const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** 表格：只留表頭、分隔線與有克漏字的列（規格書 §9.8「在表格裡」）。不是表格就原樣回傳。 */
export function tableRows(md: string): string {
  const lines = md.split("\n");
  if (lines.length < 3 || !lines[0].includes("|") || !TABLE_SEP.test(lines[1])) return md;
  const keep = lines.slice(2).filter((l) => /\{\{c\d+::/.test(l));
  return [lines[0], lines[1], ...keep].join("\n");
}

/** 一處克漏字落在表格的第幾列（0 起；不是表格回 -1）。同一列共用一則筆記。 */
export function tableRowOf(md: string, loc: Loc): number {
  const lines = md.split("\n");
  if (lines.length < 3 || !lines[0].includes("|") || !TABLE_SEP.test(lines[1])) return -1;
  const r = findInMd(md, loc);
  if (!r) return -1;
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    if (r[0] < pos + lines[i].length + 1) return i;
    pos += lines[i].length + 1;
  }
  return -1;
}

/** 這個字串裡最大的克漏字編號（沒有回 0）。 */
export function maxCloze(md: string): number {
  let n = 0;
  for (const m of md.matchAll(/\{\{c(\d+)::/g)) n = Math.max(n, Number(m[1]));
  return n;
}
