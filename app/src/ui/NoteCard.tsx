// 註記卡（規格書 §9.10「註記卡」，第 3B 階段）：螢光與加註的註記、克漏字小卡（5B）用同一張卡。
//
// 一個元件，兩種位置，內容與功能相同：
// - 電腦（寬螢幕＋滑鼠）：貼在被標的字下方（放不下就放上方），寬約 26rem；捲動時跟著那段字走。
// - 觸控（iPad、手機）：固定在畫面下緣（使用者已經習慣的位置）。
// 背景不變暗、不鎖捲動。關閉：點卡片以外的地方、Esc、「完成」（觸控：「完成」、向下滑）。關閉時由外面自動存。

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { Button, IconButton, cx } from "./primitives";

/** 有滑鼠的寬螢幕：卡片貼著字；否則放在畫面下緣 */
export function useDesktopCard(): boolean {
  const q = "(hover: hover) and (pointer: fine) and (min-width: 768px)";
  const [on, setOn] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

export interface NoteCardProps {
  /** 卡片要貼著的那段字（第一個與最後一個元素；捲動時重新量）。找不到時退回畫面下緣 */
  anchor: () => Element[] | null;
  label: string;
  /** 最上面一行：被標的字 */
  title: ReactNode;
  /** 最上面一行右邊（刪除等） */
  tools?: ReactNode;
  children: ReactNode;
  /** 最下面一行左邊（狀態說明等） */
  footer?: ReactNode;
  onClose: () => void;
  /** 強制位置（/dev/ui 展示用） */
  placement?: "anchor" | "bottom";
  /** 不放「完成」鈕（卡片裡自己有主要按鈕時；右上角要自己放關閉鈕） */
  hideDone?: boolean;
}

const W = 416; // 26rem
const GAP = 8;

export function NoteCard({ anchor, label, title, tools, children, footer, onClose, placement, hideDone }: NoteCardProps) {
  const desktop = useDesktopCard();
  /** 電腦上找不到那段字（例如還沒包上標示）：退回畫面下緣 */
  const [lost, setLost] = useState(false);
  const mode = placement ?? (desktop && !lost ? "anchor" : "bottom");
  const box = useRef<HTMLElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const missSince = useRef<number | null>(null);
  const placeRef = useRef<() => void>(() => {});
  const place = useCallback(() => {
    if (mode !== "anchor") return;
    if (!box.current) return;
    const els = anchor();
    const rects = (els ?? []).map((e) => e.getBoundingClientRect()).filter((r) => r.width || r.height);
    if (!rects.length) {
      // 剛建好的螢光要等下一輪才包上 <mark>：先等一下，0.6 秒還找不到才退回畫面下緣
      const t = (missSince.current ??= performance.now());
      if (performance.now() - t > 600) {
        if (!placement) setLost(true);
      } else requestAnimationFrame(() => placeRef.current());
      return setPos(null);
    }
    missSince.current = null;
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const left = rects[0].left;
    const h = box.current.offsetHeight;
    const vh = window.innerHeight;
    const above = bottom + GAP + h > vh - GAP && top - GAP - h > GAP;
    setPos({
      left: Math.max(GAP, Math.min(left, window.innerWidth - W - GAP)),
      top: above ? top - GAP - h : bottom + GAP,
      above,
    });
  }, [anchor, mode, placement]);
  placeRef.current = place;

  // 捲動、改變大小、卡片長高時重新貼上去
  useLayoutEffect(() => {
    if (mode !== "anchor") return;
    place();
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(place);
    };
    window.addEventListener("scroll", later, true);
    window.addEventListener("resize", later);
    const ro = new ResizeObserver(later);
    if (box.current) ro.observe(box.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", later, true);
      window.removeEventListener("resize", later);
      ro.disconnect();
    };
  }, [place, mode]);

  // 點外面、Esc ＝關閉（電腦）。手寫紙、提示訊息、對話框、選單不算外面。
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || box.current?.contains(t)) return;
      if (t.closest?.("[role=dialog],[role=status],[role=menu],[data-keep-card]")) return;
      if (mode === "anchor") close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // 編輯器裡的 Esc 先給編輯器（關掉公式小框、/ 選單）
      if ((e.target as HTMLElement | null)?.closest?.(".ed-pop")) return;
      close.current();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key);
    };
  }, [mode]);

  // 觸控：在最上面那一行向下滑 ＝ 關閉
  const swipe = useRef<{ y: number; id: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const head = {
    onPointerDown: (e: React.PointerEvent) => {
      if (mode !== "bottom" || e.pointerType === "mouse") return;
      swipe.current = { y: e.clientY, id: e.pointerId };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!swipe.current || swipe.current.id !== e.pointerId) return;
      setDrag(Math.max(0, e.clientY - swipe.current.y));
    },
    onPointerUp: () => {
      if (!swipe.current) return;
      swipe.current = null;
      if (drag > 60) close.current();
      setDrag(0);
    },
    onPointerCancel: () => {
      swipe.current = null;
      setDrag(0);
    },
  };

  const card = (
    <section
      ref={box}
      role="dialog"
      aria-modal="false"
      aria-label={label}
      data-noswipe="always"
      className={cx("anim-rise flex max-h-[70dvh] flex-col rounded-card border border-line bg-card shadow-pop print:hidden", mode === "anchor" ? "w-[26rem] max-w-[calc(100vw-16px)]" : "mx-auto w-full max-w-3xl")}
      style={drag ? { transform: `translateY(${drag}px)` } : undefined}
    >
      <div className="relative flex shrink-0 touch-none items-center gap-1 px-3 pt-2" {...head}>
        {mode === "bottom" && <span aria-hidden="true" className="absolute top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong" />}
        <div className="min-w-0 flex-1 truncate text-ui">{title}</div>
        {tools}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pt-2 pb-1">{children}</div>
      {(footer || !hideDone) && (
        <div className="flex shrink-0 items-center justify-end gap-2 px-3 pt-1 pb-3">
          {footer && <div className="mr-auto min-w-0 text-meta text-ink-muted">{footer}</div>}
          {!hideDone && <Button variant="primary" onClick={() => close.current()}>完成</Button>}
        </div>
      )}
    </section>
  );

  if (mode === "anchor")
    return createPortal(
      <div className="fixed z-40" style={pos ? { left: pos.left, top: pos.top } : { left: 8, top: 8, opacity: 0, pointerEvents: "none" }}>
        {card}
      </div>,
      document.body,
    );
  return createPortal(
    <div className="fixed inset-x-0 z-40 px-3 lg:left-60" style={{ bottom: "calc(env(safe-area-inset-bottom) + 76px)" }}>
      {card}
    </div>,
    document.body,
  );
}

