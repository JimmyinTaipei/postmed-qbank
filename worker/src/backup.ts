// 備份與匯出（規格書 §1.5）。
// - 每晚（cron）把 D1 的個人資料表倒成 backup/YYYY-MM-DD.ndjson.gz 存 R2；保留 30 天＋每月 1 日那份。
// - 「匯出全部」與 pmq backup pull 下載同一個 zip：tables/<表>.ndjson、notes/*.md、meta.json、README.txt。
// 格式全是開放格式，不靠 Cloudflare 也讀得懂；pmq restore 可以把 zip 灌回空的 D1 或本機 SQLite。

import { strToU8, zipSync } from "fflate";
import type { Env } from "./env";
import { b64, taipeiDate } from "./util";

/** 所有個人資料表（不含登入用的 auth_*、meta）。順序就是 restore 的順序。 */
export const PERSONAL_TABLES = [
  "attempt", "session", "srs_state", "review_log", "flag", "note", "highlight", "ink",
  "content_patch", "deck", "card", "media", "setting",
] as const;

const PAGE = 5000;

function encodeRow(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) out[k] = v instanceof ArrayBuffer ? { $b64: b64(new Uint8Array(v)) } : Array.isArray(v) && k === "strokes" ? { $b64: b64(new Uint8Array(v as number[])) } : v;
  return out;
}

/** 逐表、分頁讀出（依 rowid），每列呼叫一次 fn。 */
export async function eachRow(env: Env, fn: (table: string, row: Record<string, unknown>) => void): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of PERSONAL_TABLES) {
    counts[t] = 0;
    let last = 0;
    for (;;) {
      const { results } = await env.DB.prepare(`SELECT rowid AS _rowid, * FROM ${t} WHERE rowid > ? ORDER BY rowid LIMIT ?`).bind(last, PAGE).all<Record<string, unknown>>();
      for (const r of results) {
        last = r._rowid as number;
        delete r._rowid;
        fn(t, encodeRow(r));
        counts[t]++;
      }
      if (results.length < PAGE) break;
    }
  }
  return counts;
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 120);
}

const README = `後醫題庫 個人資料匯出

tables/<表>.ndjson  每行一列（JSON），欄位與 D1 相同（規格書 §4.6）。JSON 欄位（chosen、filter、items…）是字串。
                    二進位欄位（ink.strokes）寫成 {"$b64": "…"}。
notes/<對象>.md     每則個人筆記一個 Markdown 檔（第 3 階段起才有內容）。
meta.json           匯出時間、各表筆數、同步序號。

灌回：在 Mac 上 bin/pmq restore <這個 zip> --sqlite <新檔.sqlite>（本機 SQLite），
或 --remote（空的 D1；非空時會拒絕）。
`;

export async function buildExportZip(env: Env): Promise<{ zip: Uint8Array; counts: Record<string, number> }> {
  const lines: Record<string, string[]> = {};
  const files: Record<string, Uint8Array> = {};
  const counts = await eachRow(env, (t, row) => {
    (lines[t] ??= []).push(JSON.stringify(row));
    if (t === "note" && !row.deleted) {
      const name = `notes/${safeName(String(row.target))}-${String(row.id).slice(-6)}.md`;
      files[name] = strToU8(`<!-- ${row.target}｜更新 ${new Date(row.updated_at as number).toISOString()} -->\n\n${row.body_md}\n`);
    }
  });
  for (const t of PERSONAL_TABLES) files[`tables/${t}.ndjson`] = strToU8((lines[t] ?? []).map((l) => l + "\n").join(""));
  const seq = await env.DB.prepare("SELECT value FROM meta WHERE key = 'sync_seq'").first<{ value: string }>();
  const now = Date.now();
  files["meta.json"] = strToU8(JSON.stringify({ format: 1, generated: new Date(now).toISOString(), date: taipeiDate(now), sync_seq: Number(seq?.value ?? 0), counts }, null, 1));
  files["README.txt"] = strToU8(README);
  return { zip: zipSync(files, { level: 6 }), counts };
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 每晚的備份。回傳寫入的鍵與筆數。 */
export async function nightlyBackup(env: Env, now = Date.now()): Promise<{ key: string; counts: Record<string, number>; pruned: string[] }> {
  const parts: string[] = [];
  const counts = await eachRow(env, (table, row) => parts.push(JSON.stringify({ table, row })));
  const key = `backup/${taipeiDate(now)}.ndjson.gz`;
  await env.R2.put(key, await gzip(parts.map((l) => l + "\n").join("")), {
    httpMetadata: { contentType: "application/gzip" },
    customMetadata: { counts: JSON.stringify(counts) },
  });
  // 保留：最近 30 天，以及每月 1 日那一份
  const keep = taipeiDate(now - 30 * 86_400_000);
  const pruned: string[] = [];
  let cursor: string | undefined;
  do {
    const list = await env.R2.list({ prefix: "backup/", cursor });
    for (const o of list.objects) {
      const m = /^backup\/(\d{4}-\d{2}-(\d{2}))\.ndjson\.gz$/.exec(o.key);
      if (m && m[1] < keep && m[2] !== "01") {
        await env.R2.delete(o.key);
        pruned.push(o.key);
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  return { key, counts, pruned };
}

/** 灌回空的 D1（pmq restore --remote）。body 是 ndjson：{"table","row"}。非空時拒絕。 */
export async function restore(env: Env, ndjson: string): Promise<{ ok: boolean; message?: string; counts?: Record<string, number> }> {
  for (const t of PERSONAL_TABLES) {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>();
    if (r && r.n > 0) return { ok: false, message: `資料庫不是空的（${t} 有 ${r.n} 筆），拒絕灌回。` };
  }
  const known = new Set<string>(PERSONAL_TABLES);
  const counts: Record<string, number> = {};
  let batch: D1PreparedStatement[] = [];
  const flush = async () => {
    if (batch.length) await env.DB.batch(batch);
    batch = [];
  };
  for (const line of ndjson.split("\n")) {
    if (!line.trim()) continue;
    const { table, row } = JSON.parse(line) as { table: string; row: Record<string, unknown> };
    if (!known.has(table)) throw new Error(`不認得的表 ${table}`);
    const cols = Object.keys(row).filter((k) => k !== "seq" && /^[a-z_]+$/.test(k));
    const vals = cols.map((k) => {
      const v = row[k] as unknown;
      if (v && typeof v === "object" && "$b64" in (v as object)) {
        const bin = atob((v as { $b64: string }).$b64);
        return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
      }
      return v;
    });
    batch.push(env.DB.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...vals));
    counts[table] = (counts[table] ?? 0) + 1;
    if (batch.length >= 200) await flush();
  }
  await flush();
  return { ok: true, counts };
}
