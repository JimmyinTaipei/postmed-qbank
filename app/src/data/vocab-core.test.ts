// 執行：cd app && node --experimental-strip-types --test src/data/vocab-core.test.ts
// 第 8B-2 階段：查單字的原形比對、句子、狀態、「常考而我不會」；「排到今天」的出卡順序。

import { test } from "node:test";
import assert from "node:assert/strict";
import { boldIn, isWeakCommon, lemmasOf, lookupable, sentenceAt, statusOf, wordKey, type VocabRow } from "./vocab-core.ts";
import { isAskedNew, pickCards } from "./card-core.ts";
import { startOfDay } from "./srs-core.ts";
import type { SrsState, VocabIndex } from "./types.ts";

const ix: VocabIndex = {
  v: 1,
  subject: "ENG",
  papers: {},
  lemmas: { mitigate: [2, 3, 1, 1, ["ENG-000001o"]], "carry out": [1, 1, 0, 0, []] },
  forms: { mitigated: ["mitigate"], mitigating: ["mitigate"], leaves: ["leave", "leaf"], carried: ["carry"] },
};

test("原形：只查索引的字形表；認不得的字用字本身", () => {
  assert.deepEqual(lemmasOf(ix, "mitigated"), ["mitigate", "mitigated"]);
  assert.deepEqual(lemmasOf(ix, "Mitigating"), ["mitigate", "mitigating"]);
  assert.deepEqual(lemmasOf(ix, "leaves"), ["leave", "leaf", "leaves"]);
  assert.deepEqual(lemmasOf(ix, "serendipity"), ["serendipity"]);
  assert.deepEqual(lemmasOf(ix, "carried out"), ["carry out", "carried out"]);
  assert.deepEqual(lemmasOf(null, "Dogs"), ["dogs"]);
});

test("查單字只給英文字或四個字以內的片語", () => {
  assert.ok(lookupable("mitigated"));
  assert.ok(lookupable(" carry out "));
  assert.ok(lookupable("well-known"));
  assert.ok(!lookupable("one two three four five"));
  assert.ok(!lookupable("減輕"));
  assert.ok(!lookupable("$3"));
  assert.ok(!lookupable("mitigate."));
});

test("Word 欄位比對用的字：去掉 HTML、聲音、記號", () => {
  assert.equal(wordKey("<b>Mitigate</b>&nbsp;[sound:m/abc.mp3]"), "mitigate");
  assert.equal(wordKey("**carry out**"), "carry out");
});

test("新卡的 Sentence：那個字所在的那一句", () => {
  const t = "Plato wrote it down. Efforts to mitigated the damage failed! Next one.";
  const s = t.indexOf("mitigated");
  assert.equal(sentenceAt(t, s, s + 9), "Efforts to mitigated the damage failed!");
  assert.equal(boldIn("Efforts to mitigated the damage.", "mitigated"), "Efforts to **mitigated** the damage.");
  // 段落裡的換行不算句尾；小數點不斷句；段落直接接在一起（「…one.The」）也分得開
  const u = "Line one.The cost was 3.5 billion and\nrising fast. Next.";
  const k = u.indexOf("rising");
  assert.equal(sentenceAt(u, k, k + 6), "The cost was 3.5 billion and rising fast.");
});

const st = (p: Partial<SrsState>): SrsState => ({ item: "card:x", due: 0, stability: null, difficulty: null, reps: 0, lapses: 0, state: 0, last_review: null, suspended: 0, updated_at: 0, ...p });

test("狀態：暫停、常錯、還沒背、學習中", () => {
  assert.equal(statusOf(undefined), "new");
  assert.equal(statusOf(st({ suspended: 1 })), "suspended");
  assert.equal(statusOf(st({ lapses: 2, state: 2, stability: 30 })), "lapsed");
  assert.equal(statusOf(st({ state: 1, stability: 1 })), "learning");
});

test("常考而我不會：2 份以上考卷，而且沒有卡片／還沒背／答錯過／查過", () => {
  const base: VocabRow = { lemma: "x", papers: 2, questions: 2, options: 0, answers: 0, score: 0, card: null, status: "none", looked: 0, wrong: false };
  const card = { id: "c" } as VocabRow["card"];
  assert.ok(isWeakCommon(base));
  assert.ok(!isWeakCommon({ ...base, papers: 1 }));
  assert.ok(!isWeakCommon({ ...base, card, status: "known" }));
  assert.ok(isWeakCommon({ ...base, card, status: "known", looked: 1 }));
  assert.ok(isWeakCommon({ ...base, card, status: "review", wrong: true }));
  assert.ok(isWeakCommon({ ...base, card, status: "new" }));
});

test("排到今天的新卡：排在最前面、不受每日新卡上限", () => {
  const today = startOfDay(Date.UTC(2026, 10, 12, 6));
  const states = [
    st({ item: "card:a", due: today + 5000, updated_at: 1 }),
    st({ item: "card:b", due: today + 6000, updated_at: 2 }),
    st({ item: "card:z", due: today, updated_at: 99 }), // 我不會這個字
  ];
  const deckOf = new Map([["a", "d"], ["b", "d"], ["z", "d"]]);
  const r = pickCards({ states, deckOf, decks: null, doneToday: { reviews: 0, news: 1 }, maxReviews: 100, maxNew: 1, tomorrow: today + 86_400_000, asked: (s) => isAskedNew(s, startOfDay) });
  assert.deepEqual(r.fresh, ["z"]);
  const r2 = pickCards({ states, deckOf, decks: null, doneToday: { reviews: 0, news: 0 }, maxReviews: 100, maxNew: 2, tomorrow: today + 86_400_000, asked: (s) => isAskedNew(s, startOfDay) });
  assert.deepEqual(r2.fresh, ["z", "a"]);
});
