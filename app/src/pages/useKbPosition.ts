// 資料庫筆記：記住上次讀到哪裡、再開時回到那裡（第 4B 階段，規格書 §9.4）。
//
// - 記：畫面最上方的區塊（bid）、它的標題路徑、捲動比例、展開到第幾層。最上方的區塊換了之後 2 秒才寫；
//   離開頁面、App 退到背景時再寫一次。和上次寫的一樣就不寫（只是捲動不會一直寫設定）。
// - 還原：網址有 #b-…（從題目的「相關筆記」來）時以網址為準。否則找原本的區塊 → 同一條標題路徑 → 捲動比例。

import { useCallback, useEffect, useRef, useState } from "react";
import { kbRecent, type KbBlock, type KbDoc, type KbRecent } from "@/data";

const SAVE_DELAY = 2000;
/** 畫面上方被頁首、浮動按鈕擋住的高度：這條線以上的區塊算「讀過了」 */
const TOP = 72;

const headingText = (b: KbBlock) => b.md.replace(/^#+\s*/, "").trim();

/** 區塊所在的標題路徑（由外到內，含自己如果是標題） */
export function headingPath(blocks: KbBlock[], bid: string, trail: string[] = []): string[] | null {
  for (const b of blocks) {
    const here = b.type === "heading" ? [...trail, headingText(b)] : trail;
    if (b.bid === bid) return here;
    const r = headingPath(b.children, bid, here);
    if (r) return r;
  }
  return null;
}

/** 標題路徑 → 那個標題的 bid（完全相同的路徑優先；否則最後一層的標題文字相同） */
function findByPath(blocks: KbBlock[], path: string[]): string | null {
  if (!path.length) return null;
  let loose: string | null = null;
  const walk = (bs: KbBlock[], trail: string[]): string | null => {
    for (const b of bs) {
      if (b.type === "heading") {
        const here = [...trail, headingText(b)];
        if (here.join("\u0000") === path.join("\u0000")) return b.bid;
        if (!loose && here.at(-1) === path.at(-1)) loose = b.bid;
        const r = walk(b.children, here);
        if (r) return r;
      } else {
        const r = walk(b.children, trail);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(blocks, []) ?? loose;
}

/** 展開祖先、捲到區塊的上緣 */
function scrollToBlock(root: HTMLElement, bid: string): boolean {
  const el = root.querySelector<HTMLElement>(`#b-${CSS.escape(bid)}`);
  if (!el) return false;
  for (let p: HTMLElement | null = el.parentElement; p && p !== root; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
  window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - TOP) });
  return true;
}

/** 畫面最上方的區塊：上緣在 TOP 線以上、最後開始的那一個（看得到的） */
function topBlock(root: HTMLElement): string | null {
  let best: string | null = null;
  for (const el of root.querySelectorAll<HTMLElement>(".kb-block[id^='b-'], hr[id^='b-']")) {
    if (!el.getClientRects().length) continue;
    const top = el.getBoundingClientRect().top;
    if (top <= TOP + 4) best = el.id.slice(2);
    else {
      if (!best) best = el.id.slice(2);
      break;
    }
  }
  return best;
}

const ratioNow = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
};

interface Options {
  docKey: string | undefined;
  doc: KbDoc | null | undefined;
  root: React.RefObject<HTMLElement | null>;
  depth: number;
  setDepth: (d: number) => void;
  /** 網址指定了區塊（#b-…）：不還原上次的位置 */
  linked: boolean;
  /** 列印中：不記 */
  paused: boolean;
}

export interface Restored {
  /** 回到的標題（沒有標題時是 null） */
  heading: string | null;
}

export function useKbPosition({ docKey, doc, root, depth, setDepth, linked, paused }: Options) {
  const [restored, setRestored] = useState<Restored | null>(null);
  const [tick, setTick] = useState(0);
  const ready = useRef(false); // 還原做完之前不記（免得先把「最上面」寫進去）
  const pending = useRef<KbRecent | null>(null);
  const saved = useRef<string>(""); // 上次寫的 bid + depth
  const st = useRef({ docKey, doc, depth, paused });
  st.current = { docKey, doc, depth, paused };

  // 換一份筆記：重來
  useEffect(() => {
    ready.current = false;
    pending.current = null;
    saved.current = "";
    setRestored(null);
  }, [docKey]);

  // 1. 讀到筆記：決定要不要還原；要的話先把展開層數設回去
  const docReady = !!doc;
  useEffect(() => {
    if (!docKey || !docReady || ready.current || pending.current) return;
    if (linked) {
      ready.current = true;
      return;
    }
    let alive = true;
    void kbRecent.get(docKey).then((e) => {
      if (!alive) return;
      if (!e) {
        ready.current = true;
        return;
      }
      saved.current = `${e.bid}|${e.depth}`;
      pending.current = e;
      if (e.depth && e.depth !== st.current.depth) setDepth(e.depth);
      else setTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [docKey, docReady, linked, setDepth]);

  // 2. 層數套上、區塊畫好之後捲過去
  useEffect(() => {
    const e = pending.current;
    const el = root.current;
    const d = st.current.doc;
    if (!e || !el || !d || (e.depth && e.depth !== depth)) return;
    const t = window.setTimeout(() => {
      pending.current = null;
      let bid: string | null = scrollToBlock(el, e.bid) ? e.bid : null;
      if (!bid) {
        const alt = findByPath(d.blocks, e.path);
        if (alt && scrollToBlock(el, alt)) bid = alt;
      }
      if (!bid && e.ratio > 0) window.scrollTo({ top: e.ratio * (document.documentElement.scrollHeight - window.innerHeight) });
      const path = bid ? headingPath(d.blocks, bid) : e.path;
      if (bid || e.ratio > 0.02) setRestored({ heading: path?.at(-1) ?? null });
      // 捲動事件會晚一點到：等它過了再開始記
      window.setTimeout(() => (ready.current = true), 300);
    }, 60);
    return () => window.clearTimeout(t);
  }, [depth, tick, root]);

  const save = useCallback(() => {
    const { docKey: k, doc: d, depth: dp, paused: p } = st.current;
    const el = root.current;
    if (!k || !d || !el || p || !ready.current) return;
    const bid = topBlock(el);
    if (!bid) return;
    const sig = `${bid}|${dp}`;
    if (sig === saved.current) return;
    saved.current = sig;
    void kbRecent.save({ key: k, bid, path: headingPath(d.blocks, bid) ?? [], ratio: Math.round(ratioNow() * 1000) / 1000, depth: dp, at: Date.now() });
  }, [root]);

  // 3. 捲動：最上方的區塊換了 → 2 秒後寫
  useEffect(() => {
    let raf = 0;
    let timer = 0;
    let last = "";
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = root.current;
        if (!el || !ready.current) return;
        const bid = topBlock(el) ?? "";
        if (bid === last) return;
        last = bid;
        window.clearTimeout(timer);
        timer = window.setTimeout(save, SAVE_DELAY);
      });
    };
    const flush = () => save();
    const vis = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", vis);
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      flush();
    };
  }, [save, root, docKey]);

  // 換展開層數也記（2 秒後）
  useEffect(() => {
    const t = window.setTimeout(save, SAVE_DELAY);
    return () => window.clearTimeout(t);
  }, [depth, save]);

  const dismiss = useCallback(() => setRestored(null), []);
  return { restored, dismiss };
}
