// 全螢幕圖片檢視器（規格書 §6.2）。
// 縮放時改的是 <img> 的實際寬高、用捲動定位，不用 CSS transform: scale——
// Safari 會把 scale 放大的向量圖當點陣圖拉伸而變糊；改實際尺寸則每一級都重新描繪，8 倍仍銳利。

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { prefs, useFigInvert, useInkToolPref, usePencilOnFigures } from "@/data";
import { Icon } from "../icons";
import { Dialog, lockScroll } from "../overlays";
import { Button, IconButton, cx } from "../primitives";
import { useFigInk, type FigInkInfo } from "../ink/FigInk";
import { InkLayer, InkStrokes } from "../ink/InkLayer";
import { brushOf, InkToolbar } from "../ink/InkToolbar";

export interface ViewerFig {
  src: string; // 已解析成網址
  fallback?: string | null;
  w: number;
  h: number;
  mono: boolean;
  alt: string;
  /** 圖上標記（第 6B 階段）：這張圖在這個地方的標記；沒有就不能標記 */
  ink?: FigInkInfo;
}

const Ctx = createContext<{ open: (f: ViewerFig) => void; isOpen: boolean }>({ open: () => {}, isOpen: false });

export const useFigureViewer = () => useContext(Ctx);

export function FigureViewerProvider({ children }: { children: ReactNode }) {
  const [fig, setFig] = useState<ViewerFig | null>(null);
  const open = useCallback((f: ViewerFig) => setFig(f), []);
  const value = useMemo(() => ({ open, isOpen: fig != null }), [open, fig]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {fig && <Viewer fig={fig} onClose={() => setFig(null)} />}
    </Ctx.Provider>
  );
}

const MIN = 1;
const MAX = 8;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

