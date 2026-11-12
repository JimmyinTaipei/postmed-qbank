// 查單字與常考單字（第 8B-2 階段，規格書 §9.11「8B」）。
//
// - 原形：只查內容包裡的單字索引（pmq 用 lemminflect 算的字形表），瀏覽器裡不另外寫一套還原規則，兩邊才不會不一致。
//   索引裡沒有的字（例如只出現在詳解裡）就用字本身當原形。
// - 單字卡：kind = "vocab" 的卡，用 Word 欄位（去掉標記、小寫）比對原形；Word 本身是變化形時也透過字形表對到原形。
// - 查過的字、手動連到的卡記在 vocab_mark（同步）；題目上的虛線底線就是它。

import { useLiveQuery } from "dexie-react-hooks";
import { ulid } from "@/lib/ulid";
import { content } from "./content";
import { db } from "./db";
import { decks } from "./cards";
import { scoreOf, splitAt, statusOf, wordKey, type VocabRow } from "./vocab-core";
import { enqueue, kick } from "./sync";
import type { Card, SrsState, VocabIndex, VocabMark } from "./types";

export * from "./vocab-core";

const now = () => Date.now();

/** 新增的單字卡預設放這副牌（規格書 §14-15） */
export const VOCAB_DECK = ["05_English", "考古題單字"];

// ---------- 單字卡對照 ----------

export interface VocabCards {
  /** 原形（或 Word 本身）→ 單字卡 */
  byLemma: Map<string, Card[]>;
  byId: Map<string, Card>;
  states: Map<string, SrsState>;
}

let cardsCache: { stamp: string; ix: VocabIndex | null; v: VocabCards } | null = null;

async function loadVocabCards(ix: VocabIndex | null): Promise<VocabCards> {
  // 卡片表很大（英文 13,877 則）：用「筆數＋最後更新時間」判斷要不要重建
  const last = await db.card.orderBy("updated_at").last();
  const stamp = `${await db.card.count()}|${last?.updated_at ?? 0}|${last?.id ?? ""}`;
  let base = cardsCache && cardsCache.stamp === stamp && cardsCache.ix === ix ? cardsCache.v : null;
  if (!base) {
    const byLemma = new Map<string, Card[]>();
    const byId = new Map<string, Card>();
    await db.card.each((c) => {
      if (c.deleted || c.kind !== "vocab") return;
      byId.set(c.id, c);
      const w = wordKey(c.fields?.Word ?? c.front_md);
      if (!w) return;
      const keys = new Set([w, ...(ix?.forms[w]?.slice(0, 1) ?? [])]);
      for (const k of keys) {
        const l = byLemma.get(k);
        if (l) l.push(c);
        else byLemma.set(k, [c]);
      }
    });
    base = { byLemma, byId, states: new Map() };
    cardsCache = { stamp, ix, v: base };
  }
  const states = new Map<string, SrsState>();
  const ids = [...base.byId.keys()];
  const got = await db.srs_state.bulkGet(ids.map((id) => `card:${id}`));
  got.forEach((s, i) => s && states.set(ids[i], s));
  return { ...base, states };
}

/** 單字卡對照（卡片或排程有變就重算）。 */
export function useVocabCards(subject = "ENG"): VocabCards | undefined {
  return useLiveQuery(async () => {
    // 讀 srs_state 讓 Dexie 監聽到排程的變化
    await db.srs_state.where("item").startsWith("card:").count();
    const ix = await content.vocab(subject).catch(() => null);
    return loadVocabCards(ix);
  }, [subject]);
}

export function useVocabIndex(subject = "ENG"): VocabIndex | null | undefined {
  return useLiveQuery(() => content.vocab(subject).catch(() => null), [subject]);
}

/** 開了查單字的科目（內容包裡有索引的）。 */
export function useVocabSubjects(): string[] | undefined {
  return useLiveQuery(() => content.vocabSubjects().catch(() => []), []);
}

