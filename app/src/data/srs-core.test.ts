// 執行：cd app && node --experimental-strip-types --test src/data/srs-core.test.ts
// 第 2 階段完成標準：固定的評分序列，srs_state 與 ts-fsrs 直接計算的結果相同；重算（重播 review_log）與逐筆排程相同。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyCard, fsrs, generatorParameters, type Grade } from "ts-fsrs";
import { leavesWrongBook, ratingOf, replay, review, scheduler } from "./srs-core.ts";
import type { SrsState } from "./types.ts";

const T0 = Date.UTC(2026, 10, 11, 1, 0, 0);
const H = 3_600_000;
const D = 24 * H;

// 固定評分序列：(距離上一次的時間, 評分)
const SEQ: [number, Grade][] = [[0, 1], [1 * D, 3], [3 * D, 3], [8 * D, 2], [10 * D, 1], [1 * D, 3], [4 * D, 4], [20 * D, 3], [50 * D, 3], [2 * H, 3]];

test("逐筆排程 = ts-fsrs 直接計算（同一組參數）", () => {
  const f = scheduler(0.9);
  const ref = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: true, enable_short_term: false }));
  let ours: SrsState | null = null;
  let card = createEmptyCard(new Date(T0));
  let t = T0;
  for (const [dt, g] of SEQ) {
    t += dt;
    ours = review(ours, "q:PHY-000001", g, t, f).state;
    card = ref.next(card, new Date(t), g).card;
    assert.equal(ours.due, card.due.getTime(), `due @${new Date(t).toISOString()}`);
    assert.equal(ours.stability, card.stability);
    assert.equal(ours.difficulty, card.difficulty);
    assert.equal(ours.reps, card.reps);
    assert.equal(ours.lapses, card.lapses);
    assert.equal(ours.state, card.state);
  }
});

test("重算排程（重播 review_log，順序打亂）= 逐筆排程", () => {
  const f = scheduler(0.9);
  let cur: SrsState | null = null;
  let t = T0;
  const logs: { rating: number; reviewed_at: number }[] = [];
  for (const [dt, g] of SEQ) {
    t += dt;
    cur = review(cur, "q:X", g, t, f).state;
    logs.push({ rating: g, reviewed_at: t });
  }
  const shuffled = logs.slice().reverse();
  const re = replay("q:X", shuffled, f)!;
  assert.equal(re.due, cur!.due);
  assert.equal(re.stability, cur!.stability);
  assert.equal(re.difficulty, cur!.difficulty);
  assert.equal(re.reps, cur!.reps);
});

test("兩台裝置各自複習同一題：合併兩邊的 review_log 重算 = 依時間順序逐筆排程", () => {
  const f = scheduler(0.9);
  const a = { rating: 3, reviewed_at: T0 + 5 * D }; // iPad
  const b = { rating: 1, reviewed_at: T0 + 5 * D + 3 * H }; // Mac，較晚
  const base = { rating: 1, reviewed_at: T0 };
  const merged = replay("q:Y", [b, base, a], f)!;
  let s = review(null, "q:Y", 1, T0, f).state;
  s = review(s, "q:Y", 3, a.reviewed_at, f).state;
  s = review(s, "q:Y", 1, b.reviewed_at, f).state;
  assert.equal(merged.due, s.due);
  assert.equal(merged.last_review, b.reviewed_at);
});

test("評分對應（規格書 §5.4）", () => {
  assert.equal(ratingOf({ correct: 0, confidence: 3, elapsed_ms: 1000 }, 10000), 1);
  assert.equal(ratingOf({ correct: 1, confidence: 1, elapsed_ms: 1000 }, 10000), 2);
  assert.equal(ratingOf({ correct: 1, confidence: 2, elapsed_ms: 1000 }, 10000), 3);
  assert.equal(ratingOf({ correct: 1, confidence: 3, elapsed_ms: 4000 }, 10000), 4);
  assert.equal(ratingOf({ correct: 1, confidence: 3, elapsed_ms: 6000 }, 10000), 3);
  assert.equal(ratingOf({ correct: 1, confidence: 3, elapsed_ms: 100 }, null), 3);
});

test("錯題本離開規則：最後一次答錯後，不同日答對 2 次；猜對不算", () => {
  const w = { correct: 0 as const, confidence: 2, created_at: T0 };
  const ok = (t: number, c = 2) => ({ correct: 1 as const, confidence: c, created_at: t });
  assert.equal(leavesWrongBook([w, ok(T0 + H)]), false);
  assert.equal(leavesWrongBook([w, ok(T0 + H), ok(T0 + 2 * H)]), false); // 同一天兩次
  assert.equal(leavesWrongBook([w, ok(T0 + H), ok(T0 + D)]), true);
  assert.equal(leavesWrongBook([w, ok(T0 + D, 1), ok(T0 + 2 * D)]), false); // 猜對不算
  assert.equal(leavesWrongBook([w, ok(T0 + D), { ...w, created_at: T0 + 2 * D }, ok(T0 + 3 * D)]), false); // 中間又錯
  assert.equal(leavesWrongBook([ok(T0 + 3 * D), w, ok(T0 + D), ok(T0 + 2 * D)]), true); // 順序打亂
});
