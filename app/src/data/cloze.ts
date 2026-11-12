// 克漏字（第 5B 階段，規格書 §9.8）：在筆記上選字直接做成克漏字卡。
//
// - 卡片仍是普通的克漏字卡（front_md 裡的 {{cN::…}}）；cloze_mark 只記每一處在原文的位置（定位和螢光相同）。
// - 一則筆記（card.origin.note）＝原文的一個區塊（表格是一列）；同一個區塊的挖空共用一則，每個編號一張卡。
// - 卡片內容由「區塊原文＋這一則所有的克漏字」產生（cloze-core.ts 的 buildFront）。原文改版後重新產生；
//   找不到的標「原文已改」、保留舊內容；使用者在卡片編輯器改過的（origin.edited）不再自動更新。
// - 牌組照筆記的階層：筆記 › <科目> › <群組> › <筆記標題>（規格書 §14-10 的預設）。
// - 膠帶顏色不存：由那張卡的複習紀錄算（tapeLevel）。

import { useLiveQuery } from "dexie-react-hooks";
import { ulid } from "@/lib/ulid";
import { cards } from "./cards";
import { buildFront, maxCloze, tableRowOf, tapeLevel, type TapeLevel } from "./cloze-core";
import { db } from "./db";
import { startOfDay } from "./srs-core";
import { enqueue, kick } from "./sync";
import type { Card, ClozeMark, SrsState } from "./types";
import { vocabDeck } from "./vocab";

export * from "./cloze-core";

const now = () => Date.now();
const live = (m: ClozeMark) => !m.deleted;

// ---------- 讀 ----------

/** 這份筆記（target 開頭是 prefix）的克漏字 */
export function useClozeMarksUnder(prefix: string | undefined): ClozeMark[] | undefined {
  return useLiveQuery(async () => (prefix ? (await db.cloze_mark.where("target").startsWith(prefix).toArray()).filter(live) : []), [prefix]);
}

export interface ClozeCardInfo {
  /** note → 這一則還沒刪的卡（依編號） */
  byNote: Map<string, Map<number, Card>>;
  /** 卡片 ID → 膠帶顏色 */
  level: Map<string, TapeLevel>;
  state: Map<string, SrsState | undefined>;
}

/** 這些克漏字對應的卡片、排程與膠帶顏色。 */
export function useClozeCards(marks: ClozeMark[] | undefined): ClozeCardInfo | undefined {
  const notes = [...new Set((marks ?? []).map((m) => m.note))].sort().join(",");
  return useLiveQuery(async () => {
    const want = new Set(notes ? notes.split(",") : []);
    const byNote = new Map<string, Map<number, Card>>();
    if (want.size) {
      for (const c of await db.card.where("origin.note").anyOf([...want]).toArray()) {
        const note = c.origin?.note;
        if (c.deleted || !note || !want.has(note)) continue;
        const m = byNote.get(note) ?? new Map<number, Card>();
        m.set((c.origin?.ord ?? 0) + 1, c);
        byNote.set(note, m);
      }
    }
    const ids = [...byNote.values()].flatMap((m) => [...m.values()].map((c) => c.id));
    const level = new Map<string, TapeLevel>();
    const state = new Map<string, SrsState | undefined>();
    if (ids.length) {
      const logs = await db.review_log.where("item").anyOf(ids.map((id) => `card:${id}`)).toArray();
      const by = new Map<string, { rating: number; reviewed_at: number }[]>();
      for (const l of logs) by.set(l.item.slice(5), [...(by.get(l.item.slice(5)) ?? []), l]);
      for (const id of ids) level.set(id, tapeLevel(by.get(id) ?? [], startOfDay));
      const st = await db.srs_state.bulkGet(ids.map((id) => `card:${id}`));
      ids.forEach((id, i) => state.set(id, st[i]));
    }
    return { byNote, level, state };
  }, [notes]);
}

/** 一張克漏字卡（複習畫面）的膠帶顏色 */
export function useTapeLevel(cardId: string | undefined): TapeLevel {
  return (
    useLiveQuery(async () => (cardId ? tapeLevel(await db.review_log.where("item").equals(`card:${cardId}`).toArray(), startOfDay) : 0), [cardId]) ?? 0
  );
}

// ---------- 寫 ----------

async function putMark(m: ClozeMark) {
  await db.transaction("rw", db.cloze_mark, db.outbox, async () => {
    await db.cloze_mark.put(m);
    await enqueue("cloze_mark", m.id);
  });
  kick();
}

