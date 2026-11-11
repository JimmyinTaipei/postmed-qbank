// 畫布：把筆畫畫成 SVG，並接收筆、滑鼠、手指的輸入（第 6 階段，規格書 §9.6、§9.7）。
// 手寫區與圖上標記共用。座標空間是 w × h（手寫區的紙、或圖自己的寬高），顯示多大都貼在同一個位置。
//
// 「筆會畫、手指會捲」：不用 touch-action: none（那樣手指也捲不動），
// 而是在 touchstart（非 passive）裡只對 touchType === "stylus" 的觸點 preventDefault；
// 正在畫的時候，其他觸點（手掌）的 touchmove 也擋掉，避免一邊寫一邊捲動。

import { memo, useEffect, useRef, type CSSProperties } from "react";
import type { InkStroke } from "@/data";
import { cx } from "../primitives";
import { hits, hlPath, KNOWN_TOOLS, penPath } from "./geometry";
import type { InkEditor } from "./useInkEditor";

export interface InkBrush {
  tool: "pen" | "hl" | "eraser";
  color: string;
  /** 螢幕像素；開始畫的時候換算成座標空間的單位 */
  px: number;
}

const ERASER_PX = 10;
/** 比這更近的點不收（螢幕像素）：減少存檔大小，也看不出差別 */
const MIN_STEP_PX = 0.6;

const pathCache = new WeakMap<InkStroke, string>();
function pathOf(s: InkStroke): string {
  let d = pathCache.get(s);
  if (d === undefined) {
    d = s.tool === "hl" ? hlPath(s) : penPath(s);
    pathCache.set(s, d);
  }
  return d;
}