/** 把一組卡依原形找出來：先找手動連結，再找原形與字本身。 */
export function cardsFor(v: VocabCards, lemmas: string[], links: VocabMark[] = []): Card[] {
  const out: Card[] = [];
  const seen = new Set<string>();
  const push = (c: Card | undefined) => {
    if (c && !seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  };
  for (const m of links) if (m.card && lemmas.includes(m.lemma)) push(v.byId.get(m.card));
  for (const l of lemmas) for (const c of v.byLemma.get(l) ?? []) push(c);
  return out;
}

// ---------- 查過的字（vocab_mark） ----------

/** 某一段內容上查過的字（題目的虛線底線）。 */
export function useVocabMarks(target: string | undefined): VocabMark[] | undefined {
  return useLiveQuery(async () => (target ? (await db.vocab_mark.where("target").equals(target).toArray()).filter((m) => !m.deleted) : []), [target]);
}

/** 一份筆記上查過的字（target 是 "kb:<key>#<bid>"）。 */
export function useVocabMarksUnder(prefix: string | undefined): VocabMark[] | undefined {
  return useLiveQuery(async () => (prefix ? (await db.vocab_mark.where("target").startsWith(prefix).toArray()).filter((m) => !m.deleted) : []), [prefix]);
}

/** 全部查過的字與手動連結（/vocab、比對用）。 */
export function useAllVocabMarks(): VocabMark[] | undefined {
  return useLiveQuery(async () => (await db.vocab_mark.toArray()).filter((m) => !m.deleted), []);
}

async function putMark(row: VocabMark) {
  await db.transaction("rw", db.vocab_mark, db.outbox, async () => {
    await db.vocab_mark.put(row);
    await enqueue("vocab_mark", row.id);
  });
  kick();
}

export const vocabMarks = {
  /** 記一筆查詢（同一段同一個位置已經有就更新，不重複）。回傳 id。 */
  async lookup(m: Pick<VocabMark, "lemma" | "card" | "target" | "quote" | "prefix" | "suffix" | "start" | "end">): Promise<string> {
    const same = (await db.vocab_mark.where("target").equals(m.target).toArray()).find((x) => !x.deleted && x.start === m.start && x.end === m.end);
    if (same) {
      if (m.card && same.card !== m.card) await putMark({ ...same, card: m.card, updated_at: Math.max(now(), same.updated_at + 1) });
      return same.id;
    }
    const row: VocabMark = { ...m, id: ulid(), kind: "lookup", updated_at: now(), deleted: 0 };
    await putMark(row);
    return row.id;
  },
  /** 手動把這個字連到一張卡（「連到現有的卡」）。 */
  async link(id: string, card: string): Promise<void> {
    const cur = await db.vocab_mark.get(id);
    if (!cur) return;
    await putMark({ ...cur, card, kind: "link", updated_at: Math.max(now(), cur.updated_at + 1) });
  },
  async setCard(id: string, card: string | null): Promise<void> {
    const cur = await db.vocab_mark.get(id);
    if (!cur) return;
    await putMark({ ...cur, card, updated_at: Math.max(now(), cur.updated_at + 1) });
  },
  async remove(id: string): Promise<void> {
    const cur = await db.vocab_mark.get(id);
    if (!cur) return;
    await putMark({ ...cur, deleted: 1, updated_at: Math.max(now(), cur.updated_at + 1) });
  },
};

// ---------- 新卡放的牌組 ----------

/** 找（或建立）「05_English::考古題單字」，回傳牌組 ID。 */
export async function vocabDeck(path = VOCAB_DECK): Promise<string> {
  let parent: string | null = null;
  const all = (await db.deck.toArray()).filter((d) => !d.deleted);
  for (const [i, name] of path.entries()) {
    const hit = all.find((d) => d.parent === parent && d.name === name);
    parent = hit ? hit.id : await decks.create(name, parent, i === 0 ? "ENG" : null);
  }
  return parent!;
}

/** 一題裡出現、而且在索引裡的原形（「這一題的單字」）。 */
export function lemmasInQuestion(ix: VocabIndex, qids: string[]): string[] {
  const want = new Set(qids);
  const out: string[] = [];
  for (const [lm, row] of Object.entries(ix.lemmas)) if (row[4].some((a) => want.has(splitAt(a)[0]))) out.push(lm);
  return out;
}

// ---------- /vocab 常考單字 ----------

export function vocabRows(ix: VocabIndex, v: VocabCards, marks: VocabMark[], wrongQs: Set<string>): VocabRow[] {
  const looked = new Map<string, number>();
  for (const m of marks) looked.set(m.lemma, (looked.get(m.lemma) ?? 0) + 1);
  const out: VocabRow[] = [];
  for (const [lemma, [p, q, o, a, at]] of Object.entries(ix.lemmas)) {
    const card = cardsFor(v, [lemma], marks.filter((m) => m.kind === "link" && m.lemma === lemma))[0] ?? null;
    const st = card ? v.states.get(card.id) : undefined;
    const wrongQ = at.some((x) => (x.endsWith("o") || x.endsWith("a")) && wrongQs.has(x.slice(0, -1)));
    out.push({
      lemma, papers: p, questions: q, options: o, answers: a, score: scoreOf(p, q, o, a), card,
      status: card ? statusOf(st) : "none", looked: looked.get(lemma) ?? 0, wrong: wrongQ || (st?.lapses ?? 0) > 0,
    });
  }
  return out.sort((x, y) => y.score - x.score || x.lemma.localeCompare(y.lemma));
}