export interface ClozeSource {
  /** 'kb:BCH/2-3_PDH#<bid>' */
  target: string;
  /** 那個區塊的原始 Markdown（含還沒寫回的修訂） */
  md: string;
  /** 牌組：["筆記", "生化", "B2 代謝篇", "2-3 PDH"] */
  deck: string[];
  origin: { doc?: string; bid?: string; id?: string; path?: string[] };
}

export interface ClozePick {
  /** 看得到的字（公式是 MATH） */
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  /** new：新的編號（⌘⇧C）；same：沿用這個區塊目前最大的編號（⌘⌥⇧C） */
  mode: "new" | "same";
}

export type ClozeResult = { ok: true; id: string; card: string; n: number; undo: () => Promise<void> } | { ok: false; reason: string; fallback?: string };

/** 這一則筆記還在的克漏字（卡被刪掉的編號不算） */
async function noteMarks(note: string): Promise<ClozeMark[]> {
  const ms = (await db.cloze_mark.where("note").equals(note).toArray()).filter(live);
  const alive = new Set((await liveCardsOf(note)).map((c) => (c.origin?.ord ?? 0) + 1));
  return ms.filter((m) => alive.has(m.n));
}

async function liveCardsOf(note: string): Promise<Card[]> {
  return (await db.card.where("origin.note").equals(note).toArray()).filter((c) => !c.deleted).sort((a, b) => (a.origin?.ord ?? 0) - (b.origin?.ord ?? 0));
}

/** 用目前的原文與這一則所有的克漏字重寫卡片（加卡、刪卡交給 cards.edit）。 */
async function rewrite(note: string, md: string, extra: ClozeMark[] = [], drop?: string): Promise<{ front: string; missing: number } | null> {
  const seen = new Set<string>();
  const ms = [...extra, ...(await noteMarks(note))].filter((m) => m.id !== drop && !seen.has(m.id) && (seen.add(m.id), true));
  const list = await liveCardsOf(note);
  if (!ms.length) {
    for (const c of list) await cards.remove(c.id, { keepMarks: true });
    return null;
  }
  const r = buildFront(md, ms);
  const first = list[0];
  if (first) await cards.edit(first.id, r.front, first.back_md, first.tags, undefined, undefined, { auto: true, stale: r.missing.length > 0 });
  return { front: r.front, missing: r.missing.length };
}

