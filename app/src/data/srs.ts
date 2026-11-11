// 間隔複習與錯題本的資料操作（規格書 §5.3、§5.4）。純計算在 ./srs-core.ts。
//
// - 排程的鍵是同題群組的代表題：q:<canonical>。同一題的不同出處共用一個排程，複習時出代表題（§5.4）。
//   錯題、星號等標記仍掛在各自的題目上。
// - 作答在「封存」（attempts.seal）時才排程：那時信心程度（猜的／普通／很確定）已定案，評分才正確。
// - 進入排程的時機：答錯自動加入；任何題目可手動「加入複習」（新卡）；粗心錯不追蹤 = suspended。
// - 已在排程裡的題目，之後不論在哪個模式作答，都算一次複習（寫 review_log、更新 srs_state）。

import { ulid } from "@/lib/ulid";
import { content } from "./content";
import { db } from "./db";
import { prefs } from "./prefs";
import { DAY_MS, leavesWrongBook, median, ratingOf, replay, review, sanitizeConfig, scheduler, startOfDay } from "./srs-core";
import { enqueue, kick } from "./sync";
import type { Attempt, ItemKey, ReviewLog, SrsConfig, SrsState } from "./types";
import { keyId, qKey } from "./types";

export async function srsConfig(): Promise<SrsConfig> {
  const row = await db.setting.get("srs.config");
  try {
    return sanitizeConfig(row ? JSON.parse(row.value) : null);
  } catch {
    return sanitizeConfig(null);
  }
}

/** 題目 ID → 排程用的鍵（同題群組的代表題）。 */
export async function srsKey(id: string): Promise<ItemKey> {
  const row = await content.row(id).catch(() => null);
  return qKey(row?.canonical || id);
}

/** 最近答對的作答，依題型算用時中位數（評分 Easy 的門檻）。 */
async function medians(): Promise<Map<string, number | null>> {
  const recent = await db.attempt.orderBy("created_at").reverse().filter((a) => a.correct === 1 && a.open !== 1).limit(400).toArray();
  const by = new Map<string, number[]>();
  for (const a of recent) {
    const t = (await content.row(keyId(a.item)).catch(() => null))?.qtype ?? "single";
    by.set(t, [...(by.get(t) ?? []), a.elapsed_ms]);
  }
  return new Map([...by].map(([k, v]) => [k, v.length >= 5 ? median(v) : null]));
}

/**
 * 封存後的作答：更新排程、寫評分紀錄、檢查是否離開錯題本。
 * 在 attempts.seal() 的交易「之後」呼叫（要先查索引，不能放在 Dexie 交易裡）。
 */
export async function applyAttempts(rows: Attempt[]): Promise<void> {
  if (!rows.length) return;
  const cfg = await srsConfig();
  const f = scheduler(cfg.retention);
  const info = new Map<string, { key: ItemKey; qtype: string }>();
  for (const a of rows) {
    if (info.has(a.item)) continue;
    const row = await content.row(keyId(a.item)).catch(() => null);
    info.set(a.item, { key: qKey(row?.canonical || keyId(a.item)), qtype: row?.qtype ?? "single" });
  }
  const med = await medians();
  const device = prefs.device();
  await db.transaction("rw", [db.srs_state, db.review_log, db.flag, db.attempt, db.outbox], async () => {
    for (const a of rows.slice().sort((x, y) => x.created_at - y.created_at)) {
      const { key, qtype } = info.get(a.item)!;
      const cur = (await db.srs_state.get(key)) ?? null;
      if (!cur?.suspended && (cur || !a.correct)) {
        const rating = ratingOf(a, med.get(qtype) ?? null);
        const r = review(cur, key, rating, a.created_at, f, Date.now());
        const log: ReviewLog = {
          id: ulid(a.created_at),
          item: key,
          rating,
          state_before: r.stateBefore,
          elapsed_days: r.elapsedDays,
          scheduled_days: r.scheduledDays,
          duration_ms: a.elapsed_ms,
          attempt_id: a.id,
          device,
          reviewed_at: a.created_at,
        };
        await db.srs_state.put(r.state);
        await db.review_log.add(log);
        await enqueue("srs_state", key);
        await enqueue("review_log", log.id);
      }
      // 錯題本：最後一次答錯之後，不同日答對 2 次（猜對不算）就離開
      if (a.correct && a.confidence !== 1) {
        const w = await db.flag.get([a.item, "wrong"]);
        if (w?.value === 1 && leavesWrongBook(await db.attempt.where("item").equals(a.item).toArray())) {
          await db.flag.put({ item: a.item, kind: "wrong", value: 0, updated_at: Date.now() });
          await enqueue("flag", [a.item, "wrong"]);
        }
      }
    }
  });
  kick();
}

