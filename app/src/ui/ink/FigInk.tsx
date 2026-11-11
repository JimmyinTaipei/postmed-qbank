// 圖上標記（第 6B 階段，規格書 §9.7）：在題圖、詳解圖、筆記的圖、卡片的圖上疊一層自己的筆跡與螢光。
//
// - 標記掛在「哪裡的哪張圖」上（ink.target）：外層用 <InkScope> 說明這段內容屬於哪一題／哪份筆記／哪張卡，
//   <Markdown> 依此替每張圖算出 target。沒有 InkScope 的地方（修訂預覽、編輯器）不顯示、不能畫。
// - 座標用圖自己的寬高（figs 的 w、h；卡片的圖用圖檔的實際像素），顯示多大都貼在同一個位置。
//   已經有標記的圖，沿用當初存的寬高；圖之後換了尺寸時等比例縮放。
// - 內文的圖：Apple Pencil 拖曳就是畫（設定可關），筆點一下、手指或滑鼠點一下是開檢視器；畫的時候下方浮出工具列。
// - 標記是個人資料，不進修訂佇列，不會動主檔。

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFigInvert, useInkRows, useInkToolPref, usePencilOnFigures, type InkRow } from "@/data";
import { Button } from "../primitives";
import { InkLayer, InkStrokes } from "./InkLayer";
import { brushOf, InkToolbar } from "./InkToolbar";
import { usePersistentInk, type PersistentInk } from "./persist";

// ---------- 範圍 ----------

export interface InkScopeValue {
  /** "q:PHY-007836"｜"kb:BCH/2-3_…"｜"card:<id>" */
  base: string;
  /** 物理在已作答畫面上畫的：記下那次作答（重新作答時清掉） */
  att?: string;
}

const ScopeCtx = createContext<InkScopeValue | null>(null);

export function InkScope({ value, children }: { value: InkScopeValue | null; children: ReactNode }) {
  return <ScopeCtx.Provider value={value}>{children}</ScopeCtx.Provider>;
}
export const useInkScope = () => useContext(ScopeCtx);

/** 一張圖在這個範圍裡的 target（規格書 §4.6）。題目的圖分題目版（@q）與解答版（@sol）。 */
export function figTarget(scope: InkScopeValue, fid: string, role: string): string {
  return scope.base.startsWith("q:") ? `${scope.base}/fig:${fid}@${role === "sol" ? "sol" : "q"}` : `${scope.base}/fig:${fid}`;
}
/** 卡片的圖（m/<sha>.<副檔名>）。 */
export function mediaTarget(scope: InkScopeValue, file: string): string {
  return `${scope.base}/m:${file.replace(/\.[a-z0-9]+$/i, "")}`;
}

export interface FigInkInfo {
  target: string;
  /** 這張圖現在的檔案（a/<sha>.svg 或 m/<檔名>）：和標記存的不同 = 圖在標記之後改過 */
  src: string;
  /** 圖的座標空間（沒有標記時用） */
  w: number;
  h: number;
  att?: string;
}

// ---------- 目前在內文的哪張圖上畫（同時只有一張，工具列浮在下方） ----------

let activeTarget: string | null = null;
const listeners = new Set<() => void>();
function setActive(t: string | null) {
  if (activeTarget === t) return;
  activeTarget = t;
  listeners.forEach((fn) => fn());
}
function useActive(): string | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => activeTarget,
  );
}

// ---------- 共用：一張圖的標記 ----------

/** 一張圖的標記資料：讀、存、自動存。檢視器與內文各用一份，透過資料庫互相更新。 */
export function useFigInk(info: FigInkInfo): PersistentInk & { row: InkRow | null | undefined; space: { w: number; h: number }; changed: boolean } {
  const rows = useInkRows(info.target);
  const row = rows === undefined ? undefined : (rows.find((r) => r.page === 0) ?? null);
  const live = row && !row.deleted ? row : null;
  // 已經有標記：沿用當初的座標空間（圖換了尺寸時等比例縮放）
  const space = live?.w && live?.h ? { w: live.w, h: live.h } : { w: info.w, h: info.h };
  const p = usePersistentInk({
    target: info.target,
    page: 0,
    row,
    size: () => space,
    // src 記第一次畫的時候那張圖；之後再畫不覆蓋，「圖改過了」的提示才會留著，直到清除
    meta: () => ({ src: p.doc.current?.src ?? info.src, att: info.att }),
  });
  const changed = !!p.doc.current?.src && p.doc.current.src !== info.src && p.editor.strokes.length > 0;
  return { ...p, row, space, changed };
}

// ---------- 內文的圖 ----------

const acceptPen = (e: PointerEvent) => e.pointerType === "pen";

/** 疊在內文的一張圖上（由 <Markdown> 用 portal 放進 .fig 裡）。 */
export function InlineFigInk({ info, mono, onOpen }: { info: FigInkInfo; mono: boolean; onOpen: () => void }) {
  const pencil = usePencilOnFigures();
  const pref = useInkToolPref();
  const invert = useFigInvert() && mono && document.documentElement.dataset.figInvert === "1";
  const fi = useFigInk(info);
  const active = useActive() === info.target;
  const has = fi.editor.strokes.length > 0;

  // 離開畫面：收起工具列
  useEffect(() => () => void (activeTarget === info.target && setActive(null)), [info.target]);

  if (!pencil && !has) return null;
  return (
    <>
      {pencil ? (
        <InkLayer
          w={fi.space.w}
          h={fi.space.h}
          editor={fi.editor}
          brush={brushOf(pref)}
          accept={acceptPen}
          stylusDraws
          onTap={onOpen}
          onBegin={() => setActive(info.target)}
          inverted={invert}
          label="圖上標記"
          style={{ cursor: "zoom-in" }}
        />
      ) : (
        <InkStrokes strokes={fi.editor.strokes} w={fi.space.w} h={fi.space.h} inverted={invert} />
      )}
      {active && createPortal(<Dock fi={fi} onDone={() => setActive(null)} />, document.body)}
    </>
  );
}

function Dock({ fi, onDone }: { fi: ReturnType<typeof useFigInk>; onDone: () => void }) {
  const e = fi.editor;
  return (
    <div data-noswipe="always" className="anim-rise fixed inset-x-0 z-30 px-3" style={{ bottom: "calc(env(safe-area-inset-bottom) + 76px)" }}>
      <InkToolbar
        className="mx-auto max-w-3xl shadow-pop"
        canUndo={e.canUndo}
        canRedo={e.canRedo}
        canClear={e.strokes.length > 0}
        onUndo={e.undo}
        onRedo={e.redo}
        onClear={e.clear}
        clearLabel="清除這張圖的標記"
        extra={
          <Button
            variant="secondary"
            className="ml-1"
            onClick={() => {
              void fi.save();
              onDone();
            }}
          >
            完成
          </Button>
        }
      />
    </div>
  );
}

/** 筆記最下面的「失聯的圖上標記」用：這一列的預覽（只畫，不收輸入）。 */
export function InkPreview({ row, className }: { row: InkRow; className?: string }) {
  const fi = useFigInk({ target: row.target, src: "", w: row.w, h: row.h });
  return (
    <div className={className} style={{ position: "relative", aspectRatio: `${row.w} / ${row.h}` }}>
      <InkStrokes strokes={fi.editor.strokes} w={row.w} h={row.h} />
    </div>
  );
}

