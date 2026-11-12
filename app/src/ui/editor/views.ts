// 編輯器裡公式、圖、原始碼區塊、表格的顯示（ProseMirror NodeView）。外觀和閱讀頁一樣：用同一個排版程式。

import type { Node as PMNode } from "prosemirror-model";
import type { EditorView, NodeView } from "prosemirror-view";
import { content, type Fig } from "@/data";
import { renderMarkdown, renderMath } from "../content/render";

export interface ViewOptions {
  figs?: Fig[];
  role?: Fig["role"];
}

class MathView implements NodeView {
  dom: HTMLElement;
  private tex = "";
  constructor(private node: PMNode) {
    this.dom = document.createElement("span");
    this.dom.className = node.type.name === "math_display" ? "ed-math ed-math-d" : "ed-math";
    this.render(node);
  }
  private render(node: PMNode) {
    const tex = node.attrs.tex as string;
    if (tex === this.tex && this.dom.childNodes.length) return;
    this.tex = tex;
    const display = node.type.name === "math_display";
    if (!tex.trim()) {
      this.dom.innerHTML = `<span class="ed-math-empty">${display ? "獨立公式" : "公式"}</span>`;
      return;
    }
    this.dom.innerHTML = renderMath(tex, display);
    this.dom.title = tex;
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render(node);
    return true;
  }
  ignoreMutation() {
    return true;
  }
  stopEvent() {
    return false;
  }
}

class ImageView implements NodeView {
  dom: HTMLElement;
  constructor(node: PMNode, o: ViewOptions) {
    this.dom = document.createElement("span");
    this.dom.className = "ed-img";
    const html = renderMarkdown(`![${node.attrs.alt}](${node.attrs.src})`, { figs: o.figs, role: o.role, assetUrl: content.assetUrl });
    this.dom.innerHTML = html.replace(/^\s*<p[^>]*>|<\/p>\s*$/g, "") || `<span class="ed-raw-tag">圖：${node.attrs.alt || node.attrs.src}</span>`;
  }
  ignoreMutation() {
    return true;
  }
}

/** 讀不懂的區塊：顯示排好的結果＋「原始碼」標籤；選起來時下方開小框改原始碼。 */
class RawView implements NodeView {
  dom: HTMLElement;
  private src = "";
  constructor(
    private node: PMNode,
    private o: ViewOptions,
  ) {
    this.dom = document.createElement("div");
    this.dom.className = "ed-raw";
    this.render(node);
  }
  private render(node: PMNode) {
    if (node.attrs.src === this.src) return;
    this.src = node.attrs.src;
    const html = renderMarkdown(this.src, { figs: this.o.figs, role: this.o.role, assetUrl: content.assetUrl });
    this.dom.innerHTML = `<span class="ed-raw-tag" contenteditable="false">原始碼・點一下修改</span><div class="ed-raw-body">${html || '<span class="ed-raw-tag">（閱讀頁不顯示的設定，例如列印格式）</span>'}</div>`;
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render(node);
    return true;
  }
  ignoreMutation() {
    return true;
  }
}

/** 表格外面包一層可橫向捲動的容器（和閱讀頁一樣） */
class TableView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  constructor(private node: PMNode) {
    this.dom = document.createElement("div");
    this.dom.className = "md-scroll ed-table";
    this.dom.setAttribute("data-noswipe", "");
    const table = document.createElement("table");
    this.contentDOM = document.createElement("tbody");
    table.appendChild(this.contentDOM);
    this.dom.appendChild(table);
  }
  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    return true;
  }
  ignoreMutation(m: MutationRecord | { type: "selection"; target: Node }) {
    return m.type === "attributes" && (m.target === this.dom || m.target === this.dom.firstChild);
  }
}

export function nodeViews(o: ViewOptions): Record<string, (node: PMNode, view: EditorView, getPos: () => number | undefined) => NodeView> {
  return {
    math_inline: (n) => new MathView(n),
    math_display: (n) => new MathView(n),
    image: (n) => new ImageView(n, o),
    raw_block: (n) => new RawView(n, o),
    table: (n) => new TableView(n),
  };
}
