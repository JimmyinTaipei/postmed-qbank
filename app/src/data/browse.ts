// 題目瀏覽（第 2B 階段，規格書 §9.9）：範圍（整份考卷、一份來源、一個章節）→ 題目順序；記住上次看到哪裡。
//
// 範圍的寫法（也是網址與 browse.recent 的鍵）：
// - p:<來源類型>~<學校>~<年份>~<考科>   整份考卷。跨科目：同一場考試的「物理化學」把物理、化學的題目接在一起，照原卷題號排。
// - s:<科目>:<來源 sid>                 一份來源（教材的一章、一份講義）
// - c:<科目>:<章節 id>                  一個章節（含子章節與 xchap）
//
// 在這裡看題目不算作答：不寫 attempt。

import { useLiveQuery } from "dexie-react-hooks";
import { chapterIds, type FilterContext } from "./filter";
import { pushRecent } from "./recent";
import { settings } from "./personal";
import type { IndexRow, SubjectId, Taxonomy } from "./types";

const cmp = new Intl.Collator("zh-Hant", { numeric: true });

/** 原卷題號：索引列的 label 最後一段數字（「高醫 115 07」→ 7）。教材「Ch03 12」也一樣。 */
export function qnoOf(r: Pick<IndexRow, "label" | "go">): number | null {
  if (r.go != null) return r.go;
  const m = /(\d+)\s*$/.exec(r.label);
  return m ? Number(m[1]) : null;
}

/** 考科名稱：主檔的 paper（「物理化學」「生物生化」）；「物理A_第一部分單選題」只取底線前；沒有就用科目名（英文）。 */
export function paperName(paper: string | null | undefined, subjectName: string): string {
  const p = (paper ?? "").split("_")[0].trim();
  return p || subjectName;
}

export interface PaperInfo {
  /** 範圍鍵 p:… */
  scope: string;
  kind: string;
  group: string;
  school: string;
  year: number;
  name: string;
  subjects: SubjectId[];
  rows: IndexRow[];
  /** 兩科都有同一個原卷題號時（生化題庫裡混了生物題、生物題庫是整份卷），沒採用的那一題 */
  dupes: IndexRow[];
}

const byQno = (a: IndexRow, b: IndexRow) => (qnoOf(a) ?? 1e9) - (qnoOf(b) ?? 1e9) || cmp.compare(a.label, b.label) || cmp.compare(a.id, b.id);

/** 所有科目的考卷（有學校、有年份的來源），以「來源類型＋學校＋年份＋考科」合併。 */
export function buildPapers(tax: Taxonomy, ctxs: Map<SubjectId, FilterContext>): Map<string, PaperInfo> {
  const src = new Map(tax.sources.map((s) => [s.sid, s]));
  const subjName = new Map(tax.subjects.map((s) => [s.id, s.name]));
  const group = new Map(tax.source_kinds.map((k) => [k.id, k.group]));
  const out = new Map<string, PaperInfo>();
  // 照 taxonomy 的科目順序：同一個題號兩科都有時，先出現的科目（物理、生化：有詳解）優先
  const order = [...tax.subjects.map((s) => s.id).filter((id) => ctxs.has(id)), ...[...ctxs.keys()].filter((id) => !tax.subjects.some((s) => s.id === id))];
  for (const subject of order) {
    const ctx = ctxs.get(subject)!;
    for (const r of ctx.rows) {
      if (!r.school || !r.year) continue;
      const name = paperName(src.get(r.sid)?.paper, subjName.get(subject) ?? subject);
      const scope = `p:${[r.kind, r.school, r.year, name].join("~")}`;
      let p = out.get(scope);
      if (!p) out.set(scope, (p = { scope, kind: r.kind, group: group.get(r.kind) ?? "self", school: r.school, year: r.year, name, subjects: [], rows: [], dupes: [] }));
      if (!p.subjects.includes(subject)) p.subjects.push(subject);
      p.rows.push(r);
    }
  }
  for (const p of out.values()) {
    const seen = new Map<number, SubjectId>();
    const keep: IndexRow[] = [];
    for (const r of p.rows) {
      const n = qnoOf(r);
      const subj = r.id.slice(0, r.id.indexOf("-"));
      if (n == null) keep.push(r);
      else if (!seen.has(n) || seen.get(n) === subj) {
        seen.set(n, subj);
        keep.push(r);
      } else p.dupes.push(r);
    }
    p.rows = keep.sort(byQno);
  }
  return out;
}

