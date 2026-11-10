// 內容契約（schema/*.schema.json）與個人資料表（規格書 §4.6）的 TypeScript 型別。
// 內容型別只描述畫面會用到的欄位；以 JSON Schema 為準。

export type SubjectId = string; // "PHY" | "BCH" | 之後新增的科目

export interface Subject {
  id: SubjectId;
  name: string;
  id_pattern: string;
  ink?: "per_attempt" | "keep";
}

export interface Chapter {
  id: string; // "PHY:Ch15"、"BCH:A1-1-1"
  subject: SubjectId;
  parent: string | null;
  title: string;
  order: number;
  book?: string; // 生化最上層章節所屬的書
}

export interface SourceKind {
  id: string;
  name: string;
  group: string; // postmed｜exam｜material｜ai｜self
}

export interface Source {
  sid: string;
  subject: SubjectId;
  kind: string;
  school: string | null;
  year: number | null;
  paper: string | null;
  book: string | null;
  unit: string | null;
  count: number;
}

export interface Taxonomy {
  subjects: Subject[];
  chapters: Chapter[];
  source_kinds: SourceKind[];
  sources: Source[];
}

export type AnswerTrust = "official" | "key" | "teacher" | "ai" | "pending";
export type SolOrigin = "official" | "teacher" | "ai" | "human" | "mixed";
export type AnswerMode = "single" | "all" | "any" | "text" | "numeric" | "pending";

/** 索引列：篩選、計數、出題只靠它，不含本文。 */
export interface IndexRow {
  id: string;
  label: string;
  sid: string;
  kind: string;
  school: string | null;
  year: number | null;
  unit: string | null;
  chap: string;
  xchap: string[];
  tags: string[];
  qtype: "single" | "multi" | "text" | "numeric";
  has_fig: boolean;
  trust: AnswerTrust;
  human_verified: boolean;
  pack: string;
  canonical: string;
}

export interface Fig {
  fid: string;
  role: "q" | "sol" | "kb";
  src: string; // "a/<sha>.svg"
  w: number;
  h: number;
  mono: boolean;
  fallback: string | null;
  alt: string;
  max_w: number | null;
}

export type OptSpan = [letter: string, start: number, end: number];

export interface Question {
  id: string;
  subject: SubjectId;
  label: string;
  source: { sid: string; kind: string; school: string | null; year: number | null; paper: string | null; book: string | null; unit: string | null; qno: string | null };
  alt_sources: { id: string; label: string; relation: "same" | "adapted"; confirmed?: boolean }[];
  canonical: string;
  chap: string;
  xchap: string[];
  tags: { topic?: string[]; type?: string[]; method?: string[] };
  qtype: IndexRow["qtype"];
  group: { gid: string; stem: string | null; order: number | null; parts?: string[] } | null;
  ques: string;
  opt: OptSpan[] | null;
  opt_span: [stemEnd: number, tailStart: number] | null;
  answer: { mode: AnswerMode; keys: string[]; text: string | null; trust: AnswerTrust; ai_agree: boolean; note: string };
  source_answer: { value: string | string[]; mode: string; kind: string | null; note: string } | null;
  idea: string;
  sol: string;
  teacher: { title: string; md: string; file?: string }[];
  sol_meta: {
    origin: SolOrigin;
    model: string | null;
    human_verified: boolean;
    verified_at: string | null;
    issues: string[];
  };
  figs: Fig[];
  h: { ques: string; idea: string; sol: string };
}

export interface KbBlock {
  bid: string;
  type: "heading" | "list_item" | "paragraph" | "table" | "table_group" | "figure" | "math" | "quote" | "rule" | "html";
  level?: number;
  ordered?: boolean;
  md: string;
  children: KbBlock[];
}

export interface KbDoc {
  doc: string;
  subject: SubjectId;
  title: string;
  file: string;
  blocks: KbBlock[];
  figs: Fig[];
  refs: { bid: string; text: string; qid: string | null }[];
}

export interface ContentInfo {
  version: number;
  generated: string;
  counts: Record<SubjectId, number>;
  /** 樣本模式（第 1A 階段）：只有部分題目有本文。正式內容包為 false。 */
  sample: boolean;
  kb: string[]; // "BCH/2-3_PDH…"
}

// ---------- 個人資料（欄位照規格書 §4.6；1B 接上同步時不用改畫面） ----------

export type ItemKey = `q:${string}` | `card:${string}`;
export const qKey = (id: string): ItemKey => `q:${id}`;
export const keyId = (item: string) => item.slice(item.indexOf(":") + 1);

export type SessionMode = "practice" | "wrong" | "review" | "exam";

export interface Attempt {
  id: string; // ULID
  item: ItemKey;
  session_id: string | null;
  mode: SessionMode;
  chosen: string[] | null; // 自評題為 null
  correct: 0 | 1;
  confidence: 1 | 2 | 3; // 1 猜的｜2 普通｜3 很確定
  elapsed_ms: number;
  content_h: string;
  device: string;
  created_at: number;
  seq?: number;
  /** 只存在本機：1 = 這題還停留在畫面上，信心程度仍可改；離開該題後封存，1B 只同步已封存的列。 */
  open?: 0 | 1;
}

export interface FilterSpec {
  subject: SubjectId;
  kinds: string[]; // 空 = 全部
  schools: string[];
  years: number[];
  books: string[];
  units: string[];
  chapters: string[]; // 章節樹節點 id（任一層）；選到上層代表整個子樹
  count: number | "all";
  order: "random" | "original";
}

export interface Session {
  id: string;
  mode: SessionMode;
  filter: (Partial<FilterSpec> & { label: string }) | { label: string };
  items: string[]; // 題目 ID 順序
  cursor: number;
  started_at: number;
  ended_at: number | null;
  time_limit_s: number | null;
  score: number | null;
  device: string;
  updated_at: number;
  deleted: 0 | 1;
  seq?: number;
}

export type FlagKind = "wrong" | "star" | "doubt" | "mastered";

export interface Flag {
  item: ItemKey;
  kind: FlagKind;
  value: 0 | 1;
  updated_at: number;
  seq?: number;
}

export interface Setting {
  key: string;
  value: string; // JSON
  updated_at: number;
  seq?: number;
}

export type ThemePref = "system" | "light" | "dark";

export type SyncState =
  | { kind: "local" } // 1A：只存在這台裝置
  | { kind: "synced"; at: number }
  | { kind: "pending"; count: number }
  | { kind: "syncing" }
  | { kind: "offline"; count: number }
  | { kind: "error"; message: string };
