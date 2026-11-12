// 執行：cd app && node --experimental-strip-types --test src/ui/editor/markdown.test.ts
// 第 3B 階段：原始碼保留規則（規格書 §9.10）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { parseMarkdown, serializeBlock, serializeMarkdown } from "./markdown.ts";
import { schema } from "./schema.ts";

/** 在文件裡找第一個出現的字，換成另一段字 */
function replaceText(doc: PMNode, from: string, to: string): PMNode {
  let at = -1;
  doc.descendants((n, pos) => {
    if (at >= 0 || !n.isText) return at < 0;
    const i = n.text!.indexOf(from);
    if (i >= 0) at = pos + i;
    return false;
  });
  assert.ok(at >= 0, `找不到「${from}」`);
  const st = EditorState.create({ doc });
  const tr = st.tr.insertText(to, at, at + from.length);
  return tr.doc;
}

const diffLines = (a: string, b: string) => {
  const x = a.split("\n");
  const y = b.split("\n");
  assert.equal(x.length, y.length, "行數不同");
  return x.map((l, i) => (l === y[i] ? null : i)).filter((i) => i !== null);
};

test("沒改就逐字相同（各種寫法）", () => {
  for (const t of [
    "\n一段\n\n\n二段  \n",
    "* 星號列點\n* 第二項\n\n+ 加號",
    "1) 括號編號\n2) 第二\n\n| a|b |\n|-|:-:|\n|1|2|\n",
    "__粗__ _斜_ ~~刪~~ <u>底線</u> `code` $x^2$\n\n$$\n\\int\n$$",
    "> 引言\n>\n> 第二段",
    "<style>p{}</style>\n\n段落",
    "",
  ]) {
    const { doc, source } = parseMarkdown(t);
    assert.equal(serializeMarkdown(doc, source), t);
  }
});

test("改五段詳解的第三段一個字：只有那一行不同", () => {
  const t = "第一段 $a$\n\n第二段 **粗**\n\n第三段，第一行\n第三段 錯字 第二行\n第三段第三行\n\n* 第四段\n* 列點\n\n|表|格|\n|:---|---|\n|1|2|";
  const { doc, source } = parseMarkdown(t);
  const out = serializeMarkdown(replaceText(doc, "錯字", "對字"), source);
  assert.deepEqual(diffLines(t, out), [5]);
  assert.equal(out.split("\n")[5], "第三段 對字 第二行");
});

test("改表格一格：只有那一列不同，表頭與對齊列照原本的寫法", () => {
  const t = "|名稱|值|\n|:---|:-:|\n|甲|1|\n|乙|2|";
  const { doc, source } = parseMarkdown(t);
  const out = serializeMarkdown(replaceText(doc, "乙", "丙"), source);
  assert.deepEqual(diffLines(t, out), [3]);
  assert.equal(out.split("\n")[3], "| 丙 | 2 |");
});

test("改了又改回來：逐字相同", () => {
  const t = "* 項目 __粗__\n* 第二";
  const { doc, source } = parseMarkdown(t);
  const back = replaceText(replaceText(doc, "第二", "第三"), "第三", "第二");
  assert.equal(serializeMarkdown(back, source), t);
});

test("巢狀記號照原文的層次", () => {
  for (const t of ["<u>***字***</u>", "***<u>字</u>***", "*except **RBC***", "<u>甲 ***乙*** 丙</u>"]) {
    const { source } = parseMarkdown(t);
    assert.equal(source.blocks[0].raw, false, t);
    // 強迫重新產生：不給原文
    assert.equal(serializeBlock(source.blocks[0].node), t);
  }
});

test("讀不懂的區塊原樣保留，改別的區塊後仍逐字不變", () => {
  const t = '<style>\n.a{color:red}\n</style>\n\n<table><tr><td colspan="2">合併</td></tr></table>\n\n![圖](fig:K1 "寬")\n\n要改的字\n\n[sound:m/' + "a".repeat(64) + ".mp3]";
  const { doc, source } = parseMarkdown(t);
  assert.equal(source.blocks.filter((b) => b.raw).length, 2);
  const out = serializeMarkdown(replaceText(doc, "要改的字", "改好的字"), source);
  assert.equal(out, t.replace("要改的字", "改好的字"));
});

test("跳脫：新打的字裡有語法符號，排出來仍是原本的字", () => {
  const { doc, source } = parseMarkdown("一段");
  const out = serializeMarkdown(replaceText(doc, "一段", "# 不是標題 *不是斜體* $不是公式$ 1. a_b_c [x](y)"), source);
  assert.equal(out, "\\# 不是標題 \\*不是斜體\\* \\$不是公式\\$ 1. a_b_c \\[x\\](y)");
});

test("新文件（沒有原文）：Typora 的寫法", () => {
  const p = (s: string) => schema.nodes.paragraph.create(null, s ? schema.text(s) : null);
  const li = (s: string) => schema.nodes.list_item.create(null, p(s));
  const cell = (s: string, h = false) => schema.nodes[h ? "table_header" : "table_cell"].create(null, p(s));
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.heading.create({ level: 3 }, schema.text("標題")),
    schema.nodes.bullet_list.create(null, [li("一"), schema.nodes.list_item.create(null, [p("二"), schema.nodes.ordered_list.create(null, [li("甲"), li("乙")])])]),
    schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [cell("欄一", true), cell("欄二", true)]), schema.nodes.table_row.create(null, [cell("a|b"), cell("")])]),
  ]);
  assert.equal(serializeMarkdown(doc), "### 標題\n\n- 一\n- 二\n  1. 甲\n  2. 乙\n\n| 欄一 | 欄二 |\n| --- | --- |\n| a\\|b |  |");
  // 游標放得進去（給編輯器用）
  assert.ok(TextSelection.atStart(doc));
});
