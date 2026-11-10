// 全螢幕圖片檢視器（規格書 §6.2）。
// 縮放時改的是 <img> 的實際寬高、用捲動定位，不用 CSS transform: scale——
// Safari 會把 scale 放大的向量圖當點陣圖拉伸而變糊；改實際尺寸則每一級都重新描繪，8 倍仍銳利。

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { prefs, useFigInvert } from "@/data";
import { Icon } from "../icons";
import { IconButton, cx } from "../primitives";

export interface ViewerFig {
  src: string; // 已解析成網址
  fallback?: string | null;
  w: number;
  h: number;
  mono: boolean;
  alt: string;
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
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
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
      if (pts.size === 0 && !moved) {
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
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
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
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key, true);
      document.body.style.overflow = overflow;
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
        style={{ touchAction: "none", overscrollBehavior: "contain", cursor: zoom > 1 ? "grab" : "zoom-in" }}
      >
        {base.w > 0 && (
          // margin: auto 置中——比容器小時置中，比容器大時從左上角開始、整張都捲得到
          <div style={{ margin: "auto", padding: 16, flex: "none" }}>
            <img
              ref={img}
              src={src}
              alt={fig.alt}
              draggable={false}
              onError={() => fig.fallback && src !== fig.fallback && setSrc(fig.fallback)}
              style={{ display: "block", width: base.w * zoom, height: base.h * zoom, maxWidth: "none", userSelect: "none" }}
            />
          </div>
        )}
      </div>
      <p className="pb-safe bg-card text-center text-meta text-ink-muted">
        <span className="block py-2">雙指縮放・拖曳移動・點兩下還原</span>
      </p>
    </div>,
    document.body,
  );
}
