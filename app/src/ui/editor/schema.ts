// RichEditor 的文件結構（ProseMirror schema）。不碰 DOM 以外的瀏覽器功能，node 測試也能載入。
//
// 每個節點都記下「寫回 Markdown 時要用的寫法」（列點符號、粗體用 ** 還是 __、換行是 \n 還是 <br>），
// 重新產生時才跟原文一致（規格書 §9.10 原始碼保留規則第 2 條）。

import { Schema, type MarkSpec, type NodeSpec } from "prosemirror-model";
import { tableNodes } from "prosemirror-tables";

const tables = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) => (dom as HTMLElement).dataset.align || null,
      setDOMAttr: (v, attrs) => {
        if (v) {
          attrs["data-align"] = v;
          attrs.class = `ta-${v}`;
        }
      },
    },
  },
});

const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  paragraph: {
    group: "block",
    content: "inline*",
    parseDOM: [{ tag: "p" }],
    toDOM: () => ["p", 0],
  },
  heading: {
    group: "block",
    content: "inline*",
    defining: true,
    attrs: { level: { default: 2 } },
    parseDOM: [1, 2, 3, 4, 5, 6].map((l) => ({ tag: `h${l}`, attrs: { level: l } })),
    toDOM: (n) => [`h${n.attrs.level}`, 0],
  },
  blockquote: {
    group: "block",
    content: "block+",
    defining: true,
    parseDOM: [{ tag: "blockquote" }],
    toDOM: () => ["blockquote", 0],
  },
  horizontal_rule: {
    group: "block",
    attrs: { markup: { default: "---" } },
    parseDOM: [{ tag: "hr" }],
    toDOM: () => ["hr"],
  },
  bullet_list: {
    group: "block",
    content: "list_item+",
    attrs: { tight: { default: true }, marker: { default: "-" } },
    parseDOM: [{ tag: "ul" }],
    toDOM: () => ["ul", 0],
  },
  ordered_list: {
    group: "block",
    content: "list_item+",
    attrs: { tight: { default: true }, start: { default: 1 }, delim: { default: "." } },
    parseDOM: [{ tag: "ol", getAttrs: (d) => ({ start: Number((d as HTMLElement).getAttribute("start") ?? 1) }) }],
    toDOM: (n) => (n.attrs.start === 1 ? ["ol", 0] : ["ol", { start: n.attrs.start }, 0]),
  },
  list_item: {
    content: "paragraph block*",
    defining: true,
    parseDOM: [{ tag: "li" }],
    toDOM: () => ["li", 0],
  },
  /** 編輯器不認得的語法：原樣保留（§9.10 第 3 條）。顯示排好的結果，點它可以改原始碼。 */
  raw_block: {
    group: "block",
    atom: true,
    selectable: true,
    attrs: { src: { default: "" } },
    toDOM: () => ["div", { class: "ed-raw" }],
  },
  /** 卡片的欄位小標 <div class="card-label">出處</div>（Anki 匯入時加的）：照樣顯示、不能改字、原樣寫回 */
  card_label: {
    group: "block",
    atom: true,
    selectable: false,
    attrs: { src: { default: "" }, text: { default: "" } },
    toDOM: (n) => ["div", { class: "card-label", contenteditable: "false" }, n.attrs.text],
  },
  ...tables,
  text: { group: "inline" },
  /** kind：soft＝原文的換行（breaks: true 也是 <br>）、html＝<br>、hard＝行尾兩個空白或反斜線 */
  hard_break: {
    inline: true,
    group: "inline",
    selectable: false,
    attrs: { kind: { default: "soft" } },
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },
  math_inline: {
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    attrs: { tex: { default: "" } },
    toDOM: () => ["span", { class: "ed-math" }],
  },
  /** $$…$$：閱讀頁也是在段落裡排成獨立一行，所以這裡是行內節點 */
  math_display: {
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    attrs: { tex: { default: "" } },
    toDOM: () => ["span", { class: "ed-math ed-math-d" }],
  },
  image: {
    inline: true,
    group: "inline",
    atom: true,
    draggable: false,
    attrs: { src: { default: "" }, alt: { default: "" }, title: { default: null } },
    toDOM: () => ["span", { class: "ed-img" }],
  },
};

const marks: Record<string, MarkSpec> = {
  link: {
    attrs: { href: { default: "" }, title: { default: null }, o: { default: 9 } },
    inclusive: false,
    parseDOM: [{ tag: "a[href]", getAttrs: (d) => ({ href: (d as HTMLElement).getAttribute("href") ?? "" }) }],
    toDOM: (m) => ["a", { href: m.attrs.href }, 0],
  },
  strong: {
    attrs: { delim: { default: "**" }, o: { default: 9 } },
    parseDOM: [{ tag: "strong" }, { tag: "b" }],
    toDOM: () => ["strong", 0],
  },
  em: {
    attrs: { delim: { default: "*" }, o: { default: 9 } },
    parseDOM: [{ tag: "em" }, { tag: "i" }],
    toDOM: () => ["em", 0],
  },
  strike: { attrs: { o: { default: 9 } }, parseDOM: [{ tag: "s" }, { tag: "del" }], toDOM: () => ["s", 0] },
  underline: { attrs: { o: { default: 9 } }, parseDOM: [{ tag: "u" }], toDOM: () => ["u", 0] },
  sup: { attrs: { o: { default: 9 } }, excludes: "sub", parseDOM: [{ tag: "sup" }], toDOM: () => ["sup", 0] },
  sub: { attrs: { o: { default: 9 } }, excludes: "sup", parseDOM: [{ tag: "sub" }], toDOM: () => ["sub", 0] },
  code: { code: true, parseDOM: [{ tag: "code" }], toDOM: () => ["code", 0] },
};

export const schema = new Schema({ nodes, marks });
