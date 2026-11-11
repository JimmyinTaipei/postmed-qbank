// 同步（規格書 §8）。
//
// - 所有寫入先進 IndexedDB 與待送佇列（db.outbox），畫面立刻更新；這裡負責送出與拉回。
// - 推：POST /api/sync/push，每批最多 500 列；送的是那一列「目前」的值，同一列改很多次只送一次。
//   作答（attempt）要等封存（open = 0）後才送；open 欄位本身不送。
// - 拉：GET /api/sync/pull?since=<游標>，用與伺服器相同的「較新者勝」規則（schema/ts/sync-tables.ts）套用。
// - 觸發：App 開啟、回到前景、恢復連線、寫入後 2 秒、畫面開著時每 30 秒、手動按同步。
//   規格書寫「有待送資料時每 60 秒」；這裡改成畫面開著時不論有沒有待送都每 30 秒拉一次：
//   另一台裝置「寫入後 2 秒送出＋最多 30 秒後被拉到」，才能保證 60 秒內出現（完成標準）。
// - 每次拉完順便比對內容 manifest 的雜湊，有新版就在背景下載（content.ts）。

import { useSyncExternalStore } from "react";
import { pickCols, pkOf, SYNC_TABLE, SYNC_TABLES, wins, type SyncTable } from "@schema/ts/sync-tables";
import { updateContent } from "./content";
import { db } from "./db";
import { isOnline, Offline, requestJson, Unauthorized } from "./net";
import { prefs } from "./prefs";
import type { SyncState } from "./types";

const BATCH = 500;
const PERIOD_MS = 30_000;
const DEBOUNCE_MS = 2_000;

type Row = Record<string, unknown>;
type Table = (typeof db)["attempt"];

const tableOf = (name: string) => (db as unknown as Record<string, Table>)[name];
/** Dexie 的主鍵：單欄是值，複合鍵（flag）是陣列。 */
const dexieKey = (t: SyncTable, row: Row): string | string[] => (t.pk.length === 1 ? String(row[t.pk[0]]) : t.pk.map((k) => String(row[k])));

// ---------- 狀態 ----------

interface Internal {
  running: boolean;
  lastOk: number | null;
  error: string | null;
  offline: boolean;
  pending: number;
}
let st: Internal = { running: false, lastOk: null, error: null, offline: !isOnline(), pending: 0 };
let snapshot: SyncState = derive();
const listeners = new Set<() => void>();

function derive(): SyncState {
  if (st.offline) return { kind: "offline", count: st.pending };
  if (st.running) return { kind: "syncing" };
  if (st.error) return { kind: "error", message: st.error };
  if (st.pending > 0) return { kind: "pending", count: st.pending };
  if (st.lastOk) return { kind: "synced", at: st.lastOk };
  return { kind: "pending", count: 0 };
}
function set(p: Partial<Internal>) {
  st = { ...st, ...p };
  const next = derive();
  if (JSON.stringify(next) !== JSON.stringify(snapshot)) {
    snapshot = next;
    listeners.forEach((fn) => fn());
  }
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

/** 最後一次成功同步的時間與錯誤原因（設定頁顯示）。 */
export function useSyncDetail(): { lastOk: number | null; error: string | null; pending: number } {
  useSyncState();
  return { lastOk: st.lastOk, error: st.error, pending: st.pending };
}

async function countPending(): Promise<number> {
  const n = await db.outbox.count();
  set({ pending: n });
  return n;
}

// ---------- 佇列 ----------

/** 把一列放進待送佇列（personal.ts 在每個寫入的同一個交易裡呼叫）。 */
export function enqueue(table: string, key: string | string[]): Promise<number> {
  return db.outbox.add({ table, key, at: Date.now() });
}

let debounce: ReturnType<typeof setTimeout> | null = null;
/** 寫入後呼叫：2 秒內沒有新的寫入就送出。 */
export function kick(): void {
  void countPending();
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void syncNow();
  }, DEBOUNCE_MS);
}

// ---------- 推 ----------

