// 顯示一段題目或筆記的 Markdown（含公式、表格、題圖）。全站顯示內容都用這個元件。

import { memo, useEffect, useMemo, useRef } from "react";
import { content, type Fig } from "@/data";
import { cx } from "../primitives";
import { useFigureViewer } from "./FigureViewer";
import { pickFig, renderMarkdown } from "./render";
import { playSound } from "./sound";

interface Props {
  text: string;
  figs?: Fig[];
  /** 題幹用 "q"、詳解用 "sol"、筆記用 "kb"：同一張圖有題目版與解答版時用來挑 */
  role?: Fig["role"];
  /** 選項、清單列等短內容：去掉段落外距 */
  tight?: boolean;
  className?: string;
}

export const Markdown = memo(function Markdown({ text, figs, role = "q", tight, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useFigureViewer();
  const html = useMemo(() => renderMarkdown(text, { figs, role, assetUrl: content.assetUrl }), [text, figs, role]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const openFig = (target: EventTarget | null) => {
      const node = (target as HTMLElement | null)?.closest?.<HTMLElement>(".fig");
      if (!node || !el.contains(node)) return false;
      const f = pickFig(figs, node.dataset.fig ?? "", node.dataset.role as Fig["role"]);
      if (!f) return false;
      const img = node.querySelector("img");
      // 已經退回 PNG 的圖，檢視器也直接用 PNG
      const usingFallback = !!img && !!f.fallback && img.getAttribute("src") === content.assetUrl(f.fallback);
      viewer.open({ src: content.assetUrl(usingFallback ? f.fallback! : f.src), fallback: f.fallback ? content.assetUrl(f.fallback) : null, w: f.w, h: f.h, mono: f.mono, alt: f.alt });
      return true;
    };
    const click = (e: MouseEvent) => {
      const snd = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".snd");
      if (snd && el.contains(snd)) {
        e.stopPropagation();
        void playSound(snd.dataset.snd ?? "");
        return;
      }
      if (openFig(e.target)) {
        e.stopPropagation(); // 圖在選項裡時，點圖是放大，不是選這個選項
        return;
      }
      // 站內連結（筆記之間的連結 /kb/…）：不重新載入整頁
      const a = (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>("a[href^='/']");
      if (a && el.contains(a) && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
        e.preventDefault();
        window.history.pushState({}, "", a.getAttribute("href")!);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    };
    const key = (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).classList?.contains("fig") && openFig(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // SVG 讀不到時退回 PNG（error 事件不冒泡，所以在捕獲階段接）
    const error = (e: Event) => {
      const img = e.target as HTMLImageElement;
      if (img.tagName !== "IMG") return;
      const fb = img.dataset.fallback;
      if (fb && img.getAttribute("src") !== fb) img.src = fb;
    };
    el.addEventListener("click", click);
    el.addEventListener("keydown", key);
    el.addEventListener("error", error, true);
    return () => {
      el.removeEventListener("click", click);
      el.removeEventListener("keydown", key);
      el.removeEventListener("error", error, true);
    };
  }, [figs, viewer]);

  if (!html) return null;
  return <div ref={ref} className={cx("md", tight && "md-tight", className)} dangerouslySetInnerHTML={{ __html: html }} />;
});
