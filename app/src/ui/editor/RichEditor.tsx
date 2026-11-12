// 所見即所得的 Markdown 編輯器（規格書 §9.10）。進入編輯時才載入（RichEditorLazy.tsx）。
//
// 一個元件，三種放法：就地（inline，筆記區塊、題目欄位）、註記卡（card）、整頁（page）。
// 儲存的仍然是 Markdown；沒改到的地方原文一字不動（markdown.ts）。

import "prosemirror-view/style/prosemirror.css";
import "prosemirror-tables/style/tables.css";
import "prosemirror-gapcursor/style/gapcursor.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { history } from "prosemirror-history";
import type { Node as PMNode } from "prosemirror-model";
import { EditorState, NodeSelection, TextSelection, type Command, type Plugin } from "prosemirror-state";
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, isInTable, selectedRect, tableEditing } from "prosemirror-tables";
import { gapCursor } from "prosemirror-gapcursor";
import { sinkListItem, splitListItem } from "prosemirror-schema-list";
import { EditorView } from "prosemirror-view";
import type { Fig } from "@/data";
import { renderMath } from "../content/render";
import { Icon } from "../icons";
import { Button, cx } from "../primitives";
import { cmd, keys, rules } from "./commands";
import { parseMarkdown, preserveLines, serializeInline, serializeMarkdown, type Source } from "./markdown";
import { listItemShapeOk, pastePlugin, pickSlash, shapePlugin, slashKey, slashMatches, slashPlugin } from "./plugins";
import { schema } from "./schema";
import { nodeViews } from "./views";

const N = schema.nodes;

export type EditorMode = "doc" | "heading" | "list_item";

export interface EditResult {
  md: string;
  changed: boolean;
  /** 列點就地編輯時按 Enter 新增的列點：child＝在 Tab 之後變成子列點 */
  insert?: { child: boolean; md: string };
}

export interface RichEditorProps {
  initial: string;
  /** doc：整段 Markdown；heading：只改一個標題的字（層級不變）；list_item：一個列點的字＋最多新增一個列點 */
  mode?: EditorMode;
  /** list_item：原本是編號列點 */
  ordered?: boolean;
  num?: number;
  figs?: Fig[];
  role?: Fig["role"];
  placement?: "inline" | "card" | "page";
  label: string;
  /** list_item：一開始就在下面新增一個列點（選單的「在下面插入列點」「插入子列點」） */
  startInsert?: "after" | "child";
  /** list_item：可以按 Enter 新增列點（改網站上新增、還沒寫回的列點時不行） */
  allowInsert?: boolean;
  /** 從哪裡點進來（游標放在那裡） */
  at?: { x: number; y: number } | null;
  onDone: (r: EditResult) => void;
  onCancel: () => void;
  onDirty?: (dirty: boolean) => void;
  /** 被擋下來的操作（例如列點一次只能新增一個）要說明時 */
  onNotice?: (text: string) => void;
  /** 工具列左邊多放的東西（例如題目欄位的名稱） */
  barStart?: ReactNode;
  className?: string;
  /** 每次內容改變（稍微延遲）時給目前的 Markdown：註記卡、卡片編輯、整頁筆記用，由外面決定什麼時候存 */
  onChange?: (md: string) => void;
  /** false：工具列不放「取消／完成」（外面自己有存檔的按鈕） */
  actions?: boolean;
  /** 一開始不搶焦點（例如註記卡打開時游標還在別處） */
  noFocus?: boolean;
  /** 空白時顯示的提示 */
  placeholder?: string;
  /** 按鍵交給外面先處理（例如卡片編輯器的 ⌘⇧C）；回 true 表示處理掉了 */
  onKey?: (e: KeyboardEvent, view: EditorView) => boolean;
}

interface Built {
  doc: PMNode | null;
  source: Source | null;
  /** list_item：原本那一段（算 preserveLines 用） */
  para?: PMNode;
  /** 編輯器不認得這段的寫法：直接改原始碼 */
  fallback?: string;
}

