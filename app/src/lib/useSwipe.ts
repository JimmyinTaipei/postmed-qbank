// 左右滑換題（規格書 §9.2）。
// 規則：水平位移明顯大於垂直才算滑動（否則交還給上下捲動）；放開時超過寬度 25% 或速度夠快才換題。
// 不觸發的情況：起點在可橫向捲動的表格或長公式上、在手寫區上（data-noswipe）、圖片檢視器或面板開著、從螢幕左緣起滑（留給系統的返回手勢）。

import { useEffect, type RefObject } from "react";

interface Options {
  onPrev: () => void;
  onNext: () => void;
  enabled?: boolean;
}

function blocked(target: EventTarget | null): boolean {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (!el.hasAttribute?.("data-noswipe")) continue;
    if (el.dataset.noswipe === "always" || el.scrollWidth > el.clientWidth + 1) return true;
  }
  return !!document.querySelector("[aria-modal='true'], [role='menu']");
}

export function useSwipe(ref: RefObject<HTMLElement | null>, { onPrev, onNext, enabled = true }: Options) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let mode: "idle" | "pending" | "swipe" = "idle";
    let dx = 0;

    const reset = (animate: boolean) => {
      el.style.transition = animate ? "transform var(--dur) var(--ease-out), opacity var(--dur)" : "";
      el.style.transform = "";
      el.style.opacity = "";
      mode = "idle";
    };
    const start = (e: TouchEvent) => {
      // defaultPrevented：Apple Pencil 正在圖上或手寫區畫（畫布擋掉了它的捲動），不是在滑
      if (e.defaultPrevented || e.touches.length !== 1 || blocked(e.target)) return void (mode = "idle");
      const t = e.touches[0];
      if (t.clientX < 24) return void (mode = "idle");
      x0 = t.clientX;
      y0 = t.clientY;
      t0 = e.timeStamp;
      dx = 0;
      mode = "pending";
      el.style.transition = "";
    };
    const move = (e: TouchEvent) => {
      if (mode === "idle") return;
      if (e.touches.length !== 1) return reset(true);
      const t = e.touches[0];
      dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (mode === "pending") {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.5) return void (mode = "idle"); // 是上下捲動
        mode = "swipe";
      }
      if (e.cancelable) e.preventDefault(); // 鎖定為左右滑後，不再帶動上下捲動
      el.style.transform = `translateX(${dx * 0.5}px)`;
      el.style.opacity = String(1 - Math.min(0.4, Math.abs(dx) / (el.clientWidth * 1.5)));
    };
    const end = (e: TouchEvent) => {
      if (mode !== "swipe") return void (mode = "idle");
      const fast = Math.abs(dx) / Math.max(1, e.timeStamp - t0) > 0.5 && Math.abs(dx) > 40;
      const far = Math.abs(dx) > el.clientWidth * 0.25;
      const go = fast || far ? (dx < 0 ? onNext : onPrev) : null;
      reset(!go);
      go?.();
    };
    const cancel = () => mode !== "idle" && reset(true);
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", cancel);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", cancel);
      reset(false);
    };
  }, [ref, onPrev, onNext, enabled]);
}
