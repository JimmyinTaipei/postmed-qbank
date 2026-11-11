// 間隔複習的純函式（規格書 §5.4）：不碰 IndexedDB，App 與測試（scripts/test-srs.mjs）共用。
//
// 演算法用 ts-fsrs。設定：
// - enable_short_term = false：題庫的「重來」排到隔天以後，不做「1 分鐘、10 分鐘後再出一次」的短期學習步驟
//   （srs_state 也沒有存 learning_steps 的欄位，規格書 §4.6）。
// - enable_fuzz = true：同一天答錯的一批題目不會全部擠在同一天到期。fuzz 的亂數種子由複習時間與卡片狀態決定，
//   所以「從 review_log 重算」與「逐筆排程」結果相同（測試有驗）。

import { createEmptyCard, fsrs, generatorParameters, type Card, type FSRS, type Grade } from "ts-fsrs";
import type { SrsConfig, SrsState } from "./types";

export const DEFAULT_SRS: SrsConfig = { retention: 0.9, maxReviews: 200, maxNew: 20 };
export const DAY_MS = 86_400_000;

const cache = new Map<number, FSRS>();
export function scheduler(retention: number): FSRS {
  let f = cache.get(retention);
  if (!f) {
    f = fsrs(generatorParameters({ request_retention: retention, enable_fuzz: true, enable_short_term: false }));
    cache.set(retention, f);
  }
  return f;
}

export function sanitizeConfig(c: Partial<SrsConfig> | null | undefined): SrsConfig {
  const n = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    retention: n(c?.retention, DEFAULT_SRS.retention, 0.7, 0.97),
    maxReviews: Math.round(n(c?.maxReviews, DEFAULT_SRS.maxReviews, 0, 9999)),
    maxNew: Math.round(n(c?.maxNew, DEFAULT_SRS.maxNew, 0, 9999)),
  };
}

export function toCard(s: SrsState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability ?? 0,
    difficulty: s.difficulty ?? 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: s.reps ?? 0,
    lapses: s.lapses ?? 0,
    state: s.state ?? 0,
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  } as Card;
}

/** 一題作答換成 FSRS 評分（規格書 §5.4）。medianMs：同題型答對時的用時中位數，沒有資料時為 null。 */
export function ratingOf(a: { correct: 0 | 1; confidence: 1 | 2 | 3; elapsed_ms: number }, medianMs: number | null): Grade {
  if (!a.correct) return 1; // Again
  if (a.confidence === 1) return 2; // 猜的 → Hard
  if (a.confidence === 3 && medianMs && a.elapsed_ms < medianMs / 2) return 4; // 很確定又快 → Easy
  return 3; // Good
}

export interface ReviewResult {
  state: SrsState;
  stateBefore: number;
  elapsedDays: number;
  scheduledDays: number;
}

/** 對一張卡（cur 為 null 時是新卡）在時間 at 評分 rating。suspended 與原本相同。 */
export function review(cur: SrsState | null, item: string, rating: Grade, at: number, f: FSRS, updatedAt = at): ReviewResult {
  const card = cur ? toCard(cur) : createEmptyCard(new Date(at));
  const r = f.next(card, new Date(at), rating);
  return {
    state: {
      item,
      due: r.card.due.getTime(),
      stability: r.card.stability,
      difficulty: r.card.difficulty,
      reps: r.card.reps,
      lapses: r.card.lapses,
      state: r.card.state,
      last_review: at,
      suspended: cur?.suspended ?? 0,
      updated_at: updatedAt,
    },
    stateBefore: card.state,
    elapsedDays: cur?.last_review ? Math.max(0, (at - cur.last_review) / DAY_MS) : 0,
    scheduledDays: r.card.scheduled_days,
  };
}

/** 從評分紀錄重算一張卡的排程（同一題的 review_log，任意順序）。沒有紀錄回 null。 */
export function replay(item: string, logs: { rating: number; reviewed_at: number }[], f: FSRS): SrsState | null {
  const list = logs.slice().sort((a, b) => a.reviewed_at - b.reviewed_at);
  let cur: SrsState | null = null;
  for (const l of list) cur = review(cur, item, l.rating as Grade, l.reviewed_at, f).state;
  return cur;
}

/** 本機時區的日期字串（「不同日」的判斷用）。 */
export function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function startOfDay(t = Date.now()): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 錯題本的離開規則（規格書 §5.3）：最後一次答錯之後，在「不同日」答對（不含猜對）達 2 天。
 * attempts 是同一題的作答，任意順序。
 */
export function leavesWrongBook(attempts: { correct: 0 | 1; confidence: number; created_at: number }[]): boolean {
  const list = attempts.slice().sort((a, b) => a.created_at - b.created_at);
  const days = new Set<string>();
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (!a.correct) break;
    if (a.confidence !== 1) days.add(localDay(a.created_at));
  }
  return days.size >= 2;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
