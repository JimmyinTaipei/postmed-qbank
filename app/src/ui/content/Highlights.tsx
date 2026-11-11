// 螢光筆與註記（規格書 §4.6 highlight、第 3 階段）：題幹、思路、詳解上選字 → 浮出色票 → 上色或加註。
//
// 存法：被標的字（quote）＋前後各 32 字（prefix／suffix）＋當時的位置（start／end）。位置以「畫面上看得到的字」算
// （KaTeX 給螢幕報讀器的隱藏 MathML 不算）。內容被修訂後：位置上的字還是 quote → 原地；否則找全部出現 quote 的地方，
// 取前後文最像的那一個；找不到 → 進「失聯的螢光」清單（不刪）。

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { highlights, useHighlights, type Fig, type Highlight, type HighlightColor } from "@/data";
import { Icon } from "../icons";
import { Dialog, Sheet } from "../overlays";
import { Button, cx } from "../primitives";
import { HighlightPalette, MarkdownEditor } from "../templates";
import { Markdown } from "./Markdown";

const CTX = 32;
const COLORS: [HighlightColor, string][] = [["yellow", "黃"], ["blue", "藍"], ["purple", "紫"], ["pink", "粉"], ["green", "綠"], ["orange", "橘"]];
// Tailwind 只認得完整寫出來的 class 名稱
const BG: Record<HighlightColor, string> = { yellow: "bg-hl-yellow", blue: "bg-hl-blue", purple: "bg-hl-purple", pink: "bg-hl-pink", green: "bg-hl-green", orange: "bg-hl-orange" };

interface Piece {
  node: Text;
  start: number;
  end: number;
}

function textIndex(root: HTMLElement): { text: string; pieces: Piece[] } {
  const pieces: Piece[] = [];
  let text = "";
  // KaTeX 給螢幕報讀器的隱藏 MathML 不算（畫面上看不到）
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".katex-mathml") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    pieces.push({ node: t, start: text.length, end: text.length + t.data.length });
    text += t.data;
  }
  return { text, pieces };
}

/** 選取範圍的端點 → 文字位置。 */
function offsetOf(pieces: Piece[], node: Node, offset: number, root: HTMLElement): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const p = pieces.find((x) => x.node === node);
    return p ? p.start + Math.min(offset, p.node.data.length) : null;
  }
  // 端點在元素上：取該位置之後的第一個文字
  const el = node as Element;
  if (!root.contains(el)) return null;
  const after = el.childNodes[offset];
  for (const p of pieces) {
    if (after) {
      if (after === p.node || after.contains(p.node) || after.compareDocumentPosition(p.node) & Node.DOCUMENT_POSITION_FOLLOWING) return p.start;
    } else if (!el.contains(p.node) && el.compareDocumentPosition(p.node) & Node.DOCUMENT_POSITION_FOLLOWING) return p.start;
  }
  return pieces.at(-1)?.end ?? 0;
}

function commonSuffix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** 在目前的文字裡找回這個螢光。找不到回 null。 */
export function locate(text: string, h: Pick<Highlight, "quote" | "prefix" | "suffix" | "start" | "end">): [number, number] | null {
  if (!h.quote) return null;
  if (text.slice(h.start, h.end) === h.quote && text.slice(Math.max(0, h.start - CTX), h.start).endsWith(h.prefix.slice(-8))) return [h.start, h.end];
  let best: [number, number] | null = null;
  let score = -1;
  for (let i = text.indexOf(h.quote); i >= 0; i = text.indexOf(h.quote, i + 1)) {
    const s = commonSuffix(text.slice(Math.max(0, i - CTX), i), h.prefix) + commonPrefix(text.slice(i + h.quote.length, i + h.quote.length + CTX), h.suffix) - Math.abs(i - h.start) / 1e6;
    if (s > score) {
      score = s;
      best = [i, i + h.quote.length];
    }
  }
  return best;
}

function unwrap(root: HTMLElement) {
  for (const m of Array.from(root.querySelectorAll("mark[data-hl]"))) {
    const parent = m.parentNode!;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  }
}

function wrap(pieces: Piece[], s: number, e: number, h: Highlight) {
  for (const p of pieces) {
    if (p.end <= s || p.start >= e) continue;
    let node = p.node;
    const a = Math.max(0, s - p.start);
    const b = Math.min(node.data.length, e - p.start);
    if (!node.data.slice(a, b).trim() && b - a < node.data.length) continue; // 只有空白的片段不包
    if (b < node.data.length) node.splitText(b);
    if (a > 0) node = node.splitText(a);
    const mark = document.createElement("mark");
    mark.className = cx("hl", `hl-${h.color}`, !!h.comment_md && "hl-note");
    mark.dataset.hl = h.id;
    if (h.comment_md) mark.title = h.comment_md;
    node.parentNode!.insertBefore(mark, node);
    mark.appendChild(node);
  }
}

