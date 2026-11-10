// 題目的判讀：是不是選擇題、怎麼切選項、怎麼判對錯（規格書 §4.5、§5.1）。純函式。

import type { Question } from "./types";

/** 可點選作答：有解析出選項，且答案是字母。否則以自評題顯示。 */
export function isChoice(q: Question): boolean {
  return !!q.opt && q.opt.length >= 2 && (q.answer.mode === "single" || q.answer.mode === "all" || q.answer.mode === "any") && q.answer.keys.length > 0;
}

/** 複選（全對才算對）。 */
export function isMulti(q: Question): boolean {
  return isChoice(q) && q.answer.mode === "all";
}

export function judge(q: Question, chosen: string[]): boolean {
  const keys = q.answer.keys;
  if (q.answer.mode === "all") return chosen.length === keys.length && chosen.every((c) => keys.includes(c));
  return chosen.length === 1 && keys.includes(chosen[0]); // single、any（多個答案皆可／送分）
}

export interface QuestionParts {
  stem: string;
  options: { letter: string; md: string }[];
  tail: string; // 選項後的補充文字或圖
}

export function splitQuestion(q: Question): QuestionParts {
  if (!q.opt || !q.opt_span) return { stem: q.ques, options: [], tail: "" };
  return {
    stem: q.ques.slice(0, q.opt_span[0]),
    options: q.opt.map(([letter, a, b]) => ({ letter, md: q.ques.slice(a, b) })),
    tail: q.ques.slice(q.opt_span[1]),
  };
}

/** 答案的文字寫法：選擇題「(C)」「(A)(D)」，非選擇題是答案原文。 */
export function answerText(q: Question): string {
  if (q.answer.keys.length) return q.answer.keys.map((k) => `(${k})`).join(q.answer.mode === "any" ? " 或 " : "");
  const t = q.answer.text?.trim();
  return t && t !== "[]" ? t : "";
}