export const clozes = {
  /** 選字做成克漏字。原文對不到時回 fallback（帶入這個區塊的內容，開卡片編輯器讓使用者自己挖）。 */
  async create(src: ClozeSource, pick: ClozePick): Promise<ClozeResult> {
    const md = src.md;
    const probe = buildFront(md, [{ quote: pick.quote, prefix: pick.prefix, suffix: pick.suffix, n: 1 }]);
    if (probe.missing.length) return { ok: false, reason: "這段字在原文裡對不到（格式比較特別），改用卡片編輯器自己挖", fallback: md };
    // 同一個區塊（表格是同一列）已經有卡：併進那一則
    const row = tableRowOf(md, pick);
    let note: string | null = null;
    let cur: ClozeMark[] = [];
    for (const m of (await db.cloze_mark.where("target").equals(src.target).toArray()).filter(live)) {
      if (row >= 0 && tableRowOf(md, m) !== row) continue;
      const ms = await noteMarks(m.note);
      if (!ms.length) continue;
      note = m.note;
      cur = ms;
      break;
    }
    // 和已有的克漏字重疊
    if (cur.length && buildFront(md, [...cur, { quote: pick.quote, prefix: pick.prefix, suffix: pick.suffix, n: 99 }]).missing.length)
      return { ok: false, reason: "這段字和已經挖過的地方重疊；點原文上的克漏字可以改" };
    const t = now();
    if (!note) {
      const deck = await vocabDeck(src.deck);
      const mark: Omit<ClozeMark, "note"> = { id: ulid(t), target: src.target, quote: pick.quote, prefix: pick.prefix, suffix: pick.suffix, start: pick.start, end: pick.end, n: 1, hint: null, updated_at: t, deleted: 0 };
      const front = buildFront(md, [mark]).front;
      const cardId = await cards.create({ deck_id: deck, kind: "cloze", front, back: "", origin: { from: src.target.startsWith("kb:") ? "kb" : "q", ...src.origin } });
      if (!cardId) return { ok: false, reason: "建立卡片失敗" };
      const c = await db.card.get(cardId);
      const full: ClozeMark = { ...mark, note: c!.origin!.note! };
      await putMark(full);
      return {
        ok: true,
        id: full.id,
        card: cardId,
        n: 1,
        undo: async () => {
          await putMark({ ...full, deleted: 1, updated_at: Date.now() });
          await cards.remove(cardId, { keepMarks: true });
        },
      };
    }
    const list = await liveCardsOf(note);
    const top = Math.max(0, ...cur.map((m) => m.n), ...list.map((c) => maxCloze(c.front_md)));
    const n = pick.mode === "same" ? Math.max(1, top) : top + 1;
    const mark: ClozeMark = { id: ulid(t), target: src.target, quote: pick.quote, prefix: pick.prefix, suffix: pick.suffix, start: pick.start, end: pick.end, note, n, hint: null, updated_at: t, deleted: 0 };
    const before = list[0]?.front_md;
    // 新的一處要先記下來，rewrite 才算得到它（noteMarks 只認有卡的編號）
    await putMark(mark);
    await rewrite(note, md, [mark]);
    const card = (await liveCardsOf(note)).find((c) => (c.origin?.ord ?? 0) + 1 === n);
    return {
      ok: true,
      id: mark.id,
      card: card?.id ?? list[0].id,
      n,
      undo: async () => {
        await putMark({ ...mark, deleted: 1, updated_at: Date.now() });
        const first = (await liveCardsOf(note!))[0];
        if (first && before !== undefined) await cards.edit(first.id, before, first.back_md, first.tags, undefined, undefined, { auto: true });
      },
    };
  },

  /** 改提示（空白＝拿掉） */
  async setHint(m: ClozeMark, hint: string, md: string): Promise<void> {
    const next = { ...m, hint: hint.trim() || null, updated_at: now() };
    await putMark(next);
    await rewrite(m.note, md);
  },

  /** 改成和第 n 個一起遮（同一張卡）；n = 0 ＝ 拆成自己一張（新的編號） */
  async setNumber(m: ClozeMark, n: number, md: string): Promise<void> {
    let target = n;
    if (!target) {
      const list = await liveCardsOf(m.note);
      target = Math.max(0, ...(await noteMarks(m.note)).map((x) => x.n), ...list.map((c) => maxCloze(c.front_md))) + 1;
    }
    const next = { ...m, n: target, updated_at: now() };
    await putMark(next);
    await rewrite(m.note, md, [next], m.id);
  },

  /** 刪除一處：那個編號沒有其他克漏字時，卡片一起刪（複習紀錄保留）。 */
  async remove(m: ClozeMark, md: string): Promise<void> {
    await putMark({ ...m, deleted: 1, updated_at: now() });
    await rewrite(m.note, md, [], m.id);
  },

  /** 卡片被刪掉：那張卡的克漏字也拿掉（cards.remove 呼叫） */
  async dropForCard(c: Card): Promise<void> {
    const note = c.origin?.note;
    if (!note) return;
    const n = (c.origin?.ord ?? 0) + 1;
    for (const m of (await db.cloze_mark.where("note").equals(note).toArray()).filter((x) => live(x) && x.n === n)) await putMark({ ...m, deleted: 1, updated_at: now() });
  },

  /** 原文換位置（區塊 ID 變了、字的位置變了）：和螢光一樣把 target／位置改過去 */
  async move(m: ClozeMark, target: string, start: number, end: number): Promise<void> {
    if (m.target === target && m.start === start && m.end === end) return;
    await putMark({ ...m, target, start, end, updated_at: now() });
  },

  /**
   * 原文改版後：用新的原文重新產生卡片內容（複習進度不動）。
   * 找不到的克漏字 → 卡片標「原文已改」、保留舊內容；使用者改過的卡不動。回傳更新了幾則。
   */
  async refresh(marks: ClozeMark[], mdOf: (target: string) => string | null): Promise<number> {
    const notes = new Map<string, ClozeMark[]>();
    for (const m of marks) notes.set(m.note, [...(notes.get(m.note) ?? []), m]);
    let n = 0;
    for (const [note, ms] of notes) {
      const md = mdOf(ms[0].target);
      if (md === null) continue;
      const list = await liveCardsOf(note);
      const first = list[0];
      if (!first || first.origin?.edited) continue;
      const alive = new Set(list.map((c) => (c.origin?.ord ?? 0) + 1));
      const r = buildFront(md, ms.filter((m) => alive.has(m.n)));
      const stale = r.missing.length > 0;
      if (stale) {
        if (!first.origin?.stale) {
          await cards.edit(first.id, first.front_md, first.back_md, first.tags, undefined, undefined, { auto: true, stale: true });
          n++;
        }
        continue;
      }
      if (r.front !== first.front_md || first.origin?.stale) {
        await cards.edit(first.id, r.front, first.back_md, first.tags, undefined, undefined, { auto: true, stale: false });
        n++;
      }
    }
    return n;
  },
};
