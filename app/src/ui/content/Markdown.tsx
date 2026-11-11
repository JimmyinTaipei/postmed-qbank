// 顯示一段題目或筆記的 Markdown（含公式、表格、題圖）。全站顯示內容都用這個元件。

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { content, type Fig } from "@/data";
import { cx } from "../primitives";
import { figTarget, InlineFigInk, mediaTarget, useInkScope, type FigInkInfo } from "../ink/FigInk";
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

interface FigHost {
  el: HTMLElement; // 放標記的容器（.fig 裡面的 .fig-ink）
  fig: HTMLElement;
  info: FigInkInfo | null; // 卡片的圖：圖檔讀完才知道寬高
  mono: boolean;
}

/** 卡片的圖：實際像素（還沒讀完時是 0） */
const natural = (fig: HTMLElement) => {
  const img = fig.querySelector("img");
  return img && img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null;
};

export const Markdown = memo(function Markdown({ text, figs, role = "q", tight, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const viewer = useFigureViewer();
  const scope = useInkScope();
  const html = useMemo(() => renderMarkdown(text, { figs, role, assetUrl: content.assetUrl }), [text, figs, role]);
  const [hosts, setHosts] = useState<FigHost[]>([]);

  // 圖上標記（第 6B 階段）：每張圖放一個容器，標記用 portal 畫進去
  const inkOf = useMemo(
    () =>
      (node: HTMLElement): FigInkInfo | null => {
        if (!scope) return null;
        const m = node.dataset.m;
        if (m) {
          const n = natural(node);
          return n ? { target: mediaTarget(scope, m), src: `m/${m}`, w: n.w, h: n.h, att: scope.att } : null;
        }
        const f = pickFig(figs, node.dataset.fig ?? "", node.dataset.role as Fig["role"]);
        return f ? { target: figTarget(scope, f.fid, f.role), src: f.src, w: f.w, h: f.h, att: scope.att } : null;
      },
    [scope, figs],
  );
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !scope) return setHosts((h) => (h.length ? [] : h));
    const list: FigHost[] = [];
    const pending: HTMLImageElement[] = [];
    for (const fig of el.querySelectorAll<HTMLElement>(".fig")) {
      let host = fig.querySelector<HTMLElement>(":scope > .fig-ink");
      if (!host) {
        host = document.createElement("span");
        host.className = "fig-ink";
        fig.appendChild(host);
      }
      const info = inkOf(fig);
      if (!info && fig.dataset.m) {
        const img = fig.querySelector("img");
        if (img) pending.push(img);
      }
      list.push({ el: host, fig, info, mono: fig.classList.contains("mono") });
    }
    setHosts(list);
    if (!pending.length) return;
    // 卡片的圖讀完才知道寬高
    const done = () => setHosts((cur) => cur.map((h) => (h.info ? h : { ...h, info: inkOf(h.fig) })));
    pending.forEach((img) => img.addEventListener("load", done));
    return () => pending.forEach((img) => img.removeEventListener("load", done));
  }, [html, scope, inkOf]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const openFig = (target: EventTarget | null) => {
      const node = (target as HTMLElement | null)?.closest?.<HTMLElement>(".fig");
      if (!node || !el.contains(node)) return false;
      const ink = inkOf(node) ?? undefined;
      if (node.dataset.m) {
        const n = natural(node);
        if (!n) return false;
        viewer.open({ src: `/m/${node.dataset.m}`, w: n.w, h: n.h, mono: false, alt: "卡片的圖", ink });
        return true;
      }
      const f = pickFig(figs, node.dataset.fig ?? "", node.dataset.role as Fig["role"]);
      if (!f) return false;
      const img = node.querySelector("img");
      // 已經退回 PNG 的圖，檢視器也直接用 PNG
      const usingFallback = !!img && !!f.fallback && img.getAttribute("src") === content.assetUrl(f.fallback);
      viewer.open({ src: content.assetUrl(usingFallback ? f.fallback! : f.src), fallback: f.fallback ? content.assetUrl(f.fallback) : null, w: f.w, h: f.h, mono: f.mono, alt: f.alt, ink });
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
  }, [figs, viewer, inkOf]);

  if (!html) return null;
  return (
    <>
      <div ref={ref} className={cx("md", tight && "md-tight", className)} dangerouslySetInnerHTML={{ __html: html }} />
      {hosts.map((h, i) => h.info && h.el.isConnected && createPortal(<InlineFigInk info={h.info} mono={h.mono} onOpen={() => h.fig.click()} />, h.el, `${i}:${h.info.target}`))}
    </>
  );
});