/** 原卷題號裡缺的號碼（1 到最大號之間）：還沒上站的科目（例如生物生化卷的生物題）。 */
export function missingNumbers(rows: IndexRow[]): number[] {
  const have = new Set(rows.map(qnoOf).filter((n): n is number => n != null));
  if (!have.size) return [];
  const max = Math.max(...have);
  const out: number[] = [];
  for (let i = 1; i <= max; i++) if (!have.has(i)) out.push(i);
  return out;
}

/** [1,2,3,7,8] → 「1–3、7–8」 */
export function rangesText(ns: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    parts.push(i === j ? `${ns[i]}` : `${ns[i]}–${ns[j]}`);
    i = j + 1;
  }
  return parts.join("、");
}

/** 章節範圍的順序：來源類別 → 學校 → 年份（新到舊）→ 題號；題組的小題排在一起。 */
export function chapterRows(ctx: FilterContext, chap: string): IndexRow[] {
  const rows = ctx.rows.filter((r) => chapterIds(ctx, r).includes(chap));
  const kindAt = new Map(ctx.kindOrder.map((k, i) => [k, i]));
  return rows.sort(
    (a, b) =>
      (kindAt.get(a.kind) ?? 99) - (kindAt.get(b.kind) ?? 99) ||
      cmp.compare(ctx.bookOf.get(a.sid) ?? "", ctx.bookOf.get(b.sid) ?? "") ||
      cmp.compare(a.school ?? "", b.school ?? "") ||
      (b.year ?? 0) - (a.year ?? 0) ||
      cmp.compare(a.sid, b.sid) ||
      byQno(a, b),
  );
}

/** 一份來源的題目（照題號）。 */
export function sourceRows(ctx: FilterContext, sid: string): IndexRow[] {
  return ctx.rows.filter((r) => r.sid === sid).sort(byQno);
}

export interface Scope {
  key: string;
  title: string;
  rows: IndexRow[];
  /** 整份考卷才有 */
  paper?: PaperInfo;
}

/** 範圍鍵 → 題目清單與名稱。找不到回 null。 */
export function resolveScope(key: string, tax: Taxonomy, ctxs: Map<SubjectId, FilterContext>, papers?: Map<string, PaperInfo>): Scope | null {
  if (key.startsWith("p:")) {
    const p = (papers ?? buildPapers(tax, ctxs)).get(key);
    return p ? { key, title: `${p.school} ${p.year} ${p.name}`, rows: p.rows, paper: p } : null;
  }
  const m = /^([sc]):([^:]+):(.+)$/.exec(key);
  if (!m) return null;
  const ctx = ctxs.get(m[2]);
  if (!ctx) return null;
  if (m[1] === "s") {
    const s = tax.sources.find((x) => x.sid === m[3]);
    if (!s) return null;
    const name = s.book ? [s.book, s.unit].filter(Boolean).join(" ") : [s.school, s.year, s.paper].filter(Boolean).join(" ");
    return { key, title: name || s.sid, rows: sourceRows(ctx, m[3]) };
  }
  if (!ctx.nodeLabel.has(m[3])) return null;
  const subj = tax.subjects.find((s) => s.id === m[2])?.name ?? m[2];
  return { key, title: `${subj}・${ctx.nodeLabel.get(m[3])}`, rows: chapterRows(ctx, m[3]) };
}

