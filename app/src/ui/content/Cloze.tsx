// 克漏字與膠帶（第 5B 階段，規格書 §9.8）：筆記閱讀頁上的克漏字標示、膠帶模式、克漏字小卡、失聯清單。
//
// 位置的寫法：和螢光一樣用「看得到的字」，但公式算一個字 MATH（cloze-core.ts）——卡片要的是原始 Markdown，
// 公式在畫面上是 KaTeX，原文是 $…$，兩邊只有「整個公式」對得起來。選到公式的一部分就擴大成整個公式。

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { cards, clozes, MATH, squash, TAPE_NAME, type Card, type ClozeCardInfo, type ClozeMark, type ClozePick, type ClozeSource, type KbBlock, type KbDoc } from "@/data";
import { Icon } from "../icons";
import { Dialog, useToast } from "../overlays";
import { Badge, Button, cx } from "../primitives";
import { NoteCard, NoteCardDelete } from "../NoteCard";

const CTX = 32;

// ---------- 畫面上的字 ↔ 克漏字的位置 ----------

interface Piece {
  node: Text;
  start: number;
  end: number;
}

/** 區塊的字：t＝和螢光相同的位置（含 KaTeX 畫出來的字）；c＝公式算一個 MATH 的位置。兩者互相對照。 */
export function clozeIndex(root: HTMLElement) {
  const pieces: Piece[] = [];
  let t = 0;
  let text = "";
  const cs: number[] = []; // 第 i 個字的 t 起點
  const ce: number[] = []; // 第 i 個字的 t 終點
  let lastKatex: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".katex-mathml") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    pieces.push({ node, start: t, end: t + node.data.length });
    const k = node.parentElement?.closest(".katex");
    if (k) {
      if (k !== lastKatex) {
        text += MATH;
        cs.push(t);
        ce.push(t + node.data.length);
        lastKatex = k;
      } else ce[ce.length - 1] = t + node.data.length;
    } else {
      lastKatex = null;
      for (let i = 0; i < node.data.length; i++) {
        text += node.data[i];
        cs.push(t + i);
        ce.push(t + i + 1);
      }
    }
    t += node.data.length;
  }
  /** t 位置 → c 位置（起點：落在公式中間就往前到公式開頭；終點：往後到公式結尾） */
  const toC = (pos: number, side: "start" | "end") => {
    for (let i = 0; i < cs.length; i++) {
      if (side === "start" && ce[i] > pos) return i;
      if (side === "end" && cs[i] >= pos) return i;
    }
    return cs.length;
  };
  return { text, pieces, cs, ce, toC };
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

/** 在區塊的 c 字串裡找回一處克漏字；回 c 的 [起, 訖) 與分數（前後文對上幾個字） */
function locateC(text: string, m: Pick<ClozeMark, "quote" | "prefix" | "suffix" | "start" | "end">): { at: [number, number]; score: number } | null {
  const q = m.quote;
  if (!q) return null;
  if (m.start !== null && text.slice(m.start, m.end ?? m.start) === q) return { at: [m.start, m.end!], score: 99 };
  let best: { at: [number, number]; score: number } | null = null;
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
    const s = commonSuffix(text.slice(Math.max(0, i - CTX), i), m.prefix ?? "") + commonPrefix(text.slice(i + q.length, i + q.length + CTX), m.suffix ?? "");
    if (!best || s > best.score) best = { at: [i, i + q.length], score: s };
  }
  return best;
}

/** 選取（螢光的 t 位置）→ 克漏字的位置；空白頭尾去掉 */
export function pickOf(block: HTMLElement, s: number, e: number): Omit<ClozePick, "mode"> | null {
  const ix = clozeIndex(block);
  let a = ix.toC(s, "start");
  let b = ix.toC(e, "end");
  while (a < b && /\s/.test(ix.text[a])) a++;
  while (b > a && /\s/.test(ix.text[b - 1])) b--;
  if (b <= a) return null;
  return { quote: ix.text.slice(a, b), prefix: ix.text.slice(Math.max(0, a - CTX), a), suffix: ix.text.slice(b, b + CTX), start: a, end: b };
}