/** 只畫、不收輸入（檢視器之外的地方、別人的頁面）。 */
export const InkStrokes = memo(function InkStrokes({ strokes, w, h, className, style, inverted }: { strokes: InkStroke[]; w: number; h: number; className?: string; style?: CSSProperties; /** 底下的圖反相成黑底：螢光改成半透明疊上去（相乘在黑底上會看不見），顏色不跟著反相 */ inverted?: boolean }) {
  const hl = strokes.filter((s) => s.tool === "hl");
  const pen = strokes.filter((s) => s.tool === "pen");
  return (
    <div className={cx("pointer-events-none absolute inset-0", className)} style={style} aria-hidden="true">
      {/* 螢光筆在下、用相乘混色：底下的線條與字看得見；筆在上 */}
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" style={inverted ? { opacity: 0.55 } : { mixBlendMode: "multiply" }}>
        {hl.map((s, i) => (
          <path key={i} d={pathOf(s)} fill="none" stroke={`var(--${s.color}, ${s.color})`} strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
        {pen.map((s, i) => (
          <path key={i} d={pathOf(s)} fill={`var(--${s.color}, ${s.color})`} />
        ))}
      </svg>
    </div>
  );
});

interface LayerProps {
  w: number;
  h: number;
  editor: InkEditor;
  brush: InkBrush;
  /** 這個指標要不要拿來畫（筆、滑鼠、手指的規則由外面決定） */
  accept: (e: PointerEvent) => boolean;
  /** Apple Pencil 在這裡會畫：它的觸控要擋掉捲動 */
  stylusDraws: boolean;
  /** 開始一筆（手寫區用來記「目前在哪一頁」） */
  onBegin?: () => void;
  /** 只是點一下（沒有拖動）：不留下一點，改呼叫這個（圖上：筆點一下是開檢視器） */
  onTap?: () => void;
  inverted?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
}

const TAP_PX = 6;
const TAP_MS = 350;

export function InkLayer({ w, h, editor, brush, accept, stylusDraws, onBegin, onTap, inverted, className, style, label }: LayerProps) {
  const root = useRef<HTMLDivElement>(null);
  const livePen = useRef<SVGPathElement>(null);
  const liveHl = useRef<SVGPathElement>(null);
  // 事件處理只綁一次，用 ref 讀最新的值
  const cur = useRef({ editor, brush, accept, stylusDraws, onBegin, onTap, w, h });
  cur.current = { editor, brush, accept, stylusDraws, onBegin, onTap, w, h };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    type Active = { id: number; type: string; tool: "pen" | "hl" | "eraser"; color: string; size: number; pts: [number, number, number][]; rect: DOMRect; k: number; last: [number, number] | null; raf: number; x0: number; y0: number; t0: number; far: boolean; begun: boolean; start: [number, number, number] | null };
    let a: Active | null = null;

    const toDoc = (e: PointerEvent, x: Active): [number, number] => [(e.clientX - x.rect.left) * x.k, (e.clientY - x.rect.top) * (cur.current.h / x.rect.height)];
    const pressure = (e: PointerEvent) => (e.pointerType === "pen" ? Math.max(0.05, e.pressure || 0.5) : 0.5);

    const draw = () => {
      if (!a) return;
      a.raf = 0;
      const live = a.tool === "hl" ? liveHl.current : livePen.current;
      if (!live) return;
      const s = { tool: a.tool, color: a.color, size: a.size, pts: a.pts };
      live.setAttribute("d", a.tool === "hl" ? hlPath(s) : penPath(s));
    };
    const erase = (x: number, y: number, r: number) => cur.current.editor.remove((s) => KNOWN_TOOLS.has(s.tool) && hits(s, x, y, r));

    const add = (e: PointerEvent) => {
      if (!a) return;
      if (!a.far && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) > TAP_PX) a.far = true;
      // 有 onTap 時，要真的拖動了才開始畫（點一下是開檢視器）
      if (!a.begun) {
        if (cur.current.onTap && !a.far) return;
        begin(a);
        // 從按下去的那一點開始畫（等拖動才開始時，前面那一小段不要掉）
        if (a.tool !== "eraser" && a.start) {
          a.pts.push(a.start);
          a.last = [a.start[0], a.start[1]];
        }
      }
      const [x, y] = toDoc(e, a);
      if (a.tool === "eraser") return erase(x, y, ERASER_PX * a.k);
      const minStep = MIN_STEP_PX * a.k;
      if (a.last && Math.hypot(x - a.last[0], y - a.last[1]) < minStep) {
        // 停在原地只更新壓力
        const p = a.pts[a.pts.length - 1];
        p[2] = Math.max(p[2], pressure(e));
        return;
      }
      a.last = [x, y];
      a.pts.push([x, y, pressure(e)]);
    };

    const begin = (x: Active) => {
      x.begun = true;
      cur.current.onBegin?.();
      if (x.tool === "eraser") cur.current.editor.eraseBegin();
      else {
        const live = x.tool === "hl" ? liveHl.current : livePen.current;
        live?.setAttribute(x.tool === "hl" ? "stroke" : "fill", `var(--${x.color}, ${x.color})`);
        live?.setAttribute("stroke-width", String(x.size));
      }
    };
    const clearLive = () => {
      livePen.current?.setAttribute("d", "");
      liveHl.current?.setAttribute("d", "");
    };
    // 畫完之後瀏覽器可能補送一個 click（滑鼠、部分觸控筆）：吃掉，免得圖被打開
    const swallowClick = () => {
      const stop = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", stop, { capture: true }), 400);
    };

    const down = (e: PointerEvent) => {
      // 畫的時候放下第二根手指：取消這一筆，交給外面縮放
      if (a && a.type === "touch" && e.pointerType === "touch") {
        if (a.raf) cancelAnimationFrame(a.raf);
        if (a.tool === "eraser" && a.begun) cur.current.editor.eraseEnd();
        a = null;
        clearLive();
        return;
      }
      if (a || !cur.current.accept(e)) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* 有些情況拿不到（例如指標已經放開），照樣畫 */
      }
      const rect = el.getBoundingClientRect();
      const k = cur.current.w / Math.max(1, rect.width);
      const b = cur.current.brush;
      a = { id: e.pointerId, type: e.pointerType, tool: b.tool, color: b.color, size: b.px * k, pts: [], rect, k, last: null, raf: 0, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, far: false, begun: false, start: null };
      const [sx, sy] = toDoc(e, a);
      a.start = [sx, sy, pressure(e)];
      add(e);
      if (a.begun && a.tool !== "eraser") draw();
    };
    const move = (e: PointerEvent) => {
      if (!a || e.pointerId !== a.id) return;
      e.preventDefault();
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      for (const ev of list.length ? list : [e]) add(ev);
      if (a && a.begun && a.tool !== "eraser" && !a.raf) a.raf = requestAnimationFrame(draw);
    };
    const finish = (e: PointerEvent) => {
      if (!a || e.pointerId !== a.id) return;
      const done = a;
      a = null;
      if (done.raf) cancelAnimationFrame(done.raf);
      clearLive();
      if (!done.begun) {
        if (e.type === "pointerup" && !done.far && e.timeStamp - done.t0 < TAP_MS) cur.current.onTap?.();
        return;
      }
      swallowClick();
      if (done.tool === "eraser") return cur.current.editor.eraseEnd();
      if (!done.pts.length) return;
      cur.current.editor.add({ tool: done.tool, color: done.color, size: done.size, pts: done.pts });
    };

    // Apple Pencil：擋掉它的捲動；畫的時候連手掌的捲動也擋掉
    const touchStart = (e: TouchEvent) => {
      if (a && e.cancelable) return e.preventDefault();
      if (!cur.current.stylusDraws) return;
      for (const t of Array.from(e.changedTouches)) {
        if ((t as Touch & { touchType?: string }).touchType === "stylus") {
          if (e.cancelable) e.preventDefault();
          return;
        }
      }
    };
    const touchMove = (e: TouchEvent) => {
      if (a && e.cancelable) e.preventDefault();
    };

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("touchstart", touchStart, { passive: false });
    el.addEventListener("touchmove", touchMove, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", finish);
      el.removeEventListener("pointercancel", finish);
      el.removeEventListener("touchstart", touchStart);
      el.removeEventListener("touchmove", touchMove);
    };
  }, []);

  return (
    <div
      ref={root}
      role="img"
      aria-label={label ?? "手寫"}
      className={cx("ink-surface absolute inset-0", brush.tool === "eraser" ? "cursor-cell" : "cursor-crosshair", className)}
      style={style}
    >
      <InkStrokes strokes={editor.strokes} w={w} h={h} inverted={inverted} />
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible" style={inverted ? { opacity: 0.55 } : { mixBlendMode: "multiply" }} aria-hidden="true">
        <path ref={liveHl} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
        <path ref={livePen} />
      </svg>
    </div>
  );
}
