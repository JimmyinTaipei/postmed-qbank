// 卡片與牌組（第 5 階段，規格書 §9.5）：讀寫 deck／card、卡片的間隔複習、TSV 匯入匯出。
// 純計算在 ./card-core.ts。
//
// - 排程鍵是 card:<卡片 ID>，和題目共用 srs_state、review_log（「今日複習」分成題目與卡片兩組出）。
// - 卡片建立即加入排程（新卡，規格書 §5.4）；刪除卡片＝deleted=1 並停用排程（評分紀錄保留）。
// - 同一則筆記的卡片（Anki 的 guid、網站的 note）編輯時一起改；克漏字多了編號就多一張、少了就刪掉那張。

import { useLiveQuery } from "dexie-react-hooks";
import { ulid } from "@/lib/ulid";
import { aiAfterEdit, cardFaces, cleanFields, formatIvl, interleave, isAskedNew, noteKey, parseTsv, pickCards, splitNote, toTsv, vocabMd, type TsvRow } from "./card-core";
import { db } from "./db";
import { prefs } from "./prefs";
import { review, scheduler, startOfDay, DAY_MS, toCard } from "./srs-core";
import { srsConfig } from "./srs";
import { enqueue, kick } from "./sync";
import type { Card, CardFields, CardKind, CardOrigin, Deck, ReviewLog, SrsConfig, SrsState } from "./types";

export * from "./card-core";

const now = () => Date.now();
const sk = (id: string) => `card:${id}`;

// ---------- 讀 ----------

export interface DeckNode {
  deck: Deck;
  path: string; // 「05_English › 3_GRE紅寶書」
  depth: number;
  children: DeckNode[];
  /** 含子牌組 */
  total: number;
  due: number;
  fresh: number;
  suspended: number;
}

/** 牌組樹，每個節點附卡片數與今天到期數（含子牌組）。 */
export function useDeckTree(): DeckNode[] | undefined {
  return useLiveQuery(async () => {
    const decks = (await db.deck.toArray()).filter((d) => !d.deleted);
    const cards = await db.card.toArray();
    const states = new Map((await db.srs_state.where("item").startsWith("card:").toArray()).map((s) => [s.item, s]));
    const tomorrow = startOfDay() + DAY_MS;
    const own = new Map<string, { total: number; due: number; fresh: number; suspended: number }>();
    for (const c of cards) {
      if (c.deleted) continue;
      const o = own.get(c.deck_id) ?? { total: 0, due: 0, fresh: 0, suspended: 0 };
      o.total++;
      const s = states.get(sk(c.id));
      if (s?.suspended) o.suspended++;
      else if (s && s.state === 0) o.fresh++;
      else if (s && s.due < tomorrow) o.due++;
      own.set(c.deck_id, o);
    }
    const byParent = new Map<string | null, Deck[]>();
    for (const d of decks) {
      const p = d.parent && decks.some((x) => x.id === d.parent) ? d.parent : null;
      byParent.set(p, [...(byParent.get(p) ?? []), d]);
    }
    const build = (parent: string | null, depth: number, prefix: string): DeckNode[] =>
      (byParent.get(parent) ?? [])
        .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant", { numeric: true }))
        .map((d) => {
          const path = prefix ? `${prefix} › ${d.name}` : d.name;
          const children = build(d.id, depth + 1, path);
          const o = own.get(d.id) ?? { total: 0, due: 0, fresh: 0, suspended: 0 };
          const sum = (k: keyof typeof o) => o[k] + children.reduce((s, c) => s + c[k], 0);
          return { deck: d, path, depth, children, total: sum("total"), due: sum("due"), fresh: sum("fresh"), suspended: sum("suspended") };
        });
    return build(null, 0, "");
  });
}

export function flattenDecks(tree: DeckNode[]): DeckNode[] {
  return tree.flatMap((n) => [n, ...flattenDecks(n.children)]);
}

/** 這個牌組與所有子牌組的 ID。 */
export async function deckSubtree(id: string): Promise<Set<string>> {
  const decks = await db.deck.toArray();
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of decks) if (d.parent && out.has(d.parent) && !out.has(d.id)) (out.add(d.id), (grew = true));
  }
  return out;
}

