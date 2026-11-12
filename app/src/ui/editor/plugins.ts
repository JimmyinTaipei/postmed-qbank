// RichEditor 的外掛：/ 插入選單、貼上（AI 回答、試算表、Markdown 原文）、就地編輯標題或列點時限制文件的形狀。

import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type Command, type EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { pasteText } from "../content/paste";
import { cmd } from "./commands";
import { markdownToFragment } from "./markdown";
import { schema } from "./schema";

const N = schema.nodes;

// ---------------------------------------------------------------- / 選單

export interface SlashItem {
  id: string;
  label: string;
  hint: string;
  keys: string;
  run: Command;
  blocks?: boolean;
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: "table", label: "表格", hint: "3 欄 2 列", keys: "table biaoge 表", run: cmd.table(), blocks: true },
  { id: "math", label: "公式", hint: "行內 $…$", keys: "math gongshi latex 公式", run: cmd.math },
  { id: "mathb", label: "獨立公式", hint: "自成一行 $$…$$", keys: "math display block 公式", run: cmd.mathBlock },
  { id: "h2", label: "大標", hint: "##", keys: "h2 heading 標題", run: cmd.heading(2), blocks: true },
  { id: "h3", label: "中標", hint: "###", keys: "h3 heading 標題", run: cmd.heading(3), blocks: true },
  { id: "h4", label: "小標", hint: "####", keys: "h4 heading 標題", run: cmd.heading(4), blocks: true },
  { id: "ul", label: "列點", hint: "- ", keys: "list bullet liedian 列點", run: cmd.bullet, blocks: true },
  { id: "ol", label: "編號", hint: "1. ", keys: "ordered number bianhao 編號", run: cmd.ordered, blocks: true },
  { id: "quote", label: "引言", hint: "> ", keys: "quote yinyan 引言", run: cmd.quote, blocks: true },
  { id: "hr", label: "分隔線", hint: "---", keys: "hr rule divider 分隔", run: cmd.rule(), blocks: true },
];

export interface SlashState {
  /** "/" 的位置 */
  from: number;
  query: string;
  index: number;
}

export const slashKey = new PluginKey<SlashState | null>("slash");

export function slashMatches(query: string, blocks: boolean): SlashItem[] {
  const q = query.trim().toLowerCase();
  return SLASH_ITEMS.filter((it) => (blocks || !it.blocks) && (!q || it.label.includes(q) || it.keys.toLowerCase().includes(q)));
}

function runSlash(view: EditorView, st: SlashState, it: SlashItem) {
  const { state } = view;
  // 先刪掉打的「/查詢字」
  view.dispatch(state.tr.delete(st.from, st.from + 1 + st.query.length).setMeta(slashKey, null));
  it.run(view.state, view.dispatch, view);
  view.focus();
}

export function slashPlugin(blocks: boolean): Plugin<SlashState | null> {
  return new Plugin<SlashState | null>({
    key: slashKey,
    state: {
      init: () => null,
      apply(tr, prev, _old, next) {
        const meta = tr.getMeta(slashKey);
        if (meta !== undefined) return meta;
        if (!prev) return null;
        const from = tr.mapping.map(prev.from);
        const head = next.selection.head;
        if (!next.selection.empty || head <= from || next.doc.textBetween(from, Math.min(from + 1, next.doc.content.size)) !== "/") return null;
        const query = next.doc.textBetween(from + 1, head);
        if (/\s/.test(query) || query.length > 12 || !slashMatches(query, blocks).length) return null;
        return { from, query, index: query === prev.query ? prev.index : 0 };
      },
    },
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== "/") return false;
        const $f = view.state.doc.resolve(from);
        const before = $f.parent.textBetween(0, $f.parentOffset);
        if (before && !/\s$/.test(before)) return false;
        if (!$f.parent.inlineContent) return false;
        view.dispatch(view.state.tr.insertText("/", from, to).setMeta(slashKey, { from, query: "", index: 0 }));
        return true;
      },
      handleKeyDown(view, e) {
        const st = slashKey.getState(view.state);
        if (!st) return false;
        const items = slashMatches(st.query, blocks);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const d = e.key === "ArrowDown" ? 1 : -1;
          view.dispatch(view.state.tr.setMeta(slashKey, { ...st, index: (st.index + d + items.length) % items.length }));
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          const it = items[st.index];
          if (it) runSlash(view, st, it);
          return true;
        }
        if (e.key === "Escape") {
          view.dispatch(view.state.tr.setMeta(slashKey, null));
          return true;
        }
        return false;
      },
    },
  });
}

export function pickSlash(view: EditorView, it: SlashItem) {
  const st = slashKey.getState(view.state);
  if (st) runSlash(view, st, it);
}

