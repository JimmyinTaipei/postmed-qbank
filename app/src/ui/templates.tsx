// 頁面樣板（規格書 §13.4）：第 2 階段以後的頁面從這裡的元件開始接功能，不重新設計版面。
// 這裡只有版面與互動，沒有資料邏輯；資料由頁面傳進來。

import { useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Fig, FieldMark, KbBlock, KbDoc } from "@/data";
import { Markdown } from "./content/Markdown";
import { Icon } from "./icons";
import { Menu, type MenuItem } from "./overlays";
import { Badge, Button, Card, ProgressBar, TextField, cx } from "./primitives";

// ---------- 清單頁：搜尋列 ----------

export function SearchBar({ value, onChange, placeholder, label = "搜尋" }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <div role="search" className="relative">
      <TextField label={label} hideLabel type="search" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} leading={<Icon name="search" size={18} />} />
    </div>
  );
}

// ---------- 複習卡片 ----------

export interface Rating {
  value: 1 | 2 | 3 | 4;
  label: string;
  next: string; // 下次出現的時間（「10 分鐘」「3 天」）
}

/** 複習卡片：點卡片或按空白鍵翻面；翻面後才出現四顆評分鈕。 */
export function ReviewCard({ front, back, figs, flipped, onFlip, ratings, onRate, bigFront, body }: {
  front: string;
  back: string;
  figs?: Fig[];
  flipped: boolean;
  onFlip: () => void;
  ratings: Rating[];
  onRate: (v: Rating["value"]) => void;
  /** 正面只是一個詞：放大顯示 */
  bigFront?: boolean;
  /** 有自己樣板的卡（單字卡）：整個卡面換成這個，front／back 只用來播聲音 */
  body?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <Card as="article" className="flex min-h-64 flex-col">
        {/* 克漏字的膠帶：點膠帶就翻面（和「顯示答案」相同） */}
        <div className="flex-1 p-5 sm:p-6" onClick={(e) => { if (!flipped && (e.target as HTMLElement).closest(".cloze-tape")) onFlip(); }}>
          {body ?? (
            <>
              <Markdown text={front} figs={figs} role="q" className={bigFront ? "text-display font-semibold text-ink-strong" : undefined} />
              {flipped && back.trim() && (
                <div className="anim-rise mt-5 border-t border-line pt-5">
                  <Markdown text={back} figs={figs} role="sol" />
                </div>
              )}
            </>
          )}
        </div>
      </Card>
      {flipped ? (
        <div role="group" aria-label="這張記得多清楚" className="grid grid-cols-4 gap-2">
          {ratings.map((r) => (
            <button key={r.value} type="button" onClick={() => onRate(r.value)} className={cx("flex min-h-(--option-h) flex-col items-center justify-center rounded-btn border px-1 transition-colors duration-(--dur-fast)", r.value === 1 ? "border-incorrect bg-incorrect-bg text-incorrect-ink" : "border-line bg-card text-ink-strong hover:bg-hover")}>
              <span className="text-ui font-semibold">{r.label}</span>
              <span className="text-meta opacity-80">{r.next}</span>
            </button>
          ))}
        </div>
      ) : (
        <Button variant="primary" block onClick={onFlip}>顯示答案</Button>
      )}
    </div>
  );
}

// ---------- 原卷方格、模擬考計時列 ----------

export interface PaperCell {
  count: number;
  /** 做過的話：答對率 0–1 */
  score?: number | null;
}

