// 畫面取用資料的 React hooks。畫面只 import "@/data"，不直接碰 Dexie 或 fetch。

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { content } from "./content";
import { db } from "./db";
import { buildContext, chapterLabel, type FilterContext } from "./filter";
import { settings } from "./personal";
import type { Attempt, FlagKind, ItemKey, Question, Session, SubjectId } from "./types";
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

/** 題目本文：undefined 載入中；null 沒有這一題；"missing" 本文不在裝置上。 */
export function useQuestion(id: string | undefined): Loadable<Question | null | "missing"> {
  return useAsync(() => (id ? content.question(id) : Promise.resolve(null)), [id]);
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

/** 這題是否被標成「粗心錯，不追蹤」。 */
export function useCareless(item: ItemKey | undefined): boolean {
  return useLiveQuery(async () => (item ? (await db.srs_state.get(item))?.suspended === 1 : false), [item]) ?? false;
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