export function useDeck(id: string | undefined): Deck | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.deck.get(id)) ?? null) : null), [id]);
}

export interface CardRow {
  card: Card;
  srs: SrsState | undefined;
}

/** 牌組裡的卡片（含子牌組），可搜尋正面／背面／標籤。 */
export function useDeckCards(deckId: string | undefined, query: string): CardRow[] | undefined {
  return useLiveQuery(async () => {
    if (!deckId) return [];
    const ids = await deckSubtree(deckId);
    const q = query.trim().toLowerCase();
    const cards = (await db.card.where("deck_id").anyOf([...ids]).toArray()).filter(
      (c) => !c.deleted && (!q || c.front_md.toLowerCase().includes(q) || c.back_md.toLowerCase().includes(q) || (c.tags ?? []).some((t) => t.toLowerCase().includes(q))),
    );
    const states = await db.srs_state.bulkGet(cards.map((c) => sk(c.id)));
    return cards.map((card, i) => ({ card, srs: states[i] })).sort((a, b) => (a.card.origin?.nid ?? 0) - (b.card.origin?.nid ?? 0) || a.card.id.localeCompare(b.card.id));
  }, [deckId, query]);
}

/** undefined＝讀取中（或沒給 ID）；null＝找不到（已刪除）。 */
export function useCard(id: string | undefined): CardRow | null | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    const card = await db.card.get(id);
    if (!card || card.deleted) return null;
    return { card, srs: await db.srs_state.get(sk(id)) };
  }, [id]);
}

// ---------- 今日卡片 ----------

export interface CardQueue {
  items: string[];
  dueTotal: number;
  newTotal: number;
  dueShown: number;
  newShown: number;
  doneToday: { reviews: number; news: number };
  cfg: SrsConfig;
}

/** 今天要複習的卡片（deck：只出這個牌組與子牌組）。每日上限和題目分開算，數值沿用設定頁的上限。 */
export async function cardQueue(deck: string | null = null, at = now()): Promise<CardQueue> {
  const cfg = await srsConfig();
  const today = startOfDay(at);
  let reviews = 0;
  let news = 0;
  for (const l of await db.review_log.where("reviewed_at").aboveOrEqual(today).toArray()) {
    if (!l.item.startsWith("card:") || l.device === "anki") continue;
    if (l.state_before === 0) news++;
    else reviews++;
  }
  const cards = await db.card.toArray();
  const deckOf = new Map(cards.filter((c) => !c.deleted).map((c) => [c.id, c.deck_id]));
  const r = pickCards({
    states: await db.srs_state.where("item").startsWith("card:").toArray(),
    deckOf,
    decks: deck ? await deckSubtree(deck) : null,
    doneToday: { reviews, news },
    maxReviews: cfg.maxReviews,
    maxNew: cfg.maxNew,
    tomorrow: today + DAY_MS,
    asked: (s) => isAskedNew(s, startOfDay),
  });
  return { items: interleave(r.due, r.fresh), dueTotal: r.dueTotal, newTotal: r.newTotal, dueShown: r.due.length, newShown: r.fresh.length, doneToday: { reviews, news }, cfg };
}

export function useCardQueue(deck: string | null = null): CardQueue | undefined {
  return useLiveQuery(() => cardQueue(deck), [deck]);
}

/** 四顆評分鈕下次出現的時間。 */
export async function ratingPreview(id: string, at = now()): Promise<Record<1 | 2 | 3 | 4, string>> {
  const cfg = await srsConfig();
  const f = scheduler(cfg.retention);
  const cur = await db.srs_state.get(sk(id));
  const out = {} as Record<1 | 2 | 3 | 4, string>;
  for (const g of [1, 2, 3, 4] as const) {
    const r = review(cur && cur.state !== 0 ? cur : null, sk(id), g, at, f);
    out[g] = formatIvl(r.state.due - at);
  }
  return out;
}

// ---------- 寫 ----------

