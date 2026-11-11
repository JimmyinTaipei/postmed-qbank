// 筆記（資料庫）的修訂（第 4 階段後半）：改一個區塊、在列點後面／底下插入新列點、刪除區塊、新增一份筆記。
// 和題目的修訂一樣存在 content_patch（同步、修訂佇列、pmq patches pull 寫回 Mac、pmq publish 後標 merged）。
//
// target：區塊是 "kb:<key>#<bid>"；新增筆記是 "kbnew:<科目>/<檔名>"。
// base_h：發佈時那個區塊網站格式 md 的 SHA-1（pmq 的 kb_patches.py 用同一套）。
// 寫回後 bid 可能會變（bid 由區塊開頭的字算出來），所以「已寫回」的修訂用 note.wh（寫回後的雜湊）判斷線上是否已是新版。

import { useLiveQuery } from "dexie-react-hooks";
import { sha1 } from "@/lib/sha1";
import { ulid } from "@/lib/ulid";
import { db } from "./db";
import { kbTarget } from "./kb-core";
import { isWritten, openPatch, put } from "./patches";
import { prefs } from "./prefs";
import type { ContentPatch, KbBlock, KbPatchField } from "./types";

export * from "./kb-core";


const OPEN: ContentPatch["status"][] = ["pending", "conflict"];
const now = () => Date.now();

/** 一份筆記上進行中的修訂（含已寫回、待發佈）。 */
export function useKbPatches(key: string | undefined): ContentPatch[] | undefined {
  return useLiveQuery(async () => (key ? (await db.content_patch.where("target").startsWith(`kb:${key}#`).toArray()).filter((p) => OPEN.includes(p.status)) : []), [key]);
}

/** 網站上新增、還沒合併的筆記。 */
export function useKbDrafts(): ContentPatch[] | undefined {
  return useLiveQuery(async () => (await db.content_patch.where("target").startsWith("kbnew:").toArray()).filter((p) => OPEN.includes(p.status)).sort((a, b) => b.created_at - a.created_at));
}

export function useKbDraft(id: string | undefined): ContentPatch | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.content_patch.get(id)) ?? null) : null), [id]);
}

async function upsert(target: string, field: KbPatchField, baseH: string, value: string, sameAsBase: boolean): Promise<"ok" | "conflict"> {
  const cur = await openPatch(target, field);
  if (cur?.status === "conflict") return "conflict";
  const t = now();
  if (cur) {
    // 改回和內容包一樣：還沒寫回的直接放棄；已寫回的要再寫一次（主檔已經是修訂版）
    if (sameAsBase && !isWritten(cur)) await put({ ...cur, status: "rejected", device: prefs.device(), updated_at: Math.max(t, cur.updated_at + 1) });
    else if (cur.value !== value) await put({ ...cur, value, device: prefs.device(), updated_at: Math.max(t, cur.updated_at + 1) });
  } else if (!sameAsBase) {
    await put({ id: ulid(), target, field, base_h: baseH, value, status: "pending", note: null, device: prefs.device(), created_at: t, updated_at: t });
  }
  return "ok";
}

export const kbPatches = {
  /** 改一個區塊。base 是內容包裡原本的區塊（overlay.base）。 */
  edit(key: string, base: KbBlock, value: string) {
    return upsert(kbTarget(key, base.bid), "md", sha1(base.md), value, value.trim() === base.md.trim());
  },
  /** 在列點後面（同一層）或底下（第一個子項）插入一個新列點。 */
  insert(key: string, anchor: KbBlock, child: boolean, value: string) {
    return upsert(kbTarget(key, anchor.bid), child ? "insert_child" : "insert_after", sha1(anchor.md), value, !value.trim());
  },
  /** 改還沒寫回（或已寫回、待發佈）的新列點；清空＝取消新增。 */
  async editInserted(p: ContentPatch, value: string) {
    const t = Math.max(now(), p.updated_at + 1);
    if (!value.trim() && !isWritten(p)) await put({ ...p, status: "rejected", device: prefs.device(), updated_at: t });
    else if (value !== p.value && value.trim()) await put({ ...p, value, device: prefs.device(), updated_at: t });
  },
  /** 刪除區塊（寫回 Mac 時連同底下的子項一起刪）。 */
  remove(key: string, base: KbBlock) {
    return upsert(kbTarget(key, base.bid), "delete", sha1(base.md), "1", false);
  },
  /** 新增一份筆記（寫回到 Mac 的 _收件匣/）。回傳修訂 ID；同名的草稿已存在回 null。 */
  async create(subject: string, name: string, md: string): Promise<string | null> {
    const target = `kbnew:${subject}/${name}`;
    if (await openPatch(target, "create")) return null;
    const t = now();
    const id = ulid();
    await put({ id, target, field: "create", base_h: "-", value: md, status: "pending", note: null, device: prefs.device(), created_at: t, updated_at: t });
    return id;
  },
  async saveDraft(p: ContentPatch, md: string) {
    if (md === p.value) return;
    await put({ ...p, value: md, device: prefs.device(), updated_at: Math.max(now(), p.updated_at + 1) });
  },
};