export interface ReviewQueue {
  /** 今天要複習的題目 ID（到期的在前，再來是新卡），已套每日上限 */
  items: string[];
  dueTotal: number; // 今天到期（含逾期）的總數，不受上限
  newTotal: number; // 等著開始的新卡總數
  dueShown: number;
  newShown: number;
  doneToday: { reviews: number; news: number };
  cfg: SrsConfig;
}

/** 今日複習的題目（規格書 §5.4）。在複習模式下做過的才算進每日上限。 */
export async function reviewQueue(now = Date.now()): Promise<ReviewQueue> {
  const cfg = await srsConfig();
  const today = startOfDay(now);
  const tomorrow = today + DAY_MS;
  const logs = await db.review_log.where("reviewed_at").aboveOrEqual(today).toArray();
  const modes = await db.attempt.bulkGet(logs.map((l) => l.attempt_id ?? ""));
  let reviews = 0;
  let news = 0;
  logs.forEach((l, i) => {
    if (modes[i] && modes[i]!.mode !== "review") return;
    if (l.state_before === 0) news++;
    else reviews++;
  });
  const all = await db.srs_state.toArray();
  const live = all.filter((s) => !s.suspended);
  const due = live.filter((s) => s.state !== 0 && s.due < tomorrow).sort((a, b) => a.due - b.due);
  const fresh = live.filter((s) => s.state === 0).sort((a, b) => a.updated_at - b.updated_at);
  const d = due.slice(0, Math.max(0, cfg.maxReviews - reviews));
  const n = fresh.slice(0, Math.max(0, cfg.maxNew - news));
  return {
    items: [...d, ...n].map((s) => keyId(s.item)),
    dueTotal: due.length,
    newTotal: fresh.length,
    dueShown: d.length,
    newShown: n.length,
    doneToday: { reviews, news },
    cfg,
  };
}

/** 未來幾天每天到期的題數（第 0 天含逾期）。 */
export async function dueForecast(days: number, now = Date.now()): Promise<number[]> {
  const today = startOfDay(now);
  const out = new Array<number>(days).fill(0);
  await db.srs_state.each((s) => {
    if (s.suspended || s.state === 0) return;
    const i = Math.max(0, Math.floor((startOfDay(s.due) - today) / DAY_MS));
    if (i < days) out[i]++;
  });
  return out;
}

export const srs = {
  /** 手動加入複習：新卡（已在排程裡但被停用的，恢復追蹤）。 */
  async add(id: string): Promise<void> {
    const key = await srsKey(id);
    const t = Date.now();
    await db.transaction("rw", db.srs_state, db.outbox, async () => {
      const cur = await db.srs_state.get(key);
      if (cur && !cur.suspended) return;
      await db.srs_state.put(cur ? { ...cur, suspended: 0, updated_at: t } : { item: key, due: t, stability: null, difficulty: null, reps: 0, lapses: 0, state: 0, last_review: null, suspended: 0, updated_at: t });
      await enqueue("srs_state", key);
    });
    kick();
  },

  /** 移出複習（停用，評分紀錄保留；之後再加入會接著原本的進度）。 */
  async remove(id: string): Promise<void> {
    const key = await srsKey(id);
    await db.transaction("rw", db.srs_state, db.outbox, async () => {
      const n = await db.srs_state.where("item").equals(key).modify({ suspended: 1, updated_at: Date.now() });
      if (n) await enqueue("srs_state", key);
    });
    kick();
  },

  /** 設定頁「重算排程」：從 review_log 逐筆重播，重建每一題的 srs_state。回傳重算幾題、有幾題結果不同。 */
  async rebuild(): Promise<{ items: number; changed: number }> {
    const cfg = await srsConfig();
    const f = scheduler(cfg.retention);
    const logs = await db.review_log.toArray();
    const by = new Map<string, ReviewLog[]>();
    for (const l of logs) by.set(l.item, [...(by.get(l.item) ?? []), l]);
    let changed = 0;
    const t = Date.now();
    await db.transaction("rw", db.srs_state, db.outbox, async () => {
      for (const [item, list] of by) {
        const cur = await db.srs_state.get(item);
        const next = replay(item, list, f);
        if (!next) continue;
        next.suspended = cur?.suspended ?? 0;
        next.updated_at = t;
        const same = cur && cur.due === next.due && cur.reps === next.reps && cur.state === next.state && Math.abs((cur.stability ?? 0) - (next.stability ?? 0)) < 1e-9;
        if (same) continue;
        changed++;
        await db.srs_state.put(next);
        await enqueue("srs_state", item);
      }
    });
    if (changed) kick();
    return { items: by.size, changed };
  },
};

export type { SrsState };