interface Props {
  /** "q:PHY-000816/sol" */
  target: string;
  text: string;
  figs?: Fig[];
  role?: Fig["role"];
}

/** 可以畫螢光的 Markdown。失聯的螢光列在下方。 */
export function HighlightableMarkdown({ target, text, figs, role }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const list = useHighlights(target);
  const [orphans, setOrphans] = useState<Highlight[]>([]);
  const [pick, setPick] = useState<{ s: number; e: number; quote: string; prefix: string; suffix: string; x: number; y: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // 把螢光包到畫面上
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !list) return;
    unwrap(root);
    const lost: Highlight[] = [];
    for (const h of list) {
      const { text: t, pieces } = textIndex(root);
      const at = locate(t, h);
      if (!at) {
        lost.push(h);
        continue;
      }
      wrap(pieces, at[0], at[1], h);
      if (at[0] !== h.start) void highlights.update(h.id, { start: at[0], end: at[1] });
    }
    setOrphans(lost);
  }, [list, text, figs]);

  // 選字 → 色票
  const check = useCallback(() => {
    const root = ref.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return setPick(null);
    const r = sel.getRangeAt(0);
    if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return setPick(null);
    const { text: t, pieces } = textIndex(root);
    const s = offsetOf(pieces, r.startContainer, r.startOffset, root);
    const e = offsetOf(pieces, r.endContainer, r.endOffset, root);
    if (s === null || e === null || e <= s || !t.slice(s, e).trim()) return setPick(null);
    const rect = r.getBoundingClientRect();
    setPick({ s, e, quote: t.slice(s, e), prefix: t.slice(Math.max(0, s - CTX), s), suffix: t.slice(e, e + CTX), x: rect.left + rect.width / 2, y: rect.bottom });
  }, []);

  useEffect(() => {
    let timer = 0;
    const onSel = () => {
      clearTimeout(timer);
      timer = window.setTimeout(check, 250);
    };
    document.addEventListener("selectionchange", onSel);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSel);
    };
  }, [check]);

  const add = async (color: HighlightColor, note: boolean) => {
    if (!pick) return;
    const id = await highlights.add({ target, quote: pick.quote, prefix: pick.prefix, suffix: pick.suffix, start: pick.s, end: pick.e, color });
    window.getSelection()?.removeAllRanges();
    setPick(null);
    if (note) setOpen(id);
  };

  const onClick = (e: MouseEvent) => {
    const m = (e.target as HTMLElement).closest<HTMLElement>("mark[data-hl]");
    if (!m || !window.getSelection()?.isCollapsed) return;
    e.stopPropagation();
    setOpen(m.dataset.hl ?? null);
  };

  const current = open ? (list ?? []).find((h) => h.id === open) : undefined;

  return (
    <div>
      <div ref={ref} onClick={onClick}>
        <Markdown text={text} figs={figs} role={role} />
      </div>
      {pick && (
        <div className="fixed z-40" style={{ left: Math.max(8, Math.min(pick.x - 196, window.innerWidth - 400)), top: Math.min(pick.y + 10, window.innerHeight - 72) }} onPointerDown={(e) => e.preventDefault()}>
          <HighlightPalette onPick={(c) => void add(c, false)} onNote={() => void add("yellow", true)} />
        </div>
      )}
      {orphans.length > 0 && (
        <details className="mt-3 rounded-btn border border-line">
          <summary className="flex min-h-(--tap) items-center gap-2 px-3 text-meta text-ink-muted">
            <Icon name="alert" size={16} />
            失聯的螢光（{orphans.length}）：內容改過，原本標的字找不到了
          </summary>
          <ul className="space-y-2 px-3 pb-3">
            {orphans.map((h) => (
              <li key={h.id} className="flex items-start gap-2 text-ui">
                <span className={cx("min-w-0 flex-1 rounded-chip px-1 text-paper-ink", BG[h.color])}>{h.quote}</span>
                {h.comment_md && <span className="min-w-0 flex-1 text-ink-muted">{h.comment_md}</span>}
                <Button variant="ghost" icon="trash" onClick={() => void highlights.remove(h.id)}>刪除</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {current && <HighlightSheet h={current} figs={figs} onClose={() => setOpen(null)} />}
    </div>
  );
}

function HighlightSheet({ h, figs, onClose }: { h: Highlight; figs?: Fig[]; onClose: () => void }) {
  const [note, setNote] = useState(h.comment_md ?? "");
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet
      title="螢光與註記"
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" icon="trash" className="mr-auto" onClick={() => setConfirm(true)}>刪除螢光</Button>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={note === (h.comment_md ?? "")} onClick={() => { void highlights.update(h.id, { comment_md: note.trim() ? note : null }); onClose(); }}>儲存註記</Button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        <blockquote className={cx("rounded-btn px-3 py-2 text-body text-paper-ink", BG[h.color])}>{h.quote}</blockquote>
        <div role="group" aria-label="顏色" className="flex gap-1">
          {COLORS.map(([c, name]) => (
            <button key={c} type="button" aria-label={`改成${name}色`} aria-pressed={h.color === c} onClick={() => void highlights.update(h.id, { color: c })} className={cx("flex size-(--tap) items-center justify-center rounded-chip hover:bg-hover", h.color === c && "bg-blue-light")}>
              <span className={cx("size-6 rounded-full border border-line-strong", BG[c])} />
            </button>
          ))}
        </div>
        <MarkdownEditor value={note} onChange={setNote} figs={figs} label="註記（Markdown，可寫公式）" minRows="short" />
      </div>
      {confirm && (
        <Dialog title="刪除這個螢光？" onClose={() => setConfirm(false)} actions={<><Button variant="ghost" onClick={() => setConfirm(false)}>取消</Button><Button variant="danger" onClick={() => { void highlights.remove(h.id); onClose(); }}>刪除</Button></>}>
          註記也會一起刪除。
        </Dialog>
      )}
    </Sheet>
  );
}

// ---------- 筆記（資料庫閱讀頁）的螢光 ----------
//
// 整份筆記共用一層：每個區塊自己的文字放在 [data-hl-bid] 的容器裡（不含子區塊），
// 螢光的 target 是 "kb:<key>#<bid>"，start／end 以那個區塊的文字算。
// 筆記改版後重新定位（規格書 §9.4）：先找原本的區塊，再找同一個標題底下的區塊，再找全文；
// 換了區塊就把 target 改過去。都找不到 → 「失聯的螢光」，不刪。

function blockTexts(scope: ParentNode): { bid: string; el: HTMLElement }[] {
  return Array.from(scope.querySelectorAll<HTMLElement>("[data-hl-bid]")).map((el) => ({ bid: el.dataset.hlBid!, el }));
}

function bestIn(cands: { bid: string; el: HTMLElement }[], h: Highlight): { bid: string; el: HTMLElement; at: [number, number]; score: number } | null {
  let best: { bid: string; el: HTMLElement; at: [number, number]; score: number } | null = null;
  for (const c of cands) {
    const { text } = textIndex(c.el);
    for (let i = text.indexOf(h.quote); i >= 0; i = text.indexOf(h.quote, i + 1)) {
      const s = commonSuffix(text.slice(Math.max(0, i - CTX), i), h.prefix) + commonPrefix(text.slice(i + h.quote.length, i + h.quote.length + CTX), h.suffix);
      if (!best || s > best.score) best = { bid: c.bid, el: c.el, at: [i, i + h.quote.length], score: s };
    }
  }
  return best;
}

/** 換到別的區塊時，前後文至少要有幾個字對得上；否則當成失聯（原文被刪掉、別處剛好有同樣的字）。 */
const MIN_CONTEXT = 3;
const near = <T extends { score: number }>(hit: T | null): T | null => (hit && hit.score >= MIN_CONTEXT ? hit : null);

interface LayerProps {
  /** "BCH/2-3_PDH…" */
  docKey: string;
  root: RefObject<HTMLElement | null>;
  list: Highlight[] | undefined;
  figs?: Fig[];
  /** 區塊樹重新畫過（筆記載入、套上修訂、換了展開層數）時換一個新值，讓螢光重新包上去 */
  version: unknown;
}

/** 筆記閱讀頁的螢光層：包螢光、選字浮出色票、點螢光開註記面板、失聯清單。 */
export function KbHighlightLayer({ docKey, root, list, figs, version }: LayerProps) {
  const [orphans, setOrphans] = useState<Highlight[]>([]);
  const [pick, setPick] = useState<{ bid: string; s: number; e: number; quote: string; prefix: string; suffix: string; x: number; y: number } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const prefix = `kb:${docKey}#`;

  // 用 useEffect 而不是 useLayoutEffect：螢光層排在文章前面，同一次提交裡 layout effect 會比文章的 ref 先執行，
  // 第一次載入時拿到的 root 是空的（2026-11-11 實測：一進頁面螢光不出現）
  useEffect(() => {
    const el = root.current;
    if (!el || !list) return;
    unwrap(el);
    const lost: Highlight[] = [];
    const all = blockTexts(el);
    for (const h of list) {
      const bid = h.target.slice(prefix.length);
      const own = all.find((c) => c.bid === bid);
      let hit: { bid: string; el: HTMLElement; at: [number, number] } | null = null;
      if (own) {
        const at = locate(textIndex(own.el).text, h);
        if (at) hit = { ...own, at };
      }
      if (!hit && own) {
        // 同一個標題底下
        const section = own.el.closest("details");
        if (section) hit = near(bestIn(blockTexts(section), h));
      }
      if (!hit) hit = near(bestIn(all, h));
      if (!hit) {
        lost.push(h);
        continue;
      }
      wrap(textIndex(hit.el).pieces, hit.at[0], hit.at[1], h);
      if (hit.bid !== bid) void highlights.update(h.id, { target: prefix + hit.bid, start: hit.at[0], end: hit.at[1] });
      else if (hit.at[0] !== h.start) void highlights.update(h.id, { start: hit.at[0], end: hit.at[1] });
    }
    setOrphans(lost);
  }, [list, version, root, prefix]);

  const check = useCallback(() => {
    const el = root.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return setPick(null);
    const r = sel.getRangeAt(0);
    const startNode = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : (r.startContainer as Element);
    const block = startNode?.closest<HTMLElement>("[data-hl-bid]");
    if (!block || !el.contains(block)) return setPick(null);
    const { text: t, pieces } = textIndex(block);
    const s = offsetOf(pieces, r.startContainer, r.startOffset, block);
    // 跨區塊的選取：只標到這個區塊的結尾
    const e = block.contains(r.endContainer) ? offsetOf(pieces, r.endContainer, r.endOffset, block) : t.length;
    if (s === null || e === null || e <= s || !t.slice(s, e).trim()) return setPick(null);
    const rect = r.getBoundingClientRect();
    setPick({ bid: block.dataset.hlBid!, s, e, quote: t.slice(s, e), prefix: t.slice(Math.max(0, s - CTX), s), suffix: t.slice(e, e + CTX), x: rect.left + rect.width / 2, y: rect.bottom });
  }, [root]);

  useEffect(() => {
    let timer = 0;
    const onSel = () => {
      clearTimeout(timer);
      timer = window.setTimeout(check, 250);
    };
    document.addEventListener("selectionchange", onSel);
    const el = root.current;
    const onClick = (e: globalThis.MouseEvent) => {
      const m = (e.target as HTMLElement).closest<HTMLElement>("mark[data-hl]");
      if (!m || !window.getSelection()?.isCollapsed) return;
      e.stopPropagation();
      setOpen(m.dataset.hl ?? null);
    };
    el?.addEventListener("click", onClick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onSel);
      el?.removeEventListener("click", onClick);
    };
  }, [check, root, version]);

  const add = async (color: HighlightColor, note: boolean) => {
    if (!pick) return;
    const id = await highlights.add({ target: prefix + pick.bid, quote: pick.quote, prefix: pick.prefix, suffix: pick.suffix, start: pick.s, end: pick.e, color });
    window.getSelection()?.removeAllRanges();
    setPick(null);
    if (note) setOpen(id);
  };

  const current = open ? (list ?? []).find((h) => h.id === open) : undefined;
  return (
    <>
      {pick && (
        <div className="fixed z-40 print:hidden" style={{ left: Math.max(8, Math.min(pick.x - 196, window.innerWidth - 400)), top: Math.min(pick.y + 10, window.innerHeight - 72) }} onPointerDown={(e) => e.preventDefault()}>
          <HighlightPalette onPick={(c) => void add(c, false)} onNote={() => void add("yellow", true)} />
        </div>
      )}
      {orphans.length > 0 && <OrphanList orphans={orphans} />}
      {current && <HighlightSheet h={current} figs={figs} onClose={() => setOpen(null)} />}
    </>
  );
}

function OrphanList({ orphans }: { orphans: Highlight[] }) {
  return (
    <details className="rounded-btn border border-line bg-card print:hidden">
      <summary className="flex min-h-(--tap) items-center gap-2 px-3 text-meta text-ink-muted">
        <Icon name="alert" size={16} />
        失聯的螢光（{orphans.length}）：筆記改過，原本標的字找不到了
      </summary>
      <ul className="space-y-2 px-3 pb-3">
        {orphans.map((h) => (
          <li key={h.id} className="flex items-start gap-2 text-ui">
            <span className={cx("min-w-0 flex-1 rounded-chip px-1 text-paper-ink", BG[h.color])}>{h.quote}</span>
            {h.comment_md && <span className="min-w-0 flex-1 text-ink-muted">{h.comment_md}</span>}
            <Button variant="ghost" icon="trash" onClick={() => void highlights.remove(h.id)}>刪除</Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
