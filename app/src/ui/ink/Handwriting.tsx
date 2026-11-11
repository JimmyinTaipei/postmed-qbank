// 題目下方的手寫區（第 6 階段，規格書 §9.6）。
// - 預設收合；展開後是白色紙面（深淺色都是 --paper），可以加長、加頁。
// - Apple Pencil 與滑鼠會畫；手指照常捲動頁面。整區不觸發左右滑換題（data-noswipe="always"）。
// - 停筆 2 秒自動存；離開畫面、App 進背景時立刻存。
// - 物理（per_attempt）：重新作答這一題時是空白的，由 useInkAttemptReset 清掉上一次的筆跡（含這一題圖上的標記）。

import { useCallback, useEffect, useRef, useState } from "react";
import { ink, InkTooLarge, qKey, readInk, useInkPolicy, useInkRows, useInkToolPref, useLastAttempt, type InkRow, type Question } from "@/data";
import { Icon } from "../icons";
import { useToast } from "../overlays";
import { Button, cx } from "../primitives";
import { InkLayer } from "./InkLayer";
import { brushOf, InkToolbar } from "./InkToolbar";
import { useInkEditor, type InkEditor } from "./useInkEditor";

/** 紙的座標空間：寬固定 1000，高預設 700，每次「加長」多 350。顯示時等比縮放到欄寬。 */
export const PAGE_W = 1000;
const PAGE_H = 700;
const GROW = 350;
const MAX_H = 4200;
const SAVE_DELAY = 2000;

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
      {open && rows && <Pages target={target} att={att} rows={rows} />}
    </details>
  );
}

function Pages({ target, att, rows }: { target: string; att?: string; rows: InkRow[] }) {
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
        className="sticky top-[calc(env(safe-area-inset-top)+3.75rem)] z-10 shadow-pop"
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
  const toast = useToast();
  const editor = useInkEditor();
  const [h, setH] = useState(row && !row.deleted ? row.h || PAGE_H : PAGE_H);
  const known = useRef<number | null>(null); // 畫面上這一份對應的 updated_at
  const edRef = useRef(editor);
  edRef.current = editor;
  const hRef = useRef(h);
  hRef.current = h;
  const attRef = useRef(att);
  attRef.current = att;

  useEffect(() => onEditor(page, editor), [page, editor, onEditor]);

  // 資料庫的內容（開啟時、另一台裝置畫了、物理重新作答被清掉）→ 畫面。自己還有沒存的變更時不蓋掉。
  const at = row?.updated_at ?? null;
  useEffect(() => {
    if (at === known.current || edRef.current.dirty) return;
    let alive = true;
    void readInk(row).then((doc) => {
      if (!alive || edRef.current.dirty) return;
      known.current = at;
      edRef.current.load(doc.strokes);
      if (row && !row.deleted && row.h) setH(row.h);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  const save = useCallback(
    async (force = false) => {
      const e = edRef.current;
      if (!e.dirty && !force) return;
      const rev = e.rev;
      try {
        const r = await ink.save(target, page, { v: 1, ...(attRef.current ? { att: attRef.current } : {}), strokes: e.strokes }, PAGE_W, hRef.current);
        known.current = r.updated_at;
        e.markSaved(rev);
      } catch (err) {
        toast(err instanceof InkTooLarge ? err.message : "手寫沒有存成功，請再寫一筆試試");
      }
    },
    [target, page, toast],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  // 停筆 2 秒自動存
  useEffect(() => {
    if (!editor.dirty) return;
    const t = setTimeout(() => void saveRef.current(), SAVE_DELAY);
    return () => clearTimeout(t);
  }, [editor.rev, editor.dirty]);

  // 離開畫面、App 進背景：立刻存
  useEffect(() => {
    const flush = () => void saveRef.current();
    const vis = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

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
