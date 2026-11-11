// 執行：cd app && node --experimental-strip-types --test src/data/kb-core.test.ts
// 第 4 階段：筆記修訂的疊加顯示（改區塊、插入列點、刪除、已寫回待發佈、對不到區塊）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { sha1 } from "../lib/sha1.ts";
import { applyKbPatches, kbTarget } from "./kb-core.ts";
import type { ContentPatch, KbDoc } from "./types.ts";

const doc: KbDoc = {
  doc: "d", key: "BCH/d", subject: "BCH", title: "D", file: "x.md", figs: [], refs: [],
  blocks: [
    { bid: "h00000000000", type: "heading", level: 2, md: "## 一", children: [
      { bid: "a00000000000", type: "list_item", md: "第一點", children: [
        { bid: "b00000000000", type: "list_item", md: "子點", children: [] },
      ] },
      { bid: "c00000000000", type: "list_item", md: "第二點", children: [] },
    ] },
  ],
};

let n = 0;
function patch(bid: string, field: ContentPatch["field"], value: string, extra: Partial<ContentPatch> = {}): ContentPatch {
  const base = (function find(bs = doc.blocks): string {
    for (const b of bs) {
      if (b.bid === bid) return b.md;
      const k = find(b.children);
      if (k) return k;
    }
    return "";
  })();
  n++;
  return { id: `P${n}`, target: kbTarget("BCH/d", bid), field, base_h: sha1(base), value, status: "pending", note: null, device: "t", created_at: n, updated_at: n, ...extra };
}

const flat = (d: KbDoc) => {
  const out: string[] = [];
  const walk = (bs: KbDoc["blocks"], depth: number) => bs.forEach((b) => { out.push(`${depth}:${b.md}`); walk(b.children, depth + 1); });
  walk(d.blocks, 0);
  return out;
};

test("沒有修訂：原樣", () => {
  const ov = applyKbPatches(doc, []);
  assert.equal(ov.doc, doc);
});

test("改區塊：顯示修訂內容並標待寫回；原本的內容包不變", () => {
  const ov = applyKbPatches(doc, [patch("a00000000000", "md", "第一點（改）")]);
  assert.deepEqual(flat(ov.doc), ["0:## 一", "1:第一點（改）", "2:子點", "1:第二點"]);
  assert.equal(ov.marks.get("a00000000000")![0].state, "pending");
  assert.equal(doc.blocks[0].children[0].md, "第一點");
  assert.equal(ov.base.get("a00000000000")!.md, "第一點");
});

test("插入列點：同一層接在後面、子列點放第一個", () => {
  const ov = applyKbPatches(doc, [patch("a00000000000", "insert_after", "新一"), patch("a00000000000", "insert_child", "新子"), patch("c00000000000", "insert_after", "最後")]);
  assert.deepEqual(flat(ov.doc), ["0:## 一", "1:第一點", "2:新子", "2:子點", "1:新一", "1:第二點", "1:最後"]);
  assert.equal([...ov.marks.keys()].filter((k) => k.startsWith("new-")).length, 3);
});

test("刪除：區塊仍在（淡化），標刪除", () => {
  const ov = applyKbPatches(doc, [patch("c00000000000", "delete", "1")]);
  assert.equal(flat(ov.doc).length, 4);
  assert.equal(ov.marks.get("c00000000000")![0].kind, "delete");
});

test("內容包已經變了（Mac 上改過）：不套修訂、標修訂待處理", () => {
  const p = patch("a00000000000", "md", "第一點（改）", { base_h: sha1("別的版本") });
  const ov = applyKbPatches(doc, [p]);
  assert.equal(flat(ov.doc)[1], "1:第一點");
  assert.equal(ov.marks.get("a00000000000")![0].state, "stale");
});

test("已寫回、線上已是新版：不再疊、不標記", () => {
  const p = patch("c00000000000", "md", "第二點");
  p.note = JSON.stringify({ written: "abc", wh: sha1("第二點"), wv: sha1("第二點") });
  const ov = applyKbPatches(doc, [p]);
  assert.equal(ov.marks.size, 0);
  assert.equal(ov.unanchored.length, 0);
});

test("已寫回、還沒發佈：照修訂顯示並標待發佈", () => {
  const p = patch("c00000000000", "md", "第二點（改）");
  p.note = JSON.stringify({ written: "abc", wh: sha1("第二點（改）"), wv: sha1("第二點（改）") });
  const ov = applyKbPatches(doc, [p]);
  assert.equal(flat(ov.doc)[3], "1:第二點（改）");
  assert.equal(ov.marks.get("c00000000000")![0].state, "written");
});

test("對不到區塊：放進 unanchored", () => {
  const ov = applyKbPatches(doc, [patch("zzzzzzzzzzzz", "md", "x")]);
  assert.equal(ov.unanchored.length, 1);
});

test("衝突與放棄的修訂", () => {
  const ov = applyKbPatches(doc, [patch("a00000000000", "md", "衝突版", { status: "conflict" }), patch("c00000000000", "md", "放棄版", { status: "rejected" })]);
  assert.equal(flat(ov.doc)[1], "1:第一點");
  assert.equal(ov.marks.get("a00000000000")![0].state, "conflict");
  assert.equal(flat(ov.doc)[3], "1:第二點");
});
