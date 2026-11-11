// 同步 API（規格書 §8）。
// 推：POST /api/sync/push {device, rows:[{table,row}]}，每批最多 500 列。
//   只增表 INSERT OR IGNORE（重送無害）；其他表照 schema/ts/sync-tables.ts 的 order 比較，較新者才覆寫。
//   seq 由 D1 的觸發程序給（migrations/0001_init.sql）。
// 拉：GET /api/sync/pull?since=<seq> → seq 大於游標的列（依 seq 排序）與新游標。

import type { Context } from "hono";
import { invalid, pickCols, SYNC_TABLE, SYNC_TABLES, type SyncTable } from "../../schema/ts/sync-tables";
import type { App, Env } from "./env";

export const MAX_PUSH = 500;
const PULL_LIMIT = 2000;
/** 一列可能很大的表，一次拉少一點（ink 一列最多約 1.4 MB）。 */
const TABLE_LIMIT: Record<string, number> = { ink: 100 };

const q = (c: string) => `"${c}"`;

function upsertSql(t: SyncTable): string {
  const cols = t.cols.map(q).join(", ");
  const marks = t.cols.map(() => "?").join(", ");
  if (t.kind === "append") return `INSERT OR IGNORE INTO ${t.name} (${cols}) VALUES (${marks})`;
  const set = t.cols.filter((c) => !t.pk.includes(c)).map((c) => `${q(c)} = excluded.${q(c)}`).join(", ");
  // (A1 > B1) OR (A1 = B1 AND ((A2 > B2) OR (A2 = B2 AND (…))))；null 視為最小
  const v = (side: string, c: string) => `coalesce(${side}.${q(c)}, -9e18)`;
  let cond = "0";
  for (let i = t.order.length - 1; i >= 0; i--) {
    const c = t.order[i];
    cond = `(${v("excluded", c)} > ${v(t.name, c)} OR (${v("excluded", c)} = ${v(t.name, c)} AND ${cond}))`;
  }
  return `INSERT INTO ${t.name} (${cols}) VALUES (${marks}) ON CONFLICT(${t.pk.map(q).join(", ")}) DO UPDATE SET ${set} WHERE ${cond}`;
}

const SQL = Object.fromEntries(SYNC_TABLES.map((t) => [t.name, upsertSql(t)]));

export function bindValues(t: SyncTable, row: Record<string, unknown>): unknown[] {
  const r = pickCols(t, row);
  return t.cols.map((c) => {
    const v = r[c];
    if (t.json.includes(c)) return v === null ? null : JSON.stringify(v);
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v !== null && typeof v === "object") return JSON.stringify(v);
    return v;
  });
}

export function rowFromDb(t: SyncTable, r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of t.cols) {
    const v = r[c];
    if (t.json.includes(c) && typeof v === "string") {
      try {
        out[c] = JSON.parse(v);
      } catch {
        out[c] = v;
      }
    } else out[c] = v;
  }
  out.seq = r.seq;
  return out;
}

export async function currentSeq(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT CAST(value AS INTEGER) AS v FROM meta WHERE key = 'sync_seq'").first<{ v: number }>();
  return r?.v ?? 0;
}

export async function push(c: Context<App>): Promise<Response> {
  let body: { device?: unknown; rows?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request", message: "不是 JSON" }, 400);
  }
  if (!Array.isArray(body.rows)) return c.json({ error: "bad_request", message: "缺少 rows" }, 400);
  if (body.rows.length > MAX_PUSH) return c.json({ error: "too_many", message: `每批最多 ${MAX_PUSH} 列` }, 413);

  const rejected: { i: number; error: string }[] = [];
  const stmts: { i: number; stmt: D1PreparedStatement }[] = [];
  body.rows.forEach((entry: unknown, i: number) => {
    const e = entry as { table?: unknown; row?: unknown };
    const t = typeof e?.table === "string" ? SYNC_TABLE[e.table] : undefined;
    if (!t) return rejected.push({ i, error: "不認得的表" });
    const bad = invalid(t, e.row);
    if (bad) return rejected.push({ i, error: bad });
    stmts.push({ i, stmt: c.env.DB.prepare(SQL[t.name]).bind(...bindValues(t, e.row as Record<string, unknown>)) });
  });

  if (stmts.length) {
    try {
      await c.env.DB.batch(stmts.map((s) => s.stmt));
    } catch {
      // 整批失敗（某一列違反 NOT NULL 等）：逐列重試，把壞的挑出來回報，其餘照收
      for (const s of stmts) {
        try {
          await s.stmt.run();
        } catch (err) {
          rejected.push({ i: s.i, error: String((err as Error).message ?? err).slice(0, 200) });
        }
      }
    }
  }
  return c.json({ ok: true, accepted: body.rows.length - rejected.length, rejected, seq: await currentSeq(c.env) });
}

export async function pull(c: Context<App>): Promise<Response> {
  const since = Math.max(0, Number(c.req.query("since") ?? 0) || 0);
  const limit = Math.min(PULL_LIMIT, Math.max(1, Number(c.req.query("limit") ?? PULL_LIMIT) || PULL_LIMIT));
  const lim = (t: SyncTable) => Math.min(limit, TABLE_LIMIT[t.name] ?? limit);
  const stmts = SYNC_TABLES.map((t) =>
    c.env.DB.prepare(`SELECT ${[...t.cols, "seq"].map(q).join(", ")} FROM ${t.name} WHERE seq > ? ORDER BY seq LIMIT ?`).bind(since, lim(t)),
  );
  stmts.push(c.env.DB.prepare("SELECT key, value FROM meta WHERE key IN ('sync_seq', 'manifest_h')"));
  const res = await c.env.DB.batch(stmts);
  const all: { table: string; row: Record<string, unknown>; seq: number }[] = [];
  let full = false;
  // 有表被截斷時，游標不能超過那張表拿到的最後一列（否則它後面還沒拿的列會被跳過）
  let cut = Infinity;
  SYNC_TABLES.forEach((t, i) => {
    const rows = res[i].results as Record<string, unknown>[];
    if (rows.length === lim(t)) {
      full = true;
      cut = Math.min(cut, rows[rows.length - 1].seq as number);
    }
    for (const r of rows) all.push({ table: t.name, row: rowFromDb(t, r), seq: r.seq as number });
  });
  all.sort((a, b) => a.seq - b.seq);
  const take = all.filter((r) => r.seq <= cut).slice(0, limit);
  const meta = Object.fromEntries((res[SYNC_TABLES.length].results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const head = Number(meta.sync_seq ?? 0);
  const more = full || all.length > limit;
  // 沒有更多時游標直接跳到目前的最大號（中間被「較舊、不覆寫」吃掉的號碼不必再問）
  const cursor = more ? take[take.length - 1].seq : Math.max(since, head);
  // head < since：伺服器的資料庫被換過（pmq restore 灌回新的 D1），裝置要從 0 重新拉
  return c.json({ rows: take.map(({ table, row }) => ({ table, row })), cursor, head, more, manifest_h: meta.manifest_h ?? null });
}
