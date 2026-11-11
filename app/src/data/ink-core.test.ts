// 執行：cd app && node --experimental-strip-types --test src/data/ink-core.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeInk, encodeInk, roundStroke } from "./ink-core.ts";
import type { InkStroke } from "./types.ts";

/** 模擬手寫：每筆 n 點、沿著一條帶抖動的曲線，壓力隨機（像 Apple Pencil 的原始資料，小數很多位）。 */
function fakeStroke(seed: number, n: number, tool = "pen"): InkStroke {
  let x = 50 + (seed * 37) % 900;
  let y = 40 + (seed * 53) % 600;
  let a = seed;
  const pts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    a += 0.15 + Math.sin(seed + i) * 0.3;
    x += Math.cos(a) * 1.3 + Math.random() * 0.3;
    y += Math.sin(a) * 1.3 + Math.random() * 0.3;
    pts.push([x, y, 0.2 + Math.random() * 0.5]);
  }
  return { tool, color: "ink-blue", size: 3.7142857, pts };
}

test("一頁 200 筆（每筆 100 點）壓縮後 < 300 KB，解回來一樣", async () => {
  const strokes = Array.from({ length: 200 }, (_, i) => fakeStroke(i, 100));
  const s = await encodeInk({ v: 1, strokes: strokes.map(roundStroke) });
  console.log(`  200 筆 × 100 點：${(s.length / 1024).toFixed(0)} KB`);
  assert.ok(s.length < 300 * 1024, `太大：${s.length}`);
  const back = await decodeInk(s);
  assert.equal(back.strokes.length, 200);
  assert.deepEqual(back.strokes[5], roundStroke(strokes[5]));
});

test("圖上 100 筆 < 150 KB", async () => {
  const strokes = Array.from({ length: 100 }, (_, i) => fakeStroke(i, 100, i % 3 ? "pen" : "hl"));
  const s = await encodeInk({ v: 1, src: "a/abc.svg", strokes: strokes.map(roundStroke) });
  console.log(`  100 筆：${(s.length / 1024).toFixed(0)} KB`);
  assert.ok(s.length < 150 * 1024);
});

test("不認得的工具與欄位原樣保留", async () => {
  const doc = { v: 1 as const, future: 1, strokes: [{ tool: "tape", color: "tape-red", size: 1, pts: [[1, 2, 0.5]] as [number, number, number][], rect: [0, 0, 5, 5] }] };
  const back = await decodeInk(await encodeInk(doc));
  assert.deepEqual(back, doc);
});

test("壞掉的字串讀成空白，不丟例外", async () => {
  assert.deepEqual((await decodeInk("@@@不是base64")).strokes, []);
  assert.deepEqual((await decodeInk("")).strokes, []);
});
