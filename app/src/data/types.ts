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
  /** 只在裝置上：套了修訂佇列之後才有（patches.ts 的 applyPatches）。 */
  patch?: PatchInfo;
}

// ---------- 修訂佇列（規格書 §4.6 content_patch、§7.3、§8） ----------

export type PatchField = "ques" | "idea" | "sol" | "answer" | "chap" | "tags" | "human_verified";
/** 筆記（資料庫）的修訂：target 是 "kb:<key>#<bid>"（create 是 "kbnew:<科目>/<檔名>"）。寫回見 pmq 的 kb_patches.py。 */
export type KbPatchField = "md" | "insert_after" | "insert_child" | "delete" | "create";
export type PatchStatus = "pending" | "merged" | "conflict" | "rejected";

export interface ContentPatch {
  id: string; // ULID
  target: string; // "q:PHY-007836"｜"kb:BCH/2-3_PDH#0123456789ab"｜"kbnew:BCH/新筆記"
  field: PatchField | KbPatchField;
  base_h: string; // 改之前內容包裡該欄位的雜湊
  value: string; // 新內容（answer、tags 是 JSON）
  status: PatchStatus;
  note: string | null; // JSON（PatchNote），pmq 寫
  device: string;
  created_at: number;
  updated_at: number;
  seq?: number;
}

/** pmq 寫在 content_patch.note 的資訊。 */
export interface PatchNote {
  written?: string; // 寫回主檔的 commit
  wh?: string; // 寫回後該欄位的雜湊
  wv?: string; // 寫回時 value 的雜湊（之後又改過就不同）
  conflict?: { theirs: string; theirs_h: string; at: number }; // 主檔目前的版本
  reason?: string;
  resolved?: "mine" | "theirs";
  merged?: number;
  bf?: string; // 筆記：寫回之前整份檔的雜湊（pmq 判斷線上是不是新版用）
}

/** 這一題在畫面上的修訂狀態：pending 待寫回｜written 已寫回、待發佈｜stale 修訂待處理（內容包已經變了）｜conflict 衝突 */
export type FieldMark = "pending" | "written" | "stale" | "conflict";

export interface PatchInfo {
  marks: Partial<Record<PatchField, FieldMark>>;
  /** 答案曾在網站上修訂過（含已合併的） */
  answerRevised: boolean;
  /** 套修訂之前的內容包版本（編輯器算 base_h 用） */
  base: Question;
}

export interface Note {
  id: string; // "n:" + target（同一個對象只有一則，兩台裝置離線各寫也只會合併成一筆）
  target: string; // "q:PHY-…"
  body_md: string;
  updated_at: number;
  deleted: 0 | 1;
  seq?: number;
}

export type HighlightColor = "yellow" | "blue" | "purple" | "pink" | "green" | "orange";

export interface Highlight {
  id: string;
  target: string; // "q:PHY-…/ques"｜"q:PHY-…/sol"｜"q:PHY-…/idea"
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  color: HighlightColor;
  comment_md: string | null;
  updated_at: number;
  deleted: 0 | 1;
  seq?: number;
}

export interface KbBlock {
  bid: string;
  type: "heading" | "list_item" | "paragraph" | "table" | "table_group" | "figure" | "math" | "quote" | "rule" | "html" | "code";
  level?: number;
  ordered?: boolean;
  /** 有序列點的編號 */
  num?: number;
  md: string;
  /** 主檔行範圍 [起, 訖)，0 起 */
  lines?: [number, number];
  children: KbBlock[];
}

export interface KbDoc {
  doc: string;
  /** "BCH/2-3_PDH_TCA_and_Glyoxylate_Cycle" */
  key?: string;
  subject: SubjectId;
  title: string;
  file: string;
  blocks: KbBlock[];
  figs: Fig[];
  refs: { bid: string; text: string; qid: string | null }[];
  /** 主檔原文（匯出 .md 用） */
  src?: string;
}

/** 資料庫目錄（c/kbcat）：科目 → 群組（B1 基礎篇、Ch01 生命的研究…）→ 筆記。 */
export interface KbCatalog {
  subjects: {
    id: string;
    name: string;
    /** false = 只有章節目錄、還沒有內容（生物、化學、英文） */
    imported: boolean;
    groups: { id: string; title: string; docs: KbCatalogDoc[] }[];
  }[];
}
export interface KbCatalogDoc {
  key: string;
  title: string;
  file: string;
  counts: Partial<Record<KbBlock["type"], number>>;
  /** 第二層標題 */
  sections: string[];
}