function build(text: string, mode: EditorMode, ordered: boolean, num: number): Built {
  const { doc, source } = parseMarkdown(text);
  const b = source.blocks;
  if (mode === "doc") return { doc, source };
  if (mode === "heading") {
    if (b.length === 1 && !b[0].raw && b[0].node.type === N.heading) return { doc, source };
    return { doc: null, source: null, fallback: "這個標題的寫法編輯器不認得，改的是原始碼。" };
  }
  let para: PMNode;
  if (!text.trim()) para = N.paragraph.create();
  else if (b.length === 1 && !b[0].raw && b[0].node.type === N.paragraph) para = b[0].node;
  else return { doc: null, source: null, fallback: "這個列點的寫法編輯器不認得，改的是原始碼。" };
  const list = ordered ? N.ordered_list.create({ start: num }, N.list_item.create(null, para)) : N.bullet_list.create(null, N.list_item.create(null, para));
  return { doc: N.doc.create(null, list), source, para };
}

function result(doc: PMNode, b: Built, mode: EditorMode, initial: string): EditResult {
  if (mode !== "list_item") {
    const md = serializeMarkdown(doc, b.source ?? undefined);
    return { md, changed: md !== initial };
  }
  const list = doc.firstChild!;
  const i0 = list.firstChild!;
  const p0 = i0.firstChild!;
  const md = b.para && p0.eq(b.para) ? initial : b.para ? preserveLines(initial, serializeInline(b.para), serializeInline(p0)) : serializeInline(p0);
  let insert: EditResult["insert"];
  if (list.childCount === 2) insert = { child: false, md: serializeInline(list.child(1).firstChild!) };
  else if (i0.childCount === 2) insert = { child: true, md: serializeInline(i0.child(1).firstChild!.firstChild!) };
  if (insert && !insert.md.trim()) insert = undefined;
  return { md, changed: md !== initial || !!insert, insert };
}

const coarse = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** 不讓按鈕搶走編輯器的焦點（iPad 上焦點一走鍵盤就收起來） */
const keepFocus = { onPointerDown: (e: { preventDefault: () => void }) => e.preventDefault(), onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() };

