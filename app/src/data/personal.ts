// 個人資料的寫入與查詢（規格書 §4.6、§5）。
// 每個寫入都在同一個交易裡把列放進待送佇列（enqueue），交易完成後 kick() 觸發同步（sync.ts）。
// 函式簽名與 1A 相同，畫面不用改。

import { ulid } from "@/lib/ulid";
import { content } from "./content";
import { db } from "./db";
import { clusterItems } from "./group-core";
import { judge } from "./question";
import { prefs } from "./prefs";
import { applyAttempts, srsKey } from "./srs";
import { enqueue, kick, resetCursor } from "./sync";
import type { Attempt, FlagKind, ItemKey, Session, SessionMode } from "./types";
import { keyId } from "./types";

const now = () => Date.now();

export const flags = {
  async set(item: ItemKey, kind: FlagKind, value: boolean): Promise<void> {
    await db.transaction("rw", db.flag, db.outbox, async () => {
      await db.flag.put({ item, kind, value: value ? 1 : 0, updated_at: now() });
      await enqueue("flag", [item, kind]);
    });
    kick();
  },
};

export const wrongBook = {
  /** 「已掌握」：離開錯題本（flag.mastered = 1、flag.wrong = 0）。排程不變。 */
  async master(item: ItemKey): Promise<void> {
    const t = now();
    await db.transaction("rw", db.flag, db.outbox, async () => {
      await db.flag.put({ item, kind: "wrong", value: 0, updated_at: t });
      await db.flag.put({ item, kind: "mastered", value: 1, updated_at: t });
      await enqueue("flag", [item, "wrong"]);
      await enqueue("flag", [item, "mastered"]);
    });
    kick();
  },
  /** 復原「已掌握」：放回錯題本。 */
  async unmaster(item: ItemKey): Promise<void> {
    const t = now();
    await db.transaction("rw", db.flag, db.outbox, async () => {
      await db.flag.put({ item, kind: "wrong", value: 1, updated_at: t });
      await db.flag.put({ item, kind: "mastered", value: 0, updated_at: t });
      await enqueue("flag", [item, "wrong"]);
      await enqueue("flag", [item, "mastered"]);
    });
    kick();
  },
};

