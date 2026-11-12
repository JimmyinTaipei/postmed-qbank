// RichEditor 的打字規則、快捷鍵與插入指令（規格書 §9.10「打字時的行為」）。

import { baseKeymap, chainCommands, setBlockType, toggleMark, wrapIn } from "prosemirror-commands";
import { redo, undo } from "prosemirror-history";
import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType, Node as PMNode } from "prosemirror-model";
import { liftListItem, sinkListItem, splitListItem, wrapInList } from "prosemirror-schema-list";
import { NodeSelection, Selection, TextSelection, type Command, type EditorState, type Plugin } from "prosemirror-state";
import { addRowAfter, goToNextCell, isInTable } from "prosemirror-tables";
import { schema } from "./schema";

const N = schema.nodes;
const M = schema.marks;

// ---------------------------------------------------------------- 插入

/** 在游標處插入一個公式並選起來（開 LaTeX 小框） */
export function insertMath(display: boolean): Command {
  return (state, dispatch) => {
    const type = display ? N.math_display : N.math_inline;
    const { $from } = state.selection;
    if (!$from.parent.inlineContent || !$from.parent.type.contentMatch.matchType(type)) return false;
    if (dispatch) {
      const text = state.selection.empty ? "" : state.doc.textBetween(state.selection.from, state.selection.to, " ");
      const tr = state.tr.replaceSelectionWith(type.create({ tex: text }));
      const pos = tr.selection.from - 1;
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** 3 欄 2 列（第一列是表頭）的表格 */
export function makeTable(cols = 3, rows = 2): PMNode {
  const cell = (h: boolean) => N[h ? "table_header" : "table_cell"].create(null, N.paragraph.create());
  return N.table.create(
    null,
    Array.from({ length: rows }, (_, r) => N.table_row.create(null, Array.from({ length: cols }, () => cell(r === 0)))),
  );
}

/** 插入一個區塊（表格、分隔線）：空段落就換掉它，不然接在這一段後面；游標放進新區塊 */
export function insertBlock(node: PMNode): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if ($from.depth < 1 || isInTable(state)) return false;
    const para = $from.parent;
    if (!dispatch) return true;
    const tr = state.tr;
    let at: number;
    if (para.type === N.paragraph && para.content.size === 0) {
      at = $from.before();
      tr.replaceWith(at, $from.after(), node);
    } else {
      at = $from.after();
      tr.insert(at, node);
    }
    // 後面沒有東西時補一個空段落，游標才出得去
    const after = at + node.nodeSize;
    if (after >= tr.doc.content.size || !tr.doc.resolve(after).nodeAfter) {
      if (tr.doc.resolve(after).parent.type.contentMatch.matchType(N.paragraph)) tr.insert(after, N.paragraph.create());
    }
    tr.setSelection(Selection.near(tr.doc.resolve(at + 1)));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export const cmd = {
  strong: toggleMark(M.strong),
  em: toggleMark(M.em),
  underline: toggleMark(M.underline),
  strike: toggleMark(M.strike),
  code: toggleMark(M.code),
  heading: (level: number) => setBlockType(N.heading, { level }),
  paragraph: setBlockType(N.paragraph),
  bullet: wrapInList(N.bullet_list),
  ordered: wrapInList(N.ordered_list),
  quote: wrapIn(N.blockquote),
  table: () => insertBlock(makeTable()),
  rule: () => insertBlock(N.horizontal_rule.create()),
  math: insertMath(false),
  mathBlock: insertMath(true),
  undo,
  redo,
};

// ---------------------------------------------------------------- 打字規則

/** **字** → 粗體這類：打完結尾的記號那一刻換掉 */
function markRule(re: RegExp, type: MarkType): InputRule {
  return new InputRule(re, (state, match, start, end) => {
    const text = match[1];
    const $s = state.doc.resolve(start);
    if ($s.parent.type.spec.code || state.doc.rangeHasMark(start, end, M.code)) return null;
    const marks = $s.marks().filter((m) => m.type !== type);
    const tr = state.tr.replaceWith(start, end, schema.text(text, [...marks, type.create()]));
    tr.removeStoredMark(type);
    return tr;
  });
}

function mathRule(): InputRule {
  // $x^2$：第二個 $ 打下去變成排好的公式（$$ 不算；前一個字是 \ 的 $ 不算）
  return new InputRule(/(?<![$\\])\$([^$\s](?:[^$]*[^$\s\\])?)\$$/, (state, match, start, end) => {
    if (state.doc.rangeHasMark(start, end, M.code)) return null;
    return state.tr.replaceWith(start, end, N.math_inline.create({ tex: match[1] }));
  });
}

function ruleRule(): InputRule {
  // 空段落打 ---：分隔線
  return new InputRule(/^---$/, (state, _m, start) => {
    const $s = state.doc.resolve(start);
    if ($s.parent.type !== N.paragraph || $s.depth !== 1) return null;
    const from = $s.before();
    const tr = state.tr.replaceWith(from, $s.after(), [N.horizontal_rule.create(), N.paragraph.create()]);
    tr.setSelection(TextSelection.create(tr.doc, from + 2));
    return tr;
  });
}

export interface RuleOptions {
  /** 可以打出標題、清單等區塊（就地編輯標題或列點時不行） */
  blocks: boolean;
}

export function rules(o: RuleOptions): Plugin {
  const list: InputRule[] = [
    markRule(/(?<![*\\])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, M.strong),
    markRule(/(?<![*\\])\*([^*\s](?:[^*]*[^*\s])?)\*(?!\*)$/, M.em),
    markRule(/(?<![`\\])`([^`]+)`$/, M.code),
    markRule(/(?<![~\\])~~([^~\s](?:[^~]*[^~\s])?)~~$/, M.strike),
    mathRule(),
  ];
  if (o.blocks)
    list.push(
      textblockTypeInputRule(/^(#{1,4})\s$/, N.heading, (m) => ({ level: m[1].length })),
      wrappingInputRule(/^\s*[-*]\s$/, N.bullet_list),
      wrappingInputRule(/^(\d+)\.\s$/, N.ordered_list, (m) => ({ start: Number(m[1]) }), (m, n) => n.childCount + n.attrs.start === Number(m[1])),
      wrappingInputRule(/^\s*>\s$/, N.blockquote),
      ruleRule(),
    );
  return inputRules({ rules: list });
}

// ---------------------------------------------------------------- 快捷鍵

const inCell = (state: EditorState) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type.name;
    if (t === "table_cell" || t === "table_header") return true;
  }
  return false;
};

/** 換行（不分段）：儲存格裡存成 <br>，其他地方存成原文的換行 */
const hardBreak: Command = (state, dispatch) => {
  if (dispatch) dispatch(state.tr.replaceSelectionWith(N.hard_break.create({ kind: inCell(state) ? "<br>" : "soft" })).scrollIntoView());
  return true;
};

/** 整段只有 $$ 時按 Enter：獨立一行的公式 */
const dollarEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parent.type !== N.paragraph || $from.parent.textContent !== "$$") return false;
  if (dispatch) {
    const start = $from.start();
    const tr = state.tr.replaceWith(start, $from.end(), N.math_display.create({ tex: "" }));
    tr.setSelection(NodeSelection.create(tr.doc, start));
    dispatch(tr);
  }
  return true;
};

/** 表格：Tab 到下一格；最後一格 Tab 加一列 */
const tableTab: Command = (state, dispatch, view) => {
  if (!isInTable(state)) return false;
  if (goToNextCell(1)(state, dispatch)) return true;
  if (!dispatch || !view) return true;
  addRowAfter(state, dispatch);
  return goToNextCell(1)(view.state, view.dispatch);
};

/** 標題、清單開頭按 Backspace：先變回一般段落 */
const backspaceAtStart: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;
  if ($from.parent.type === N.heading) return setBlockType(N.paragraph)(state, dispatch);
  return false;
};

export interface KeyOptions {
  blocks: boolean;
  onDone: () => void;
  onEscape: () => boolean;
}

export function keys(o: KeyOptions): Plugin[] {
  return [
    keymap({
      "Mod-z": undo,
      "Shift-Mod-z": redo,
      "Mod-y": redo,
      "Mod-b": cmd.strong,
      "Mod-i": cmd.em,
      "Mod-u": cmd.underline,
      "Mod-e": cmd.code,
      "Mod-Shift-x": cmd.strike,
      "Mod-Enter": () => (o.onDone(), true),
      Escape: () => o.onEscape(),
      "Shift-Enter": hardBreak,
      Enter: chainCommands(dollarEnter, (s, d) => (inCell(s) ? hardBreak(s, d) : false), splitListItem(N.list_item)),
      Tab: chainCommands(tableTab, sinkListItem(N.list_item), () => true),
      "Shift-Tab": chainCommands(goToNextCell(-1), liftListItem(N.list_item), () => true),
      Backspace: o.blocks ? backspaceAtStart : () => false,
    }),
    keymap(baseKeymap),
  ];
}
