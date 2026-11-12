// 貼上 AI 回覆（規格書 §9.4）：剪貼簿裡有帶格式的 HTML（從 ChatGPT、Claude、Gemini 網頁選取複製）時，
// 用 turndown 轉成 Markdown——標題、巢狀列點、表格、粗體保留；公式轉成 $…$／$$…$$。
// 純文字（或只是編輯器自帶上色的 HTML）原樣貼入。
//
// 公式來源三種：
// 1. KaTeX 排好的（ChatGPT、Claude）：<span class="katex"> 裡的 <annotation encoding="application/x-tex">
// 2. 有 data-math 屬性的（Gemini 等）
// 3. 文字裡的 \( … \)、\[ … \]、$…$、$$…$$
// 先把公式換成佔位字（只有英數字，不會被 turndown 跳脫），轉完再換回去。

import TurndownService from "turndown";
// @ts-expect-error 這個套件沒有型別
import { gfm } from "turndown-plugin-gfm";

const RICH = /<(p|ul|ol|li|h[1-6]|table|strong|em|b|i|pre|blockquote|code|br)\b|class="[^"]*katex/i;
const PH = (i: number) => `PMQMATH${i}X`;
const PH_RE = /PMQMATH(\d+)X/g;

function service(): TurndownService {
  const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*", strongDelimiter: "**" });
  td.use(gfm);
  td.remove(["style", "script", "button"]);
  // 列點寫成「- 」、子層縮排對齊內文（turndown 預設是「-   」）
  td.addRule("listItem", {
    filter: "li",
    replacement(content, node) {
      const parent = node.parentNode as HTMLElement | null;
      let prefix = "- ";
      if (parent?.nodeName === "OL") {
        const start = Number(parent.getAttribute("start") ?? 1);
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "\n").replace(/\n/gm, "\n" + " ".repeat(prefix.length));
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });
  return td;
}

/** 剪貼簿的 HTML 值得轉換嗎（有結構或公式）。 */
export function isRichHtml(html: string): boolean {
  return RICH.test(html);
}

/** 文字裡的 \( \)、\[ \] → $ $、$$ $$（code 區塊外）。 */
export function normalizeMathDelims(md: string): string {
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return parts
    .map((p, i) => (i % 2 ? p : p.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => `$$${t.trim()}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => `$${t.trim()}$`)))
    .join("");
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const math: { tex: string; display: boolean }[] = [];
  const hold = (tex: string, display: boolean) => {
    math.push({ tex: tex.trim(), display });
    return doc.createTextNode(PH(math.length - 1));
  };

  // 1. KaTeX（.katex-display 是獨立一行的公式）
  for (const el of Array.from(doc.querySelectorAll(".katex-display, .katex"))) {
    if (!el.isConnected) continue;
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    if (!ann) continue;
    const display = el.classList.contains("katex-display") || !!el.closest(".katex-display");
    const target = el.closest(".katex-display") ?? el;
    target.replaceWith(hold(ann.textContent ?? "", display));
  }
  // MathJax 3 的 <mjx-container> 帶 <math> 時沒有原始碼；有 data-latex 的話用它
  for (const el of Array.from(doc.querySelectorAll("[data-math], [data-latex], mjx-container[data-tex]"))) {
    if (!el.isConnected) continue;
    const tex = el.getAttribute("data-math") ?? el.getAttribute("data-latex") ?? el.getAttribute("data-tex") ?? "";
    if (!tex) continue;
    const display = el.tagName === "DIV" || el.getAttribute("display") === "block" || el.classList.contains("math-block");
    el.replaceWith(hold(tex, display));
  }
  // 3. 文字節點裡的分隔符號（不在 code／pre 裡）
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  const DELIM = /\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|(?<![\\$])\$([^$\n]+?)\$(?!\$)/g;
  for (const t of texts) {
    if (t.parentElement?.closest("code, pre")) continue;
    const s = t.data;
    if (!DELIM.test(s)) continue;
    DELIM.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of s.matchAll(DELIM)) {
      frag.append(s.slice(last, m.index));
      const display = m[1] !== undefined || m[2] !== undefined;
      frag.append(hold(m[1] ?? m[2] ?? m[3] ?? m[4] ?? "", display));
      last = m.index! + m[0].length;
    }
    frag.append(s.slice(last));
    t.replaceWith(frag);
  }

  // 4. 沒有表頭列的表格（Google 試算表、Excel 複製出來的）：第一列當表頭，才轉得成 Markdown 表格
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const first = table.rows[0];
    if (!first || Array.from(first.cells).every((c) => c.tagName === "TH")) continue;
    if (table.querySelector("[colspan],[rowspan]")) continue; // 合併儲存格：Markdown 表格表達不了，留著
    for (const c of Array.from(first.cells)) {
      const th = doc.createElement("th");
      th.innerHTML = c.innerHTML;
      c.replaceWith(th);
    }
    // gfm 外掛要表頭列在 <thead> 裡或是第一個 <tbody> 的第一列
    const head = doc.createElement("thead");
    head.appendChild(first);
    table.insertBefore(head, table.firstChild);
  }

  let md = service().turndown(doc.body.innerHTML);
  md = md.replace(PH_RE, (_, i) => {
    const m = math[Number(i)];
    return m.display ? `\n\n$$${m.tex}$$\n\n` : `$${m.tex}$`;
  });
  return md.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 編輯器的 paste 事件：回傳要插入的文字；null 表示照瀏覽器預設（純文字原樣貼入）。 */
export function pasteText(data: DataTransfer | null): string | null {
  if (!data) return null;
  const html = data.getData("text/html");
  if (html && isRichHtml(html)) {
    try {
      return htmlToMarkdown(html);
    } catch {
      return null;
    }
  }
  return null;
}
