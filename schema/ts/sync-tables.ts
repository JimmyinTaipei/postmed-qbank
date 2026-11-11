// 會同步的個人資料表（規格書 §4.6、§8）。Worker 與 App 共用這一份，兩邊的「誰勝出」規則才會一樣。
//
// 傳輸格式：每一列就是 App 裡 Dexie 存的物件（JSON 欄位是物件／陣列，不是字串）；
// Worker 寫 D1 前把 json 欄位轉成字串，讀出來再轉回去。
//
// 規則：
// - append（只增）：同一主鍵已經存在就不動（INSERT OR IGNORE），重送無害。
// - lww（較新者勝）：order 依序比較，較大者勝；全部相同時視為同一筆、不覆寫。
//   規格書 §8：updated_at 較新者勝，相同時 device 字串較大者勝；沒有 device 欄位的表改用 order 裡最後一欄當平手時的依據。
//   srs_state 以 last_review 較新者為準（§8），null 視為最舊。

export interface SyncTable {
  name: string;
  pk: string[];
  cols: string[];
  json: string[];
  kind: "append" | "lww";
  order: string[];
}

export const SYNC_TABLES: SyncTable[] = [
  {
    name: "attempt",
    pk: ["id"],
    cols: ["id", "item", "session_id", "mode", "chosen", "correct", "confidence", "elapsed_ms", "content_h", "device", "created_at"],
    json: ["chosen"],
    kind: "append",
    order: [],
  },
  {
    name: "review_log",
    pk: ["id"],
    cols: ["id", "item", "rating", "state_before", "elapsed_days", "scheduled_days", "duration_ms", "attempt_id", "device", "reviewed_at"],
    json: [],
    kind: "append",
    order: [],
  },
  {
    name: "session",
    pk: ["id"],
    cols: ["id", "mode", "filter", "items", "cursor", "started_at", "ended_at", "time_limit_s", "score", "device", "updated_at", "deleted"],
    json: ["filter", "items"],
    kind: "lww",
    order: ["updated_at", "device"],
  },
  {
    name: "srs_state",
    pk: ["item"],
    cols: ["item", "due", "stability", "difficulty", "reps", "lapses", "state", "last_review", "suspended", "updated_at"],
    json: [],
    kind: "lww",
    order: ["last_review", "updated_at", "due"],
  },
  {
    name: "flag",
    pk: ["item", "kind"],
    cols: ["item", "kind", "value", "updated_at"],
    json: [],
    kind: "lww",
    order: ["updated_at", "value"],
  },
  {
    name: "note",
    pk: ["id"],
    cols: ["id", "target", "body_md", "updated_at", "deleted"],
    json: [],
    kind: "lww",
    order: ["updated_at", "body_md"],
  },
  {
    name: "highlight",
    pk: ["id"],
    cols: ["id", "target", "quote", "prefix", "suffix", "start", "end", "color", "comment_md", "updated_at", "deleted"],
    json: [],
    kind: "lww",
    order: ["updated_at", "color"],
  },
  {
    // 第 6 階段：手寫區與圖上標記。一個對象的一頁一列（id = ink:<target>#<page>），較新者勝；
    // strokes 是 deflate＋base64 的字串，單列上限 MAX_INK_CHARS。
    name: "ink",
    pk: ["id"],
    cols: ["id", "target", "page", "strokes", "w", "h", "updated_at", "deleted"],
    json: [],
    kind: "lww",
    order: ["updated_at", "strokes"],
  },
  {
    // 第 3 階段：修訂佇列。裝置建立與改值；pmq（管理 API）改 status 與 note。
    name: "content_patch",
    pk: ["id"],
    cols: ["id", "target", "field", "base_h", "value", "status", "note", "device", "created_at", "updated_at"],
    json: [],
    kind: "lww",
    order: ["updated_at", "device"],
  },
  {
    // 第 5 階段：卡片。牌組與卡片「較新者勝」；媒體只增（檔案本體在 R2 m/<sha>.<副檔名>，內容永不變）。
    name: "deck",
    pk: ["id"],
    cols: ["id", "name", "subject", "parent", "updated_at", "deleted"],
    json: [],
    kind: "lww",
    order: ["updated_at", "name"],
  },
  {
    name: "card",
    pk: ["id"],
    cols: ["id", "deck_id", "kind", "front_md", "back_md", "tags", "origin", "updated_at", "deleted"],
    json: ["tags", "origin"],
    kind: "lww",
    order: ["updated_at", "front_md"],
  },
  {
    name: "media",
    pk: ["sha"],
    cols: ["sha", "mime", "bytes", "created_at"],
    json: [],
    kind: "append",
    order: [],
  },
  {
    name: "setting",
    pk: ["key"],
    cols: ["key", "value", "updated_at"],
    json: [],
    kind: "lww",
    order: ["updated_at", "value"],
  },
];

/** ink.strokes 字串長度上限：壓縮後 1 MB（規格書 §4.6）的 base64 約 1.37 M 字元。 */
export const MAX_INK_CHARS = 1_400_000;

export const SYNC_TABLE = Object.fromEntries(SYNC_TABLES.map((t) => [t.name, t])) as Record<string, SyncTable>;

type Row = Record<string, unknown>;

function cmp(a: unknown, b: unknown): number {
  // null／undefined 最小（srs_state.last_review 沒複習過）
  const an = a === null || a === undefined;
  const bn = b === null || b === undefined;
  if (an || bn) return an && bn ? 0 : an ? -1 : 1;
  if (typeof a === "number" && typeof b === "number") return a === b ? 0 : a < b ? -1 : 1;
  const sa = String(a);
  const sb = String(b);
  return sa === sb ? 0 : sa < sb ? -1 : 1;
}

/** incoming 是否應該取代 existing。existing 不存在時一律是。 */
export function wins(t: SyncTable, incoming: Row, existing: Row | undefined | null): boolean {
  if (!existing) return true;
  if (t.kind === "append") return false;
  for (const col of t.order) {
    const c = cmp(incoming[col], existing[col]);
    if (c !== 0) return c > 0;
  }
  return false;
}

/** 主鍵字串（Dexie 複合鍵與 D1 主鍵共用的表示法）。 */
export function pkOf(t: SyncTable, row: Row): string {
  return t.pk.map((k) => String(row[k])).join("\u0001");
}

/** 只留 cols 列出的欄位（去掉本機專用的 open、seq 等），缺的欄位補 null。 */
export function pickCols(t: SyncTable, row: Row): Row {
  const out: Row = {};
  for (const c of t.cols) out[c] = row[c] === undefined ? null : row[c];
  return out;
}

/** 檢查一列的形狀：主鍵與 NOT NULL 的時間欄位要有值。不合格回傳原因。 */
export function invalid(t: SyncTable, row: unknown): string | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return "不是物件";
  const r = row as Row;
  for (const k of t.pk) if (typeof r[k] !== "string" || !(r[k] as string).length) return `缺少主鍵 ${k}`;
  for (const k of t.order) if (k === "updated_at" && typeof r[k] !== "number") return "updated_at 不是數字";
  if (t.name === "attempt" && typeof r.created_at !== "number") return "created_at 不是數字";
  if (t.name === "review_log" && typeof r.reviewed_at !== "number") return "reviewed_at 不是數字";
  if (t.name === "ink" && (typeof r.strokes !== "string" || r.strokes.length > MAX_INK_CHARS)) return "手寫資料太大或格式不對";
  return null;
}
