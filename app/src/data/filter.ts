// 出題篩選：純函式，只吃索引列與章節樹（規格書 §5.2）。畫面與測試共用。

import type { Chapter, FilterSpec, IndexRow, StatusKey, SubjectId, Taxonomy } from "./types";

/** 狀態條件用的個人資料（題目 ID 的集合）。沒給時狀態條件不生效。 */
export interface StatusSets {
  done: Set<string>;
  wrongEver: Set<string>;
  star: Set<string>;
  doubt: Set<string>;
}

export const STATUS_KEYS: { id: StatusKey; name: string }[] = [
  { id: "new", name: "沒做過" },
  { id: "wrong", name: "做錯過" },
  { id: "star", name: "有星號" },
  { id: "doubt", name: "存疑" },
  { id: "verified", name: "已確認" },
  { id: "unverified", name: "未確認" },
];

function hasStatus(st: StatusSets | undefined, r: IndexRow, k: StatusKey): boolean {
  switch (k) {
    case "verified":
      return r.human_verified;
    case "unverified":
      return !r.human_verified;
    case "new":
      return !st?.done.has(r.id);
    case "wrong":
      return !!st?.wrongEver.has(r.id);
    case "star":
      return !!st?.star.has(r.id);
    case "doubt":
      return !!st?.doubt.has(r.id);
  }
}

export interface ChapterNode {
  id: string;
  label: string;
  children: ChapterNode[];
}

export interface FilterContext {
  subject: SubjectId;
  rows: IndexRow[];
  tree: ChapterNode[];
  /** 章節 id → 自己與所有上層（含「書」這層虛擬節點） */
  chain: Map<string, string[]>;
  nodeLabel: Map<string, string>;
  children: Map<string, string[]>;
  parent: Map<string, string | null>;
  bookOf: Map<string, string | null>; // sid → 書名
  kindName: Map<string, string>;
  kindGroup: Map<string, string>;
  kindOrder: string[];
  status?: StatusSets;
}

/** 套上個人資料（狀態條件）。 */
export function withStatus(ctx: FilterContext, status: StatusSets | undefined): FilterContext {
  return status ? { ...ctx, status } : ctx;
}

export function chapterLabel(ch: Pick<Chapter, "id" | "title">): string {
  const code = ch.id.slice(ch.id.indexOf(":") + 1);
  return code === ch.title ? ch.title : `${code}　${ch.title}`;
}

export function buildContext(tax: Taxonomy, subject: SubjectId, rows: IndexRow[]): FilterContext {
  const chapters = tax.chapters.filter((c) => c.subject === subject).sort((a, b) => a.order - b.order);
  const nodes = new Map<string, ChapterNode>();
  const parent = new Map<string, string | null>();
  for (const c of chapters) nodes.set(c.id, { id: c.id, label: chapterLabel(c), children: [] });
  const tree: ChapterNode[] = [];
  for (const c of chapters) {
    const node = nodes.get(c.id)!;
    let pid = c.parent;
    if (!pid && c.book) {
      // 生化：最上層章節依「書」分組，做成虛擬節點
      pid = `${subject}:@${c.book}`;
      if (!nodes.has(pid)) {
        const book: ChapterNode = { id: pid, label: c.book.replace(/\s*\(.*\)\s*$/, ""), children: [] };
        nodes.set(pid, book);
        parent.set(pid, null);
        tree.push(book);
      }
    }
    parent.set(c.id, pid ?? null);
    if (pid && nodes.has(pid)) nodes.get(pid)!.children.push(node);
    else tree.push(node);
  }
  const chain = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const [id, node] of nodes) {
    children.set(id, node.children.map((n) => n.id));
    const up: string[] = [];
    for (let cur: string | null | undefined = id; cur; cur = parent.get(cur)) up.push(cur);
    chain.set(id, up);
  }
  return {
    subject,
    rows,
    tree,
    chain,
    nodeLabel: new Map([...nodes].map(([id, n]) => [id, n.label])),
    children,
    parent,
    bookOf: new Map(tax.sources.filter((s) => s.subject === subject).map((s) => [s.sid, s.book])),
    kindName: new Map(tax.source_kinds.map((k) => [k.id, k.name])),
    kindGroup: new Map(tax.source_kinds.map((k) => [k.id, k.group])),
    kindOrder: tax.source_kinds.map((k) => k.id),
  };
}