async function putCard(c: Card) {
  await db.card.put(c);
  await enqueue("card", c.id);
}

async function newState(id: string, t: number) {
  const key = sk(id);
  if (await db.srs_state.get(key)) return;
  await db.srs_state.put({ item: key, due: t, stability: null, difficulty: null, reps: 0, lapses: 0, state: 0, last_review: null, suspended: 0, updated_at: t });
  await enqueue("srs_state", key);
}

async function setSuspended(id: string, v: 0 | 1, t: number) {
  const key = sk(id);
  const n = await db.srs_state.where("item").equals(key).modify({ suspended: v, updated_at: t });
  if (n) await enqueue("srs_state", key);
}

const TABLES = () => [db.card, db.deck, db.srs_state, db.outbox];

export interface NoteInput {
  deck_id: string;
  kind: CardKind;
  front: string;
  back: string;
  /** 單字卡（kind = "vocab"）的 11 個欄位；有給時 front／back 由它產生 */
  fields?: CardFields;
  tags?: string[];
  origin?: Omit<CardOrigin, "note" | "ord">;
}

export const cards = {
  /** 新增一則筆記（依種類拆成一或多張卡）。回傳第一張卡的 ID；克漏字沒有 {{c1::…}} 時回 null。 */
  async create(n: NoteInput): Promise<string | null> {
    const fields = n.kind === "vocab" ? cleanFields(n.fields) : null;
    if (fields && !fields.Word) return null;
    const md = fields ? vocabMd(fields) : { front_md: n.front, back_md: n.back };
    const parts = splitNote(n.kind, md.front_md, md.back_md);
    if (!parts.length) return null;
    const t = now();
    const note = ulid(t);
    let first: string | null = null;
    await db.transaction("rw", TABLES(), async () => {
      for (const p of parts) {
        const id = parts.length === 1 && (n.kind === "basic" || n.kind === "vocab") ? note : `${note}-${p.ord}`;
        first ??= id;
        await putCard({ id, deck_id: n.deck_id, kind: n.kind, front_md: p.front_md, back_md: p.back_md, fields, tags: n.tags?.length ? n.tags : null, origin: { from: "site", ...n.origin, note, ord: p.ord }, updated_at: t, deleted: 0 });
        await newState(id, t);
      }
    });
    kick();
    return first;
  },

  /**
   * 改一張卡（連同同一則筆記的其他卡）。front／back 是使用者在編輯器裡看到的那一則筆記的內容
   * （正反卡是第一張的正面與背面）。
   */
  async edit(id: string, front: string, back: string, tags: string[] | null, deckId?: string, fields?: CardFields): Promise<void> {
    const card = await db.card.get(id);
    if (!card) return;
    if (card.kind === "vocab") {
      const f = cleanFields(fields ?? card.fields);
      const md = vocabMd(f);
      const origin = aiAfterEdit(card, f);
      await db.transaction("rw", TABLES(), () => putCard({ ...card, origin, fields: f, front_md: md.front_md, back_md: md.back_md, tags, deck_id: deckId ?? card.deck_id, updated_at: now() }));
      kick();
      return;
    }
    const key = noteKey(card);
    const siblings = (await db.card.toArray()).filter((c) => noteKey(c) === key);
    const t = now();
    await db.transaction("rw", TABLES(), async () => {
      if (card.kind === "cloze") {
        const want = new Map(splitNote("cloze", front, back).map((p) => [p.ord, p]));
        for (const s of siblings) {
          const ord = s.origin?.ord ?? 0;
          if (want.has(ord)) {
            await putCard({ ...s, front_md: front, back_md: back, tags, deck_id: deckId ?? s.deck_id, deleted: 0, updated_at: t });
            if (s.deleted) await setSuspended(s.id, 0, t);
            want.delete(ord);
          } else if (!s.deleted) {
            await putCard({ ...s, deleted: 1, updated_at: t });
            await setSuspended(s.id, 1, t);
          }
        }
        for (const p of want.values()) {
          const nid = `${card.id.replace(/-\d+$/, "")}-${p.ord}`;
          await putCard({ id: nid, deck_id: deckId ?? card.deck_id, kind: "cloze", front_md: front, back_md: back, tags, origin: { ...card.origin, from: card.origin?.from ?? "site", ord: p.ord } as CardOrigin, updated_at: t, deleted: 0 });
          await newState(nid, t);
        }
      } else if (card.kind === "reverse") {
        for (const s of siblings) {
          const swap = (s.origin?.ord ?? 0) === 1;
          await putCard({ ...s, front_md: swap ? back : front, back_md: swap ? front : back, tags, deck_id: deckId ?? s.deck_id, updated_at: t });
        }
      } else {
        await putCard({ ...card, front_md: front, back_md: back, tags, deck_id: deckId ?? card.deck_id, updated_at: t });
      }
    });
    kick();
  },

  /** 編輯器要顯示的「那一則筆記」：正反卡回第一張的正反面。 */
  async noteOf(id: string): Promise<{ front: string; back: string; fields?: CardFields } | null> {
    const card = await db.card.get(id);
    if (!card) return null;
    if (card.kind === "vocab") return { front: card.front_md, back: card.back_md, fields: cleanFields(card.fields) };
    if (card.kind === "reverse" && (card.origin?.ord ?? 0) === 1) return { front: card.back_md, back: card.front_md };
    return { front: card.front_md, back: card.back_md };
  },

  async move(ids: string[], deckId: string): Promise<void> {
    const t = now();
    await db.transaction("rw", TABLES(), async () => {
      for (const id of ids) {
        const c = await db.card.get(id);
        if (c && c.deck_id !== deckId) await putCard({ ...c, deck_id: deckId, updated_at: t });
      }
    });
    kick();
  },

  async suspend(id: string, v: boolean): Promise<void> {
    const t = now();
    await db.transaction("rw", TABLES(), () => setSuspended(id, v ? 1 : 0, t));
    kick();
  },

  /**
   * 排到今天（第 8B-2 階段「我不會這個字」）：暫停的恢復；新卡排在今天新卡的最前面；學過的卡改成現在到期。
   * 評分紀錄不動。
   */
  async askToday(ids: string[]): Promise<number> {
    const t = now();
    const today = startOfDay(t);
    let n = 0;
    await db.transaction("rw", TABLES(), async () => {
      for (const id of ids) {
        const key = sk(id);
        const c = await db.card.get(id);
        if (!c || c.deleted) continue;
        const cur = await db.srs_state.get(key);
        const base = cur ?? { item: key, due: t, stability: null, difficulty: null, reps: 0, lapses: 0, state: 0 as const, last_review: null, suspended: 0 as const, updated_at: t };
        const due = base.state === 0 ? today : Math.min(base.due, t);
        await db.srs_state.put({ ...base, due, suspended: 0, updated_at: Math.max(t, (cur?.updated_at ?? 0) + 1) });
        await enqueue("srs_state", key);
        n++;
      }
    });
    kick();
    return n;
  },

  /** 刪除一張卡（同一則筆記的其他卡不動）。 */
  async remove(id: string): Promise<void> {
    const t = now();
    await db.transaction("rw", TABLES(), async () => {
      const c = await db.card.get(id);
      if (!c) return;
      await putCard({ ...c, deleted: 1, updated_at: t });
      await setSuspended(id, 1, t);
    });
    kick();
  },

  /** 評分一張卡（複習畫面）。 */
  async rate(id: string, rating: 1 | 2 | 3 | 4, durationMs: number, at = now()): Promise<void> {
    const cfg = await srsConfig();
    const f = scheduler(cfg.retention);
    const key = sk(id);
    await db.transaction("rw", [db.srs_state, db.review_log, db.outbox], async () => {
      const cur = (await db.srs_state.get(key)) ?? null;
      const r = review(cur && cur.state !== 0 ? cur : null, key, rating, at, f);
      r.state.suspended = cur?.suspended ?? 0;
      const log: ReviewLog = {
        id: ulid(at),
        item: key as ReviewLog["item"],
        rating,
        state_before: cur?.state ?? 0,
        elapsed_days: r.elapsedDays,
        scheduled_days: r.scheduledDays,
        duration_ms: Math.min(durationMs, 600_000),
        attempt_id: null,
        device: prefs.device(),
        reviewed_at: at,
      };
      await db.srs_state.put(r.state);
      await db.review_log.add(log);
      await enqueue("srs_state", key);
      await enqueue("review_log", log.id);
    });
    kick();
  },

  /** 這張卡在 FSRS 的狀態說明（卡片頁顯示）。 */
  describe(s: SrsState | undefined): string {
    if (!s) return "不在排程裡";
    if (s.suspended) return "已暫停";
    if (s.state === 0) return "新卡（還沒學過）";
    const days = Math.round((s.due - startOfDay()) / DAY_MS);
    const when = days <= 0 ? "今天到期" : days === 1 ? "明天到期" : `${days} 天後到期`;
    return `${when}・穩定度 ${toCard(s).stability.toFixed(1)} 天・複習 ${s.reps} 次・忘記 ${s.lapses} 次`;
  },
};