async function pushOnce(): Promise<number> {
  const entries = await db.outbox.orderBy("n").limit(BATCH * 4).toArray();
  if (!entries.length) return 0;
  const seen = new Set<string>();
  const sendRows: { table: string; row: Row }[] = [];
  const sentN: number[] = [];
  for (const e of entries) {
    const t = SYNC_TABLE[e.table];
    if (!t) {
      sentN.push(e.n!); // 不同步的表：直接丟掉
      continue;
    }
    const id = e.table + "\u0000" + (Array.isArray(e.key) ? e.key.join("\u0001") : e.key);
    if (seen.has(id)) {
      sentN.push(e.n!);
      continue;
    }
    const row = (await tableOf(e.table).get(e.key as never)) as Row | undefined;
    if (!row) {
      sentN.push(e.n!);
      continue;
    }
    if (e.table === "attempt" && row.open === 1) continue; // 還沒封存：留在佇列
    if (sendRows.length >= BATCH) break;
    seen.add(id);
    sendRows.push({ table: e.table, row: pickCols(t, row) });
    sentN.push(e.n!);
  }
  if (sendRows.length) {
    const res = await requestJson<{ ok: boolean; rejected: { i: number; error: string }[] }>("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: prefs.device(), rows: sendRows }),
    });
    if (res.rejected.length) {
      // 伺服器拒收的列（格式不對）重送也不會過：記下原因，不卡住後面的資料
      console.warn("[sync] 伺服器拒收", res.rejected.map((r) => ({ ...r, row: sendRows[r.i] })));
      set({ error: `有 ${res.rejected.length} 筆資料伺服器拒收（${res.rejected[0].error}）` });
    }
  }
  await db.outbox.bulkDelete(sentN);
  return sendRows.length;
}

// ---------- 拉 ----------

interface PullRes {
  rows: { table: string; row: Row }[];
  cursor: number;
  head: number;
  more: boolean;
  manifest_h: string | null;
}

async function applyRows(rows: { table: string; row: Row }[]): Promise<void> {
  if (!rows.length) return;
  const names = [...new Set(rows.map((r) => r.table))].filter((n) => SYNC_TABLE[n]);
  await db.transaction("rw", names.map(tableOf), async () => {
    for (const { table, row } of rows) {
      const t = SYNC_TABLE[table];
      if (!t) continue;
      const tb = tableOf(table);
      const key = dexieKey(t, row);
      const cur = (await tb.get(key as never)) as Row | undefined;
      if (cur && t.kind === "append") {
        if (cur.seq == null && row.seq != null) await tb.update(key as never, { seq: row.seq } as never);
        continue;
      }
      if (!wins(t, row, cur)) continue;
      await tb.put(row as never);
    }
  });
}

async function pullAll(): Promise<string | null> {
  let since = ((await db.kv.get("sync.cursor"))?.value as number | undefined) ?? 0;
  let manifestH: string | null = null;
  for (let guard = 0; guard < 1000; guard++) {
    const res = await requestJson<PullRes>(`/api/sync/pull?since=${since}`, { timeoutMs: 60_000 });
    manifestH = res.manifest_h;
    if (res.head < since) {
      // 伺服器的資料庫換過（pmq restore）：從頭拉
      since = 0;
      await db.kv.put({ key: "sync.cursor", value: 0 });
      continue;
    }
    await applyRows(res.rows);
    since = res.cursor;
    await db.kv.put({ key: "sync.cursor", value: since });
    if (!res.more) break;
  }
  return manifestH;
}

// ---------- 主流程 ----------

let inflight: Promise<void> | null = null;

/** 立刻同步一次（推→拉→檢查內容新版）。同時只會跑一個。 */
export function syncNow(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    if (!isOnline()) {
      set({ offline: true });
      await countPending();
      return;
    }
    set({ running: true });
    try {
      while ((await pushOnce()) > 0) {
        /* 一批一批送到送完 */
      }
      const manifestH = await pullAll();
      const remaining = await countPending();
      set({ running: false, offline: false, lastOk: Date.now(), error: remaining && st.error ? st.error : null });
      void updateContent(manifestH).catch(() => undefined);
    } catch (e) {
      if (e instanceof Offline) set({ running: false, offline: true });
      else if (e instanceof Unauthorized) set({ running: false, error: "登入已過期，請重新登入" });
      else set({ running: false, error: e instanceof Error ? e.message : String(e) });
      await countPending();
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

let started = false;

/** App 啟動時呼叫一次（main.tsx）。 */
export function startSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  // 上次沒正常離開而留下的未封存作答：封存後送出
  void db.attempt
    .where("open")
    .equals(1)
    .primaryKeys()
    .then(async (ids) => {
      if (!ids.length) return;
      await db.transaction("rw", db.attempt, db.outbox, async () => {
        await db.attempt.where("open").equals(1).modify({ open: 0 });
        for (const id of ids) await enqueue("attempt", id);
      });
    })
    .finally(() => void syncNow());
  window.addEventListener("online", () => {
    set({ offline: false });
    void syncNow();
  });
  window.addEventListener("offline", () => set({ offline: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, PERIOD_MS);
  if (navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined);
}

/** 清除本機資料後，下次同步從頭拉。 */
export async function resetCursor(): Promise<void> {
  await db.kv.put({ key: "sync.cursor", value: 0 });
}

export { pkOf, SYNC_TABLES };
