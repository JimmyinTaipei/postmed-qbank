// 卡片的純函式（不碰資料庫）：克漏字遮蓋、新增卡片時拆成幾張、今日卡片的挑選、TSV 匯入匯出。
// cards.ts 用；node 測試直接 import 這個檔。
// 執行測試：cd app && node --experimental-strip-types --test src/data/card-core.test.ts

import { mathRanges } from "../../../schema/ts/options.ts";
import type { Card, CardKind, SrsState } from "./types.ts";

// ---------- 克漏字 ----------

/** {{c1::答案}} 或 {{c1::答案::提示}}；答案到第一個「}}」為止（與 Anki 相同）。 */
const CLOZE = /\{\{c(\d+)::((?:(?!\}\}|::)[\s\S])*)(?:::((?:(?!\}\})[\s\S])*))?\}\}/g;

export function clozeNumbers(md: string): number[] {
  const out = new Set<number>();
  for (const m of md.matchAll(CLOZE)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

const texText = (s: string) => s.replace(/[\\{}$&#%_^~]/g, (c) => (c === "\\" ? "\\backslash " : `\\${c}`));

/**
 * 克漏字卡的一面。n：要遮的編號（ord + 1）。
 * - 正面：第 n 個換成 [提示] 或 [⋯]，其他編號直接顯示答案。
 * - 背面：第 n 個的答案上色標出。
 * 在公式（$…$）裡的克漏字改用 KaTeX 的寫法，公式才排得出來。
 */
export function clozeSide(md: string, n: number, side: "front" | "back"): string {
  const ranges = mathRanges(md);
  const inMath = (pos: number) => ranges.some(([a, b]) => a < pos && pos < b);
  return md.replace(CLOZE, (_all, num: string, ans: string, hint: string | undefined, pos: number) => {
    if (Number(num) !== n) return ans;
    if (inMath(pos)) {
      if (side === "back") return `{\\color{#2f6fde}${ans}}`;
      return `\\boxed{\\text{${hint ? texText(hint) : "?"}}}`;
    }
    if (side === "back") return `<span class="cloze-a">${ans}</span>`;
    return `<span class="cloze">[${hint ? hint : "⋯"}]</span>`;
  });
}

/** 一張卡顯示用的正面與背面（背面＝翻面後正面下方多出來的部分）。 */
export function cardFaces(c: Pick<Card, "kind" | "front_md" | "back_md" | "origin">): { front: string; reveal: string; back: string } {
  if (c.kind === "cloze") {
    const n = (c.origin?.ord ?? 0) + 1;
    return { front: clozeSide(c.front_md, n, "front"), reveal: clozeSide(c.front_md, n, "back"), back: c.back_md };
  }
  return { front: c.front_md, reveal: c.front_md, back: c.back_md };
}

/** 一則筆記（使用者在編輯器裡寫的正面／背面）要拆成哪幾張卡。 */
export function splitNote(kind: CardKind, front: string, back: string): { ord: number; front_md: string; back_md: string }[] {
  if (kind === "reverse") return [{ ord: 0, front_md: front, back_md: back }, { ord: 1, front_md: back, back_md: front }];
  if (kind === "cloze") return clozeNumbers(front).map((n) => ({ ord: n - 1, front_md: front, back_md: back }));
  return [{ ord: 0, front_md: front, back_md: back }];
}

/** 同一則筆記的卡片共用的鍵（Anki 的 guid、網站的 note ID）；單張卡用自己的 ID。 */
export const noteKey = (c: Pick<Card, "id" | "origin">) => c.origin?.guid ?? c.origin?.note ?? c.id;

// ---------- 今日卡片 ----------

export interface CardQueueInput {
  states: SrsState[]; // card:… 的排程
  /** 卡片 ID → 牌組 ID（已刪除的卡不在裡面） */
  deckOf: Map<string, string>;
  /** 只出這些牌組（含子牌組）；null＝全部 */
  decks: Set<string> | null;
  doneToday: { reviews: number; news: number };
  maxReviews: number;
  maxNew: number;
  tomorrow: number;
}

export function pickCards(i: CardQueueInput): { due: string[]; fresh: string[]; dueTotal: number; newTotal: number } {
  const ok = (s: SrsState) => {
    if (s.suspended) return false;
    const deck = i.deckOf.get(s.item.slice(5));
    return deck !== undefined && (!i.decks || i.decks.has(deck));
  };
  const live = i.states.filter(ok);
  const due = live.filter((s) => s.state !== 0 && s.due < i.tomorrow).sort((a, b) => a.due - b.due);
  const fresh = live.filter((s) => s.state === 0).sort((a, b) => a.updated_at - b.updated_at);
  return {
    due: due.slice(0, Math.max(0, i.maxReviews - i.doneToday.reviews)).map((s) => s.item.slice(5)),
    fresh: fresh.slice(0, Math.max(0, i.maxNew - i.doneToday.news)).map((s) => s.item.slice(5)),
    dueTotal: due.length,
    newTotal: fresh.length,
  };
}

/** 新卡與複習卡交錯出（Anki 的預設：每幾張複習夾一張新卡）。 */
export function interleave(due: string[], fresh: string[]): string[] {
  if (!fresh.length) return due;
  if (!due.length) return fresh;
  const every = Math.max(1, Math.floor(due.length / fresh.length));
  const out: string[] = [];
  let f = 0;
  due.forEach((d, i) => {
    out.push(d);
    if ((i + 1) % every === 0 && f < fresh.length) out.push(fresh[f++]);
  });
  return out.concat(fresh.slice(f));
}

/** 間隔顯示：「10 分」「3 天」「2.5 個月」。 */
export function formatIvl(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return `${Math.max(1, Math.round(min))} 分`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} 小時`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} 天`;
  if (d < 365) return `${Math.round((d / 30) * 10) / 10} 個月`;
  return `${Math.round((d / 365) * 10) / 10} 年`;
}

// ---------- TSV（Anki「純文字的筆記」格式） ----------

export interface TsvRow {
  front: string;
  back: string;
  tags: string[];
}

/** Anki 匯出的純文字：# 開頭的是設定行；欄位用 tab 分隔；含 tab、換行、雙引號的欄位用雙引號包起來。 */
export function parseTsv(text: string): { rows: TsvRow[]; html: boolean } {
  let html = true;
  let sep = "\t";
  let tagsCol = -1;
  const rows: TsvRow[] = [];
  const lines: string[][] = [];
  let i = 0;
  const s = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  while (i < s.length) {
    if (s[i] === "#" && (i === 0 || s[i - 1] === "\n")) {
      const end = s.indexOf("\n", i);
      const line = s.slice(i + 1, end < 0 ? s.length : end);
      const [k, v] = line.split(":").map((x) => x.trim());
      if (k === "html") html = v === "true";
      if (k === "separator") sep = v === "tab" ? "\t" : v === "comma" ? "," : v === "semicolon" ? ";" : v === "pipe" ? "|" : v === "space" ? " " : v || "\t";
      if (k === "tags column") tagsCol = Number(v) - 1;
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    const fields: string[] = [];
    let cur = "";
    let quoted = false;
    for (;;) {
      if (i >= s.length) {
        fields.push(cur);
        break;
      }
      const ch = s[i];
      if (quoted) {
        if (ch === '"' && s[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else if (ch === '"') {
          quoted = false;
          i++;
        } else {
          cur += ch;
          i++;
        }
      } else if (ch === '"' && cur === "") {
        quoted = true;
        i++;
      } else if (ch === sep) {
        fields.push(cur);
        cur = "";
        i++;
      } else if (ch === "\n") {
        fields.push(cur);
        i++;
        break;
      } else {
        cur += ch;
        i++;
      }
    }
    if (fields.some((f) => f.trim())) lines.push(fields);
  }
  for (const f of lines) {
    const tags = tagsCol >= 0 ? (f[tagsCol] ?? "").split(/\s+/).filter(Boolean) : f.length >= 3 ? (f[2] ?? "").split(/\s+/).filter(Boolean) : [];
    const rest = tagsCol >= 0 ? f.filter((_, k) => k !== tagsCol) : f;
    rows.push({ front: rest[0] ?? "", back: rest[1] ?? "", tags });
  }
  return { rows, html };
}

const tsvField = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** 匯出給 Anki：欄位是 HTML（公式改回 Anki 的 \( \)、\[ \]）。 */
export function toTsv(cards: { front: string; back: string; tags: string[] | null }[]): string {
  const head = "#separator:tab\n#html:true\n#tags column:3\n";
  return head + cards.map((c) => [mdToAnkiHtml(c.front), mdToAnkiHtml(c.back), (c.tags ?? []).join(" ")].map(tsvField).join("\t")).join("\n") + "\n";
}

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 很簡單的 Markdown → Anki HTML：粗斜體、換行、公式、圖與聲音（檔名是網站上的雜湊檔名）。其他照原文。 */
export function mdToAnkiHtml(md: string): string {
  const ranges = mathRanges(md);
  let out = "";
  let last = 0;
  const inline = (t: string) =>
    escHtml(t)
      .replace(/&lt;(\/?(?:u|sub|sup|s|span|div|b|i|br|table|tr|td|th)\b[^&]*?)&gt;/g, "<$1>") // 原本就是 HTML 的標籤
      .replace(/!\[[^\]]*\]\(m\/([0-9a-f]{64}\.[a-z0-9]+)\)/g, '<img src="$1">')
      .replace(/\[sound:m\/([0-9a-f]{64}\.[a-z0-9]+)\]/g, "[sound:$1]")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*\\])\*([^*\n]+)\*/g, "$1<i>$2</i>")
      .replace(/\\([*_`$#>\\])/g, "$1")
      .replace(/\n/g, "<br>");
  for (const [a, b, display] of ranges) {
    out += inline(md.slice(last, a));
    const tex = display ? md.slice(a + 2, b - 2) : md.slice(a + 1, b - 1);
    out += display ? `\\[${escHtml(tex)}\\]` : `\\(${escHtml(tex)}\\)`;
    last = b;
  }
  return out + inline(md.slice(last));
}
