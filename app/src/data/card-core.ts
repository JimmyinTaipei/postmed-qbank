// 卡片的純函式（不碰資料庫）：克漏字遮蓋、新增卡片時拆成幾張、今日卡片的挑選、TSV 匯入匯出。
// cards.ts 用；node 測試直接 import 這個檔。
// 執行測試：cd app && node --experimental-strip-types --test src/data/card-core.test.ts

import { mathRanges } from "../../../schema/ts/options.ts";
import { VOCAB_FIELDS, type Card, type CardFields, type CardKind, type SrsState, type VocabField } from "./types.ts";

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

// ---------- 單字卡（第 8B-1 階段，規格書 §9.11） ----------

/** 背面由上到下的順序（與使用者 Anki 樣板、pmq.toml [anki.models."0_後醫單字基本型"] 的 back 相同）。 */
export const VOCAB_BACK: VocabField[] = ["Part of Speech", "Meaning and Definition", "Sentence", "Derivative", "Memo & Confusable", "Synonyms", "Antonyms", "Prefix & Roots", "Image", "Source"];

/** 背面各塊的小標（與 pmq.toml 的 labels 相同；空字串＝不加小標）。 */
export const VOCAB_LABEL: Record<VocabField, string> = {
  Word: "",
  "Part of Speech": "",
  "Meaning and Definition": "",
  Sentence: "例句",
  Derivative: "衍生字",
  "Memo & Confusable": "辨析",
  Synonyms: "同義字",
  Antonyms: "反義字",
  "Prefix & Roots": "字根字首",
  Image: "",
  Source: "出處",
};

/** 編輯表單上每一格的名稱。 */
export const VOCAB_FORM_LABEL: Record<VocabField, string> = {
  Word: "單字",
  "Part of Speech": "詞性",
  "Meaning and Definition": "字義",
  Sentence: "例句",
  "Memo & Confusable": "辨析與易混淆",
  Derivative: "衍生字",
  Synonyms: "同義字",
  Antonyms: "反義字",
  "Prefix & Roots": "字根字首",
  Image: "圖與聲音",
  Source: "出處",
};

/** 去掉空白格、補齊順序；不認得的欄位丟掉。 */
export function cleanFields(f: CardFields | null | undefined): CardFields {
  const out: CardFields = {};
  for (const k of VOCAB_FIELDS) {
    const v = (f?.[k] ?? "").replace(/\s+$/, "");
    if (v.trim()) out[k] = v;
  }
  return out;
}

/**
 * 由欄位產生 front_md／back_md（搜尋、TSV 匯出、沒有樣板的地方用）。
 * 格式與 pmq anki import 相同：背面各塊用空行分開，第二塊以後有小標的加 <div class="card-label">。
 */
export function vocabMd(f: CardFields): { front_md: string; back_md: string } {
  const parts: string[] = [];
  for (const k of VOCAB_BACK) {
    const md = (f[k] ?? "").trim();
    if (!md) continue;
    const label = parts.length ? VOCAB_LABEL[k] : "";
    parts.push((label ? `<div class="card-label">${label}</div>\n\n` : "") + md);
  }
  return { front_md: (f.Word ?? "").trim(), back_md: parts.join("\n\n") };
}

const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]+/g;

/**
 * 例句裡的中文包上遮罩（點了才顯示），和使用者 Anki 樣板的 toggleHint 用同一組字元範圍。
 * 公式、HTML 標籤、聲音與圖的語法裡面不動。
 */
export function maskChinese(md: string): string {
  const skip: [number, number][] = mathRanges(md).map(([a, b]) => [a, b]);
  for (const m of md.matchAll(/<[^>]*>|!\[[^\]]*\]\([^)]*\)|\[sound:[^\]]*\]/g)) skip.push([m.index, m.index + m[0].length]);
  skip.sort((a, b) => a[0] - b[0]);
  let out = "";
  let last = 0;
  const wrap = (t: string) => t.replace(CJK, (s) => `<span class="spoiler">${s}</span>`);
  for (const [a, b] of skip) {
    if (a < last) continue;
    out += wrap(md.slice(last, a)) + md.slice(a, b);
    last = b;
  }
  return out + wrap(md.slice(last));
}

const SOUND_RE = /\[sound:(m\/[0-9a-f]{64}\.[a-z0-9]{2,5})\]/g;

/** 欄位裡的聲音（依出現順序；Anki 的單字卡放在 Image 那一格）。 */
export function vocabSounds(f: CardFields): string[] {
  const out: string[] = [];
  for (const k of VOCAB_FIELDS) for (const m of (f[k] ?? "").matchAll(SOUND_RE)) out.push("/" + m[1]);
  return [...new Set(out)];
}

/** 拿掉聲音語法（發音改用單字旁的喇叭鈕，不在內文裡再出現一次）。 */
export const stripSounds = (md: string) => md.replace(SOUND_RE, "").trim();

/** 一張卡顯示用的正面與背面（背面＝翻面後正面下方多出來的部分）。 */
export function cardFaces(c: Pick<Card, "kind" | "front_md" | "back_md" | "origin"> & { fields?: CardFields | null }): { front: string; reveal: string; back: string } {
  if (c.kind === "vocab" && c.fields) {
    const v = vocabMd(c.fields);
    return { front: v.front_md, reveal: v.front_md, back: v.back_md };
  }
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
  // vocab：一則筆記一張卡（與 Anki 的「0_後醫單字基本型」相同，只有一個樣板）
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
