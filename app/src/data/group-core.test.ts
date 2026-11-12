// 執行：cd app && node --experimental-strip-types --test src/data/group-core.test.ts
// 第 8A 階段：題組整組出、同一組排在一起、切頁。

import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterItems, expandUnits, pageAt, pageLabel, pagesOf, takeUnits } from "./group-core.ts";

const rows = [
  { id: "a1" },
  { id: "g3", gid: "G", go: 43 },
  { id: "g1", gid: "G", go: 41 },
  { id: "g2", gid: "G", go: 42 },
  { id: "a2" },
  { id: "h1", gid: "H", go: 1 },
  { id: "h2", gid: "H", go: 2 },
  { id: "solo", gid: "S", go: 1 }, // 只有一題的組：當單題
];

test("篩到題組裡任何一小題 → 整組出，組內照題號", () => {
  const picked = [rows[0], rows[3], rows[4]]; // a1、g2、a2
  assert.deepEqual(expandUnits(picked, rows), [["a1"], ["g1", "g2", "g3"], ["a2"]]);
});

test("題數照小題算；最後一組不拆", () => {
  const units = expandUnits(rows, rows);
  assert.deepEqual(takeUnits(units, 2), ["a1", "g1", "g2", "g3"]);
  assert.deepEqual(takeUnits(units, 1), ["a1"]);
  assert.equal(takeUnits(units, Infinity).length, rows.length);
});

test("沒有本文的小題不出", () => {
  assert.deepEqual(expandUnits([rows[1]], rows, new Set(["g1", "g3"])), [["g1", "g3"]]);
});

test("錯題本、複習的清單：同一組排在一起（第一次出現的位置）", () => {
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.deepEqual(clusterItems(["h2", "a1", "g3", "h1", "g1"], (id) => by.get(id)), ["h1", "h2", "a1", "g1", "g3"]);
});

test("切頁：相鄰同組一頁、題號「41–45」", () => {
  const items = ["a1", "g1", "g2", "g3", "a2"];
  const gid = new Map(rows.map((r) => [r.id, r.gid]));
  const pages = pagesOf(items, (id) => gid.get(id));
  assert.deepEqual(pages.map((p) => [p.start, p.end, p.gid]), [[0, 1, null], [1, 4, "G"], [4, 5, null]]);
  assert.equal(pageLabel(pages[1]), "2–4");
  assert.equal(pageAt(pages, 3), 1);
  assert.equal(pageAt(pages, 4), 2);
});
