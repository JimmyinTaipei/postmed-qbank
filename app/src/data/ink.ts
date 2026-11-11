// 手寫區與圖上標記的資料（第 6 階段，規格書 §4.6 ink、§9.6、§9.7）。
//
// - 一個對象的一頁一列：id = "ink:" + target + "#" + page。兩台裝置離線各畫同一頁，同步後留較新的那一份。
// - strokes 欄位是「JSON → deflate（zlib）→ base64」的字串；讀的時候反過來。壓縮用瀏覽器內建的 CompressionStream。
// - 刪除是軟刪除（deleted = 1、strokes 清空），才同步得到另一台裝置。
// - 圖上標記是個人資料，不進修訂佇列、不會動主檔。

import { MAX_INK_CHARS } from "@schema/ts/sync-tables";
import { db } from "./db";
import { enqueue, kick } from "./sync";
import { decodeInk, EMPTY, encodeInk, roundStroke } from "./ink-core";
import type { Attempt, InkDoc, InkRow } from "./types";

export { decodeInk, encodeInk, roundStroke };

const now = () => Date.now();

export const inkId = (target: string, page = 0) => `ink:${target}#${page}`;

// 解壓結果快取：同一列（id＋updated_at）不重複解壓
const cache = new Map<string, Promise<InkDoc>>();
export function readInk(row: InkRow | null | undefined): Promise<InkDoc> {
  if (!row || row.deleted) return Promise.resolve({ ...EMPTY, strokes: [] });
  const k = row.id + "@" + row.updated_at;
  let p = cache.get(k);
  if (!p) {
    p = decodeInk(row.strokes);
    cache.set(k, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
  }
  return p;
}

export class InkTooLarge extends Error {
  constructor() {
    super("這一頁的筆跡太多，存不下了（上限 1 MB）。請加一頁再寫。");
  }
}

// ---------- 寫入 ----------

async function put(row: InkRow): Promise<void> {
  await db.transaction("rw", db.ink, db.outbox, async () => {
    await db.ink.put(row);
    await enqueue("ink", row.id);
  });
  kick();
}

export const ink = {
  /** 存一頁。筆畫全空時改成刪除。回傳存進去的列（畫面用 updated_at 認出「這是我剛存的」）。 */
  async save(target: string, page: number, doc: InkDoc, w: number, h: number): Promise<InkRow> {
    const id = inkId(target, page);
    const cur = await db.ink.get(id);
    const t = Math.max(now(), (cur?.updated_at ?? 0) + 1);
    if (!doc.strokes.length) {
      const row: InkRow = { id, target, page, strokes: "", w: Math.round(w), h: Math.round(h), updated_at: t, deleted: 1 };
      if (cur && !cur.deleted) await put(row);
      return row;
    }
    const strokes = await encodeInk({ ...doc, v: 1, strokes: doc.strokes.map(roundStroke) });
    if (strokes.length > MAX_INK_CHARS) throw new InkTooLarge();
    const row: InkRow = { id, target, page, strokes, w: Math.round(w), h: Math.round(h), updated_at: t, deleted: 0 };
    await put(row);
    return row;
  },

  /** 刪掉一列（失聯的圖上標記「刪除」）。 */
  async remove(row: InkRow): Promise<void> {
    await put({ ...row, strokes: "", deleted: 1, updated_at: Math.max(now(), row.updated_at + 1) });
  },

  /**
   * 把一列標記移到另一張圖（失聯的圖上標記「移到這張圖」）。座標等比例換算到那張圖；那張圖已經有標記就接在後面。
   */
  async move(row: InkRow, toTarget: string, w: number, h: number): Promise<void> {
    const from = await readInk(row);
    const dest = await db.ink.get(inkId(toTarget, 0));
    const base = dest && !dest.deleted ? await readInk(dest) : null;
    const space = dest && !dest.deleted ? { w: dest.w, h: dest.h } : { w, h };
    const kx = space.w / Math.max(1, row.w);
    const ky = space.h / Math.max(1, row.h);
    const moved = from.strokes.map((s) => ({ ...s, size: s.size * Math.sqrt(kx * ky), pts: s.pts.map(([x, y, p]) => [x * kx, y * ky, p] as [number, number, number]) }));
    await ink.save(toTarget, 0, { ...(base ?? { v: 1 }), v: 1, strokes: [...(base?.strokes ?? []), ...moved] }, space.w, space.h);
    await ink.remove(row);
  },

  /** 這個對象有沒有（沒刪掉的）筆跡 */
  async has(target: string): Promise<boolean> {
    const rows = await db.ink.where("target").equals(target).toArray();
    return rows.some((r) => !r.deleted);
  },

  /** 清除一個對象的所有頁（手寫區的「清空」只清一頁，用 save 空白）。 */
  async clearTarget(target: string): Promise<void> {
    const rows = await db.ink.where("target").equals(target).toArray();
    for (const r of rows) if (!r.deleted) await put({ ...r, strokes: "", deleted: 1, updated_at: Math.max(now(), r.updated_at + 1) });
  },

  /**
   * 物理（per_attempt）：重新作答這一題時，把上一次的手寫與這一題所有圖上標記清掉（規格書 §9.6、§9.7、§14-9）。
   * 「上一次的」= 在上次作答之前畫的，或是在已作答畫面上畫的（doc.att 有值）。
   * 還沒作答就離開、之後回來接著寫的，不清。
   */
  async resetForAttempt(qid: string, last: Attempt | null): Promise<number> {
    if (!last) return 0;
    const base = `q:${qid}`;
    const rows = await db.ink.where("target").startsWith(base).filter((r) => !r.deleted && (r.target === base || r.target.startsWith(base + "/"))).toArray();
    let n = 0;
    for (const r of rows) {
      const doc = await readInk(r);
      if (r.updated_at < last.created_at || doc.att) {
        await put({ ...r, strokes: "", deleted: 1, updated_at: Math.max(now(), r.updated_at + 1) });
        n++;
      }
    }
    return n;
  },
};