/** 題目 → 引用它的筆記段落（c/kbrel）。 */
export interface KbRelated {
  key: string;
  bid: string;
  title: string;
  /** 文件標題以下的標題路徑 */
  path: string[];
  text: string;
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
  /** 狀態條件（或）：new 沒做過｜wrong 做錯過｜star｜doubt｜verified 已確認｜unverified 未確認 */
  status?: StatusKey[];
}

export type StatusKey = "new" | "wrong" | "star" | "doubt" | "verified" | "unverified";

export interface Session {
  id: string;
  mode: SessionMode;
  /** label 是給人看的摘要；paper 是原卷的鍵（「PHY|postmed|高醫|115」），原卷方格用來找得分 */
  filter: (Partial<FilterSpec> & { label: string; paper?: string }) | { label: string; paper?: string };
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

export interface ReviewLog {
  id: string;
  item: ItemKey; // 同題群組的代表題（q:<canonical>）
  rating: 1 | 2 | 3 | 4; // Again｜Hard｜Good｜Easy
  state_before: number; // 0 New｜1 Learning｜2 Review｜3 Relearning
  elapsed_days: number;
  scheduled_days: number;
  duration_ms: number | null;
  attempt_id: string | null;
  device: string;
  reviewed_at: number;
  seq?: number;
}

export interface SrsState {
  item: string;
  due: number;
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
  suspended: 0 | 1;
  updated_at: number;
  seq?: number;
}

/** 間隔複習的設定（規格書 §5.4；會同步，存在 setting["srs.config"]）。 */
export interface SrsConfig {
  retention: number; // 目標記憶率 0.7–0.97
  maxReviews: number; // 每日複習上限
  maxNew: number; // 每日新卡上限
}

export interface Setting {
  key: string;
  value: string; // JSON
  updated_at: number;
  seq?: number;
}

// ---------- 卡片（第 5 階段，規格書 §9.5） ----------

export interface Deck {
  id: string;
  name: string; // 這一層的名稱（不含上層）
  subject: string | null;
  parent: string | null;
  updated_at: number;
  deleted: 0 | 1;
  seq?: number;
}

/** basic＝問答；reverse＝正反兩張（同一則筆記的兩面互換）；cloze＝克漏字（遮第 ord+1 個 {{cN::…}}）。 */
export type CardKind = "basic" | "reverse" | "cloze";

export interface CardOrigin {
  from: "anki" | "site" | "q" | "kb" | "tsv";
  /** 同一則筆記的卡片共用：Anki 的 guid，或網站產生的 note ID。編輯時一起改。 */
  guid?: string;
  note?: string;
  ord?: number;
  model?: string;
  deck?: string;
  nid?: number;
  cid?: number;
  /** 由題目做成：題目 ID；由筆記做成：kb 文件與區塊 */
  id?: string;
  doc?: string;
  bid?: string;
}

export interface Card {
  id: string;
  deck_id: string;
  kind: CardKind;
  front_md: string;
  back_md: string;
  tags: string[] | null;
  origin: CardOrigin | null;
  updated_at: number;
  deleted: 0 | 1;
  seq?: number;
}

export interface Media {
  sha: string;
  mime: string | null;
  bytes: number | null;
  created_at: number | null;
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

// ---------- 手寫與圖上標記（第 6 階段，規格書 §4.6 ink、§9.6、§9.7） ----------

/** 一筆。座標是這一列的座標空間（ink.w × ink.h），不是螢幕像素。 */
export interface InkStroke {
  /** pen 筆｜hl 螢光筆。之後可能有別的（例如圖上膠帶）：讀到不認得的要原樣保留、不畫 */
  tool: string;
  color: string; // 色彩代碼名稱，例如 "ink-blue"、"hl-yellow"
  size: number; // 筆寬（座標空間的單位）
  pts: [x: number, y: number, p: number][];
  [k: string]: unknown;
}

/** 解壓後的 ink.strokes。 */
export interface InkDoc {
  v: 1;
  /** 圖上標記：畫的時候那張圖的檔案（a/<sha>.svg）；圖之後被改過就和現在的不同 */
  src?: string;
  /** 物理（per_attempt）：在「已作答」的畫面上畫的，記下那一次作答的 id；下次重新作答時清空 */
  att?: string;
  strokes: InkStroke[];
  [k: string]: unknown;
}

/** D1／Dexie 的一列。strokes 是 deflate＋base64 的字串（同步走 JSON）。 */
export interface InkRow {
  id: string; // "ink:" + target + "#" + page
  target: string; // 手寫區 "q:PHY-007836"；圖上標記 "q:PHY-007836/fig:<fid>@q"｜"kb:<doc>/fig:<fid>"｜"card:<id>/m:<sha>"
  page: number;
  strokes: string;
  w: number;
  h: number;
  updated_at: number;
  deleted: 0 | 1;
  seq?: number;
}
