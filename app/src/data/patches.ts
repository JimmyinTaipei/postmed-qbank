// 修訂佇列（規格書 §4.6 content_patch、§7.3、§8）、個人筆記（note）、螢光筆（highlight）。
//
// 修訂：在網站上改題目 → 寫一筆 content_patch（status = pending）→ 同步 → Mac 上 `pmq patches pull` 寫回主檔
// → `pmq publish` 後 pmq 把它改成 merged。同一題同一欄位只有一筆「進行中」的修訂（再改就改同一筆）。
//
// 疊加顯示（§8）：pending 且 base_h（或寫回後的雜湊 note.wh）等於目前內容包該欄位的雜湊 → 顯示修訂內容；
// 不等 → 顯示內容包並標「修訂待處理」；conflict → 顯示內容包並標「衝突」。
//
// 欄位雜湊與 pmq 的 patches.field_h 同一套：ques／idea／sol 用內容包的 h；answer、chap、tags 是正規化 JSON 的 SHA-1。

import { parseOptions } from "@schema/ts/options.ts";
import { sha1 } from "@/lib/sha1";
import { ulid } from "@/lib/ulid";
import { db } from "./db";
import { prefs } from "./prefs";
import { enqueue, kick } from "./sync";
import type { ContentPatch, FieldMark, Highlight, HighlightColor, Note, PatchField, PatchInfo, PatchNote, Question } from "./types";

const now = () => Date.now();
const OPEN: ContentPatch["status"][] = ["pending", "conflict"];

export const FIELD_NAME: Record<PatchField, string> = {
  ques: "題幹與選項",
  idea: "思路",
  sol: "詳解",
  answer: "答案",
  chap: "章節",
  tags: "標籤",
  human_verified: "已確認",
};

export type AnswerValue = Pick<Question["answer"], "mode" | "keys" | "text">;

export function answerValue(q: Question): AnswerValue {
  return { mode: q.answer.mode, keys: [...q.answer.keys], text: q.answer.text };
}

function sortedTags(t: Question["tags"]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(t).sort()) out[k] = [...((t as Record<string, string[]>)[k] ?? [])];
  return out;
}

/** 該欄位目前的「值」（與修訂的 value 同格式）。 */
export function fieldValue(q: Question, field: PatchField): string {
  switch (field) {
    case "ques":
    case "idea":
    case "sol":
      return q[field];
    case "answer":
      return JSON.stringify(answerValue(q));
    case "chap":
      return q.chap ?? "";
    case "tags":
      return JSON.stringify(sortedTags(q.tags));
    case "human_verified":
      return q.sol_meta.human_verified ? "1" : "";
  }
}

/** 欄位雜湊（pmq 的 field_h）。 */
export function fieldHash(q: Question, field: PatchField): string {
  if (field === "ques" || field === "idea" || field === "sol") return q.h[field];
  if (field === "human_verified") return "-";
  return sha1(fieldValue(q, field));
}

export function patchNote(p: ContentPatch): PatchNote {
  try {
    const n = JSON.parse(p.note ?? "{}");
    return n && typeof n === "object" ? n : {};
  } catch {
    return {};
  }
}

/** 已寫回主檔、之後內容沒再改。 */
export function isWritten(p: ContentPatch): boolean {
  const n = patchNote(p);
  return !!n.written && n.wv === sha1(p.value);
}

/** 這一筆進行中的修訂在畫面上是什麼狀態（相對於目前的內容包 q）。 */
export function markOf(p: ContentPatch, q: Question): FieldMark | null {
  if (p.status === "conflict") return "conflict";
  if (p.status !== "pending") return null;
  if (p.field === "human_verified" && q.sol_meta.human_verified) return null; // 已發佈
  const n = patchNote(p);
  const h = fieldHash(q, p.field);
  // 已寫回主檔：主檔就是這個內容，照修訂顯示（已發佈、等 pmq 標 merged 時不再加標記）
  if (isWritten(p)) return h === n.wh && p.field !== "human_verified" ? null : "written";
  // 寫回過、之後又改（主檔是我們上一版）或衝突時選了「保留我的版本」：內容包落後是正常的，照修訂顯示
  if (n.written || n.resolved === "mine") return "pending";
  if (h !== p.base_h && p.field !== "human_verified") return "stale";
  return "pending";
}

function setField(q: Question, field: PatchField, value: string): void {
  switch (field) {
    case "ques": {
      q.ques = value;
      const parsed = parseOptions(value);
      q.opt = parsed ? parsed.opt : null;
      q.opt_span = parsed ? parsed.span : null;
      return;
    }
    case "idea":
    case "sol":
      q[field] = value;
      return;
    case "answer": {
      const a = JSON.parse(value) as AnswerValue;
      q.answer = { ...q.answer, mode: a.mode, keys: a.keys, text: a.text };
      if (a.mode === "all") q.qtype = "multi";
      else if (a.mode === "single" || a.mode === "any") q.qtype = "single";
      return;
    }
    case "chap":
      q.chap = value;
      return;
    case "tags":
      q.tags = JSON.parse(value);
      return;
    case "human_verified":
      q.sol_meta = { ...q.sol_meta, human_verified: true };
      return;
  }
}

/** 內容包的題目＋這一題的修訂 → 畫面上顯示的題目。沒有任何修訂時回傳原物件。 */
export function applyPatches(base: Question, rows: ContentPatch[]): Question {
  if (!rows.length) return base;
  const q: Question = { ...base, answer: { ...base.answer }, sol_meta: { ...base.sol_meta } };
  const marks: PatchInfo["marks"] = {};
  const latest = new Map<PatchField, ContentPatch>();
  for (const p of rows) {
    if (!OPEN.includes(p.status)) continue;
    const cur = latest.get(p.field);
    if (!cur || p.created_at > cur.created_at) latest.set(p.field, p);
  }
  for (const [field, p] of latest) {
    const m = markOf(p, base);
    if (m) marks[field] = m;
    if (p.status === "pending" && m !== "stale") {
      try {
        setField(q, field, p.value);
      } catch {
        /* 壞掉的修訂值：照內容包顯示 */
      }
    }
  }
  const answerRevised = rows.some((p) => p.field === "answer" && (p.status === "pending" || p.status === "merged"));
  q.patch = { marks, answerRevised, base };
  return q;
}