export default function RichEditor(props: RichEditorProps) {
  const { initial, mode = "doc", ordered = false, num = 1, figs, role, placement = "inline", label } = props;
  const blocks = mode === "doc";
  const host = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [, setTick] = useState(0);
  const first = useMemo(() => build(initial, mode, ordered, num), [initial, mode, ordered, num]);
  const built = useRef<Built>(first);
  const [src, setSrc] = useState<string | null>(first.fallback ? initial : null);
  const startDoc = useRef<PMNode | null>(first.doc);
  const cb = useRef(props);
  cb.current = props;
  const doneRef = useRef(false);
  const changeTimer = useRef(0);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const v = view.current;
    if (src !== null) cb.current.onDone({ md: src, changed: src !== initial });
    else if (v) cb.current.onDone(result(v.state.doc, built.current, mode, initial));
    else cb.current.onDone({ md: initial, changed: false });
  }, [src, initial, mode]);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const cancel = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    cb.current.onCancel();
  }, []);

  // 建立 ProseMirror（原始碼模式時不建）
  useLayoutEffect(() => {
    if (src !== null || !host.current || !built.current.doc) return;
    const plugins: Plugin[] = [
      slashPlugin(blocks),
      pastePlugin({ blocks }),
      rules({ blocks }),
      ...keys({
        blocks,
        onDone: () => finishRef.current(),
        onEscape: () => {
          const v = view.current;
          if (v && slashKey.getState(v.state)) return false;
          cancel();
          return true;
        },
      }),
      history(),
    ];
    if (mode === "heading") {
      const level = built.current.doc.firstChild!.attrs.level;
      plugins.push(shapePlugin((d) => d.childCount === 1 && d.firstChild!.type === N.heading && d.firstChild!.attrs.level === level, () => cb.current.onNotice?.("標題只能改字，層級要在 Mac 上用 Typora 改")));
    } else if (mode === "list_item") {
      const one = (d: PMNode) => listItemShapeOk(d) && d.firstChild!.childCount === 1 && d.firstChild!.firstChild!.childCount === 1;
      plugins.push(
        props.allowInsert === false
          ? shapePlugin(one, () => cb.current.onNotice?.("網站上新增、還沒寫回的列點下面不能再新增；寫回 Mac 之後再加"))
          : shapePlugin(listItemShapeOk, () => cb.current.onNotice?.("一次只能新增一個列點；存檔後再從新的位置繼續")),
      );
    }
    plugins.push(tableEditing(), gapCursor());
    const state = EditorState.create({ doc: built.current.doc, plugins });
    const v = new EditorView(host.current, {
      state,
      nodeViews: nodeViews({ figs, role }),
      handleKeyDown: (vv, e) => !!cb.current.onKey?.(e, vv),
      attributes: { class: cx("md ed", placement === "card" && "md-tight"), "data-placeholder": props.placeholder ?? "", "aria-label": label, role: "textbox", "aria-multiline": "true", spellcheck: "false", autocapitalize: "off", autocorrect: "off" },
      dispatchTransaction(tr) {
        const s = v.state.apply(tr);
        v.updateState(s);
        if (tr.docChanged) {
          cb.current.onDirty?.(!startDoc.current || !s.doc.eq(startDoc.current));
          if (cb.current.onChange) {
            window.clearTimeout(changeTimer.current);
            changeTimer.current = window.setTimeout(() => {
              const cur = view.current;
              if (cur) cb.current.onChange?.(result(cur.state.doc, built.current, mode, initial).md);
            }, 120);
          }
        }
        setTick((t) => t + 1);
      },
    });
    view.current = v;
    // 游標：點進來的位置，不然放在最後
    const p = props.at ? v.posAtCoords({ left: props.at.x, top: props.at.y }) : null;
    const sel = p ? TextSelection.near(v.state.doc.resolve(p.pos)) : TextSelection.atEnd(v.state.doc);
    v.dispatch(v.state.tr.setSelection(sel));
    if (mode === "list_item" && props.startInsert) {
      // 第一個列點那一段的結尾（doc > list > item > paragraph，所以內容從 3 開始）
      const p0 = v.state.doc.firstChild!.firstChild!.firstChild!;
      v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 3 + p0.content.size)));
      splitListItem(N.list_item)(v.state, v.dispatch);
      if (props.startInsert === "child") sinkListItem(N.list_item)(v.state, v.dispatch);
    }
    if (!props.noFocus) v.focus();
    setTick((t) => t + 1);
    return () => {
      // 卸載前把還沒送出的內容送出去
      if (changeTimer.current && cb.current.onChange) {
        window.clearTimeout(changeTimer.current);
        changeTimer.current = 0;
        cb.current.onChange(result(v.state.doc, built.current, mode, initial).md);
      }
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src === null]);

  // 點編輯器以外的地方 ＝ 完成
  useEffect(() => {
    if (placement !== "inline") return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || !box.current || box.current.contains(t)) return;
      // 頁面上浮出的東西（提示訊息、對話框）不算
      if ((t as HTMLElement).closest?.("[role=dialog],[role=status],[data-keep-editor]")) return;
      finishRef.current();
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, [placement]);

  const toggleSource = () => {
    const v = view.current;
    if (src === null) {
      if (!v) return;
      const r = result(v.state.doc, built.current, mode, initial);
      if (r.insert) {
        cb.current.onNotice?.("有新增的列點時不能切到原始碼；先存檔");
        return;
      }
      setSrc(r.md);
    } else {
      const b = build(src, mode, ordered, num);
      if (b.fallback) {
        cb.current.onNotice?.(b.fallback);
        return;
      }
      built.current = b;
      setSrc(null);
    }
  };

  const v = view.current;
  const state = v?.state;
  const run = (c: Command) => () => {
    if (!v) return;
    c(v.state, v.dispatch, v);
    v.focus();
  };

  return (
    <div ref={box} className={cx("ed-box relative", placement === "page" && "ed-page", mode === "list_item" && "ed-li", props.className)} data-editing>
      {src !== null ? (
        <div className="space-y-2">
          {first.fallback && <p className="text-meta text-ink-muted">{first.fallback}</p>}
          <textarea
            aria-label={`${label}（原始碼）`}
            value={src}
            onChange={(e) => {
              setSrc(e.target.value);
              cb.current.onChange?.(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), finish());
              if (e.key === "Escape") (e.preventDefault(), cancel());
            }}
            autoFocus
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            rows={Math.min(18, Math.max(3, src.split("\n").length + 1))}
            className="block w-full resize-y rounded-btn border border-line-strong bg-card p-3 font-mono text-base leading-relaxed"
          />
        </div>
      ) : (
        <div className="relative">
          <div ref={host} />
          {props.placeholder && state && state.doc.childCount <= 1 && !state.doc.textContent && (
            <span aria-hidden="true" className="pointer-events-none absolute top-0 left-0 text-ink-muted">{props.placeholder}</span>
          )}
        </div>
      )}
      {v && state && src === null && <Floating view={v} blocks={blocks} />}
      <Bar
        view={src === null ? v : null}
        blocks={blocks}
        placement={placement}
        start={props.barStart}
        source={src !== null}
        canSource={!first.fallback}
        onSource={toggleSource}
        onCancel={cancel}
        onDone={finish}
        actions={props.actions !== false}
        run={run}
      />
    </div>
  );
}

