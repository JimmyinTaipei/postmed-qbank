// 題組（第 8A 階段，規格書 §9.11「8A」）：同一篇文章（英文閱讀、克漏字段落）的小題放在同一頁。
// 刷題、模擬考與原卷、錯題與複習、單題頁共用。
//
// - 寬螢幕（電腦、iPad 橫向；variant `split`）：左邊文章、右邊小題，兩邊各自捲動。
// - 窄螢幕（iPad 直向、手機）：文章在上、小題在下；捲到小題時，文章收成固定在上緣的一列，點一下展開、再點收回。
// - 文章上的螢光、註記、圖上標記掛在題組上（g:<gid>），不是某一小題：每一小題看到的是同一份。
// - 克漏字段落的空格編號（<span class="cloze-blank">21</span>，pmq 產生）可以點，點了捲到那一小題（id="blank-21"）。

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Fig } from "@/data";
import { Icon } from "../icons";
import { cx } from "../primitives";
import { InkScope } from "../ink/FigInk";
import { HighlightableMarkdown } from "./Highlights";

/** 題組裡一小題的外框：給克漏字空格跳轉用的錨點。order＝原卷題號。 */
export function GroupItem({ order, children, className }: { order: number | null | undefined; children: ReactNode; className?: string }) {
  return (
    <div id={order != null ? `blank-${order}` : undefined} className={cx("group-item scroll-mt-[calc(var(--group-top)+3.5rem)]", className)}>
      {children}
    </div>
  );
}

/** 畫面上方固定列（sticky header）的高度：文章欄與收合列要貼在它下面。 */
function useHeaderHeight(): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>("header.sticky");
    if (!header) return;
    const update = () => setH(Math.round(header.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return h;
}

function plain(md: string): string {
  return md
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`#>\\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function jumpToBlank(e: React.MouseEvent) {
  const b = (e.target as HTMLElement).closest?.(".cloze-blank");
  if (!b) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return; // 正在選字（要畫螢光）時不跳
  const el = document.getElementById(`blank-${b.textContent?.trim()}`);
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  el.classList.remove("group-item-flash");
  void el.offsetWidth;
  el.classList.add("group-item-flash");
}

interface Props {
  gid: string;
  /** 共用的文章（Markdown）；null＝沒有共用文章（物理的同一大題），只把小題排在一起 */
  passage: string | null;
  figs: Fig[];
  /** 「第 41–45 題」 */
  label?: string;
  children: ReactNode;
}

export function GroupLayout({ gid, passage, figs, label, children }: Props) {
  const top = useHeaderHeight();
  const sentinel = useRef<HTMLDivElement>(null);
  const [past, setPast] = useState(false);
  const [open, setOpen] = useState(false);
  const scope = useMemo(() => ({ base: `g:${gid}` }), [gid]);
  const head = useMemo(() => (passage ? plain(passage).slice(0, 80) : ""), [passage]);

  // 窄螢幕：文章整段捲出畫面之後，才出現上緣的收合列
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !passage) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setPast(el.offsetParent !== null && el.getBoundingClientRect().top < top);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [passage, top]);
  useEffect(() => {
    if (!past) setOpen(false);
  }, [past]);

  const style = { "--group-top": `${top}px` } as React.CSSProperties;
  if (!passage) {
    return (
      <div className="space-y-8" style={style}>
        {label && <p className="text-meta text-ink-muted">{label}</p>}
        {children}
      </div>
    );
  }

  const text = (
    <InkScope value={scope}>
      <div onClick={jumpToBlank}>
        <HighlightableMarkdown target={`g:${gid}/stem`} text={passage} figs={figs} role="q" />
      </div>
    </InkScope>
  );

  return (
    <div className="split:grid split:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] split:gap-8" style={style}>
      {/* 文章 */}
      <section aria-label="文章" className="split:sticky split:self-start split:overflow-y-auto split:overscroll-contain split:pr-2 split:top-[calc(var(--group-top)+1rem)] split:max-h-[calc(100dvh-var(--group-top)-7rem)]">
        {label && <p className="mb-2 text-meta text-ink-muted">{label}・文章</p>}
        <div className="passage rounded-card border border-line bg-card p-4 sm:p-5">{text}</div>
      </section>
      <div ref={sentinel} aria-hidden className="h-px split:hidden" />

      {/* 窄螢幕：捲到小題時文章收成上緣一列 */}
      {past && (
        <div data-passage-bar className="sticky z-10 -mx-4 mb-4 border-b border-line bg-card shadow-pop split:hidden" style={{ top }}>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-(--tap) w-full items-center gap-2 px-4 text-left">
            <Icon name="book" size={16} className="shrink-0 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate text-ui text-ink">{open ? "收起文章" : head}</span>
            <Icon name="chevronDown" size={18} className={cx("shrink-0 text-ink-muted transition-transform duration-(--dur-fast)", open && "rotate-180")} />
          </button>
          {open && <div className="passage max-h-[55dvh] overflow-y-auto overscroll-contain border-t border-line px-4 py-3">{text}</div>}
        </div>
      )}

      {/* 小題 */}
      <div className="mt-6 space-y-8 split:mt-0">{children}</div>
    </div>
  );
}
