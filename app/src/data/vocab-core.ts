// 查單字的純函式（第 8B-2 階段）。vocab.ts 用；node 測試直接 import 這個檔。

import { DAY_MS, startOfDay, toCard } from "./srs-core.ts";
import type { Card, SrsState, VocabIndex } from "./types.ts";

/** 選字框出現「查單字」的上限：四個字以內 */
const MAX_WORDS = 4;

/** 選到的字是不是可以查的英文字或片語（英文字母、連字號、撇號、空白；四個字以內）。 */
export function lookupable(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 60) return false;
  if (!/^[A-Za-z][A-Za-z'’\- ]*[A-Za-z]$|^[A-Za-z]$/.test(t)) return false;
  return t.split(/\s+/).length <= MAX_WORDS;
}

/** 字形 → 原形候選（最可能的在前）。片語：每個字各自還原後接起來。 */
export function lemmasOf(ix: VocabIndex | null, text: string): string[] {
  const words = text.trim().toLowerCase().replace(/’/g, "'").replace(/'s$/, "").split(/\s+/);
  if (words.length > 1) {
    const one = words.map((w) => ix?.forms[w]?.[0] ?? w).join(" ");
    const raw = words.join(" ");
    return one === raw ? [raw] : [one, raw];
  }
  const w = words[0];
  const f = ix?.forms[w];
  return f ? [...f, ...(f.includes(w) ? [] : [w])] : [w];
}

/** 卡片的 Word 欄位 → 比對用的小寫字（去掉 HTML、Markdown 記號、聲音）。 */
export function wordKey(md: string | undefined): string {
  return (md ?? "")
    .replace(/\[sound:[^\]]*\]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[*_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ---------- 狀態 ----------

export type VocabStatus = "none" | "new" | "learning" | "known" | "lapsed" | "suspended" | "review";

export const STATUS_NAME: Record<VocabStatus, string> = {
  none: "沒有卡片",
  new: "還沒背",
  learning: "學習中",
  review: "複習中",
  known: "已熟",
  lapsed: "常錯",
  suspended: "暫停",
};

/** 一張卡的狀態。常錯＝忘記 2 次以上；已熟＝穩定度 21 天以上。 */
export function statusOf(s: SrsState | undefined): VocabStatus {
  if (!s) return "new";
  if (s.suspended) return "suspended";
  if (s.lapses >= 2) return "lapsed";
  if (s.state === 0) return "new";
  if (s.state === 1 || s.state === 3) return "learning";
  return toCard(s).stability >= 21 ? "known" : "review";
}

/** 註記卡上的一行說明：「還沒背」「下次複習 11/20」「暫停」… */
export function statusLine(s: SrsState | undefined): string {
  const st = statusOf(s);
  if (!s || st === "new") return "還沒背";
  if (st === "suspended") return "暫停";
  const days = Math.round((s.due - startOfDay()) / DAY_MS);
  const when = days <= 0 ? "今天要複習" : `下次複習 ${new Date(s.due).getMonth() + 1}/${new Date(s.due).getDate()}`;
  return `${st === "lapsed" ? `常錯（忘記 ${s.lapses} 次）・` : st === "learning" ? "學習中・" : ""}${when}`;
}

// ---------- 句子 ----------

/**
 * 文字裡 [s, e) 所在的那一句（給新卡的 Sentence）。句尾＝. ! ? 。！？ 後面接空白、引號或大寫字母（段落在畫面文字裡
 * 是直接接在一起的，例如「…end.Next」）；段落裡的換行只是排版，不算句尾。
 */
export function sentenceAt(text: string, s: number, e: number): string {
  const end = (i: number) => /[.!?。！？]/.test(text[i]) && (i + 1 >= text.length || /[\s"'”’A-Z]/.test(text[i + 1]) || /[。！？]/.test(text[i]));
  let a = s;
  while (a > 0 && !end(a - 1)) a--;
  let b = e;
  while (b < text.length && !end(b)) b++;
  if (b < text.length) b++;
  return text.slice(a, b).replace(/\s+/g, " ").trim();
}

/** 句子裡把那個字標粗（**word**）。 */
export function boldIn(sentence: string, word: string): string {
  const i = sentence.toLowerCase().indexOf(word.toLowerCase());
  return i < 0 ? sentence : `${sentence.slice(0, i)}**${sentence.slice(i, i + word.length)}**${sentence.slice(i + word.length)}`;
}

// ---------- 出現位置 ----------

export const WHERE_NAME: Record<string, string> = { s: "題幹", o: "選項", a: "答案", g: "文章" };

/** "ENG-000058o" → ["ENG-000058", "o"] */
export const splitAt = (at: string): [string, string] => [at.slice(0, -1), at.slice(-1)];

export interface VocabRow {
  lemma: string;
  papers: number;
  questions: number;
  options: number;
  answers: number;
  /** 常考度：當答案、當選項的權重最高（字彙題的選項是最直接的「常考」證據） */
  score: number;
  card: Card | null;
  status: VocabStatus;
  /** 查過幾次 */
  looked: number;
  /** 答錯過：卡片忘記過，或答錯的題目裡它是選項／答案 */
  wrong: boolean;
}

export const scoreOf = (p: number, q: number, o: number, a: number) => p * 3 + a * 4 + o * 2 + q;

/** 規格書 §9.11：「常考而我不會」＝出現在 2 份以上考卷，而且（沒有卡片、還沒背、答錯過、或查過）。 */
export const isWeakCommon = (r: VocabRow) => r.papers >= 2 && (!r.card || r.status === "new" || r.wrong || r.looked > 0);

