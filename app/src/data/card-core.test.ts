// 執行：cd app && node --experimental-strip-types --test src/data/card-core.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { aiAfterEdit, cardFaces, cleanFields, clozeNumbers, clozeSide, interleave, maskChinese, mdToAnkiHtml, parseTsv, pickCards, splitNote, stripSounds, toTsv, vocabMd, vocabSounds } from "./card-core.ts";
import type { SrsState } from "./types.ts";

test("克漏字：遮第 n 個（膠帶，第 5B 階段），其他照常顯示（淺藍底）", () => {
  const md = "The {{c2:: nucleoid }} region is found in {{c1::prokaryotes::eu or pro?}}";
  assert.deepEqual(clozeNumbers(md), [1, 2]);
  assert.equal(clozeSide(md, 1, "front"), 'The <span class="cloze-o"> nucleoid </span> region is found in <span class="cloze-tape tape-blue" role="img" aria-label="空格（提示：eu or pro?）" data-hint="eu or pro?">prokaryotes</span>');
  assert.equal(clozeSide(md, 2, "front", 2), 'The <span class="cloze-tape tape-red" role="img" aria-label="空格"> nucleoid </span> region is found in <span class="cloze-o">prokaryotes</span>');
  assert.equal(clozeSide(md, 1, "back"), 'The <span class="cloze-o"> nucleoid </span> region is found in <span class="cloze-a">prokaryotes</span>');
});

test("克漏字在公式裡：改用 KaTeX 寫法", () => {
  const md = "角位移 $\\theta = {{c1::\\omega_0 t + \\frac{1}{2} \\alpha t^2 }}$";
  assert.equal(clozeSide(md, 1, "front"), "角位移 $\\theta = \\boxed{\\text{?}}$");
  assert.equal(clozeSide(md, 1, "back"), "角位移 $\\theta = {\\color{#2f6fde}\\omega_0 t + \\frac{1}{2} \\alpha t^2 }$");
  const two = "${{c1::\\ln(x^{r})}}={{c2::r\\ln(x)}}$";
  assert.equal(clozeSide(two, 2, "front"), "$\\ln(x^{r})=\\boxed{\\text{?}}$");
  // 公式在答案裡（$ 在克漏字裡面）：照一般文字遮
  assert.equal(clozeSide("h = {{c1::$6.6$}}", 1, "front", 1), 'h = <span class="cloze-tape tape-orange" role="img" aria-label="空格">$6.6$</span>');
});

test("cardFaces：克漏字的 ord 決定遮哪一個", () => {
  const f = cardFaces({ kind: "cloze", front_md: "{{c1::a}} {{c2::b}}", back_md: "x", origin: { from: "anki", ord: 1 } });
  assert.equal(f.front, '<span class="cloze-o">a</span> <span class="cloze-tape tape-blue" role="img" aria-label="空格">b</span>');
  assert.equal(f.reveal, '<span class="cloze-o">a</span> <span class="cloze-a">b</span>');
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

// ---------- 單字卡（第 8B-1 階段） ----------

const SND = "m/" + "a".repeat(64) + ".mp3";

test("單字卡：front_md 只有單字，back_md 照樣板順序、空格不出現、格式與 pmq anki import 相同", () => {
  const f = cleanFields({ Word: "abate ", "Part of Speech": "v.", "Meaning and Definition": "減輕；減少", Sentence: "abate a tax\n減稅", "Memo & Confusable": "【辨別】bash 打", Derivative: "rebate", Antonyms: "  ", Image: `[sound:${SND}]` });
  assert.equal(f.Antonyms, undefined);
  const md = vocabMd(f);
  assert.equal(md.front_md, "abate");
  assert.equal(md.back_md, `v.\n\n減輕；減少\n\n<div class="card-label">例句</div>\n\nabate a tax\n減稅\n\n<div class="card-label">衍生字</div>\n\nrebate\n\n<div class="card-label">辨析</div>\n\n【辨別】bash 打\n\n[sound:${SND}]`);
  const faces = cardFaces({ kind: "vocab", front_md: "舊的", back_md: "舊的", origin: null, fields: f });
  assert.equal(faces.front, "abate");
  assert.ok(faces.back.includes("[sound:"), "翻面時自動播放要找得到聲音");
  assert.deepEqual(splitNote("vocab", "abate", md.back_md).length, 1);
});

test("單字卡：例句裡的中文包上遮罩，公式與聲音不動", () => {
  assert.equal(maskChinese("The medicine abated her pain\n這種藥減輕了她的痛苦."), 'The medicine abated her pain\n<span class="spoiler">這種藥減輕了她的痛苦</span>.');
  assert.equal(maskChinese("$x$ 中文 <u>底線</u>"), '$x$ <span class="spoiler">中文</span> <u><span class="spoiler">底線</span></u>');
  assert.equal(maskChinese("only English"), "only English");
  assert.equal(maskChinese(`[sound:${SND}]`), `[sound:${SND}]`);
});

test("單字卡：聲音從欄位裡找、內文拿掉聲音", () => {
  const f = { Word: "x", Image: `[sound:${SND}]` };
  assert.deepEqual(vocabSounds(f), ["/" + SND]);
  assert.equal(stripSounds(f.Image), "");
});

test("AI 產生的單字卡：改過的欄位拿掉 AI 標示，沒改的留著（8B-3）", () => {
  const card = {
    fields: { Word: "inundate", "Part of Speech": "v.", "Meaning and Definition": "淹沒", Sentence: "The village was **inundated**." },
    origin: { from: "ai" as const, batch: "V001", ai: ["Part of Speech", "Meaning and Definition", "Sentence"] },
  };
  const edited = aiAfterEdit(card, { ...card.fields, "Meaning and Definition": "淹沒；使應接不暇" });
  assert.deepEqual(edited?.ai, ["Part of Speech", "Sentence"]);
  assert.equal(edited?.batch, "V001");
  // 只改標籤、欄位沒動：標示都還在
  assert.deepEqual(aiAfterEdit(card, { ...card.fields })?.ai, card.origin.ai);
  // 清空一格也算改過
  const { Sentence: _, ...noSentence } = card.fields;
  assert.deepEqual(aiAfterEdit(card, noSentence)?.ai, ["Part of Speech", "Meaning and Definition"]);
  // 不是 AI 的卡：origin 原樣
  const anki = { fields: card.fields, origin: { from: "anki" as const, deck: "x" } };
  assert.equal(aiAfterEdit(anki, {}), anki.origin);
});