type Facet = "kinds" | "schools" | "years" | "books" | "units" | "chapters" | "status";

/**
 * 各條件之間是「且」，同一條件內是「或」；沒勾任何項目 = 不限。
 * 學校、年份只限制「有學校、有年份」的題目；書與單元只限制「出自書」的題目——
 * 所以同時勾後醫與特訓班時，選「高醫」不會把特訓班的題目濾掉。
 */
function test(ctx: FilterContext, f: FilterSpec, r: IndexRow, facet: Facet): boolean {
  switch (facet) {
    case "kinds":
      return !f.kinds.length || f.kinds.includes(r.kind);
    case "schools":
      return !f.schools.length || r.school == null || f.schools.includes(r.school);
    case "years":
      return !f.years.length || r.year == null || f.years.includes(r.year);
    case "books": {
      if (!f.books.length) return true;
      const b = ctx.bookOf.get(r.sid);
      return b == null || f.books.includes(b);
    }
    case "units":
      return !f.units.length || r.unit == null || ctx.bookOf.get(r.sid) == null || f.units.includes(r.unit);
    case "chapters": {
      if (!f.chapters.length) return true;
      const up = ctx.chain.get(r.chap);
      return !!up && up.some((id) => f.chapters.includes(id));
    }
    case "status":
      return !f.status?.length || f.status.some((k) => hasStatus(ctx.status, r, k));
  }
}

const FACETS: Facet[] = ["kinds", "schools", "years", "books", "units", "chapters", "status"];

export function matchRows(ctx: FilterContext, f: FilterSpec): IndexRow[] {
  return ctx.rows.filter((r) => FACETS.every((k) => test(ctx, f, r, k)));
}

export interface FacetCounts {
  total: number;
  kinds: Map<string, number>;
  schools: Map<string, number>;
  years: Map<number, number>;
  books: Map<string, number>;
  units: Map<string, number>;
  chapters: Map<string, number>;
  status: Map<StatusKey, number>;
}

/** 每個選項旁邊的數字 =「其他條件不變、只看這個選項」會有幾題。 */
export function facetCounts(ctx: FilterContext, f: FilterSpec): FacetCounts {
  const out: FacetCounts = { total: 0, kinds: new Map(), schools: new Map(), years: new Map(), books: new Map(), units: new Map(), chapters: new Map(), status: new Map() };
  const inc = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
  const pass = new Array<boolean>(FACETS.length);
  for (const r of ctx.rows) {
    let fails = 0;
    let failed = -1;
    for (let i = 0; i < FACETS.length; i++) {
      pass[i] = test(ctx, f, r, FACETS[i]);
      if (!pass[i]) {
        fails++;
        failed = i;
      }
    }
    if (fails > 1) continue;
    const only = (facet: Facet) => fails === 0 || FACETS[failed] === facet;
    if (fails === 0) out.total++;
    if (only("kinds")) inc(out.kinds, r.kind);
    if (only("schools") && r.school != null) inc(out.schools, r.school);
    if (only("years") && r.year != null) inc(out.years, r.year);
    const book = ctx.bookOf.get(r.sid);
    if (only("books") && book != null) inc(out.books, book);
    if (only("units") && book != null && r.unit != null) inc(out.units, r.unit);
    if (only("chapters")) for (const id of ctx.chain.get(r.chap) ?? []) inc(out.chapters, id);
    if (only("status")) for (const k of STATUS_KEYS) if (hasStatus(ctx.status, r, k.id)) inc(out.status, k.id);
  }
  return out;
}

// ---------- 章節樹的勾選（選到上層 = 整個子樹） ----------

export type CheckState = "on" | "off" | "partial";

export function chapterState(ctx: FilterContext, selected: string[], id: string): CheckState {
  const up = ctx.chain.get(id) ?? [id];
  if (up.some((a) => selected.includes(a))) return "on";
  const hasSelectedBelow = (n: string): boolean => (ctx.children.get(n) ?? []).some((c) => selected.includes(c) || hasSelectedBelow(c));
  return hasSelectedBelow(id) ? "partial" : "off";
}

