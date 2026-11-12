// 管理 API（規格書 §7.2-5、§11-5）：pmq 只透過這裡上傳內容，不用 Cloudflare API token。
// 全部要 Authorization: Bearer <ADMIN_TOKEN>（index.ts 統一檢查）。

import type { Context } from "hono";
import type { App } from "./env";
import { buildExportZip, nightlyBackup, restore } from "./backup";
import { bindValues, MAX_PUSH, rowFromDb } from "./sync";
import { invalid, SYNC_TABLE } from "../../schema/ts/sync-tables";
import { contentType, sha256Hex } from "./util";

const BLOB_KEY = /^(c\/(?!manifest\.json$)(?!manifests\/)[^\u0000]+\.json|[am]\/[0-9a-f]{64}\.[a-z0-9]{2,5})$/;
const HASHED_C = /-([0-9a-f]{12})\.json$/;

async function listAll(c: Context<App>, prefix: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const list = await c.env.R2.list({ prefix, cursor, limit: 1000 });
    for (const o of list.objects) out.set(o.key, o.size);
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return out;
}

/** POST /api/admin/have {keys:[…]} → {missing:[…]} */
export async function have(c: Context<App>): Promise<Response> {
  const body = await c.req.json<{ keys?: string[] }>().catch(() => ({}) as { keys?: string[] });
  const keys = Array.isArray(body.keys) ? body.keys.filter((k) => typeof k === "string") : [];
  const [cs, as, ms] = await Promise.all([listAll(c, "c/"), listAll(c, "a/"), keys.some((k) => k.startsWith("m/")) ? listAll(c, "m/") : new Map()]);
  return c.json({ missing: keys.filter((k) => !cs.has(k) && !as.has(k) && !ms.has(k)) });
}

/** PUT /api/admin/blob/<key>：檔名裡的雜湊必須與內容相符，傳錯的檔進不來。 */
export async function putBlob(c: Context<App>): Promise<Response> {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/admin/blob/".length));
  if (!BLOB_KEY.test(key)) return c.json({ error: "bad_key", key }, 400);
  const data = new Uint8Array(await c.req.arrayBuffer());
  const sha = await sha256Hex(data);
  if (key.startsWith("a/") || key.startsWith("m/")) {
    if (key.slice(2, 66) !== sha) return c.json({ error: "hash_mismatch", key, sha }, 400);
  } else {
    const m = HASHED_C.exec(key);
    if (!m || m[1] !== sha.slice(0, 12)) return c.json({ error: "hash_mismatch", key, sha }, 400);
  }
  await c.env.R2.put(key, data, { httpMetadata: { contentType: contentType(key) }, sha256: sha });
  return c.json({ ok: true, key, bytes: data.length });
}

/** GET /api/admin/blob/<key>：卡片的媒體檔（pmq anki export 打包用）、內容包的檔（pmq publish --subject 讀線上的 taxonomy 等）。 */
export async function getBlob(c: Context<App>): Promise<Response> {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/admin/blob/".length));
  if (!BLOB_KEY.test(key)) return c.json({ error: "bad_key", key }, 400);
  const obj = await c.env.R2.get(key);
  if (!obj) return c.json({ error: "not_found", key }, 404);
  return new Response(obj.body, { headers: { "Content-Type": contentType(key) } });
}

interface Manifest {
  version: number;
  generated: string;
  counts: Record<string, number>;
  files: {
    taxonomy: string; index: Record<string, string>; packs: Record<string, string>; kb?: Record<string, string>; cases?: string;
    kbcat?: string; kbrel?: string; vocab?: Record<string, string>;
  };
}

function manifestFiles(m: Manifest): string[] {
  const f = m.files;
  return [f.taxonomy, ...Object.values(f.index ?? {}), ...Object.values(f.packs ?? {}), ...Object.values(f.kb ?? {}), ...(f.cases ? [f.cases] : []),
    ...(f.kbcat ? [f.kbcat] : []), ...(f.kbrel ? [f.kbrel] : []), ...Object.values(f.vocab ?? {})];
}

