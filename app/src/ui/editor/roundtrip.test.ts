// 全庫往返測試（規格書 §9.10 第 4 條；第 3B 階段完成標準）。
// 執行：scripts/editor-roundtrip.sh（先從主檔倒出內容，再跑這個檔）
//   或：cd app && PMQ_RT_CONTENT=<content.json> node --experimental-strip-types --test src/ui/editor/roundtrip.test.ts
// PMQ_RT_CARDS=<cards.json>（可省略）：卡片的 front／back（從本機 D1 讀出）。
// PMQ_RT_REPORT=<路徑>（可省略）：寫出原始碼區塊的清單。
//
// (a) 讀入後不改直接存 → 與原文逐字相同。
// (b) 強迫每個區塊都重新產生 → 排出來的 HTML 相同（讀入時自我檢查不過的區塊是原始碼區塊，原樣寫出）。
//     另外統計：落進原始碼區塊的比例（試作的門檻是 5%）。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderForCompare } from "../content/md-core.ts";
import { parseMarkdown, serializeBlock, serializeMarkdown } from "./markdown.ts";

const file = process.env.PMQ_RT_CONTENT;
const cardsFile = process.env.PMQ_RT_CARDS;

interface Item {
  where: string;
  text: string;
}

function items(): Item[] {
  const out: Item[] = [];
  if (file) {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const q of d.questions) for (const f of ["ques", "idea", "sol"]) if (typeof q[f] === "string" && q[f].trim()) out.push({ where: `${q.id}/${f}`, text: q[f] });
    type B = { bid: string; md: string; children: B[] };
    const walk = (key: string, bs: B[]) => {
      for (const b of bs) {
        if (b.md.trim()) out.push({ where: `kb:${key}#${b.bid}`, text: b.md });
        walk(key, b.children);
      }
    };
    for (const [key, doc] of Object.entries(d.kb as Record<string, { blocks: B[] }>)) walk(key, doc.blocks);
  }
  if (cardsFile) {
    const cs = JSON.parse(fs.readFileSync(cardsFile, "utf8")) as { id: string; front: string; back: string; fields?: string | null }[];
    for (const c of cs) {
      if (c.front?.trim()) out.push({ where: `card:${c.id}/front`, text: c.front });
      if (c.back?.trim()) out.push({ where: `card:${c.id}/back`, text: c.back });
      if (c.fields) for (const [k, v] of Object.entries(JSON.parse(c.fields) as Record<string, string>)) if (typeof v === "string" && v.trim()) out.push({ where: `card:${c.id}/${k}`, text: v });
    }
  }
  return out;
}

test("全庫往返", { skip: !file && !cardsFile ? "沒有指定 PMQ_RT_CONTENT／PMQ_RT_CARDS" : false }, () => {
  const all = items();
  const failA: string[] = [];
  const failB: string[] = [];
  const raw: { where: string; src: string }[] = [];
  let blocks = 0;
  let rawItems = 0;
  for (const it of all) {
    const { doc, source } = parseMarkdown(it.text);
    // (a)
    if (serializeMarkdown(doc, source) !== it.text) failA.push(it.where);
    // (b) 每個區塊都重新產生
    const fresh = source.blocks.map((b) => serializeBlock(b.node));
    const regen = [source.gaps[0].join("\n"), ...fresh].join("\n\n");
    if (renderForCompare(regen) !== renderForCompare([source.gaps[0].join("\n"), ...source.blocks.map((b) => b.src)].join("\n\n"))) failB.push(it.where);
    blocks += source.blocks.length;
    const r = source.blocks.filter((b) => b.raw);
    if (r.length) rawItems++;
    for (const b of r) raw.push({ where: it.where, src: b.src });
  }
  const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(2)}%`;
  const summary = {
    items: all.length,
    blocks,
    a_fail: failA.length,
    b_fail: failB.length,
    raw_blocks: raw.length,
    raw_block_pct: pct(raw.length, blocks),
    items_with_raw: rawItems,
    items_with_raw_pct: pct(rawItems, all.length),
  };
  console.log(JSON.stringify(summary, null, 1));
  if (process.env.PMQ_RT_REPORT) fs.writeFileSync(process.env.PMQ_RT_REPORT, JSON.stringify({ summary, failA: failA.slice(0, 200), failB: failB.slice(0, 200), raw }, null, 1));
  assert.equal(failA.length, 0, `(a) 不相同：${failA.slice(0, 10).join("、")}`);
  assert.equal(failB.length, 0, `(b) 不相同：${failB.slice(0, 10).join("、")}`);
});
