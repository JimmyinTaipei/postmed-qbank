// 頁面樣板（規格書 §13.4）：第 2 階段以後的頁面從這裡的元件開始接功能，不重新設計版面。
// 這裡只有版面與互動，沒有資料邏輯；資料由頁面傳進來。

import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Fig, KbBlock, KbDoc } from "@/data";
import { Markdown } from "./content/Markdown";
import { Icon } from "./icons";
import { Sheet } from "./overlays";
import { Button, Card, IconButton, ProgressBar, TextField, cx } from "./primitives";

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
export function ReviewCard({ front, back, figs, flipped, onFlip, ratings, onRate }: { front: string; back: string; figs?: Fig[]; flipped: boolean; onFlip: () => void; ratings: Rating[]; onRate: (v: Rating["value"]) => void }) {
  return (
    <div className="space-y-3">
      <Card as="article" className="flex min-h-64 flex-col">
        <div className="flex-1 p-5 sm:p-6">
          <Markdown text={front} figs={figs} role="q" />
          {flipped && (
            <div className="anim-rise mt-5 border-t border-line pt-5">
              <Markdown text={back} figs={figs} role="sol" />
            </div>
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

/** 模擬考進行中固定在最上面的一列：剩餘時間、已作答數、交卷。剩不到 5 分鐘變成警示色。 */
export function ExamTimerBar({ remainingS, totalS, answered, total, onSubmit }: { remainingS: number; totalS: number; answered: number; total: number; onSubmit: () => void }) {
  const mm = String(Math.floor(remainingS / 60)).padStart(2, "0");
  const ss = String(remainingS % 60).padStart(2, "0");
  const low = remainingS <= 300;
  return (
    <div className="rounded-card border border-line bg-card">
      <div className="flex items-center gap-3 px-4 py-2">
        <span role="timer" aria-label={`剩餘 ${mm} 分 ${ss} 秒`} className={cx("flex items-center gap-1.5 rounded-btn px-2 py-1 text-title font-semibold tabular-nums", low ? "bg-warning-bg text-warning-ink" : "text-ink-strong")}>
          <Icon name={low ? "alert" : "clock"} size={18} />
          {mm}:{ss}
        </span>
        <span className="min-w-0 flex-1 text-meta text-ink-muted">已作答 {answered} / {total}</span>
        <Button variant="primary" onClick={onSubmit}>交卷</Button>
      </div>
      <ProgressBar value={totalS - remainingS} max={totalS} label="考試時間" className="rounded-none" />
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
export function HeatTable({ rows, cols, value, rowLabel }: { rows: string[]; cols: (string | number)[]; value: (row: string, col: string | number) => number; rowLabel: string }) {
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
              <th scope="row" className="sticky left-0 max-w-40 truncate bg-card px-2 py-1.5 text-left font-normal whitespace-nowrap text-ink-strong">{r}</th>
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

// ---------- 編輯面板 ----------

/** 編輯一段內容：上面（寬螢幕是左邊）Markdown 原始碼，下面（右邊）即時預覽。 */
export function EditPanel({ title, initial, figs, role = "sol", onClose, onSave, saveDisabledReason }: { title: string; initial: string; figs?: Fig[]; role?: Fig["role"]; onClose: () => void; onSave?: (md: string) => void; saveDisabledReason?: string }) {
  const [text, setText] = useState(initial);
  return (
    <Sheet
      title={title}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {saveDisabledReason && <span className="mr-auto self-center text-meta text-ink-muted">{saveDisabledReason}</span>}
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!onSave || text === initial} onClick={() => onSave?.(text)}>儲存</Button>
        </>
      }
    >
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div>
          <label htmlFor="edit-src" className="mb-1.5 block text-meta font-medium text-ink-muted">Markdown 原始碼</label>
          <textarea id="edit-src" data-autofocus value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoCapitalize="none" autoCorrect="off" className="block min-h-72 w-full resize-y rounded-btn border border-line-strong bg-card p-3 font-mono leading-relaxed lg:min-h-[60dvh]" />
        </div>
        <div>
          <div className="mb-1.5 text-meta font-medium text-ink-muted">預覽</div>
          <div className="min-h-24 rounded-btn border border-line p-3" aria-live="polite">
            <Markdown text={text} figs={figs} role={role} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- 資料庫閱讀頁 ----------

const HL = [["yellow", "黃", "bg-hl-yellow"], ["green", "綠", "bg-hl-green"], ["pink", "粉", "bg-hl-pink"], ["blue", "藍", "bg-hl-blue"]] as const;

/** 螢光筆色票（選字後浮出）。 */
export function HighlightPalette({ onPick, onNote }: { onPick: (color: (typeof HL)[number][0]) => void; onNote: () => void }) {
  return (
    <div role="toolbar" aria-label="螢光筆" className="inline-flex items-center gap-1 rounded-btn border border-line bg-card p-1 shadow-pop">
      {HL.map(([id, name, cls]) => (
        <button key={id} type="button" aria-label={`${name}色螢光`} title={`${name}色螢光`} onClick={() => onPick(id)} className="flex size-(--tap) items-center justify-center rounded-chip hover:bg-hover">
          <span className={cx("size-6 rounded-full border border-line-strong", cls)} />
        </button>
      ))}
      <Button variant="ghost" icon="note" onClick={onNote}>加註</Button>
    </div>
  );
}

interface KbProps {
  doc: KbDoc;
  /** 預設展開到第幾層標題（1 起）；Infinity = 全部 */
  openDepth: number;
  editing: boolean;
  onEdit: (b: KbBlock) => void;
}

/** 筆記的區塊樹：標題與有子項的列點都可收合；編輯模式下每個區塊右邊有 ✎。 */
export function KbBlocks({ doc, openDepth, editing, onEdit }: KbProps) {
  const refs = useMemo(() => {
    const m = new Map<string, KbDoc["refs"]>();
    for (const r of doc.refs) m.set(r.bid, [...(m.get(r.bid) ?? []), r]);
    return m;
  }, [doc]);
  return <BlockList blocks={doc.blocks} doc={doc} refs={refs} openDepth={openDepth} editing={editing} onEdit={onEdit} />;
}

type Shared = Omit<KbProps, "doc"> & { doc: KbDoc; refs: Map<string, KbDoc["refs"]> };

function BlockList({ blocks, ...s }: { blocks: KbBlock[] } & Shared) {
  // 連續的列點收成同一個清單
  const groups: (KbBlock | KbBlock[])[] = [];
  for (const b of blocks) {
    const last = groups[groups.length - 1];
    if (b.type === "list_item" && Array.isArray(last)) last.push(b);
    else groups.push(b.type === "list_item" ? [b] : b);
  }
  return (
    <>
      {groups.map((g, i) =>
        Array.isArray(g) ? (
          <ul key={i} className="space-y-0.5">
            {g.map((b) => <ListItem key={b.bid} b={b} {...s} />)}
          </ul>
        ) : (
          <Block key={g.bid} b={g} {...s} />
        ),
      )}
    </>
  );
}

function EditHandle({ b, editing, onEdit }: { b: KbBlock; editing: boolean; onEdit: (b: KbBlock) => void }) {
  if (!editing) return null;
  return (
    <IconButton label="編輯這個區塊" className="-my-1 text-blue-deep" onClick={() => onEdit(b)}>
      <Icon name="edit" size={18} />
    </IconButton>
  );
}

function RefChips({ refs }: { refs?: KbDoc["refs"] }) {
  if (!refs?.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {refs.map((r, i) =>
        r.qid ? (
          <Link key={i} to={`/q/${encodeURIComponent(r.qid)}`} className="inline-flex min-h-7 items-center rounded-chip bg-blue-light px-2 text-meta text-blue-ink no-underline">{r.text}</Link>
        ) : (
          <span key={i} className="inline-flex min-h-7 items-center rounded-chip bg-hover px-2 text-meta text-ink-muted">{r.text}</span>
        ),
      )}
    </span>
  );
}

// 句尾的考古題出處已經另外做成連結，從內文拿掉避免重複
const stripRefs = (md: string, refs?: KbDoc["refs"]) => (refs?.length ? md.replace(/[（(][^（()）]*\d{2,3}-\d+[^（()）]*[）)]\s*$/, "") : md);

function ListItem({ b, ...s }: { b: KbBlock } & Shared) {
  const [open, setOpen] = useState(true);
  const kids = b.children;
  const r = s.refs.get(b.bid);
  return (
    <li>
      <div className="flex items-start gap-1">
        {kids.length ? (
          <button type="button" aria-expanded={open} aria-label={open ? "收合子項" : "展開子項"} onClick={() => setOpen((v) => !v)} className="flex h-7 w-6 shrink-0 items-center justify-center rounded-chip text-ink-muted hover:bg-hover">
            <Icon name="chevronRight" size={15} className={cx("transition-transform duration-(--dur-fast)", open && "rotate-90")} />
          </button>
        ) : (
          <span className="flex h-7 w-6 shrink-0 items-center justify-center text-ink-muted" aria-hidden="true">•</span>
        )}
        <div className="min-w-0 flex-1">
          <Markdown text={stripRefs(b.md, r)} figs={s.doc.figs} role="kb" tight />
          <RefChips refs={r} />
        </div>
        <EditHandle b={b} editing={s.editing} onEdit={s.onEdit} />
      </div>
      {open && kids.length > 0 && (
        <div className="ml-3 border-l border-line pl-3">
          <BlockList blocks={kids} {...s} />
        </div>
      )}
    </li>
  );
}

function Block({ b, ...s }: { b: KbBlock } & Shared) {
  if (b.type === "html" || /^\s*<style/.test(b.md)) return null; // Typora 的列印設定，網站上不顯示
  if (b.type === "rule") return <hr className="my-4 border-line" />;
  if (b.type === "heading") {
    const level = b.level ?? 2;
    const H = `h${Math.min(6, Math.max(2, level))}` as "h2";
    const text = b.md.replace(/^#+\s*/, "");
    if (level === 1) return <BlockList blocks={b.children} {...s} />; // 文件標題已在頁首
    return (
      <details open={level <= s.openDepth} className="group/h">
        <summary className={cx("flex min-h-(--tap) items-center gap-2 rounded-btn hover:bg-hover", level === 2 ? "mt-4 border-b border-line" : "mt-2")}>
          <Icon name="chevronRight" size={18} className="text-ink-muted transition-transform duration-(--dur-fast) group-open/h:rotate-90" />
          <H className={cx("min-w-0 flex-1 font-semibold text-ink-strong", level === 2 ? "text-title" : "text-body")}>
            <Markdown text={text} tight className={level === 2 ? "text-title!" : undefined} />
          </H>
          <span onClick={(e) => e.preventDefault()}><EditHandle b={b} editing={s.editing} onEdit={s.onEdit} /></span>
        </summary>
        <div className="space-y-2 py-2 pl-1.5">
          <BlockList blocks={b.children} {...s} />
        </div>
      </details>
    );
  }
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <Markdown text={stripRefs(b.md, s.refs.get(b.bid))} figs={s.doc.figs} role="kb" />
        <RefChips refs={s.refs.get(b.bid)} />
      </div>
      <EditHandle b={b} editing={s.editing} onEdit={s.onEdit} />
    </div>
  );
}