// ---------------------------------------------------------------- 工具列

function Bar({ view, blocks, placement, start, source, canSource, onSource, onCancel, onDone, actions: withActions, run }: { view: EditorView | null; blocks: boolean; placement: string; start?: ReactNode; source: boolean; canSource: boolean; onSource: () => void; onCancel: () => void; onDone: () => void; actions: boolean; run: (c: Command) => () => void }) {
  const touch = useMemo(coarse, []);
  const [bottom, setBottom] = useState(0);
  const [focused, setFocused] = useState(false);
  // 觸控裝置：工具列貼在鍵盤上方（visualViewport 是鍵盤以外看得到的範圍）
  useEffect(() => {
    if (!touch) return;
    const vv = window.visualViewport;
    const place = () => vv && setBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    const focus = () => setFocused(!!document.activeElement?.closest?.("[data-editing]"));
    place();
    focus();
    vv?.addEventListener("resize", place);
    vv?.addEventListener("scroll", place);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", focus);
    return () => {
      vv?.removeEventListener("resize", place);
      vv?.removeEventListener("scroll", place);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", focus);
    };
  }, [touch]);
  const s = view?.state;
  const active = (name: string) => !!s && !!schema.marks[name] && (s.storedMarks ?? s.selection.$from.marks()).some((m) => m.type.name === name);
  const fmt = (name: string, labelText: string, c: Command, glyph: ReactNode) => (
    <button key={name} type="button" {...keepFocus} onClick={run(c)} aria-label={labelText} title={labelText} aria-pressed={active(name)} disabled={!view} className={cx("ed-tool", active(name) && "ed-tool-on")}>
      {glyph}
    </button>
  );
  const floating = touch && focused && placement !== "page";
  const tools = (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" data-noswipe>
      {start}
      {!source && (
        <>
          {fmt("strong", "粗體（⌘B）", cmd.strong, <b>B</b>)}
          {fmt("em", "斜體（⌘I）", cmd.em, <i className="font-serif">I</i>)}
          {fmt("underline", "底線（⌘U）", cmd.underline, <u>U</u>)}
          {fmt("math_inline", "公式（打 $…$）", cmd.math, <span className="font-serif italic">∑</span>)}
          {blocks && fmt("table", "表格（/表格）", cmd.table(), <Icon name="grid" size={18} />)}
          {blocks && fmt("bullet_list", "列點（打 - ）", cmd.bullet, <Icon name="list" size={18} />)}
          {blocks && fmt("ordered_list", "編號（打 1. ）", cmd.ordered, <span className="text-meta font-semibold">1.</span>)}
          {fmt("undo", "復原（⌘Z）", cmd.undo, <Icon name="undo" size={18} />)}
        </>
      )}
    </div>
  );
  const actions = (
    <div className="flex shrink-0 items-center gap-1">
      {canSource && (
        <button type="button" {...keepFocus} onClick={onSource} aria-pressed={source} className={cx("ed-tool px-2 text-meta", source && "ed-tool-on")} title="顯示原始碼（排版怪怪的時候檢查用）">
          原始碼
        </button>
      )}
      {withActions && (
        <>
          <Button variant="ghost" {...keepFocus} onClick={onCancel}>取消</Button>
          <Button variant="primary" {...keepFocus} onClick={onDone} title="完成（⌘Enter）">完成</Button>
        </>
      )}
    </div>
  );
  if (floating)
    return (
      <div className="ed-kbbar fixed inset-x-0 z-40 flex items-center gap-1 border-t border-line bg-card px-2 py-1" style={{ bottom }} data-noswipe>
        {tools}
        {actions}
      </div>
    );
  return (
    <div className={cx("mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2", placement === "page" && "sticky bottom-0 bg-card pb-2")}>
      {tools}
      {actions}
    </div>
  );
}