export const attempts = {
  /**
   * 記一筆作答。答錯會自動進錯題本（flag.wrong = 1）。
   * 回傳的列在離開該題前是「未封存」的，信心程度可用 setConfidence 改。
   */
  async record(input: {
    item: ItemKey;
    sessionId: string | null;
    mode: SessionMode;
    chosen: string[] | null;
    correct: boolean;
    elapsedMs: number;
    contentH: string;
  }): Promise<Attempt> {
    const row: Attempt = {
      id: ulid(),
      item: input.item,
      session_id: input.sessionId,
      mode: input.mode,
      chosen: input.chosen,
      correct: input.correct ? 1 : 0,
      confidence: 2,
      elapsed_ms: Math.max(0, Math.round(input.elapsedMs)),
      content_h: input.contentH,
      device: prefs.device(),
      created_at: now(),
      open: 1,
    };
    const key = input.correct ? null : await srsKey(keyId(input.item));
    await db.transaction("rw", db.attempt, db.flag, db.srs_state, db.outbox, async () => {
      await db.attempt.add(row); // 作答本身等封存（seal）後才放進佇列
      if (!input.correct) {
        await db.flag.put({ item: input.item, kind: "wrong", value: 1, updated_at: row.created_at });
        await enqueue("flag", [input.item, "wrong"]);
        // 之前標過「粗心錯，不追蹤」的題目又答錯：恢復追蹤
        const n = await db.srs_state.where("item").equals(key!).modify({ suspended: 0, updated_at: row.created_at });
        if (n) await enqueue("srs_state", key!);
      }
    });
    kick();
    return row;
  },

  /** 只能改還沒封存的作答（attempt 表在伺服器上是只增的）。 */
  async setConfidence(id: string, confidence: 1 | 2 | 3): Promise<void> {
    await db.attempt.where("id").equals(id).and((a) => a.open === 1).modify({ confidence });
  },

  /** 離開題目、結束一場、App 進背景時呼叫：封存所有未封存的作答。 */
  async seal(): Promise<void> {
    let sealed: Attempt[] = [];
    await db.transaction("rw", db.attempt, db.outbox, async () => {
      sealed = await db.attempt.where("open").equals(1).toArray();
      if (!sealed.length) return;
      await db.attempt.where("open").equals(1).modify({ open: 0 });
      for (const a of sealed) await enqueue("attempt", a.id);
    });
    if (!sealed.length) return;
    kick();
    // 信心程度定案了：排進複習、檢查是否離開錯題本（規格書 §5.3、§5.4）
    await applyAttempts(sealed.map((a) => ({ ...a, open: 0 })));
  },

  /** 粗心錯，不追蹤（規格書 §5.3）：不進錯題本、不進複習；作答紀錄仍是答錯。 */
  async markCareless(item: ItemKey): Promise<void> {
    const t = now();
    const key = await srsKey(keyId(item));
    await db.transaction("rw", db.flag, db.srs_state, db.outbox, async () => {
      await db.flag.put({ item, kind: "wrong", value: 0, updated_at: t });
      const cur = await db.srs_state.get(key);
      await db.srs_state.put({
        ...(cur ?? { item: key, due: t, stability: null, difficulty: null, reps: 0, lapses: 0, state: 0, last_review: null }),
        suspended: 1,
        updated_at: t,
      });
      await enqueue("flag", [item, "wrong"]);
      await enqueue("srs_state", key);
    });
    kick();
  },

  /** 取消「粗心錯」：放回錯題本並恢復追蹤。 */
  async undoCareless(item: ItemKey): Promise<void> {
    const t = now();
    const key = await srsKey(keyId(item));
    await db.transaction("rw", db.flag, db.srs_state, db.outbox, async () => {
      await db.flag.put({ item, kind: "wrong", value: 1, updated_at: t });
      await enqueue("flag", [item, "wrong"]);
      const n = await db.srs_state.where("item").equals(key).modify({ suspended: 0, updated_at: t });
      if (n) await enqueue("srs_state", key);
    });
    kick();
  },
};

export const sessions = {
  async create(input: { mode: SessionMode; filter: Session["filter"]; items: string[]; timeLimitS?: number | null }): Promise<Session> {
    // 題組（第 8A 階段）：同一篇文章的小題排在一起，畫面才能放在同一頁
    const rows = new Map((await Promise.all(input.items.map((id) => content.row(id).catch(() => null)))).filter((r) => r != null).map((r) => [r.id, r]));
    input = { ...input, items: clusterItems(input.items, (id) => rows.get(id)) };
    const t = now();
    const row: Session = {
      id: ulid(t),
      mode: input.mode,
      filter: input.filter,
      items: input.items,
      cursor: 0,
      started_at: t,
      ended_at: null,
      time_limit_s: input.timeLimitS ?? null,
      score: null,
      device: prefs.device(),
      updated_at: t,
      deleted: 0,
    };
    await db.transaction("rw", db.session, db.outbox, async () => {
      await db.session.add(row);
      await enqueue("session", row.id);
    });
    kick();
    return row;
  },
  async get(id: string): Promise<Session | null> {
    const s = await db.session.get(id);
    return s && !s.deleted ? s : null;
  },
  async setCursor(id: string, cursor: number): Promise<void> {
    await touchSession(id, { cursor });
  },
  async end(id: string): Promise<void> {
    const t = now();
    await attempts.seal();
    const s = await db.session.get(id);
    if (!s || s.ended_at) return;
    const rows = await db.attempt.where("session_id").equals(id).toArray();
    const latest = new Map(rows.sort((a, b) => a.created_at - b.created_at).map((a) => [a.item, a]));
    const right = [...latest.values()].filter((a) => a.correct).length;
    await touchSession(id, { ended_at: t, score: s.items.length ? right / s.items.length : null }, t);
  },
  /** 捨棄一場（作答紀錄保留）。 */
  async remove(id: string): Promise<void> {
    await touchSession(id, { deleted: 1 });
  },
};