export function toggleChapter(ctx: FilterContext, selected: string[], id: string): string[] {
  const up = ctx.chain.get(id) ?? [id];
  const hit = up.find((a) => selected.includes(a));
  let next = selected.slice();
  if (hit) {
    // 取消：若是上層被選，先把上層拆成它的子節點，沿路只留下不是自己的那些
    next = next.filter((s) => s !== hit);
    const path = up.slice(0, up.indexOf(hit)).reverse(); // hit 往下到 id
    let cur = hit;
    for (const step of path) {
      for (const c of ctx.children.get(cur) ?? []) if (c !== step) next.push(c);
      cur = step;
    }
    return next;
  }
  // 勾選：移除已選的下層，加入自己；兄弟全選時收合成上層
  const below = (n: string): string[] => (ctx.children.get(n) ?? []).flatMap((c) => [c, ...below(c)]);
  const drop = new Set(below(id));
  next = next.filter((s) => !drop.has(s));
  next.push(id);
  for (let p = ctx.parent.get(id); p; p = ctx.parent.get(p)) {
    const kids = ctx.children.get(p) ?? [];
    if (!kids.length || !kids.every((k) => next.includes(k))) break;
    next = next.filter((s) => !kids.includes(s));
    next.push(p);
  }
  return next;
}

// ---------- 預設值與摘要 ----------

/** 預設只勾後醫（規格書 §5.2）；該科沒有後醫題時不限來源。 */
export function defaultFilter(ctx: FilterContext): FilterSpec {
  const present = new Set(ctx.rows.map((r) => r.kind));
  const kinds = ctx.kindOrder.filter((k) => present.has(k) && ctx.kindGroup.get(k) === "postmed");
  return { subject: ctx.subject, kinds, schools: [], years: [], books: [], units: [], chapters: [], count: 20, order: "random", status: [] };
}

/** 把存下來的條件套到目前的內容上：丟掉已不存在的選項。 */
export function sanitizeFilter(ctx: FilterContext, f: Partial<FilterSpec> | null | undefined): FilterSpec {
  const d = defaultFilter(ctx);
  if (!f || f.subject !== ctx.subject) return d;
  const kinds = new Set(ctx.rows.map((r) => r.kind));
  return {
    subject: ctx.subject,
    kinds: (f.kinds ?? d.kinds).filter((k) => kinds.has(k)),
    schools: f.schools ?? [],
    years: f.years ?? [],
    books: f.books ?? [],
    units: f.units ?? [],
    chapters: (f.chapters ?? []).filter((c) => ctx.chain.has(c)),
    count: f.count === "all" || typeof f.count === "number" ? f.count : d.count,
    order: f.order === "original" ? "original" : "random",
    status: (f.status ?? []).filter((k) => STATUS_KEYS.some((s) => s.id === k)),
  };
}

export function describeFilter(ctx: FilterContext, f: FilterSpec, subjectName: string): string {
  const parts: string[] = [subjectName];
  const some = (xs: (string | number)[], max = 3) => (xs.length > max ? `${xs.slice(0, max).join("、")} 等 ${xs.length} 項` : xs.join("、"));
  if (f.kinds.length) parts.push(some(f.kinds.map((k) => ctx.kindName.get(k) ?? k)));
  if (f.schools.length) parts.push(some(f.schools));
  if (f.years.length) parts.push(some(f.years.slice().sort((a, b) => b - a)) + " 年");
  if (f.books.length) parts.push(some(f.books));
  if (f.units.length) parts.push(some(f.units, 2));
  if (f.status?.length) parts.push(f.status.map((k) => STATUS_KEYS.find((s) => s.id === k)?.name ?? k).join("、"));
  if (f.chapters.length) parts.push(some(f.chapters.map((c) => (ctx.nodeLabel.get(c) ?? c).split("　")[0].replace(/^Book (\d+):.*$/, "Book $1")), 3));
  return parts.join("・");
}

/** 依條件排出一場的題目順序。available 為 null 代表每題都有本文。 */
export function pickItems(ctx: FilterContext, f: FilterSpec, available: Set<string> | null, random: () => number = Math.random): string[] {
  let rows = matchRows(ctx, f);
  if (available) rows = rows.filter((r) => available.has(r.id));
  if (f.order === "random") {
    rows = rows.slice();
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
  } else {
    // 原順序：同一份考卷或同一本書排在一起，題號由小到大
    const cmp = new Intl.Collator("zh-Hant", { numeric: true });
    rows = rows.slice().sort((a, b) => cmp.compare(a.sid, b.sid) || cmp.compare(a.label, b.label));
  }
  const n = f.count === "all" ? rows.length : Math.min(f.count, rows.length);
  return rows.slice(0, n).map((r) => r.id);
}