// ---------------------------------------------------------------- 浮出的小框：公式、原始碼區塊、表格、/ 選單

function relRect(view: EditorView, el: Element | null) {
  const root = view.dom.closest(".ed-box");
  if (!el || !root) return null;
  const r = el.getBoundingClientRect();
  const c = root.getBoundingClientRect();
  return { top: r.top - c.top, bottom: r.bottom - c.top, left: r.left - c.left, width: c.width };
}

function Floating({ view, blocks }: { view: EditorView; blocks: boolean }) {
  const s = view.state;
  const sel = s.selection;
  const slash = slashKey.getState(s);
  if (slash) return <SlashMenu view={view} blocks={blocks} />;
  if (sel instanceof NodeSelection && (sel.node.type === N.math_inline || sel.node.type === N.math_display || sel.node.type === N.raw_block))
    return <NodeBox key={sel.from} view={view} pos={sel.from} node={sel.node} />;
  if (isInTable(s)) return <TableBar view={view} />;
  return null;
}

function NodeBox({ view, pos, node }: { view: EditorView; pos: number; node: PMNode }) {
  const raw = node.type === N.raw_block;
  const display = node.type === N.math_display;
  const [text, setText] = useState<string>(raw ? node.attrs.src : node.attrs.tex);
  const ref = useRef<HTMLTextAreaElement>(null);
  const at = relRect(view, view.nodeDOM(pos) as Element | null);
  useEffect(() => {
    ref.current?.focus();
    const n = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(n, n);
  }, []);
  const set = (v: string) => {
    setText(v);
    const tr = view.state.tr.setNodeMarkup(pos, undefined, raw ? { src: v } : { tex: v });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    view.dispatch(tr);
  };
  const close = () => {
    const st = view.state;
    const n = st.doc.nodeAt(pos);
    let tr = st.tr;
    if (n && !text.trim()) tr = tr.delete(pos, pos + n.nodeSize);
    else if (n) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos + n.nodeSize)));
    view.dispatch(tr);
    view.focus();
  };
  if (!at) return null;
  return (
    <div className="ed-pop absolute z-30 w-[min(28rem,100%)] space-y-2 rounded-card border border-line bg-card p-3 shadow-pop" style={{ top: at.bottom + 6, left: Math.max(0, Math.min(at.left, at.width - 448)) }} data-noswipe>
      <label className="block text-meta font-medium text-ink-muted">
        {raw ? "原始碼（編輯器不認得的寫法，存檔時原樣寫回）" : display ? "獨立公式（LaTeX）" : "公式（LaTeX）"}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" && !e.shiftKey && !raw) || (e.key === "Enter" && (e.metaKey || e.ctrlKey)) || e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
          rows={raw ? Math.min(12, Math.max(3, text.split("\n").length + 1)) : 2}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          className="mt-1 block w-full resize-y rounded-btn border border-line-strong bg-card p-2 font-mono text-base leading-snug text-ink-strong"
        />
      </label>
      {!raw && (
        <div className="md md-tight min-h-8 overflow-x-auto rounded-btn bg-hover px-2 py-1" aria-live="polite" dangerouslySetInnerHTML={{ __html: text.trim() ? renderMath(text, display) : '<span class="text-meta text-ink-muted">打 LaTeX，這裡即時顯示</span>' }} />
      )}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={close}>完成</Button>
      </div>
    </div>
  );
}