function Viewer({ fig, onClose }: { fig: ViewerFig; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [zoom, setZoom] = useState(1);
  const [base, setBase] = useState({ w: 0, h: 0 }); // 1 倍 = 剛好放進畫面
  const [src, setSrc] = useState(fig.src);
  const invertPref = useFigInvert();
  const inverted = fig.mono && invertPref;
  // 縮放後要把哪個點留在原地：[內容比例 x, y, 畫面座標 x, y]
  const anchor = useRef<[number, number, number, number] | null>(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  // 圖上標記：「標記」模式時單指與滑鼠是畫；不在標記模式時只有 Apple Pencil 會畫（設定可關）
  const [marking, setMarking] = useState(false);
  const [showInk, setShowInk] = useState(true);
  const pencil = usePencilOnFigures();
  const fi = useFigInk(fig.ink ?? NO_INK);
  const drawsRef = useRef<(e: PointerEvent) => boolean>(() => false);
  drawsRef.current = (e) => !!fig.ink && showInk && (marking ? true : pencil && e.pointerType === "pen");

  // 1 倍大小：等比放進舞台（留 16px 邊）
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const k = Math.min((el.clientWidth - 32) / fig.w, (el.clientHeight - 32) / fig.h);
      setBase({ w: Math.max(1, fig.w * k), h: Math.max(1, fig.h * k) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fig.w, fig.h]);

  const zoomTo = useCallback((next: number, cx?: number, cy?: number) => {
    const el = stage.current;
    const im = img.current;
    if (!el || !im) return;
    const z = clamp(next);
    const box = el.getBoundingClientRect();
    const r = im.getBoundingClientRect();
    const px = cx ?? box.left + box.width / 2;
    const py = cy ?? box.top + box.height / 2;
    anchor.current = [(px - r.left) / r.width, (py - r.top) / r.height, px - box.left, py - box.top];
    setZoom(z);
  }, []);

  // 尺寸改完後，把錨點捲回原來的畫面位置
  useLayoutEffect(() => {
    const el = stage.current;
    const im = img.current;
    const a = anchor.current;
    if (!el || !im || !a) return;
    anchor.current = null;
    const box = el.getBoundingClientRect();
    const r = im.getBoundingClientRect();
    el.scrollLeft += r.left + a[0] * r.width - (box.left + a[2]);
    el.scrollTop += r.top + a[1] * r.height - (box.top + a[3]);
  }, [zoom, base]);

  // 手勢：單指拖曳、雙指縮放；觸控板捏合（ctrl＋滾輪）；雙擊還原或放大
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { d: number; z: number } | null = null;
    let lastTap = 0;
    let moved = false;

    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const mid = () => {
      const [a, b] = [...pts.values()];
      return [(a.x + b.x) / 2, (a.y + b.y) / 2] as const;
    };
    // 這一個指標在畫標記（交給上面那一層），不拿來移動或點兩下放大
    let drawing = false;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pts.size === 1) drawing = drawsRef.current(e) && !!(e.target as HTMLElement).closest?.(".ink-surface");
      else drawing = false; // 第二根手指：縮放（畫的那一筆由畫布自己取消）
      if (!drawing) el.setPointerCapture(e.pointerId);
      if (pts.size === 2) pinch = { d: dist(), z: zoomRef.current };
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        if (drawing) return;
        el.scrollLeft -= dx;
        el.scrollTop -= dy;
      } else if (pts.size === 2 && pinch) {
        const [mx, my] = mid();
        zoomTo(pinch.z * (dist() / Math.max(1, pinch.d)), mx, my);
      }
    };
    const up = (e: PointerEvent) => {
      if (!pts.delete(e.pointerId)) return;
      if (pts.size < 2) pinch = null;
      if (pts.size === 0 && drawing) drawing = false;
      else if (pts.size === 0 && !moved) {
        const t = performance.now();
        if (t - lastTap < 300) {
          zoomTo(zoomRef.current > 1.05 ? 1 : 3, e.clientX, e.clientY);
          lastTap = 0;
        } else lastTap = t;
      }
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // 一般滾輪交給原生捲動
      e.preventDefault();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    // 捕獲階段：畫布接走的指標（它會停止冒泡）這裡也要看到，雙指縮放才算得出來
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
      el.removeEventListener("wheel", wheel);
    };
  }, [zoomTo]);

  // 鍵盤、焦點、鎖住背景捲動
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomTo(zoomRef.current * 1.5);
      else if (e.key === "-") zoomTo(zoomRef.current / 1.5);
      else if (e.key === "0") zoomTo(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", key, true);
    const unlock = lockScroll();
    return () => {
      window.removeEventListener("keydown", key, true);
      unlock();
      prev?.focus?.();
    };
  }, [onClose, zoomTo]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`圖片檢視：${fig.alt || "題圖"}`} className="anim-fade fixed inset-0 z-50 flex flex-col bg-page" data-noswipe>
      <div className="pt-safe border-b border-line bg-card">
        <div className="px-safe flex h-14 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-ui text-ink-muted">{fig.alt || "題圖"}</span>
          <span className="w-12 text-right text-meta tabular-nums text-ink-muted" aria-live="polite">
            {zoom.toFixed(zoom < 2 ? 1 : 0)}×
          </span>
          <IconButton label="縮小" onClick={() => zoomTo(zoom / 1.5)} disabled={zoom <= MIN}>
            <Icon name="minus" />
          </IconButton>
          <IconButton label="放大" onClick={() => zoomTo(zoom * 1.5)} disabled={zoom >= MAX}>
            <Icon name="plus" />
          </IconButton>
          <IconButton label="還原大小" onClick={() => zoomTo(1)} disabled={zoom === 1}>
            <Icon name="fit" />
          </IconButton>
          {fig.ink && (
            <>
              <IconButton label={showInk ? "隱藏標記" : "顯示標記"} pressed={!showInk} onClick={() => { setShowInk(!showInk); if (showInk) setMarking(false); }}>
                <Icon name={showInk ? "eye" : "eyeOff"} />
              </IconButton>
              <Button variant={marking ? "primary" : "ghost"} icon="pencil" aria-pressed={marking} onClick={() => { setMarking(!marking); setShowInk(true); }}>
                標記
              </Button>
            </>
          )}
          {fig.mono && (
            <IconButton label={inverted ? "取消反相" : "反相（黑底白線）"} pressed={inverted} onClick={() => prefs.setFigInvert(!invertPref)}>
              <Icon name="contrast" />
            </IconButton>
          )}
          <IconButton ref={closeBtn} label="關閉" onClick={onClose}>
            <Icon name="x" />
          </IconButton>
        </div>
      </div>
      <div
        ref={stage}
        className={cx("viewer-stage flex min-h-0 flex-1 overflow-auto bg-paper", fig.mono && "mono", inverted && "inverted")}
        style={{ touchAction: "none", overscrollBehavior: "contain", cursor: marking ? "crosshair" : zoom > 1 ? "grab" : "zoom-in" }}
      >
        {base.w > 0 && (
          // margin: auto 置中——比容器小時置中，比容器大時從左上角開始、整張都捲得到
          <div style={{ margin: "auto", padding: 16, flex: "none" }}>
            <div style={{ position: "relative", width: base.w * zoom, height: base.h * zoom }}>
              <img
                ref={img}
                src={src}
                alt={fig.alt}
                draggable={false}
                onError={() => fig.fallback && src !== fig.fallback && setSrc(fig.fallback)}
                style={{ display: "block", width: "100%", height: "100%", maxWidth: "none", userSelect: "none" }}
              />
              {fig.ink && showInk && <ViewerMarks fi={fi} marking={marking} inverted={inverted} draws={(e) => drawsRef.current(e)} />}
            </div>
          </div>
        )}
      </div>
      {fig.ink && marking ? (
        <ViewerToolbar fi={fi} />
      ) : (
        <p className="pb-safe bg-card text-center text-meta text-ink-muted">
          <span className="block py-2">{fig.ink ? "雙指縮放・拖曳移動・點兩下還原・按「標記」在圖上畫" : "雙指縮放・拖曳移動・點兩下還原"}</span>
        </p>
      )}
    </div>,
    document.body,
  );
}