export const decks = {
  async create(name: string, parent: string | null, subject: string | null = null): Promise<string> {
    const t = now();
    const id = ulid(t);
    await db.transaction("rw", db.deck, db.outbox, async () => {
      await db.deck.put({ id, name: name.trim(), subject, parent, updated_at: t, deleted: 0 });
      await enqueue("deck", id);
    });
    kick();
    return id;
  },

  async rename(id: string, name: string): Promise<void> {
    await db.transaction("rw", db.deck, db.outbox, async () => {
      const n = await db.deck.update(id, { name: name.trim(), updated_at: now() });
      if (n) await enqueue("deck", id);
    });
    kick();
  },

  /** 刪除牌組（含子牌組與裡面所有卡片）。 */
  async remove(id: string): Promise<number> {
    const ids = await deckSubtree(id);
    const t = now();
    let n = 0;
    await db.transaction("rw", TABLES(), async () => {
      for (const d of ids) {
        await db.deck.update(d, { deleted: 1, updated_at: t });
        await enqueue("deck", d);
        for (const c of await db.card.where("deck_id").equals(d).toArray()) {
          if (c.deleted) continue;
          await putCard({ ...c, deleted: 1, updated_at: t });
          await setSuspended(c.id, 1, t);
          n++;
        }
      }
    });
    kick();
    return n;
  },
};