async function put(p: ContentPatch): Promise<void> {
  await db.transaction("rw", db.content_patch, db.outbox, async () => {
    await db.content_patch.put(p);
    await enqueue("content_patch", p.id);
  });
  kick();
}

async function openPatch(target: string, field: PatchField): Promise<ContentPatch | undefined> {
  const rows = await db.content_patch.where("target").equals(target).toArray();
  return rows.filter((p) => p.field === field && OPEN.includes(p.status)).sort((a, b) => b.created_at - a.created_at)[0];
}

function fresh(base: Question, field: PatchField, value: string): ContentPatch {
  const t = now();
  return { id: ulid(), target: `q:${base.id}`, field, base_h: fieldHash(base, field), value, status: "pending", note: null, device: prefs.device(), created_at: t, updated_at: t };
}

export const patches = {
  /**
   * 存一筆修訂。base 是內容包的版本（q.patch?.base ?? q）。
   * 改答案或詳解時一併標「已確認」（規格書 §4.4）。回傳 false 表示這一段有衝突、要先到修訂佇列處理。
   */
  async save(base: Question, field: PatchField, value: string): Promise<boolean> {
    const target = `q:${base.id}`;
    const cur = await openPatch(target, field);
    if (cur?.status === "conflict") return false;
    const text = field === "ques" || field === "idea" || field === "sol";
    const same = text ? value.trim() === fieldValue(base, field).trim() : value === fieldValue(base, field);
    if (cur) {
      // 改回和題庫一樣：還沒寫回的修訂直接放棄；已寫回的要再寫一次（主檔已經是修訂版）
      if (same && !isWritten(cur)) await put({ ...cur, status: "rejected", device: prefs.device(), updated_at: Math.max(now(), cur.updated_at + 1) });
      else if (cur.value !== value) await put({ ...cur, value, device: prefs.device(), updated_at: Math.max(now(), cur.updated_at + 1) });
    } else if (!same) {
      await put(fresh(base, field, value));
    }
    if (field === "answer" || field === "sol") await patches.markVerified(base);
    return true;
  },

  /** ⋯ 選單「標為已確認」。 */
  async markVerified(base: Question): Promise<void> {
    if (base.sol_meta.human_verified) return;
    const rows = await db.content_patch.where("target").equals(`q:${base.id}`).toArray();
    if (rows.some((p) => p.field === "human_verified" && (p.status === "pending" || p.status === "merged"))) return;
    await put(fresh(base, "human_verified", "1"));
  },

  /** 衝突時「保留我的版本」：下次 pull 用網站的版本蓋過主檔。 */
  async keepMine(id: string): Promise<void> {
    const p = await db.content_patch.get(id);
    const c = p && patchNote(p).conflict;
    if (!p || !c) return;
    await put({ ...p, base_h: c.theirs_h, status: "pending", note: JSON.stringify({ resolved: "mine" }), device: prefs.device(), updated_at: Math.max(now(), p.updated_at + 1) });
  },

  /** 放棄這筆修訂（還沒寫回的；或衝突時「用 Mac 的版本」）。 */
  async discard(id: string): Promise<void> {
    const p = await db.content_patch.get(id);
    if (!p) return;
    await put({ ...p, status: "rejected", device: prefs.device(), updated_at: Math.max(now(), p.updated_at + 1) });
  },
};

// ---------- 個人筆記 ----------

export const noteId = (target: string) => "n:" + target;

export const notes = {
  async save(target: string, body: string): Promise<void> {
    const id = noteId(target);
    await db.transaction("rw", db.note, db.outbox, async () => {
      const cur = await db.note.get(id);
      const t = Math.max(now(), (cur?.updated_at ?? 0) + 1);
      const row: Note = body.trim() ? { id, target, body_md: body, updated_at: t, deleted: 0 } : { id, target, body_md: cur?.body_md ?? "", updated_at: t, deleted: 1 };
      await db.note.put(row);
      await enqueue("note", id);
    });
    kick();
  },
  remove(target: string): Promise<void> {
    return notes.save(target, "");
  },
};

// ---------- 螢光筆 ----------

export const highlights = {
  async add(h: Pick<Highlight, "target" | "quote" | "prefix" | "suffix" | "start" | "end" | "color">): Promise<string> {
    const row: Highlight = { ...h, id: ulid(), comment_md: null, updated_at: now(), deleted: 0 };
    await highlights.put(row);
    return row.id;
  },
  async update(id: string, patch: Partial<Pick<Highlight, "color" | "comment_md" | "start" | "end">>): Promise<void> {
    const cur = await db.highlight.get(id);
    if (!cur) return;
    await highlights.put({ ...cur, ...patch, updated_at: Math.max(now(), cur.updated_at + 1) });
  },
  async remove(id: string): Promise<void> {
    const cur = await db.highlight.get(id);
    if (!cur) return;
    await highlights.put({ ...cur, deleted: 1, updated_at: Math.max(now(), cur.updated_at + 1) });
  },
  async put(row: Highlight): Promise<void> {
    await db.transaction("rw", db.highlight, db.outbox, async () => {
      await db.highlight.put(row);
      await enqueue("highlight", row.id);
    });
    kick();
  },
};

export type { HighlightColor };
