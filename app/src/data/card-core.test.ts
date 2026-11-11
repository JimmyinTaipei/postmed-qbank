// 執行：cd app && node --experimental-strip-types --test src/data/card-core.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { cardFaces, clozeNumbers, clozeSide, interleave, mdToAnkiHtml, parseTsv, pickCards, splitNote, toTsv } from "./card-core.ts";
import type { SrsState } from "./types.ts";

test("克漏字：遮第 n 個，其他直接顯示", () => {
  const md = "The {{c2:: nucleoid }} region is found in {{c1::prokaryotes::eu or pro?}}";
  assert.deepEqual(clozeNumbers(md), [1, 2]);
  assert.equal(clozeSide(md, 1, "front"), 'The  nucleoid  region is found in <span class="cloze">[eu or pro?]</span>');
  assert.equal(clozeSide(md, 2, "front"), 'The <span class="cloze">[⋯]</span> region is found in prokaryotes');
  assert.equal(clozeSide(md, 1, "back"), 'The  nucleoid  region is found in <span class="cloze-a">prokaryotes</span>');
});

test("克漏字在公式裡：改用 KaTeX 寫法", () => {
  const md = "角位移 $\\theta = {{c1::\\omega_0 t + \\frac{1}{2} \\alpha t^2 }}$";
  assert.equal(clozeSide(md, 1, "front"), "角位移 $\\theta = \\boxed{\\text{?}}$");
  assert.equal(clozeSide(md, 1, "back"), "角位移 $\\theta = {\\color{#2f6fde}\\omega_0 t + \\frac{1}{2} \\alpha t^2 }$");
  const two = "${{c1::\\ln(x^{r})}}={{c2::r\\ln(x)}}$";
  assert.equal(clozeSide(two, 2, "front"), "$\\ln(x^{r})=\\boxed{\\text{?}}$");
  // 公式在答案裡（$ 在克漏字裡面）：照一般文字遮
  assert.equal(clozeSide("h = {{c1::$6.6$}}", 1, "front"), 'h = <span class="cloze">[⋯]</span>');
});

test("cardFaces：克漏字的 ord 決定遮哪一個", () => {
  const f = cardFaces({ kind: "cloze", front_md: "{{c1::a}} {{c2::b}}", back_md: "x", origin: { from: "anki", ord: 1 } });
  assert.equal(f.front, 'a <span class="cloze">[⋯]</span>');
  assert.equal(f.reveal, 'a <span class="cloze-a">b</span>');
  assert.equal(f.back, "x");
});

test("splitNote：正反兩張、克漏字每個編號一張", () => {
  assert.equal(splitNote("basic", "q", "a").length, 1);
  assert.deepEqual(splitNote("reverse", "q", "a").map((c) => [c.ord, c.front_md]), [[0, "q"], [1, "a"]]);
  assert.deepEqual(splitNote("cloze", "{{c3::x}} {{c1::y}} {{c1::z}}", "").map((c) => c.ord), [0, 2]);
});

test("pickCards：上限、暫停、牌組", () => {
  const st = (id: string, state: number, due: number, extra: Partial<SrsState> = {}): SrsState => ({ item: `card:${id}`, due, stability: 1, difficulty: 5, reps: 1, lapses: 0, state, last_review: 1, suspended: 0, updated_at: due, ...extra });
  const states = [st("a", 2, 5), st("b", 2, 1), st("c", 0, 0), st("d", 0, 0, { updated_at: -1 }), st("e", 2, 1, { suspended: 1 }), st("f", 2, 200), st("g", 2, 1)];
  const deckOf = new Map([["a", "D1"], ["b", "D1"], ["c", "D1"], ["d", "D2"], ["e", "D1"], ["f", "D1"]]); // g 已刪除
  const r = pickCards({ states, deckOf, decks: null, doneToday: { reviews: 0, news: 1 }, maxReviews: 10, maxNew: 2, tomorrow: 100 });
  assert.deepEqual(r.due, ["b", "a"]);
  assert.deepEqual(r.fresh, ["d"]);
  assert.equal(r.newTotal, 2);
  const only = pickCards({ states, deckOf, decks: new Set(["D2"]), doneToday: { reviews: 0, news: 0 }, maxReviews: 10, maxNew: 20, tomorrow: 100 });
  assert.deepEqual([...only.due, ...only.fresh], ["d"]);
  assert.deepEqual(interleave(["1", "2", "3", "4"], ["n1", "n2"]), ["1", "2", "n1", "3", "4", "n2"]);
});

test("TSV：讀 Anki 的純文字匯出（引號、tab、標籤欄）", () => {
  const t = '#separator:tab\n#html:true\n#tags column:3\nabash\t"使害羞<br>""尷尬"""\tGRE vocab\n\n"多\n行"\tb\t\n';
  const r = parseTsv(t);
  assert.equal(r.html, true);
  assert.deepEqual(r.rows, [
    { front: "abash", back: '使害羞<br>"尷尬"', tags: ["GRE", "vocab"] },
    { front: "多\n行", back: "b", tags: [] },
  ]);
  const back = parseTsv(toTsv([{ front: "a\tb", back: "**粗** $x^2$", tags: ["t1"] }]));
  assert.deepEqual(back.rows, [{ front: "a\tb", back: "<b>粗</b> \\(x^2\\)", tags: ["t1"] }]);
});

test("mdToAnkiHtml：圖、聲音、公式", () => {
  const sha = "a".repeat(64);
  assert.equal(mdToAnkiHtml(`![](m/${sha}.png)\n[sound:m/${sha}.mp3] $$E$$ a\\_b`), `<img src="${sha}.png"><br>[sound:${sha}.mp3] \\[E\\] a_b`);
});