function unwrap(root: HTMLElement) {
  for (const m of Array.from(root.querySelectorAll("span[data-cz]"))) {
    const parent = m.parentNode!;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  }
}

function wrap(pieces: Piece[], s: number, e: number, m: ClozeMark, level: number) {
  for (const p of pieces) {
    if (p.end <= s || p.start >= e) continue;
    let node = p.node;
    const a = Math.max(0, s - p.start);
    const b = Math.min(node.data.length, e - p.start);
    if (b < node.data.length) node.splitText(b);
    if (a > 0) node = node.splitText(a);
    // 公式整個包起來（不要切進 KaTeX 裡面）
    const k = node.parentElement?.closest(".katex");
    const target: Node = k && k.parentNode ? k : node;
    if (target !== node && (target as Element).closest("span[data-cz]")) continue;
    const span = document.createElement("span");
    span.className = "cloze-mark";
    span.dataset.cz = m.id;
    span.dataset.tape = String(level);
    if (m.hint) span.dataset.hint = m.hint;
    target.parentNode!.insertBefore(span, target);
    span.appendChild(target);
  }
}

/** 區塊的路徑：標題路徑＋上層列點（規格書 §9.8；列點常常是半句話，沒有上層看不懂） */
export function pathOf(doc: KbDoc, bid: string): string[] {
  const strip = (md: string) => md.replace(/^#+\s*/, "").replace(/\$[^$]*\$/g, "…").replace(/[*_`~=]|<[^>]+>/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim().slice(0, 40);
  const walk = (bs: KbBlock[], trail: string[]): string[] | null => {
    for (const b of bs) {
      if (b.bid === bid) return trail;
      const label = b.type === "heading" ? ((b.level ?? 1) === 1 ? null : strip(b.md)) : b.type === "list_item" ? strip(b.md) : null;
      const r = walk(b.children, label ? [...trail, label] : trail);
      if (r) return r;
    }
    return null;
  };
  return [doc.title, ...(walk(doc.blocks, []) ?? [])];
}

// ---------- 筆記閱讀頁的克漏字層 ----------

interface LayerProps {
  docKey: string;
  doc: KbDoc;
  root: RefObject<HTMLElement | null>;
  marks: ClozeMark[] | undefined;
  info: ClozeCardInfo | undefined;
  /** 區塊重新畫過時換一個新值 */
  version: unknown;
  tape: boolean;
  /** 撕開的處數（頁首顯示「共 N 處・已撕 M」） */
  onTorn: (torn: number, total: number) => void;
  /** 「全部貼回」時換一個新值 */
  resetTorn: number;
  /** 區塊的原文（含還沒寫回的修訂） */
  mdOf: (bid: string) => string | null;
  src: (bid: string) => ClozeSource | null;
}

export function KbClozeLayer({ docKey, doc, root, marks, info, version, tape, onTorn, resetTorn, mdOf }: LayerProps) {
  const prefix = `kb:${docKey}#`;
  const [orphans, setOrphans] = useState<ClozeMark[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const torn = useRef(new Set<string>());
  const tapeRef = useRef(tape);
  tapeRef.current = tape;

  // 卡被刪掉的編號不顯示
  const shown = useMemo(() => (marks ?? []).filter((m) => info?.byNote.get(m.note)?.has(m.n)), [marks, info]);
  const levelOf = useCallback((m: ClozeMark) => {
    const c = info?.byNote.get(m.note)?.get(m.n);
    return c ? (info?.level.get(c.id) ?? 0) : 0;
  }, [info]);

  // 包上克漏字；失聯的列出來
  useEffect(() => {
    const el = root.current;
    if (!el || !info) return;
    unwrap(el);
    const blocks = Array.from(el.querySelectorAll<HTMLElement>("[data-hl-bid]")).map((b) => ({ bid: b.dataset.hlBid!, el: b }));
    const lost: ClozeMark[] = [];
    for (const m of shown) {
      const bid = m.target.slice(prefix.length);
      const own = blocks.find((b) => b.bid === bid);
      let hit: { bid: string; el: HTMLElement; at: [number, number] } | null = null;
      if (own) {
        const r = locateC(clozeIndex(own.el).text, m);
        if (r) hit = { ...own, at: r.at };
      }
      if (!hit) {
        // 換了區塊：先找同一個標題底下，再找全文；前後文至少要對上 3 個字
        const scope = own?.el.closest("details") ?? el;
        for (const cands of [Array.from(scope.querySelectorAll<HTMLElement>("[data-hl-bid]")), blocks.map((b) => b.el)]) {
          let best: { bid: string; el: HTMLElement; at: [number, number]; score: number } | null = null;
          for (const b of cands) {
            const r = locateC(clozeIndex(b).text, m);
            if (r && (!best || r.score > best.score)) best = { bid: b.dataset.hlBid!, el: b, at: r.at, score: r.score };
          }
          if (best && best.score >= 3) {
            hit = best;
            break;
          }
        }
      }
      if (!hit) {
        lost.push(m);
        continue;
      }
      const ix = clozeIndex(hit.el);
      wrap(ix.pieces, ix.cs[hit.at[0]], ix.ce[hit.at[1] - 1], m, levelOf(m));
      void clozes.move(m, prefix + hit.bid, hit.at[0], hit.at[1]);
    }
    setOrphans(lost);
    // 膠帶模式：撕開的狀態保留
    for (const s of Array.from(el.querySelectorAll<HTMLElement>("span[data-cz]"))) if (torn.current.has(s.dataset.cz!)) s.classList.add("torn");
    decorate(el, tapeRef.current);
    onTorn(torn.current.size, new Set(shown.map((m) => m.id)).size - lost.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, info, version, root, prefix, levelOf]);

  // 原文改版：重新產生卡片內容（找不到的標「原文已改」）
  const refreshed = useRef<unknown>(null);
  useEffect(() => {
    if (!marks?.length || refreshed.current === doc) return;
    refreshed.current = doc;
    void clozes.refresh(marks, (t) => (t.startsWith(prefix) ? mdOf(t.slice(prefix.length)) : null));
  }, [doc, marks, prefix, mdOf]);

  // 膠帶模式切換、全部貼回
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!tape || resetTorn) {
      torn.current.clear();
      el.querySelectorAll("span[data-cz].torn").forEach((s) => s.classList.remove("torn"));
    }
    decorate(el, tape);
    onTorn(torn.current.size, el.querySelectorAll("span[data-cz]").length ? new Set(Array.from(el.querySelectorAll<HTMLElement>("span[data-cz]")).map((s) => s.dataset.cz)).size : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tape, resetTorn, root]);

  // 點克漏字：膠帶模式撕開／貼回；平常開克漏字小卡。比螢光先處理（capture）。
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const toggle = (span: HTMLElement) => {
      const id = span.dataset.cz!;
      const on = !torn.current.has(id);
      if (on) torn.current.add(id);
      else torn.current.delete(id);
      el.querySelectorAll<HTMLElement>(`span[data-cz="${CSS.escape(id)}"]`).forEach((s) => s.classList.toggle("torn", on));
      decorate(el, true);
      onTorn(torn.current.size, new Set(Array.from(el.querySelectorAll<HTMLElement>("span[data-cz]")).map((s) => s.dataset.cz)).size);
    };
    const click = (e: MouseEvent) => {
      const span = (e.target as HTMLElement).closest<HTMLElement>("span[data-cz]");
      if (!span || !el.contains(span)) return;
      if (tapeRef.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle(span);
        return;
      }
      if (!window.getSelection()?.isCollapsed) return;
      e.stopImmediatePropagation();
      setOpen(span.dataset.cz!);
    };
    const key = (e: KeyboardEvent) => {
      if (!tapeRef.current || (e.key !== "Enter" && e.key !== " ")) return;
      const span = (e.target as HTMLElement).closest?.<HTMLElement>("span[data-cz]");
      if (!span || !el.contains(span)) return;
      e.preventDefault();
      toggle(span);
    };
    el.addEventListener("click", click, true);
    el.addEventListener("keydown", key);
    return () => {
      el.removeEventListener("click", click, true);
      el.removeEventListener("keydown", key);
    };
  }, [root, version, onTorn]);

  const current = open ? shown.find((m) => m.id === open) : undefined;
  return (
    <>
      {orphans.length > 0 && <ClozeOrphans orphans={orphans} info={info} mdOf={(m) => mdOf(m.target.slice(prefix.length)) ?? ""} />}
      {current && <ClozeCard key={current.id} m={current} all={shown} info={info} md={mdOf(current.target.slice(prefix.length)) ?? ""} onClose={() => setOpen(null)} />}
    </>
  );
}