/** 模擬考的作答（交卷前不判對錯、不記 attempt）：存在會同步的 setting["exam.<場次>"]，換裝置也能續考。 */
export interface ExamPicks {
  picks: Record<string, string[]>; // 題目 ID → 選的字母
  ms: Record<string, number>; // 題目 ID → 停留時間（交卷時寫進 attempt.elapsed_ms）
}

/** 模擬考作答是「讀整份 → 改一格 → 寫回」：同時有好幾個寫入（題組頁一次記 5 小題的時間、連續點選項）要排隊，否則會互相蓋掉。 */
let examQueue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = examQueue.then(fn, fn);
  examQueue = run.catch(() => undefined);
  return run;
}

export const exam = {
  key: (sessionId: string) => `exam.${sessionId}`,
  async get(sessionId: string): Promise<ExamPicks> {
    return (await settings.get<ExamPicks>(exam.key(sessionId))) ?? { picks: {}, ms: {} };
  },
  pick(sessionId: string, id: string, chosen: string[]): Promise<void> {
    return serial(async () => {
      const cur = await exam.get(sessionId);
      const picks = { ...cur.picks };
      if (chosen.length) picks[id] = chosen;
      else delete picks[id];
      await settings.set(exam.key(sessionId), { ...cur, picks });
    });
  },
  addTime(sessionId: string, id: string, ms: number): Promise<void> {
    if (ms < 500) return Promise.resolve();
    return serial(async () => {
      const cur = await exam.get(sessionId);
      await settings.set(exam.key(sessionId), { ...cur, ms: { ...cur.ms, [id]: Math.round((cur.ms[id] ?? 0) + ms) } });
    });
  },
  /** 交卷：有作答的題目各記一筆 attempt（mode = exam）並判對錯，然後結束這一場。 */
  async submit(sessionId: string): Promise<void> {
    const s = await db.session.get(sessionId);
    if (!s || s.ended_at) return;
    const cur = await serial(() => exam.get(sessionId)); // 等還沒寫完的作答
    for (const id of s.items) {
      const chosen = cur.picks[id];
      if (!chosen?.length) continue;
      const q = await content.question(id).catch(() => null);
      if (!q || q === "missing") continue;
      await attempts.record({ item: `q:${id}`, sessionId, mode: "exam", chosen, correct: judge(q, chosen), elapsedMs: cur.ms[id] ?? 0, contentH: q.h.ques });
    }
    await sessions.end(sessionId);
  },
};

export const settings = {
  async get<T>(key: string): Promise<T | null> {
    const row = await db.setting.get(key);
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    const v = JSON.stringify(value);
    const cur = await db.setting.get(key);
    if (cur && cur.value === v) return; // 沒變就不寫、不同步
    await db.transaction("rw", db.setting, db.outbox, async () => {
      await db.setting.put({ key, value: v, updated_at: now() });
      await enqueue("setting", key);
    });
    kick();
  },
};

async function touchSession(id: string, changes: Partial<Session>, t = now()): Promise<void> {
  await db.transaction("rw", db.session, db.outbox, async () => {
    const n = await db.session.update(id, { ...changes, updated_at: t });
    if (n) await enqueue("session", id);
  });
  kick();
}

/**
 * 清掉這台裝置上的個人資料副本（設定頁）。雲端資料不受影響，下次同步會從雲端重新拉回來。
 * 還沒送出的資料（待送佇列）會一起消失，所以畫面要先提醒。下載的題庫內容保留。
 */
export async function wipeLocal(): Promise<void> {
  const keep = new Set(["cfile", "kv"]);
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) if (!keep.has(t.name)) await t.clear();
  });
  await resetCursor();
  kick();
}
