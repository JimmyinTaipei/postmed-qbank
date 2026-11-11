// 題目下方的手寫區（第 6 階段，規格書 §9.6）。
// - 預設收合；展開後是白色紙面（深淺色都是 --paper），可以加長、加頁。
// - Apple Pencil 與滑鼠會畫；手指照常捲動頁面。整區不觸發左右滑換題（data-noswipe="always"）。
// - 停筆 2 秒自動存；離開畫面、App 進背景時立刻存。
// - 物理（per_attempt）：重新作答這一題時是空白的，由 useInkAttemptReset 清掉上一次的筆跡（含這一題圖上的標記）。

import { useCallback, useEffect, useRef, useState } from "react";
import { ink, qKey, useInkPolicy, useInkRows, useInkToolPref, useLastAttempt, type InkRow, type Question } from "@/data";
import { Icon } from "../icons";
import { Button, cx } from "../primitives";
import { InkLayer } from "./InkLayer";
import { brushOf, InkToolbar } from "./InkToolbar";
import { usePersistentInk } from "./persist";
import type { InkEditor } from "./useInkEditor";

/** 紙的座標空間：寬固定 1000，高預設 700，每次「加長」多 350。顯示時等比縮放到欄寬。 */
export const PAGE_W = 1000;
const PAGE_H = 700;
const GROW = 350;
const MAX_H = 4200;

const acceptPenOrMouse = (e: PointerEvent) => e.pointerType === "pen" || e.pointerType === "mouse";

/**
 * 物理（per_attempt）：題目以「還沒作答」的狀態出現時，就是新的一次作答——清掉上一次的手寫與這一題圖上的標記。
 * 每次掛載只做一次；已作答的畫面不清。
 */
export function useInkAttemptReset(q: Question, answering: boolean): void {
  const policy = useInkPolicy(q.subject);
  // 一定要查同一個鍵：查詢的鍵中途改變時，useLiveQuery 會先回上一次的結果（null），會被誤當成「沒作答過」
  const last = useLastAttempt(qKey(q.id));
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !answering || policy !== "per_attempt" || last === undefined) return;
    done.current = true;
    void ink.resetForAttempt(q.id, last);
  }, [answering, policy, last, q.id]);
}

interface Props {
  target: string;
  /** 物理在已作答畫面上畫的：記下那次作答（下次重新作答時清掉） */
  att?: string;
}

export function Handwriting({ target, att }: Props) {
  const rows = useInkRows(target);
  const live = rows?.filter((r) => !r.deleted) ?? [];
  const has = live.length > 0;
  const [open, setOpen] = useState(false);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="group rounded-btn border border-line"
    >
      <summary className="flex min-h-(--tap) items-center gap-2 px-3 text-ui font-medium text-ink-strong">
        <Icon name="pencil" size={18} />
        <span className="min-w-0 flex-1">{has ? "手寫區（有內容）" : "手寫區"}</span>
        <Icon name="chevronDown" size={18} className="transition-transform duration-(--dur-fast) group-open:rotate-180" />
      </summary>
      {open && rows && <InkPages target={target} att={att} rows={rows} />}
    </details>
  );
}

/** 工具列＋一頁頁的紙＋加一頁。手寫區與螢光的手寫註記共用。toolbarClass：工具列黏住的位置（在面板裡捲動時不同）。 */
export function InkPages({ target, att, rows, toolbarClass = "sticky top-[calc(env(safe-area-inset-top)+3.75rem)]" }: { target: string; att?: string; rows: InkRow[]; toolbarClass?: string }) {
  const pref = useInkToolPref();
  const brush = brushOf(pref);
  const used = rows.filter((r) => !r.deleted).map((r) => r.page);
  const [extra, setExtra] = useState(0);
  const count = Math.max(1, (used.length ? Math.max(...used) + 1 : 0), extra);
  const [active, setActive] = useState(0);
  const [eds, setEds] = useState<Record<number, InkEditor>>({});
  const onEditor = useCallback((p: number, e: InkEditor) => setEds((m) => (m[p] === e ? m : { ...m, [p]: e })), []);
  const ed = eds[Math.min(active, count - 1)];

  return (
    <div data-noswipe="always" className="space-y-3 px-3 pb-3">
      <p className="text-meta text-ink-muted">用 Apple Pencil 或滑鼠寫；手指可以照常捲動。停筆 2 秒自動存，兩台裝置會同步。</p>
      <InkToolbar
        className={cx(toolbarClass, "z-10 shadow-pop")}
        canUndo={!!ed?.canUndo}
        canRedo={!!ed?.canRedo}
        canClear={!!ed?.strokes.length}
        onUndo={() => ed?.undo()}
        onRedo={() => ed?.redo()}
        onClear={() => ed?.clear()}
        clearLabel={count > 1 ? `清空第 ${active + 1} 頁` : "清空這一頁"}
      />
      {Array.from({ length: count }, (_, i) => (
        <InkPage key={i} target={target} page={i} row={rows.find((r) => r.page === i) ?? null} att={att} brush={brush} active={i === active} multi={count > 1} onActivate={() => setActive(i)} onEditor={onEditor} />
      ))}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          icon="plus"
          onClick={() => {
            setExtra(count + 1);
            setActive(count);
          }}
        >
          加一頁
        </Button>
      </div>
    </div>
  );
}

interface PageProps {
  target: string;
  page: number;
  row: InkRow | null;
  att?: string;
  brush: ReturnType<typeof brushOf>;
  active: boolean;
  multi: boolean;
  onActivate: () => void;
  onEditor: (page: number, e: InkEditor) => void;
}

function InkPage({ target, page, row, att, brush, active, multi, onActivate, onEditor }: PageProps) {
  const [h, setH] = useState(row && !row.deleted ? row.h || PAGE_H : PAGE_H);
  const hRef = useRef(h);
  hRef.current = h;
  const attRef = useRef(att);
  attRef.current = att;
  const { editor, save } = usePersistentInk({
    target,
    page,
    row,
    size: () => ({ w: PAGE_W, h: hRef.current }),
    meta: () => ({ att: attRef.current }),
    onLoad: (r) => r && !r.deleted && r.h && setH(r.h),
  });

  useEffect(() => onEditor(page, editor), [page, editor, onEditor]);

  return (
    <div className="space-y-1">
      {multi && <p className={cx("text-meta", active ? "font-semibold text-ink-strong" : "text-ink-muted")}>第 {page + 1} 頁</p>}
      <div
        className={cx("relative w-full overflow-hidden rounded-btn border bg-paper select-none", active && multi ? "border-blue-accent" : "border-line-strong")}
        style={{ aspectRatio: `${PAGE_W} / ${h}`, WebkitTouchCallout: "none" }}
      >
        <InkLayer w={PAGE_W} h={h} editor={editor} brush={brush} accept={acceptPenOrMouse} stylusDraws onBegin={onActivate} label={`手寫第 ${page + 1} 頁`} />
      </div>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          icon="chevronDown"
          disabled={h >= MAX_H}
          onClick={() => {
            const next = Math.min(MAX_H, h + GROW);
            hRef.current = next;
            setH(next);
            onActivate();
            if (editor.strokes.length) void save(true);
          }}
        >
          加長
        </Button>
      </div>
    </div>
  );
}