function TableBar({ view }: { view: EditorView }) {
  const s = view.state;
  const { $from } = s.selection;
  let tablePos = -1;
  for (let d = $from.depth; d > 0; d--)
    if ($from.node(d).type === N.table) {
      tablePos = $from.before(d);
      break;
    }
  const at = relRect(view, tablePos >= 0 ? (view.nodeDOM(tablePos) as Element | null) : null);
  if (!at) return null;
  const run = (c: Command) => () => {
    c(view.state, view.dispatch, view);
    view.focus();
  };
  const align = (a: "left" | "center" | "right" | null): Command => (state, dispatch) => {
    const rect = selectedRect(state);
    if (!dispatch) return true;
    const tr = state.tr;
    for (let r = 0; r < rect.map.height; r++)
      for (let c = rect.left; c < rect.right; c++) {
        const p = rect.tableStart + rect.map.map[r * rect.map.width + c];
        const cell = tr.doc.nodeAt(p);
        if (cell) tr.setNodeMarkup(p, undefined, { ...cell.attrs, align: a });
      }
    dispatch(tr);
    return true;
  };
  const b = (labelText: string, c: Command, child: ReactNode) => (
    <button type="button" {...keepFocus} onClick={run(c)} title={labelText} aria-label={labelText} className="ed-tool px-2 text-meta whitespace-nowrap">
      {child}
    </button>
  );
  return (
    <div role="toolbar" aria-label="表格" className="ed-pop absolute z-30 flex max-w-full items-center gap-0.5 overflow-x-auto rounded-btn border border-line bg-card p-0.5 shadow-pop" style={{ top: at.top - 52, left: 0 }} data-noswipe>
      {b("上方插入列", addRowBefore, "↑ 加列")}
      {b("下方插入列", addRowAfter, "↓ 加列")}
      {b("左邊插入欄", addColumnBefore, "← 加欄")}
      {b("右邊插入欄", addColumnAfter, "→ 加欄")}
      {b("刪除這一列", deleteRow, "刪列")}
      {b("刪除這一欄", deleteColumn, "刪欄")}
      {b("靠左", align("left"), "靠左")}
      {b("置中", align("center"), "置中")}
      {b("靠右", align("right"), "靠右")}
      {b("刪除表格", deleteTable, <Icon name="trash" size={16} />)}
    </div>
  );
}

function SlashMenu({ view, blocks }: { view: EditorView; blocks: boolean }) {
  const st = slashKey.getState(view.state)!;
  const items = slashMatches(st.query, blocks);
  let at: { top: number; left: number } | null = null;
  try {
    const c = view.coordsAtPos(st.from);
    const root = view.dom.closest(".ed-box")!.getBoundingClientRect();
    at = { top: c.bottom - root.top + 4, left: Math.max(0, Math.min(c.left - root.left, root.width - 240)) };
  } catch {
    at = null;
  }
  if (!at) return null;
  return (
    <ul role="listbox" aria-label="插入" className="ed-pop absolute z-30 max-h-72 w-60 overflow-y-auto rounded-card border border-line bg-card p-1 shadow-pop" style={at}>
      {items.map((it, i) => (
        <li key={it.id} role="option" aria-selected={i === st.index}>
          <button type="button" {...keepFocus} onClick={() => pickSlash(view, it)} className={cx("flex min-h-(--tap) w-full items-center justify-between gap-3 rounded-btn px-3 text-left text-ui", i === st.index ? "bg-blue-light text-blue-ink" : "text-ink hover:bg-hover")}>
            <span>{it.label}</span>
            <span className="font-mono text-meta text-ink-muted">{it.hint}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