// ---------- 圖上標記（第 6B 階段） ----------

const NO_INK: FigInkInfo = { target: "", src: "", w: 1, h: 1 };
type FigInk = ReturnType<typeof useFigInk>;

function ViewerMarks({ fi, marking, inverted, draws }: { fi: FigInk; marking: boolean; inverted: boolean; draws: (e: PointerEvent) => boolean }) {
  const pref = useInkToolPref();
  const pencil = usePencilOnFigures();
  if (!marking && !pencil) return <InkStrokes strokes={fi.editor.strokes} w={fi.space.w} h={fi.space.h} inverted={inverted} />;
  return (
    <InkLayer
      w={fi.space.w}
      h={fi.space.h}
      editor={fi.editor}
      brush={brushOf(pref)}
      accept={draws}
      stylusDraws
      inverted={inverted}
      label="圖上標記"
      style={{ touchAction: "none", cursor: marking ? undefined : "inherit" }}
    />
  );
}

/** 標記模式的工具列（和內文、手寫區同一個元件）；圖在標記之後改過時提示。 */
function ViewerToolbar({ fi }: { fi: FigInk }) {
  const e = fi.editor;
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="pb-safe space-y-2 border-t border-line bg-card px-3 pt-2">
      {fi.changed && (
        <div role="status" className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-btn bg-warning-bg px-3 py-2 text-ui text-warning-ink">
          <Icon name="alert" size={18} />
          <span className="min-w-0 flex-1">這張圖在你標記之後改過，標記可能對不準。</span>
          <Button variant="ghost" className="text-warning-ink" onClick={() => setConfirm(true)}>清除標記</Button>
        </div>
      )}
      <InkToolbar className="mx-auto mb-2 max-w-3xl" canUndo={e.canUndo} canRedo={e.canRedo} canClear={e.strokes.length > 0} onUndo={e.undo} onRedo={e.redo} onClear={e.clear} clearLabel="清除這張圖的標記" />
      {confirm && (
        <Dialog
          title="清除這張圖的標記？"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>取消</Button>
              <Button variant="danger" onClick={() => { e.clear(); setConfirm(false); }}>清除</Button>
            </>
          }
        >
          清除後可以按「復原」救回來；關掉檢視器後就不能復原了。
        </Dialog>
      )}
    </div>
  );
}