/** POST /api/admin/manifest：確認引用的檔都已上傳，才換版（原子；中途失敗線上仍是舊版）。 */
export async function putManifest(c: Context<App>): Promise<Response> {
  const text = await c.req.text();
  let m: Manifest;
  try {
    m = JSON.parse(text);
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (!m?.files?.taxonomy || typeof m.files.index !== "object" || typeof m.files.packs !== "object") return c.json({ error: "bad_manifest" }, 400);
  const need = manifestFiles(m);
  const have = await listAll(c, "c/");
  const missing = need.filter((k) => !have.has(k));
  if (missing.length) return c.json({ error: "missing_files", missing: missing.slice(0, 50), count: missing.length }, 409);
  const h = (await sha256Hex(text)).slice(0, 16);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await c.env.R2.put(`c/manifests/${stamp}-${h}.json`, text, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  await c.env.R2.put("c/manifest.json", text, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  await c.env.DB.prepare("INSERT INTO meta (key, value) VALUES ('manifest_h', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(h).run();
  return c.json({ ok: true, manifest_h: h, files: need.length });
}

/** GET /api/admin/manifest：目前線上的 manifest（pmq publish --subject 要保留其他科的檔）。 */
export async function getManifest(c: Context<App>): Promise<Response> {
  const obj = await c.env.R2.get("c/manifest.json");
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": "application/json; charset=utf-8" } });
}

/** GET /api/admin/export：與設定頁「匯出全部」相同的 zip（pmq backup pull 用）。 */
export async function exportZip(c: Context<App>): Promise<Response> {
  const { zip } = await buildExportZip(c.env);
  return new Response(zip, { headers: { "Content-Type": "application/zip", "Cache-Control": "no-store" } });
}

/** POST /api/admin/restore：body 是 ndjson（{"table","row"}）。D1 不是空的就拒絕。 */
export async function restoreRoute(c: Context<App>): Promise<Response> {
  try {
    const res = await restore(c.env, await c.req.text());
    return c.json(res, res.ok ? 200 : 409);
  } catch (e) {
    return c.json({ ok: false, message: String((e as Error).message ?? e) }, 400);
  }
}

/** POST /api/admin/backup：立刻做一次每晚的備份（測試與手動補做用）。 */
export async function backupNow(c: Context<App>): Promise<Response> {
  return c.json(await nightlyBackup(c.env));
}

/** GET /api/admin/usage：D1 大小、R2 用量（規格書 §11-6）。 */
export async function usage(c: Context<App>): Promise<Response> {
  const r = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM attempt").run();
  const d1Bytes = (r.meta as { size_after?: number }).size_after ?? null;
  const prefixes: Record<string, { objects: number; bytes: number }> = {};
  let cursor: string | undefined;
  do {
    const list = await c.env.R2.list({ cursor, limit: 1000 });
    for (const o of list.objects) {
      const p = o.key.split("/")[0] + "/";
      const e = (prefixes[p] ??= { objects: 0, bytes: 0 });
      e.objects++;
      e.bytes += o.size;
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  const total = Object.values(prefixes).reduce((s, e) => s + e.bytes, 0);
  // 個人資料各表的筆數（pmq status 用；有 deleted 欄的不算已刪除的）
  const names = Object.keys(SYNC_TABLE);
  const counted = await c.env.DB.batch(
    names.map((t) => c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}${SYNC_TABLE[t].cols.includes("deleted") ? " WHERE COALESCE(deleted, 0) = 0" : ""}`)),
  );
  const rows = Object.fromEntries(names.map((t, i) => [t, (counted[i].results[0] as { n: number }).n]));
  return c.json({ d1_bytes: d1Bytes, r2_bytes: total, r2: prefixes, rows });
}

// ---------- 清掉沒用到的圖（pmq prune） ----------

/** GET /api/admin/list?prefix=a/ → {objects:[[key, size, uploaded(ms)], …]}。只開放 a/（內容圖）。 */
export async function listObjects(c: Context<App>): Promise<Response> {
  const prefix = c.req.query("prefix") ?? "";
  if (prefix !== "a/") return c.json({ error: "bad_prefix" }, 400);
  const objects: [string, number, number][] = [];
  let cursor: string | undefined;
  do {
    const list = await c.env.R2.list({ prefix, cursor, limit: 1000 });
    for (const o of list.objects) objects.push([o.key, o.size, o.uploaded.getTime()]);
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return c.json({ objects });
}

const ASSET_KEY = /^a\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/;

/** POST /api/admin/delete {keys:[…]}：刪內容圖（只收 a/<sha>.<ext>，一次最多 1000 個）。哪些沒用到由 pmq 從目前的 manifest 算。 */
export async function deleteObjects(c: Context<App>): Promise<Response> {
  let keys: unknown;
  try {
    keys = ((await c.req.json()) as { keys?: unknown }).keys;
  } catch {
    return c.json({ error: "bad_json" }, 400);
  }
  if (!Array.isArray(keys) || keys.length > 1000 || !keys.every((k) => typeof k === "string" && ASSET_KEY.test(k))) return c.json({ error: "bad_keys" }, 400);
  if (keys.length) await c.env.R2.delete(keys as string[]);
  return c.json({ ok: true, deleted: keys.length });
}

// ---------- 修訂佇列（規格書 §7.3；pmq patches list／pull／resolve 用） ----------

const PATCH_COLS = ["id", "target", "field", "base_h", "value", "status", "note", "device", "created_at", "updated_at"];
const PATCH_STATUS = new Set(["pending", "merged", "conflict", "rejected"]);

/** GET /api/admin/patches?status=pending,conflict（預設這兩種；all＝全部） */
export async function listPatches(c: Context<App>): Promise<Response> {
  const want = (c.req.query("status") ?? "pending,conflict").split(",").filter((s) => s === "all" || PATCH_STATUS.has(s));
  const sql = want.includes("all")
    ? `SELECT ${PATCH_COLS.join(", ")} FROM content_patch ORDER BY created_at`
    : `SELECT ${PATCH_COLS.join(", ")} FROM content_patch WHERE status IN (${want.map(() => "?").join(", ") || "''"}) ORDER BY created_at`;
  const { results } = await c.env.DB.prepare(sql).bind(...(want.includes("all") ? [] : want)).all();
  return c.json({ patches: results });
}

/**
 * POST /api/admin/patches {updates:[{id, status, note, base_h?, expect}]}
 * expect＝pmq 讀到的 updated_at；裝置在這之後又改過（updated_at 不同）就不覆寫，回報 stale，
 * 避免把使用者剛存的新修訂蓋掉。寫入時 updated_at 取「現在」與「原值＋1」較大者，裝置下次同步就會拿到。
 */
export async function updatePatches(c: Context<App>): Promise<Response> {
  const body = await c.req.json<{ updates?: unknown }>().catch(() => ({}) as { updates?: unknown });
  if (!Array.isArray(body.updates)) return c.json({ error: "bad_request" }, 400);
  const out: { id: string; ok: boolean; reason?: string }[] = [];
  for (const u of body.updates as Record<string, unknown>[]) {
    const id = String(u?.id ?? "");
    const status = String(u?.status ?? "");
    if (!id || !PATCH_STATUS.has(status)) {
      out.push({ id, ok: false, reason: "bad_update" });
      continue;
    }
    const note = u.note === null || u.note === undefined ? null : typeof u.note === "string" ? u.note : JSON.stringify(u.note);
    const baseH = typeof u.base_h === "string" ? u.base_h : null;
    const expect = typeof u.expect === "number" ? u.expect : null;
    const r = await c.env.DB.prepare(
      `UPDATE content_patch SET status = ?, note = ?, base_h = coalesce(?, base_h), device = 'pmq',
         updated_at = max(updated_at + 1, ?) WHERE id = ? AND (? IS NULL OR updated_at = ?)`,
    )
      .bind(status, note, baseH, Date.now(), id, expect, expect)
      .run();
    out.push(r.meta.changes ? { id, ok: true } : { id, ok: false, reason: "stale_or_missing" });
  }
  return c.json({ results: out });
}

// ---------- 卡片匯入（第 5 階段；pmq anki import 用） ----------

const IMPORT_TABLES = new Set(["deck", "card", "media", "srs_state", "review_log"]);

/**
 * POST /api/admin/rows {mode:"insert"|"upsert", rows:[{table,row}]}，每批最多 500 列。
 * insert：主鍵已存在就不動（重複匯入不覆寫網站上改過的內容與進度）。
 * upsert：覆寫（pmq anki import --update，只用在卡片內容）。寫入後由觸發程序給 seq，裝置下次同步拿到。
 */
export async function importRows(c: Context<App>): Promise<Response> {
  const body = await c.req.json<{ mode?: string; rows?: unknown }>().catch(() => ({}) as { mode?: string; rows?: unknown });
  if (!Array.isArray(body.rows)) return c.json({ error: "bad_request", message: "缺少 rows" }, 400);
  if (body.rows.length > MAX_PUSH) return c.json({ error: "too_many", message: `每批最多 ${MAX_PUSH} 列` }, 413);
  const upsert = body.mode === "upsert";
  const stmts: D1PreparedStatement[] = [];
  const rejected: { i: number; error: string }[] = [];
  let inserted = 0;
  body.rows.forEach((e: unknown, i: number) => {
    const { table, row } = (e ?? {}) as { table?: string; row?: unknown };
    const t = typeof table === "string" && IMPORT_TABLES.has(table) ? SYNC_TABLE[table] : undefined;
    if (!t) return rejected.push({ i, error: "不能匯入這張表" });
    const bad = invalid(t, row);
    if (bad) return rejected.push({ i, error: bad });
    const cols = t.cols.map((x) => `"${x}"`).join(", ");
    const marks = t.cols.map(() => "?").join(", ");
    const set = t.cols.filter((x) => !t.pk.includes(x)).map((x) => `"${x}" = excluded."${x}"`).join(", ");
    const sql = upsert && t.kind === "lww"
      ? `INSERT INTO ${t.name} (${cols}) VALUES (${marks}) ON CONFLICT(${t.pk.join(", ")}) DO UPDATE SET ${set} RETURNING 1 AS w`
      : `INSERT OR IGNORE INTO ${t.name} (${cols}) VALUES (${marks}) RETURNING 1 AS w`;
    stmts.push(c.env.DB.prepare(sql).bind(...bindValues(t, row as Record<string, unknown>)));
  });
  if (stmts.length) {
    const res = await c.env.DB.batch(stmts);
    // meta.changes 會把觸發程序補 seq 的那次更新也算進去，所以用 RETURNING 的列數
    for (const r of res) inserted += r.results.length;
  }
  return c.json({ ok: true, written: inserted, rejected });
}

/** GET /api/admin/cards：全部牌組、卡片、卡片的排程與評分紀錄（pmq anki export 用）。 */
export async function exportCards(c: Context<App>): Promise<Response> {
  const [decks, cards, srs, logs] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT * FROM deck WHERE deleted = 0"),
    c.env.DB.prepare("SELECT * FROM card WHERE deleted = 0"),
    c.env.DB.prepare("SELECT * FROM srs_state WHERE item LIKE 'card:%'"),
    c.env.DB.prepare("SELECT * FROM review_log WHERE item LIKE 'card:%' ORDER BY reviewed_at"),
  ]);
  const conv = (name: string, rows: unknown[]) => rows.map((r) => rowFromDb(SYNC_TABLE[name], r as Record<string, unknown>));
  return c.json({
    decks: conv("deck", decks.results),
    cards: conv("card", cards.results),
    srs_state: conv("srs_state", srs.results),
    review_log: conv("review_log", logs.results),
  });
}
