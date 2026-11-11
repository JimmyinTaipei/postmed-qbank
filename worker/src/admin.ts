// 管理 API（規格書 §7.2-5、§11-5）：pmq 只透過這裡上傳內容，不用 Cloudflare API token。
// 全部要 Authorization: Bearer <ADMIN_TOKEN>（index.ts 統一檢查）。

import type { Context } from "hono";
import type { App } from "./env";
import { buildExportZip, nightlyBackup, restore } from "./backup";
import { contentType, sha256Hex } from "./util";

const BLOB_KEY = /^(c\/(?!manifest\.json$)(?!manifests\/)[^\u0000]+\.json|a\/[0-9a-f]{64}\.[a-z0-9]{2,5})$/;
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
  const [cs, as] = await Promise.all([listAll(c, "c/"), listAll(c, "a/")]);
  return c.json({ missing: keys.filter((k) => !cs.has(k) && !as.has(k)) });
}

/** PUT /api/admin/blob/<key>：檔名裡的雜湊必須與內容相符，傳錯的檔進不來。 */
export async function putBlob(c: Context<App>): Promise<Response> {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/admin/blob/".length));
  if (!BLOB_KEY.test(key)) return c.json({ error: "bad_key", key }, 400);
  const data = new Uint8Array(await c.req.arrayBuffer());
  const sha = await sha256Hex(data);
  if (key.startsWith("a/")) {
    if (key.slice(2, 66) !== sha) return c.json({ error: "hash_mismatch", key, sha }, 400);
  } else {
    const m = HASHED_C.exec(key);
    if (!m || m[1] !== sha.slice(0, 12)) return c.json({ error: "hash_mismatch", key, sha }, 400);
  }
  await c.env.R2.put(key, data, { httpMetadata: { contentType: contentType(key) }, sha256: sha });
  return c.json({ ok: true, key, bytes: data.length });
}

interface Manifest {
  version: number;
  generated: string;
  counts: Record<string, number>;
  files: { taxonomy: string; index: Record<string, string>; packs: Record<string, string>; kb?: Record<string, string>; cases?: string };
}

function manifestFiles(m: Manifest): string[] {
  const f = m.files;
  return [f.taxonomy, ...Object.values(f.index ?? {}), ...Object.values(f.packs ?? {}), ...Object.values(f.kb ?? {}), ...(f.cases ? [f.cases] : [])];
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
  return c.json({ d1_bytes: d1Bytes, r2_bytes: total, r2: prefixes });
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