/** 膠帶模式：蓋住的每一段可以用 Tab 移過去、螢幕報讀只念「膠帶」 */
function decorate(el: HTMLElement, tape: boolean) {
  el.classList.toggle("tape-mode", tape);
  const seen = new Set<string>();
  for (const s of Array.from(el.querySelectorAll<HTMLElement>("span[data-cz]"))) {
    const first = !seen.has(s.dataset.cz!);
    seen.add(s.dataset.cz!);
    const covered = tape && !s.classList.contains("torn");
    if (tape && first) {
      s.tabIndex = 0;
      s.setAttribute("role", "button");
      s.setAttribute("aria-label", covered ? `膠帶${s.dataset.hint ? `（提示：${s.dataset.hint}）` : ""}，按 Enter 撕開` : "已撕開，按 Enter 貼回");
      s.setAttribute("aria-pressed", covered ? "false" : "true");
    } else {
      s.removeAttribute("tabindex");
      s.removeAttribute("role");
      s.removeAttribute("aria-pressed");
      if (covered) s.setAttribute("aria-hidden", "true");
      else s.removeAttribute("aria-label");
    }
    if (!covered) s.removeAttribute("aria-hidden");
  }
}

const show = (q: string) => q.replaceAll(MATH, "〔公式〕");

/** 點原文上的克漏字：答案、提示、和誰一起遮、這張卡的狀態、開啟卡片、刪除（註記卡，規格書 §9.8） */
function ClozeCard({ m, all, info, md, onClose }: { m: ClozeMark; all: ClozeMark[]; info: ClozeCardInfo | undefined; md: string; onClose: () => void }) {
  const toast = useToast();
  const [hint, setHint] = useState(m.hint ?? "");
  const [confirm, setConfirm] = useState(false);
  const card = info?.byNote.get(m.note)?.get(m.n);
  const level = card ? (info?.level.get(card.id) ?? 0) : 0;
  const others = [...new Set(all.filter((x) => x.note === m.note && x.n !== m.n).map((x) => x.n))].sort((a, b) => a - b);
  const sameN = all.filter((x) => x.note === m.note && x.n === m.n).length;
  const latest = useRef({ hint, m, md });
  latest.current = { hint, m, md };
  // 關掉時存提示
  useEffect(
    () => () => {
      const { hint, m, md } = latest.current;
      if ((hint.trim() || null) !== (m.hint ?? null)) void clozes.setHint(m, hint, md);
    },
    [],
  );
  const anchor = useCallback(() => Array.from(document.querySelectorAll(`span[data-cz="${CSS.escape(m.id)}"]`)), [m.id]);
  return (
    <NoteCard
      anchor={anchor}
      label="克漏字"
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Badge tone="blue">c{m.n}</Badge>
          <span className="cloze-mark min-w-0 truncate px-1">{show(m.quote)}</span>
        </span>
      }
      tools={<NoteCardDelete onClick={() => setConfirm(true)} />}
      footer={card?.origin?.stale ? "原文改過，有克漏字找不到了；卡片保留舊內容" : undefined}
    >
      <label className="block text-meta font-medium text-ink-muted">
        提示（寫在膠帶上，可留空）
        <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="例如：輔酶、幾個碳" className="mt-1 block min-h-(--tap) w-full rounded-btn border border-line-strong bg-card px-3 text-base text-ink-strong" />
      </label>
      <div className="flex flex-wrap items-center gap-2 text-ui">
        <span className="text-ink-muted">一起遮：</span>
        {others.map((n) => (
          <Button key={n} variant="secondary" onClick={() => void clozes.setNumber(m, n, md).then(() => { toast(`已改成和 c${n} 一起遮`); onClose(); })}>
            和 c{n} 一起
          </Button>
        ))}
        {sameN > 1 && (
          <Button variant="secondary" onClick={() => void clozes.setNumber(m, 0, md).then(() => { toast("已拆成自己一張卡"); onClose(); })}>
            拆成自己一張
          </Button>
        )}
        {!others.length && sameN <= 1 && <span className="text-meta text-ink-muted">這個區塊只有這一處</span>}
      </div>
      {card && (
        <div className="space-y-1 rounded-btn bg-hover px-3 py-2 text-meta text-ink">
          <p>{cards.describe(info?.state.get(card.id))}</p>
          <p className="flex items-center gap-1.5">
            <span className={cx("inline-block size-3 rounded-sm outline outline-1 outline-line-strong", ["bg-tape-blue", "bg-tape-orange", "bg-tape-red"][level])} aria-hidden="true" />
            膠帶顏色：{TAPE_NAME[level]}（{level === 0 ? "沒答錯過，或已經連續答對降回來" : level === 1 ? "複習時答錯過 1 次" : "複習時答錯過 2 次以上"}）
          </p>
          {card.origin?.edited && <p>這張卡在卡片編輯器改過，原文改版時不會自動更新。</p>}
        </div>
      )}
      <div className="flex justify-end">
        {card && (
          <Link to={`/cards/c/${card.id}`} className="inline-flex min-h-(--tap) items-center gap-1 px-2 text-ui text-blue-ink underline underline-offset-2">
            <Icon name="list" size={16} />
            開啟卡片
          </Link>
        )}
      </div>
      {confirm && (
        <Dialog
          title="刪除這個克漏字？"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>取消</Button>
              <Button variant="danger" onClick={() => void clozes.remove(m, md).then(() => { toast("已刪除克漏字"); onClose(); })}>刪除</Button>
            </>
          }
        >
          {sameN > 1 ? `c${m.n} 還有其他 ${sameN - 1} 處，卡片保留。` : `c${m.n} 只有這一處：卡片一起刪除（複習紀錄保留）。`}
        </Dialog>
      )}
    </NoteCard>
  );
}

function ClozeOrphans({ orphans, info, mdOf }: { orphans: ClozeMark[]; info: ClozeCardInfo | undefined; mdOf: (m: ClozeMark) => string }) {
  return (
    <details className="rounded-btn border border-line bg-card print:hidden">
      <summary className="flex min-h-(--tap) items-center gap-2 px-3 text-meta text-ink-muted">
        <Icon name="alert" size={16} />
        失聯的克漏字（{orphans.length}）：筆記改過，原本挖的字找不到了；卡片保留舊內容
      </summary>
      <ul className="space-y-2 px-3 pb-3">
        {orphans.map((m) => {
          const c: Card | undefined = info?.byNote.get(m.note)?.get(m.n);
          return (
            <li key={m.id} className="flex items-center gap-2 text-ui">
              <Badge tone="blue">c{m.n}</Badge>
              <span className="min-w-0 flex-1 truncate">{show(squash(m.quote).text)}</span>
              {c && <Link to={`/cards/c/${c.id}`} className="text-meta text-blue-ink">卡片</Link>}
              <Button variant="ghost" icon="trash" onClick={() => void clozes.remove(m, mdOf(m))}>刪除</Button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