// ---------- TSV ----------

export const tsv = {
  /** 這個牌組（含子牌組）匯出成 Anki 可以匯入的純文字。 */
  async export(deckId: string): Promise<{ text: string; count: number }> {
    const ids = await deckSubtree(deckId);
    const list = (await db.card.where("deck_id").anyOf([...ids]).toArray()).filter((c) => !c.deleted);
    // 同一則筆記只匯出一次（克漏字、正反卡）
    const seen = new Set<string>();
    const rows = [];
    for (const c of list) {
      const k = noteKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      const note = c.kind === "reverse" && c.origin?.ord === 1 ? { front: c.back_md, back: c.front_md } : { front: c.front_md, back: c.back_md };
      rows.push({ ...note, tags: c.tags });
    }
    return { text: toTsv(rows), count: rows.length };
  },

  parse(text: string, htmlToMd: (html: string) => string): TsvRow[] {
    const r = parseTsv(text);
    return r.rows.map((x) => (r.html ? { ...x, front: htmlToMd(x.front), back: htmlToMd(x.back) } : x));
  },

  /** 匯入：有 {{c1::…}} 的是克漏字，其他是問答卡。回傳新增的筆記數。 */
  async import(rows: TsvRow[], deckId: string): Promise<number> {
    let n = 0;
    for (const r of rows) {
      if (!r.front.trim()) continue;
      const kind: CardKind = /\{\{c\d+::/.test(r.front) ? "cloze" : "basic";
      if (await cards.create({ deck_id: deckId, kind, front: r.front, back: r.back, tags: r.tags, origin: { from: "tsv" } })) n++;
    }
    return n;
  },
};

export { cardFaces };