/** 學校 × 年份方格。沒有這份考卷的格子留空；做過的格子顯示得分。 */
export function PaperGrid({ schools, years, cell, onOpen }: { schools: string[]; years: number[]; cell: (school: string, year: number) => PaperCell | null; onOpen: (school: string, year: number) => void }) {
  return (
    <div className="overflow-x-auto overscroll-x-contain rounded-card border border-line bg-card" data-noswipe>
      <table className="w-full border-collapse text-ui">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-sidebar px-4 py-2.5 text-left font-semibold text-ink-strong">學校</th>
            {years.map((y) => (
              <th key={y} scope="col" className="bg-sidebar px-1 py-2.5 text-center font-medium tabular-nums text-ink-muted">{y}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {schools.map((s) => (
            <tr key={s} className="border-t border-line">
              <th scope="row" className="sticky left-0 z-10 bg-card px-4 text-left font-medium whitespace-nowrap text-ink-strong">{s}</th>
              {years.map((y) => {
                const c = cell(s, y);
                return (
                  <td key={y} className="p-1 text-center">
                    {c ? (
                      <button type="button" onClick={() => onOpen(s, y)} aria-label={`${s} ${y} 年，${c.count} 題${c.score != null ? `，上次答對率 ${Math.round(c.score * 100)}%` : ""}`} className={cx("flex size-(--tap) flex-col items-center justify-center rounded-btn border text-meta tabular-nums transition-colors duration-(--dur-fast)", c.score != null ? "border-blue-deep bg-blue-light font-semibold text-blue-ink" : "border-line text-ink hover:bg-hover")}>
                        {c.score != null ? `${Math.round(c.score * 100)}%` : c.count}
                      </button>
                    ) : (
                      <span className="inline-block size-(--tap)" aria-hidden="true" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 模擬考進行中固定在最上面的一列：剩餘時間（不計時則是已用時間）、已作答數、交卷。剩不到 5 分鐘變成警示色。 */
export function ExamTimerBar({ remainingS, totalS, elapsedS = 0, answered, total, onSubmit }: { remainingS: number | null; totalS: number | null; elapsedS?: number; answered: number; total: number; onSubmit: () => void }) {
  const timed = remainingS != null && totalS != null;
  const shown = timed ? Math.max(0, remainingS) : elapsedS;
  const hh = Math.floor(shown / 3600);
  const mm = String(Math.floor((shown % 3600) / 60)).padStart(hh ? 2 : 2, "0");
  const ss = String(shown % 60).padStart(2, "0");
  const text = hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
  const low = timed && remainingS <= 300;
  return (
    <div className="rounded-card border border-line bg-card">
      <div className="flex items-center gap-3 px-4 py-2">
        <span role="timer" aria-label={timed ? `剩餘 ${Math.floor(shown / 60)} 分 ${shown % 60} 秒` : `已用 ${Math.floor(shown / 60)} 分`} className={cx("flex items-center gap-1.5 rounded-btn px-2 py-1 text-title font-semibold tabular-nums", low ? "bg-warning-bg text-warning-ink" : "text-ink-strong")}>
          <Icon name={low ? "alert" : "clock"} size={18} />
          {text}
        </span>
        <span className="min-w-0 flex-1 text-meta text-ink-muted">{timed ? "" : "不計時・"}已作答 {answered} / {total}</span>
        <Button variant="primary" onClick={onSubmit}>交卷</Button>
      </div>
      {timed && <ProgressBar value={totalS - Math.max(0, remainingS)} max={totalS} label="考試時間" className="rounded-none" />}
    </div>
  );
}

// ---------- 圖表卡 ----------

export function ChartCard({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-ui font-semibold text-ink-strong">{title}</h3>
          {subtitle && <p className="mt-0.5 text-meta text-ink-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** 橫條圖：每列是名稱、長條、數值。只用藍色；數值一定寫出來，不靠顏色深淺讀數。 */
export function BarList({ rows, max, format = (v) => String(v) }: { rows: { label: string; value: number; note?: string }[]; max?: number; format?: (v: number) => string }) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-meta">
          <span className="truncate text-ink-strong">{r.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
            <span className="block h-full rounded-full bg-blue-accent" style={{ width: `${Math.min(100, (r.value / top) * 100)}%` }} />
          </span>
          <span className="w-16 text-right tabular-nums text-ink">{format(r.value)}{r.note && <span className="text-ink-muted"> {r.note}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

/** 直條圖：每日題數、複習負擔預測。 */
export function ColumnChart({ data, unit }: { data: { label: string; value: number }[]; unit: string }) {
  const top = Math.max(1, ...data.map((d) => d.value));
  return (
    <div role="img" aria-label={data.map((d) => `${d.label} ${d.value} ${unit}`).join("、")} className="flex h-40 items-end gap-1.5">
      {data.map((d) => (
        <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="text-meta tabular-nums text-ink-muted">{d.value || ""}</span>
          <span className="w-full max-w-10 rounded-t-chip bg-blue-accent" style={{ height: `${(d.value / top) * 100}%`, minHeight: d.value ? 3 : 0 }} />
          <span className="w-full truncate text-center text-meta text-ink-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** 章節 × 年份（或學校）的出題比例表。格子底色分四級，數字照寫。 */
export function HeatTable({ rows, cols, value, rowLabel, rowName = (r) => r }: { rows: string[]; cols: (string | number)[]; value: (row: string, col: string | number) => number; rowLabel: string; rowName?: (row: string) => string }) {
  const top = useMemo(() => Math.max(1, ...rows.flatMap((r) => cols.map((c) => value(r, c)))), [rows, cols, value]);
  const shade = (v: number) => (v === 0 ? "text-ink-muted" : v / top > 0.66 ? "bg-blue-deep text-on-deep font-semibold" : v / top > 0.33 ? "bg-blue-mid text-blue-ink" : "bg-blue-light text-blue-ink");
  return (
    <div className="overflow-x-auto overscroll-x-contain" data-noswipe>
      <table className="w-full border-separate border-spacing-0.5 text-meta tabular-nums">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-card px-2 py-1.5 text-left font-medium text-ink-muted">{rowLabel}</th>
            {cols.map((c) => <th key={c} scope="col" className="min-w-9 px-1 py-1.5 font-medium text-ink-muted">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r}>
              <th scope="row" title={rowName(r)} className="sticky left-0 max-w-40 truncate bg-card px-2 py-1.5 text-left font-normal whitespace-nowrap text-ink-strong">{rowName(r)}</th>
              {cols.map((c) => {
                const v = value(r, c);
                return <td key={c} className={cx("rounded-chip px-1 py-1.5 text-center", shade(v))}>{v || "·"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- 資料庫閱讀頁 ----------

// 使用者自己的螢光筆六色（順序照使用者給的）
const HL = [["yellow", "黃", "bg-hl-yellow"], ["blue", "藍", "bg-hl-blue"], ["purple", "紫", "bg-hl-purple"], ["pink", "粉", "bg-hl-pink"], ["green", "綠", "bg-hl-green"], ["orange", "橘", "bg-hl-orange"]] as const;

/** 螢光筆色票（選字後浮出）。 */
export function HighlightPalette({ onPick, onNote, onInk, onEdit, onLookup, extra }: { onPick: (color: (typeof HL)[number][0]) => void; onNote: () => void; /** 手寫註記：開註記卡並直接展開手寫 */ onInk?: () => void; /** 編輯這段內容（題目的欄位、筆記的區塊） */ onEdit?: () => void; /** 查單字（第 8B-2 階段；選到英文字才有） */ onLookup?: () => void; /** 其他按鈕（5B 的克漏字） */ extra?: ReactNode }) {
  return (
    <div role="toolbar" aria-label="螢光筆" className="inline-flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-1 rounded-btn border border-line bg-card p-1 shadow-pop">
      {HL.map(([id, name, cls]) => (
        <button key={id} type="button" aria-label={`${name}色螢光`} title={`${name}色螢光`} onClick={() => onPick(id)} className="flex size-(--tap) items-center justify-center rounded-chip hover:bg-hover">
          <span className={cx("size-6 rounded-full border border-line-strong", cls)} />
        </button>
      ))}
      <Button variant="ghost" icon="note" onClick={onNote}>加註</Button>
      {onInk && <Button variant="ghost" icon="pencil" onClick={onInk}>手寫</Button>}
      {extra}
      {onLookup && <Button variant="ghost" icon="book" onClick={onLookup}>查單字</Button>}
      {onEdit && <Button variant="ghost" icon="edit" onClick={onEdit}>編輯</Button>}
    </div>
  );
}

/** 區塊上的修訂標記（資料層的 KbMark 去掉修訂本身）。 */
export interface KbBlockMark {
  state: FieldMark;
  kind: "md" | "insert" | "delete";
}

interface KbProps {
  doc: KbDoc;
  /** 預設展開到第幾層標題（1 起）；Infinity = 全部 */
  openDepth: number;
  editing: boolean;
  /** 編輯模式下每個區塊 ✎ 選單的項目（改、插入列點、刪除…） */
  editMenu: (b: KbBlock) => MenuItem[];
  /** bid → 修訂標記（待寫回、待發佈、衝突…）；刪除待寫回的區塊淡化加刪除線 */
  marks?: Map<string, KbBlockMark[]>;
  /** 區塊筆記：bid → Markdown */
  notes?: Map<string, { body_md: string }>;
  /** 點區塊筆記：就地編輯它 */
  onNote?: (b: KbBlock) => void;
  /** 正在就地編輯的區塊筆記：編輯器放在筆記的位置 */
  noteEditor?: { bid: string; node: ReactNode } | null;
  /** 正在就地編輯的區塊（第 3B 階段）：原本那段字藏起來但留在頁面上（螢光才不會失聯），編輯器放在它的位置 */
  inline?: { bid: string; node: ReactNode } | null;
  /** 電腦上在區塊上按兩下：就地編輯這個區塊 */
  onOpen?: (b: KbBlock, at: { x: number; y: number }) => void;
}

/** 有滑鼠的電腦（按兩下編輯、滑過出現 ⋯ 只在這種裝置上） */
const finePointer = () => typeof matchMedia !== "undefined" && matchMedia("(hover: hover) and (pointer: fine)").matches;

/** 區塊上按兩下（電腦）；頁首開了「編輯」之後點一下（圖、連結、按鈕上不算） */
function opener(b: KbBlock, s: Shared) {
  const go = (e: ReactMouseEvent) => {
    if (!s.onOpen || (e.target as HTMLElement).closest(".fig, a, button, .snd, mark, [data-vm]")) return false;
    window.getSelection()?.removeAllRanges();
    s.onOpen(b, { x: e.clientX, y: e.clientY });
    return true;
  };
  return {
    onDoubleClick: (e: ReactMouseEvent) => {
      if (finePointer()) go(e);
    },
    onClick: (e: ReactMouseEvent) => {
      if (s.editing && window.getSelection()?.isCollapsed !== false && go(e)) e.preventDefault();
    },
  };
}

/** 筆記的區塊樹：標題與有子項的列點都可收合；每個區塊右邊有 ⋯ 選單（電腦上滑過出現；觸控在頁首開「編輯」之後出現）。
 *  每個區塊自己的文字包在 [data-hl-bid] 裡（螢光層用），整個區塊有 id="b-<bid>"（相關筆記的連結跳到這裡）。
 *  收合只是藏起來（hidden），文字仍在頁面上，螢光才找得到。 */
export function KbBlocks({ doc, ...rest }: KbProps) {
  const refs = useMemo(() => {
    const m = new Map<string, KbDoc["refs"]>();
    for (const r of doc.refs) m.set(r.bid, [...(m.get(r.bid) ?? []), r]);
    return m;
  }, [doc]);
  return <BlockList blocks={doc.blocks} doc={doc} refs={refs} {...rest} />;
}

type Shared = Omit<KbProps, "doc"> & { doc: KbDoc; refs: Map<string, KbDoc["refs"]> };

function BlockList({ blocks, ...s }: { blocks: KbBlock[] } & Shared) {
  // 連續的列點收成同一個清單
  const groups: (KbBlock | KbBlock[])[] = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (b.type === "list_item" && Array.isArray(last) && last[0].ordered === b.ordered) last.push(b);
    else groups.push(b.type === "list_item" ? [b] : b);
  }
  return (
    <>
      {groups.map((g, i) =>
        Array.isArray(g) ? (
          <ul key={i} className="space-y-0.5">
            {/* 有序列點的編號照 Markdown：從第一項的數字往下數（與 Typora 相同） */}
            {g.map((b, k) => <ListItem key={b.bid} b={b} n={(g[0].num ?? 1) + k} {...s} />)}
          </ul>
        ) : (
          <Block key={g.bid} b={g} {...s} />
        ),
      )}
    </>
  );
}

function Handles({ b, s }: { b: KbBlock; s: Shared }) {
  const items = s.editMenu(b);
  if (!items.length) return null;
  return (
    <span className={cx("kb-handle -my-1 text-ink-muted print:hidden", s.editing && "kb-handle-on text-blue-deep")}>
      <Menu label="這個區塊的動作" items={items}>
        <Icon name="dots" size={18} />
      </Menu>
    </span>
  );
}

/** 區塊下方的個人筆記：點一下就地編輯。 */
function BlockNote({ b, s }: { b: KbBlock; s: Shared }) {
  if (s.noteEditor?.bid === b.bid) return <div className="mt-1 rounded-btn border border-blue-accent bg-card px-3 py-2">{s.noteEditor.node}</div>;
  const n = s.notes?.get(b.bid);
  if (!n) return null;
  return (
    <button
      type="button"
      onClick={() => s.onNote?.(b)}
      title="點一下修改這則筆記"
      className="mt-1 flex w-full items-start gap-2 rounded-btn border border-line bg-hover px-3 py-2 text-left hover:border-blue-accent"
    >
      <Icon name="note" size={16} className="mt-1 shrink-0 text-blue-deep" />
      <div className="min-w-0 flex-1 text-ui">
        <Markdown text={n.body_md} figs={s.doc.figs} role="kb" tight />
      </div>
    </button>
  );
}

const MARK_TEXT: Record<KbBlockMark["kind"], string> = { md: "已修訂", insert: "新增", delete: "刪除" };

/** 區塊旁的修訂標記。 */
function Marks({ list }: { list?: KbBlockMark[] }) {
  if (!list?.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5 print:hidden">
      {list.map((m, i) =>
        m.state === "conflict" ? (
          <Badge key={i} tone="incorrect" icon="alert">{MARK_TEXT[m.kind]}・衝突</Badge>
        ) : m.state === "stale" ? (
          <Badge key={i} tone="warning" icon="alert">{MARK_TEXT[m.kind]}・修訂待處理</Badge>
        ) : (
          <Badge key={i} tone={m.state === "written" ? "blue" : "warning"} icon="edit">{MARK_TEXT[m.kind]}・{m.state === "written" ? "已寫回・待發佈" : "待寫回"}</Badge>
        ),
      )}
    </span>
  );
}

const isDeleted = (list?: KbBlockMark[]) => !!list?.some((m) => m.kind === "delete" && (m.state === "pending" || m.state === "written"));

function RefChips({ refs }: { refs?: KbDoc["refs"] }) {
  if (!refs?.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {refs.map((r, i) =>
        r.qid ? (
          <Link key={i} to={`/q/${encodeURIComponent(r.qid)}`} className="inline-flex min-h-7 items-center rounded-chip bg-blue-light px-2 text-meta text-blue-ink no-underline">{r.text}</Link>
        ) : (
          <span key={i} title="題庫裡找不到這一題" className="inline-flex min-h-7 items-center rounded-chip bg-hover px-2 text-meta text-ink-muted">{r.text}</span>
        ),
      )}
    </span>
  );
}

// 句尾的考古題出處已經另外做成連結，從內文拿掉避免重複
const stripRefs = (md: string, refs?: KbDoc["refs"]) => (refs?.length ? md.replace(/[（(][^（()）]*[一-鿿]{2}-\d{2,3}-\d+[^（()）]*[）)]\s*$/, "") : md);

function ListItem({ b, n, ...s }: { b: KbBlock; n: number } & Shared) {
  const [open, setOpen] = useState(true);
  const kids = b.children;
  const r = s.refs.get(b.bid);
  const m = s.marks?.get(b.bid);
  return (
    <li id={`b-${b.bid}`} className={cx("kb-block", isDeleted(m) && "kb-deleted")}>
      <div className="kb-row flex items-start gap-1">
        {kids.length ? (
          <button type="button" aria-expanded={open} aria-label={open ? "收合子項" : "展開子項"} onClick={() => setOpen((v) => !v)} className="flex h-7 min-w-6 shrink-0 items-center justify-center rounded-chip text-ink-muted hover:bg-hover print:hidden">
            <Icon name="chevronRight" size={15} className={cx("transition-transform duration-(--dur-fast)", open && "rotate-90")} />
          </button>
        ) : null}
        <span className={cx("h-7 min-w-6 shrink-0 items-center justify-center text-ink-muted", kids.length || s.inline?.bid === b.bid ? "hidden print:flex" : "flex")} aria-hidden="true">{b.ordered ? `${n}.` : "•"}</span>
        <div className="min-w-0 flex-1">
          <div data-hl-bid={b.bid} hidden={s.inline?.bid === b.bid} {...opener(b, s)}>
            <Markdown text={stripRefs(b.md, r)} figs={s.doc.figs} role="kb" tight />
          </div>
          {s.inline?.bid === b.bid && s.inline.node}
          <Marks list={m} />
          <RefChips refs={r} />
          <BlockNote b={b} s={s} />
        </div>
        <Handles b={b} s={s} />
      </div>
      {kids.length > 0 && (
        <div hidden={!open} className="ml-3 border-l border-line pl-3 print:block">
          <BlockList blocks={kids} {...s} />
        </div>
      )}
    </li>
  );
}

function Block({ b, ...s }: { b: KbBlock } & Shared) {
  if (b.type === "html" || /^\s*<style/.test(b.md)) {
    // Typora 的列印設定、分頁符號：網站上不顯示；分頁符號在列印時照樣分頁
    return /page-break-before/.test(b.md) ? <div className="hidden print:block print:break-before-page" aria-hidden="true" /> : null;
  }
  if (b.type === "rule") return <hr id={`b-${b.bid}`} className="my-4 border-line" />;
  if (b.type === "heading") {
    const level = b.level ?? 2;
    const H = `h${Math.min(6, Math.max(2, level))}` as "h2";
    const text = b.md.replace(/^#+\s*/, "");
    if (level === 1) return <BlockList blocks={b.children} {...s} />; // 文件標題已在頁首
    const m = s.marks?.get(b.bid);
    return (
      <details id={`b-${b.bid}`} open={level <= s.openDepth || s.inline?.bid === b.bid} className="kb-block group/h">
        <summary className={cx("kb-row flex min-h-(--tap) items-center gap-2 rounded-btn hover:bg-hover", level === 2 ? "mt-4 border-b border-line" : "mt-2")}>
          <Icon name="chevronRight" size={18} className="text-ink-muted transition-transform duration-(--dur-fast) group-open/h:rotate-90 print:hidden" />
          <H className={cx("min-w-0 flex-1 font-semibold text-ink-strong", level === 2 ? "text-title" : "text-body")}>
            <span data-hl-bid={b.bid} className="block" onDoubleClick={(e) => (e.preventDefault(), opener(b, s).onDoubleClick(e))} onClick={(e) => { if (s.editing) { e.preventDefault(); opener(b, s).onClick(e); } }}>
              <Markdown text={text} tight className={level === 2 ? "text-title!" : undefined} />
            </span>
          </H>
          <span onClick={(e) => e.preventDefault()}><Handles b={b} s={s} /></span>
        </summary>
        <div className="space-y-2 py-2 pl-1.5">
          {/* 標題的編輯器不放在 <summary> 裡（在裡面打空白會收合） */}
          {s.inline?.bid === b.bid && <div className={level === 2 ? "text-title font-semibold" : "font-semibold"}>{s.inline.node}</div>}
          <Marks list={m} />
          <BlockNote b={b} s={s} />
          <BlockList blocks={b.children} {...s} />
        </div>
      </details>
    );
  }
  const r = s.refs.get(b.bid);
  const m = s.marks?.get(b.bid);
  return (
    <div id={`b-${b.bid}`} className={cx("kb-block", isDeleted(m) && "kb-deleted")}>
      <div className="kb-row flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div data-hl-bid={b.bid} hidden={s.inline?.bid === b.bid} {...opener(b, s)}>
            <Markdown text={stripRefs(b.md, r)} figs={s.doc.figs} role="kb" />
          </div>
          {s.inline?.bid === b.bid && s.inline.node}
          <Marks list={m} />
          <RefChips refs={r} />
          <BlockNote b={b} s={s} />
        </div>
        <Handles b={b} s={s} />
      </div>
      {b.children.length > 0 && (
        <div className="ml-3 space-y-2 border-l border-line pl-3">
          <BlockList blocks={b.children} {...s} />
        </div>
      )}
    </div>
  );
}