/** 卡片右上角的刪除鈕 */
/** 卡片右上角的關閉鈕（hideDone 時用） */
export function NoteCardClose({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="關閉" onClick={onClick}>
      <Icon name="x" />
    </IconButton>
  );
}

export function NoteCardDelete({ onClick, label = "刪除" }: { onClick: () => void; label?: string }) {
  return (
    <IconButton label={label} onClick={onClick}>
      <Icon name="trash" />
    </IconButton>
  );
}

/**
 * 滑過有註記的字 0.3 秒，浮出註記內容的預覽（只能看；電腦才有）。
 * root 裡符合 selector 的元素，用 text(el) 取得要顯示的內容；回 null 就不顯示。
 */
export function HoverPreview({ root, selector, render }: { root: React.RefObject<HTMLElement | null>; selector: string; render: (el: HTMLElement) => ReactNode | null }) {
  const desktop = useDesktopCard();
  const [at, setAt] = useState<{ el: HTMLElement; x: number; y: number } | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || !desktop) return;
    let timer = 0;
    let cur: HTMLElement | null = null;
    const over = (e: MouseEvent) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>(selector);
      if (m === cur) return;
      cur = m;
      window.clearTimeout(timer);
      setAt(null);
      if (!m) return;
      timer = window.setTimeout(() => {
        const r = m.getBoundingClientRect();
        setAt({ el: m, x: r.left, y: r.bottom });
      }, 300);
    };
    const out = (e: MouseEvent) => {
      if (cur && !cur.contains(e.relatedTarget as Node)) {
        cur = null;
        window.clearTimeout(timer);
        setAt(null);
      }
    };
    const hide = () => {
      cur = null;
      window.clearTimeout(timer);
      setAt(null);
    };
    el.addEventListener("mouseover", over);
    el.addEventListener("mouseout", out);
    el.addEventListener("pointerdown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener("mouseover", over);
      el.removeEventListener("mouseout", out);
      el.removeEventListener("pointerdown", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [root, selector, desktop]);
  if (!at) return null;
  const body = render(at.el);
  if (!body) return null;
  return createPortal(
    <div role="tooltip" className="pointer-events-none fixed z-50 max-h-60 w-80 overflow-hidden rounded-btn border border-line bg-card px-3 py-2 text-ui shadow-pop" style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 328)), top: Math.min(at.y + 6, window.innerHeight - 100) }}>
      {body}
    </div>,
    document.body,
  );
}