// ---------------------------------------------------------------- 貼上

/** 純文字裡的 Tab 分隔表格（Excel、Numbers 只給純文字時）→ Markdown 表格 */
function tsvTable(text: string): string | null {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (lines.length < 2 || !lines.every((l) => l.includes("\t"))) return null;
  const rows = lines.map((l) => l.split("\t").map((c) => c.trim().replace(/\|/g, "\\|")));
  const n = Math.max(...rows.map((r) => r.length));
  const row = (r: string[]) => "| " + Array.from({ length: n }, (_, i) => r[i] || " ").join(" | ") + " |";
  return [row(rows[0]), "| " + Array(n).fill("---").join(" | ") + " |", ...rows.slice(1).map(row)].join("\n");
}

/** 只留文字（貼進表格的一格、或就地編輯標題時） */
function flatten(frag: Fragment): Fragment {
  const out: PMNode[] = [];
  frag.descendants((n) => {
    if (n.isTextblock) {
      if (out.length) out.push(N.hard_break.create({ kind: "<br>" }));
      n.forEach((c) => out.push(c.type === N.hard_break ? N.hard_break.create({ kind: "<br>" }) : c));
      return false;
    }
    return true;
  });
  return Fragment.from(out);
}

/** 貼上的列點：每項只有一段文字（加子列點）時改成緊密列點（AI 回答的 <li><p> 不會變成中間空一行） */
function tighten(frag: Fragment): Fragment {
  const out: PMNode[] = [];
  frag.forEach((n) => {
    let c = n.isLeaf ? n : n.copy(tighten(n.content));
    if (isList(c)) {
      let ok = true;
      c.forEach((li) => { if (li.childCount > 2 || (li.childCount === 2 && !isList(li.child(1)))) ok = false; });
      if (ok && !c.attrs.tight) c = c.type.create({ ...c.attrs, tight: true }, c.content, c.marks);
    }
    out.push(c);
  });
  return Fragment.from(out);
}

export function pastePlugin(opts: { blocks: boolean }): Plugin {
  return new Plugin({
    props: {
      handlePaste(view, event) {
        const data = event.clipboardData;
        if (!data) return false;
        // 從編輯器自己複製的：ProseMirror 自己處理
        if ((data.getData("text/html") ?? "").includes("data-pm-slice")) return false;
        let md = pasteText(data);
        if (md === null) {
          const text = data.getData("text/plain");
          if (!text) return false;
          md = tsvTable(text) ?? text;
        }
        let frag = tighten(markdownToFragment(md));
        const { $from } = view.state.selection;
        const role = $from.depth > 0 ? $from.node($from.depth - 1).type.spec.tableRole : null;
        const cell = role === "cell" || role === "header_cell";
        const single = frag.childCount === 1 && frag.firstChild!.type === N.paragraph;
        if (cell || !opts.blocks || single) {
          frag = single && !cell ? frag.firstChild!.content : flatten(frag);
          view.dispatch(view.state.tr.replaceSelection(new Slice(frag, 0, 0)).scrollIntoView());
          return true;
        }
        view.dispatch(view.state.tr.replaceSelection(Slice.maxOpen(frag)).scrollIntoView());
        return true;
      },
    },
  });
}

// ---------------------------------------------------------------- 文件的形狀

const isList = (n: PMNode | null | undefined) => !!n && (n.type === N.bullet_list || n.type === N.ordered_list);

/** 就地編輯一個列點：這個列點本身，加上最多一個新列點（下面同一層或第一個子項） */
export function listItemShapeOk(doc: PMNode): boolean {
  if (doc.childCount !== 1 || !isList(doc.firstChild)) return false;
  const list = doc.firstChild!;
  if (list.childCount > 2) return false;
  const i0 = list.firstChild!;
  if (i0.firstChild?.type !== N.paragraph) return false;
  if (list.childCount === 2) return i0.childCount === 1 && list.child(1).childCount === 1;
  if (i0.childCount === 1) return true;
  if (i0.childCount > 2) return false;
  const sub = i0.child(1);
  return isList(sub) && sub.childCount === 1 && sub.firstChild!.childCount === 1;
}

export function shapePlugin(ok: (doc: PMNode) => boolean, onRefuse: () => void): Plugin {
  let last = 0;
  return new Plugin({
    filterTransaction(tr: { docChanged: boolean; doc: PMNode }, _state: EditorState) {
      if (!tr.docChanged || ok(tr.doc)) return true;
      if (Date.now() - last > 1500) {
        last = Date.now();
        onRefuse();
      }
      return false;
    },
  });
}