/** 網址：/browse/p/<key>、/browse/s/<科目>/<sid>、/browse/c/<科目>/<章節>（各段 encodeURIComponent）。 */
export function scopeUrl(key: string): string {
  if (key.startsWith("p:")) return `/browse/p/${encodeURIComponent(key.slice(2))}`;
  const m = /^([sc]):([^:]+):(.+)$/.exec(key);
  return m ? `/browse/${m[1]}/${encodeURIComponent(m[2])}/${encodeURIComponent(m[3])}` : "/browse";
}

// ---------- 顯示方式與記住位置 ----------

export type BrowseMode = "q" | "a" | "all";
export const BROWSE_MODES: { value: BrowseMode; label: string }[] = [
  { value: "q", label: "只看題目" },
  { value: "a", label: "題目＋答案" },
  { value: "all", label: "＋詳解" },
];
export const PAGE_SIZES = [10, 20, 50] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export interface BrowseView {
  mode: BrowseMode;
  size: PageSize;
}
const VIEW = "browse.view";
const DEFAULT_VIEW: BrowseView = { mode: "all", size: 10 };

export const browseView = {
  set: async (patch: Partial<BrowseView>) => settings.set(VIEW, { ...((await settings.get<BrowseView>(VIEW)) ?? DEFAULT_VIEW), ...patch }),
};

/** 顯示方式與每頁題數（會同步）。undefined＝還在讀。 */
export function useBrowseView(): BrowseView | undefined {
  return useLiveQuery(async () => {
    const v = await settings.get<Partial<BrowseView>>(VIEW);
    const size = PAGE_SIZES.includes(v?.size as PageSize) ? (v!.size as PageSize) : DEFAULT_VIEW.size;
    const mode = BROWSE_MODES.some((m) => m.value === v?.mode) ? (v!.mode as BrowseMode) : DEFAULT_VIEW.mode;
    return { mode, size };
  }, []);
}

/** 規格書 §9.9：{scope, qid, idx, mode, at}；qid 為準，idx 是那一題不見了時的備援。 */
export interface BrowseRecent {
  scope: string;
  /** 範圍名稱（入口頁「繼續瀏覽」顯示用；不必重算範圍） */
  title: string;
  qid: string;
  idx: number;
  total: number;
  mode: BrowseMode;
  at: number;
}
export const BROWSE_RECENT = "browse.recent";

export const browseRecent = {
  get: async (scope: string): Promise<BrowseRecent | null> => ((await settings.get<BrowseRecent[]>(BROWSE_RECENT)) ?? []).find((e) => e.scope === scope) ?? null,
  save: (e: BrowseRecent) => pushRecent<BrowseRecent>(BROWSE_RECENT, (x) => x.scope === e.scope, e),
};

export function useBrowseRecent(): BrowseRecent[] | undefined {
  return useLiveQuery(async () => {
    const v = await settings.get<BrowseRecent[]>(BROWSE_RECENT);
    return Array.isArray(v) ? v : [];
  }, []);
}

/** 回到上次的位置：qid 還在就用它，否則用當時的順位找最接近的一題。 */
export function restoreIndex(rows: Pick<IndexRow, "id">[], rec: Pick<BrowseRecent, "qid" | "idx"> | null): number {
  if (!rec || !rows.length) return 0;
  const i = rows.findIndex((r) => r.id === rec.qid);
  return i >= 0 ? i : Math.min(Math.max(0, rec.idx), rows.length - 1);
}

/** 題組不拆頁：每頁大約 size 題，但同一個題組的小題放在同一頁。回傳每頁的起點。 */
export function pageStarts(rows: Pick<IndexRow, "gid">[], size: number): number[] {
  const starts: number[] = [];
  let i = 0;
  while (i < rows.length) {
    starts.push(i);
    let j = Math.min(i + size, rows.length);
    // 頁尾落在題組中間：把這一組整個放進這一頁
    while (j < rows.length && j > 0 && rows[j].gid && rows[j].gid === rows[j - 1].gid) j++;
    i = j;
  }
  return starts;
}

export function pageOf(starts: number[], idx: number): number {
  let p = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= idx) p = i;
  return p;
}
