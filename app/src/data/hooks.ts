// 畫面取用資料的 React hooks。畫面只 import "@/data"，不直接碰 Dexie 或 fetch。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { content } from "./content";
import { db } from "./db";
import { buildContext, chapterLabel, type FilterContext, type StatusSets } from "./filter";
import { exam, settings, type ExamPicks } from "./personal";
import { dueForecast, reviewQueue, srsConfig, srsKey, type ReviewQueue } from "./srs";
import { applyPatches, isWritten, noteId } from "./patches";
import type { Attempt, ContentPatch, FlagKind, Highlight, InkRow, ItemKey, Note, Question, Session, SrsConfig, SrsState, SubjectId } from "./types";
import { keyId } from "./types";

export interface Loadable<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Loadable<T> {
  const [state, setState] = useState<{ data?: T; error: Error | null; loading: boolean }>({ error: null, loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    load().then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => live && setState({ error: error instanceof Error ? error : new Error(String(error)), loading: false }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

// ---------- 內容 ----------

export const useContentInfo = () => useAsync(() => content.info(), []);
export const useTaxonomy = () => useAsync(() => content.taxonomy(), []);
export const useBodyIds = () => useAsync(() => content.bodyIds(), []);
export const useKb = (key: string | undefined) => useAsync(() => (key ? content.kb(key) : Promise.resolve(undefined)), [key]);
export const useKbCatalog = () => useAsync(() => content.kbCatalog(), []);
export const useKbRelated = (qid: string | undefined) => useAsync(() => (qid ? content.kbRelated(qid) : Promise.resolve([])), [qid]);

/** 題目本文：undefined 載入中；null 沒有這一題；"missing" 本文不在裝置上。 */
export function useQuestion(id: string | undefined): Loadable<Question | null | "missing"> {
  const base = useAsync(() => (id ? content.question(id) : Promise.resolve(null)), [id]);
  // 套上修訂佇列（規格書 §8）：修訂一存檔，畫面立刻顯示新內容
  const rows = useLiveQuery(() => (id ? db.content_patch.where("target").equals(`q:${id}`).toArray() : Promise.resolve([] as ContentPatch[])), [id]);
  const data = useMemo(() => (base.data && typeof base.data === "object" ? (rows ? applyPatches(base.data, rows) : undefined) : base.data), [base.data, rows]);
  return { ...base, data, loading: base.loading || (!!base.data && !rows) };
}

/** 修訂佇列全部（新的在前）。 */
export function usePatches(): ContentPatch[] | undefined {
  return useLiveQuery(async () => (await db.content_patch.toArray()).sort((a, b) => b.updated_at - a.updated_at));
}

/** 待寫回與衝突的筆數（更多頁的徽章）。 */
export function useOpenPatchCount(): number | undefined {
  return useLiveQuery(() => db.content_patch.where("status").anyOf("pending", "conflict").filter((p) => !isWritten(p) || p.status === "conflict").count());
}

/** 一題的個人筆記；undefined 載入中、null 沒有。 */
export function useNote(target: string): Note | null | undefined {
  return useLiveQuery(async () => {
    const n = await db.note.get(noteId(target));
    return n && !n.deleted ? n : null;
  }, [target]);
}

/** 某個區塊（"q:ID/sol"…）上的螢光。 */
export function useHighlights(target: string): Highlight[] | undefined {
  return useLiveQuery(async () => (await db.highlight.where("target").equals(target).toArray()).filter((h) => !h.deleted).sort((a, b) => a.start - b.start), [target]);
}

/** 一份筆記上全部的螢光（target 是 "kb:<key>#<bid>"）。 */
export function useKbHighlights(key: string | undefined): Highlight[] | undefined {
  return useLiveQuery(async () => (key ? (await db.highlight.where("target").startsWith(`kb:${key}#`).toArray()).filter((h) => !h.deleted) : []), [key]);
}

/** 一份筆記上全部的區塊筆記：bid → 筆記。 */
export function useKbNotes(key: string | undefined): Map<string, Note> | undefined {
  return useLiveQuery(async () => {
    const m = new Map<string, Note>();
    if (!key) return m;
    for (const n of await db.note.where("target").startsWith(`kb:${key}#`).toArray()) if (!n.deleted) m.set(n.target.slice(key.length + 4), n);
    return m;
  }, [key]);
}

/** 某一科的篩選環境（索引＋章節樹）。 */
export function useFilterContext(subject: SubjectId | undefined): Loadable<FilterContext> {
  return useAsync(async () => {
    if (!subject) return undefined as unknown as FilterContext;
    const [tax, rows] = await Promise.all([content.taxonomy(), content.index(subject)]);
    return buildContext(tax, subject, rows);
  }, [subject]);
}

/** 多題的索引列（結束頁、清單用）。 */
export function useRows(ids: string[] | undefined) {
  const key = ids?.join(",") ?? "";
  return useAsync(async () => {
    const rows = await Promise.all((ids ?? []).map((id) => content.row(id)));
    return new Map(rows.filter((r) => r != null).map((r) => [r.id, r]));
  }, [key]);
}

// ---------- 個人資料 ----------

/** undefined 載入中；null 找不到。 */
export function useSession(id: string | undefined): Session | null | undefined {
  return useLiveQuery(async () => {
    if (!id) return null;
    const s = await db.session.get(id);
    return s && !s.deleted ? s : null;
  }, [id]);
}

/** 這一場每題最新的一筆作答（題目 ID → 作答）。 */
export function useSessionAttempts(sessionId: string | undefined): Map<string, Attempt> | undefined {
  const rows = useLiveQuery(() => (sessionId ? db.attempt.where("session_id").equals(sessionId).sortBy("created_at") : []), [sessionId]);
  return useMemo(() => (rows ? new Map(rows.map((a) => [keyId(a.item), a])) : undefined), [rows]);
}

/** 還沒結束的場次，最近動過的在前。 */
export function useActiveSessions(): Session[] | undefined {
  return useLiveQuery(async () => (await db.session.orderBy("updated_at").reverse().toArray()).filter((s) => !s.deleted && !s.ended_at && s.items.length > 0));
}

export function useFlags(item: ItemKey | undefined): Record<FlagKind, boolean> {
  const rows = useLiveQuery(() => (item ? db.flag.where("[item+kind]").between([item, ""], [item, "￿"]).toArray() : []), [item]);
  return useMemo(() => {
    const out = { wrong: false, star: false, doubt: false, mastered: false };
    for (const r of rows ?? []) out[r.kind] = r.value === 1;
    return out;
  }, [rows]);
}

export function useFlagCount(kind: FlagKind): number | undefined {
  return useLiveQuery(() => db.flag.where("kind").equals(kind).and((f) => f.value === 1).count(), [kind]);
}

/** 這題排程用的鍵（同題群組的代表題）。 */
function useSrsKey(item: ItemKey | undefined): string | undefined {
  return useAsync(async () => (item ? srsKey(keyId(item)) : undefined), [item]).data;
}

/** 這題的排程狀態：undefined 載入中；null 不在排程裡。 */
export function useSrsState(item: ItemKey | undefined): SrsState | null | undefined {
  const key = useSrsKey(item);
  return useLiveQuery(async () => (key ? ((await db.srs_state.get(key)) ?? null) : undefined), [key]);
}

/** 這題是否被標成「粗心錯，不追蹤」。 */
export function useCareless(item: ItemKey | undefined): boolean {
  return useSrsState(item)?.suspended === 1;
}

/** 今日複習（已套每日上限）。 */
export function useReviewQueue(): ReviewQueue | undefined {
  return useLiveQuery(() => reviewQueue());
}

export function useDueForecast(days: number, prefix: "q:" | "card:" = "q:"): number[] | undefined {
  return useLiveQuery(() => dueForecast(days, Date.now(), prefix), [days, prefix]);
}

export function useSrsConfig(): SrsConfig | undefined {
  return useLiveQuery(() => srsConfig());
}

export function useStatusSets(): StatusSets | undefined {
  return useLiveQuery(async () => {
    const done = new Set<string>();
    const wrongEver = new Set<string>();
    await db.attempt.each((a) => {
      const id = keyId(a.item);
      done.add(id);
      if (!a.correct) wrongEver.add(id);
    });
    const star = new Set<string>();
    const doubt = new Set<string>();
    await db.flag.each((f) => {
      if (f.value !== 1) return;
      if (f.kind === "star") star.add(keyId(f.item));
      else if (f.kind === "doubt") doubt.add(keyId(f.item));
    });
    const verified = new Set<string>();
    await db.content_patch.where("status").anyOf("pending", "merged").each((p) => {
      if (p.field === "human_verified" && p.target.startsWith("q:")) verified.add(keyId(p.target));
    });
    return { done, wrongEver, star, doubt, verified };
  });
}

/** 全部作答（統計頁）。 */
export function useAllAttempts(): Attempt[] | undefined {
  return useLiveQuery(() => db.attempt.toArray());
}

/** 已結束的場次（原卷方格的得分）。 */
export function useEndedSessions(): Session[] | undefined {
  return useLiveQuery(async () => (await db.session.toArray()).filter((s) => !s.deleted && s.ended_at));
}

/** 模擬考進行中的作答。 */
export function useExamPicks(sessionId: string | undefined): ExamPicks | undefined {
  return useLiveQuery(async () => (sessionId ? exam.get(sessionId) : undefined), [sessionId]);
}

export function useLastAttempt(item: ItemKey | undefined): Attempt | null | undefined {
  return useLiveQuery(async () => (item ? ((await db.attempt.where("item").equals(item).sortBy("created_at")).pop() ?? null) : null), [item]);
}

/** 今天（本機時區）做了幾題、對幾題。 */
export function useTodaySummary(): { done: number; right: number } | undefined {
  return useLiveQuery(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = await db.attempt.where("created_at").aboveOrEqual(start.getTime()).toArray();
    return { done: rows.length, right: rows.filter((a) => a.correct).length };
  });
}

/** 各科做過幾題（不重複）。 */
export function useSubjectProgress(): Map<SubjectId, number> | undefined {
  const items = useLiveQuery(() => db.attempt.orderBy("item").uniqueKeys());
  const tax = useTaxonomy().data;
  return useMemo(() => {
    if (!items || !tax) return undefined;
    const pats = tax.subjects.map((s) => [s.id, new RegExp(s.id_pattern)] as const);
    const out = new Map<SubjectId, number>();
    for (const it of items) {
      const id = keyId(String(it));
      const hit = pats.find(([, re]) => re.test(id));
      if (hit) out.set(hit[0], (out.get(hit[0]) ?? 0) + 1);
    }
    return out;
  }, [items, tax]);
}

/** 會同步的設定值。回傳 [值, 寫入, 是否已讀到]。 */
export function useSetting<T>(key: string, fallback: T): [T, (v: T) => void, boolean] {
  const row = useLiveQuery(async () => ({ v: await settings.get<T>(key) }), [key]);
  const set = useCallback((v: T) => void settings.set(key, v), [key]);
  return [row?.v ?? fallback, set, row !== undefined];
}


/** 有某種標記的題目（錯題本、星號、存疑清單），最近標的在前。 */
export function useFlagged(kind: FlagKind): { id: string; at: number }[] | undefined {
  return useLiveQuery(async () => {
    const rows = await db.flag.where("kind").equals(kind).and((f) => f.value === 1).toArray();
    return rows.sort((a, b) => b.updated_at - a.updated_at).map((f) => ({ id: keyId(f.item), at: f.updated_at }));
  }, [kind]);
}

/** 章節 id → 顯示名稱（「Ch15　電磁感應」）。 */
export function useChapterNames(): Map<string, string> {
  const tax = useTaxonomy().data;
  return useMemo(() => new Map((tax?.chapters ?? []).map((c) => [c.id, chapterLabel(c)])), [tax]);
}

/** 所有科目的篩選環境（統計、考題分析用）。 */
export function useAllContexts(): Loadable<Map<SubjectId, FilterContext>> {
  return useAsync(async () => {
    const tax = await content.taxonomy();
    const out = new Map<SubjectId, FilterContext>();
    for (const s of tax.subjects) out.set(s.id, buildContext(tax, s.id, await content.index(s.id)));
    return out;
  }, []);
}

/** 章節節點往上算到「章」這一層：最上層（物理的分組、生化的書）下面那一層。 */
export function chapterLevel(ctx: FilterContext, chap: string): string {
  const up = ctx.chain.get(chap) ?? [chap];
  return up.length >= 2 ? up[up.length - 2] : up[0];
}

// ---------- 手寫與圖上標記（第 6 階段） ----------

/** 一個對象的所有頁（含已刪除的列：畫面要靠它知道「另一台裝置清掉了」）。 */
export function useInkRows(target: string | undefined): InkRow[] | undefined {
  return useLiveQuery(async () => (target ? (await db.ink.where("target").equals(target).toArray()).sort((a, b) => a.page - b.page) : []), [target]);
}

/** 某個前綴底下所有還在的標記（筆記最下面的「失聯的圖上標記」用）。 */
export function useInkUnder(prefix: string | undefined): InkRow[] | undefined {
  return useLiveQuery(async () => (prefix ? (await db.ink.where("target").startsWith(prefix).toArray()).filter((r) => !r.deleted) : []), [prefix]);
}

/** 這一科手寫的保存規則（taxonomy.subjects[].ink）；查不到時當成 keep。 */
export function useInkPolicy(subject: SubjectId | undefined): "per_attempt" | "keep" | undefined {
  const tax = useTaxonomy();
  if (!tax.data) return undefined;
  return tax.data.subjects.find((s) => s.id === subject)?.ink ?? "keep";
}

/** 頁面上的「科目」切換：預設是內容包裡的第一科（不寫死科目，第 8A 階段）。選過的科目不在內容包裡時也退回第一科。 */
export function useSubjectChoice(): [SubjectId, (s: SubjectId) => void] {
  const tax = useAsync(() => content.taxonomy(), []).data;
  const [picked, setPicked] = useState<SubjectId | null>(null);
  const ids = tax?.subjects.map((s) => s.id) ?? [];
  const subject = picked && ids.includes(picked) ? picked : (ids[0] ?? "");
  return [subject, setPicked];
}
