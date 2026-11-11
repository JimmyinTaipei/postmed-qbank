// 筆記修訂的純函式（不碰資料庫）：疊加顯示、常數。kbPatches.ts 用；node 測試直接 import 這個檔。
// 執行測試：cd app && node --experimental-strip-types --test src/data/kb-core.test.ts

import { sha1 } from "../lib/sha1.ts";
import type { ContentPatch, FieldMark, KbBlock, KbDoc, PatchNote } from "./types.ts";

/** 網站上可以改內容的區塊（圖、程式碼、HTML、表格群組請在 Mac 上用 Typora 改）。 */
export const KB_EDITABLE = new Set<KbBlock["type"]>(["heading", "list_item", "paragraph", "table", "quote", "math"]);
/** 可以刪的區塊（標題不能刪：會連整節一起刪）。 */
export const KB_DELETABLE = new Set<KbBlock["type"]>(["list_item", "paragraph", "table", "quote", "math", "figure", "code", "table_group", "rule"]);
/** 新筆記的檔名：不能有 / \ : * ? " < > |、不能以 . 開頭，最多 80 字（與 pmq 相同）。 */
export const KB_BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

const OPEN: ContentPatch["status"][] = ["pending", "conflict"];

function patchNote(p: ContentPatch): PatchNote {
  try {
    const n = JSON.parse(p.note ?? "{}");
    return n && typeof n === "object" ? n : {};
  } catch {
    return {};
  }
}

/** 已寫回主檔、之後內容沒再改（與 patches.ts 的 isWritten 相同）。 */
function isWritten(p: ContentPatch): boolean {
  const n = patchNote(p);
  return !!n.written && n.wv === sha1(p.value);
}

export interface KbMark {
  state: FieldMark;
  kind: "md" | "insert" | "delete";
  patch: ContentPatch;
}

export interface KbOverlay {
  /** 套上修訂的筆記（區塊是複本） */
  doc: KbDoc;
  /** bid → 這個區塊的修訂標記（插入的新列點 bid 是 "new-<修訂 ID>"） */
  marks: Map<string, KbMark[]>;
  /** 對不到區塊的修訂（Mac 上改過筆記，原本的區塊找不到） */
  unanchored: ContentPatch[];
  /** 內容包裡原本的區塊（存修訂時算 base_h 用） */
  base: Map<string, KbBlock>;
}

export const kbTarget = (key: string, bid: string) => `kb:${key}#${bid}`;
export const isNewBid = (bid: string) => bid.startsWith("new-");
const bidOf = (p: ContentPatch) => p.target.slice(p.target.lastIndexOf("#") + 1);

function index(blocks: KbBlock[], parent: KbBlock | null, out: Map<string, { b: KbBlock; list: KbBlock[]; parent: KbBlock | null }>) {
  for (const b of blocks) {
    out.set(b.bid, { b, list: blocks, parent });
    index(b.children, b, out);
  }
  return out;
}

/** 新增筆記的修訂 → 科目與檔名。 */
export function draftName(p: ContentPatch): { subject: string; name: string } {
  const [subject, ...rest] = p.target.slice("kbnew:".length).split("/");
  return { subject, name: rest.join("/") };
}

/** 內容包的筆記＋修訂 → 畫面上顯示的筆記。 */
export function applyKbPatches(doc: KbDoc, rows: ContentPatch[]): KbOverlay {
  const base = new Map([...index(doc.blocks, null, new Map())].map(([k, v]) => [k, v.b]));
  if (!rows.length) return { doc, marks: new Map(), unanchored: [], base };
  const out: KbDoc = { ...doc, blocks: structuredClone(doc.blocks) };
  const idx = index(out.blocks, null, new Map());
  let hashes: Set<string> | null = null;
  const published = (h?: string) => !!h && (hashes ??= new Set([...base.values()].map((b) => sha1(b.md)))).has(h);
  const marks = new Map<string, KbMark[]>();
  const mark = (bid: string, m: KbMark) => marks.set(bid, [...(marks.get(bid) ?? []), m]);
  const unanchored: ContentPatch[] = [];

  // 同一個區塊同一種修訂只取最新的一筆；照建立時間套，插入的順序才穩定
  const latest = new Map<string, ContentPatch>();
  for (const p of rows) {
    const k = `${p.target}|${p.field}`;
    const cur = latest.get(k);
    if (OPEN.includes(p.status) && (!cur || p.created_at > cur.created_at)) latest.set(k, p);
  }
  for (const p of [...latest.values()].sort((a, b) => a.created_at - b.created_at)) {
    const bid = bidOf(p);
    const n = patchNote(p);
    const written = isWritten(p);
    const hit = idx.get(bid);
    // 已寫回、線上已經是新版（pmq publish 還沒把它標 merged）：不用再疊
    if (written && p.field !== "delete" && published(n.wh)) continue;
    if (written && p.field === "delete" && !hit) continue;
    if (!hit) {
      unanchored.push(p);
      continue;
    }
    const orig = base.get(bid)!;
    const state: FieldMark =
      p.status === "conflict" ? "conflict" : written ? "written" : n.written || n.resolved === "mine" ? "pending" : sha1(orig.md) !== p.base_h ? "stale" : "pending";
    const show = state === "pending" || state === "written";
    if (p.field === "md") {
      if (show) hit.b.md = p.value;
      mark(bid, { state, kind: "md", patch: p });
    } else if (p.field === "insert_after" || p.field === "insert_child") {
      const child = p.field === "insert_child";
      const sib = child ? hit.b.children.find((k) => k.type === "list_item") : hit.b;
      const nb: KbBlock = {
        bid: `new-${p.id}`,
        type: "list_item",
        md: p.value,
        level: (hit.b.level ?? 0) + (child ? 1 : 0),
        ordered: child ? (sib?.ordered ?? false) : hit.b.ordered,
        children: [],
      };
      if (child) hit.b.children.unshift(nb);
      else {
        // 接在錨點後面；同一個錨點後面已經有插入的，接在它們後面
        let at = hit.list.indexOf(hit.b) + 1;
        while (at < hit.list.length && isNewBid(hit.list[at].bid)) at++;
        hit.list.splice(at, 0, nb);
      }
      mark(nb.bid, { state, kind: "insert", patch: p });
    } else if (p.field === "delete") {
      mark(bid, { state, kind: "delete", patch: p });
    }
  }
  return { doc: out, marks, unanchored, base };
}

