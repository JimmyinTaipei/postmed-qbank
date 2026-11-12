// Markdown ⇄ 編輯器文件（規格書 §9.10「不能改壞主檔：原始碼保留規則」）。node 測試直接載入這個檔。
//
// 讀入：和閱讀頁同一個 markdown-it、同一套公式判定（md-core.ts）。每個最上層區塊記下原本的那幾行。
//       每個區塊讀進來後立刻「重新產生一次」自我檢查：排出來的 HTML 和原文不同 → 這個區塊改成原始碼區塊
//       （看得到排好的結果，點它改原始碼；存檔原樣寫回）。寧可一塊不能所見即所得，也不能悄悄改掉東西。
// 寫出：沒改到的最上層區塊把原本那幾行原樣貼回去；改到的區塊重新產生，再逐行比對，沒變的行也用原文。
//       打開又關掉、改了又改回來 → 與原文逐字相同。

import { Fragment, type Mark, Node as PMNode } from "prosemirror-model";
import type { Token } from "markdown-it";
import { extractMath, md, renderForCompare, restoreMath, type MathPiece } from "../content/md-core.ts";
import { schema } from "./schema.ts";

class Unsupported extends Error {}

/** 卡片的欄位小標（anki_import 加的） */
const CARD_LABEL = /^<div class="card-label">([^<>\n]*)<\/div>$/;

// ---------------------------------------------------------------- 讀入

interface Ctx {
  maths: MathPiece[];
}

function inlineNodes(children: Token[] | null, ctx: Ctx): PMNode[] {
  const out: PMNode[] = [];
  let marks: readonly Mark[] = [];
  const push = (m: Mark) => (marks = m.addToSet(marks));
  const pop = (name: string) => (marks = marks.filter((m) => m.type.name !== name));
  const text = (s: string) => {
    // 公式佔位字 → 公式節點
    const parts = s.split(/@@M(\d+)@@/);
    parts.forEach((p, k) => {
      if (k % 2 === 0) {
        if (p) out.push(schema.text(p, marks));
        return;
      }
      const m = ctx.maths[Number(p)];
      if (!m) throw new Unsupported("math");
      out.push(schema.nodes[m.display ? "math_display" : "math_inline"].create({ tex: m.tex }, null, marks));
    });
  };
  for (const t of children ?? []) {
    switch (t.type) {
      case "text":
        text(t.content);
        break;
      case "softbreak":
        out.push(schema.nodes.hard_break.create({ kind: "soft" }, null, marks));
        break;
      case "hardbreak":
        out.push(schema.nodes.hard_break.create({ kind: "hard" }, null, marks));
        break;
      case "strong_open":
        push(schema.marks.strong.create({ delim: t.markup, o: marks.length }));
        break;
      case "strong_close":
        pop("strong");
        break;
      case "em_open":
        push(schema.marks.em.create({ delim: t.markup, o: marks.length }));
        break;
      case "em_close":
        pop("em");
        break;
      case "s_open":
        push(schema.marks.strike.create({ o: marks.length }));
        break;
      case "s_close":
        pop("strike");
        break;
      case "link_open":
        push(schema.marks.link.create({ href: t.attrGet("href") ?? "", title: t.attrGet("title"), o: marks.length }));
        break;
      case "link_close":
        pop("link");
        break;
      case "code_inline":
        if (t.content) out.push(schema.text(t.content, schema.marks.code.create().addToSet(marks)));
        break;
      case "image":
        out.push(schema.nodes.image.create({ src: t.attrGet("src") ?? "", alt: t.content, title: t.attrGet("title") }, null, marks));
        break;
      case "html_inline": {
        const tag = t.content.trim().toLowerCase();
        if (/^<br\s*\/?>$/.test(tag)) out.push(schema.nodes.hard_break.create({ kind: t.content }, null, marks));
        else if (tag === "<u>") push(schema.marks.underline.create({ o: marks.length }));
        else if (tag === "</u>") pop("underline");
        else if (tag === "<sup>") push(schema.marks.sup.create({ o: marks.length }));
        else if (tag === "</sup>") pop("sup");
        else if (tag === "<sub>") push(schema.marks.sub.create({ o: marks.length }));
        else if (tag === "</sub>") pop("sub");
        else throw new Unsupported("html_inline");
        break;
      }
      default:
        throw new Unsupported(t.type);
    }
  }
  return out;
}

/** tokens[i] 開始的一個區塊 → [節點, 下一個 token 的位置] */
function blockNode(tokens: Token[], i: number, ctx: Ctx): [PMNode, number] {
  const t = tokens[i];
  const until = (close: string) => {
    const kids: PMNode[] = [];
    let j = i + 1;
    while (j < tokens.length && !(tokens[j].type === close && tokens[j].level === t.level)) {
      const [n, k] = blockNode(tokens, j, ctx);
      kids.push(n);
      j = k;
    }
    return [kids, j + 1] as const;
  };
  switch (t.type) {
    case "paragraph_open":
      return [schema.nodes.paragraph.create(null, inlineNodes(tokens[i + 1].children, ctx)), i + 3];
    case "heading_open":
      if (t.markup !== "#".repeat(t.markup.length)) throw new Unsupported("setext");
      return [schema.nodes.heading.create({ level: Number(t.tag.slice(1)) }, inlineNodes(tokens[i + 1].children, ctx)), i + 3];
    case "blockquote_open": {
      const [kids, j] = until("blockquote_close");
      return [schema.nodes.blockquote.create(null, kids), j];
    }
    case "bullet_list_open":
    case "ordered_list_open": {
      const ordered = t.type === "ordered_list_open";
      const [kids, j] = until(ordered ? "ordered_list_close" : "bullet_list_close");
      // markdown-it 把緊湊清單裡的段落標成 hidden
      const p = tokens.slice(i, j).find((x) => x.type === "paragraph_open" && x.level === t.level + 2);
      const tight = p ? p.hidden : true;
      const attrs = ordered ? { tight, start: Number(t.attrGet("start") ?? 1), delim: t.markup } : { tight, marker: t.markup };
      return [schema.nodes[ordered ? "ordered_list" : "bullet_list"].create(attrs, kids), j];
    }
    case "list_item_open": {
      const [kids, j] = until("list_item_close");
      if (!kids.length || kids[0].type.name !== "paragraph") throw new Unsupported("list_item");
      return [schema.nodes.list_item.create(null, kids), j];
    }
    case "hr":
      return [schema.nodes.horizontal_rule.create({ markup: t.markup }), i + 1];
    case "html_block": {
      const m = CARD_LABEL.exec(t.content.replace(/\n+$/, ""));
      if (m) return [schema.nodes.card_label.create({ src: restoreMath(t.content.replace(/\n+$/, ""), ctx.maths), text: m[1] }), i + 1];
      throw new Unsupported(t.type);
    }
    case "table_open": {
      const rows: PMNode[] = [];
      let j = i + 1;
      let row: PMNode[] = [];
      for (; tokens[j].type !== "table_close"; j++) {
        const x = tokens[j];
        if (x.type === "tr_open") row = [];
        else if (x.type === "tr_close") rows.push(schema.nodes.table_row.create(null, row));
        else if (x.type === "th_open" || x.type === "td_open") {
          const align = /text-align:(left|center|right)/.exec(String(x.attrGet("style") ?? ""))?.[1] ?? null;
          const para = schema.nodes.paragraph.create(null, inlineNodes(tokens[j + 1].children, ctx));
          row.push(schema.nodes[x.type === "th_open" ? "table_header" : "table_cell"].create({ align }, para));
          j += 2;
        }
      }
      return [schema.nodes.table.create(null, rows), j + 1];
    }
    default:
      // html_block、code_block、fence……
      throw new Unsupported(t.type);
  }
}

/** 一個最上層區塊的原文與讀進來的節點。 */
export interface SourceBlock {
  /** 原文（多行用 \n 接） */
  src: string;
  node: PMNode;
  /** 讀不懂或自我檢查不過，用原始碼區塊顯示 */
  raw: boolean;
}

export interface Source {
  text: string;
  /** gaps[k] 是第 k 個區塊前面的行（區塊之間的空行）；gaps 比 blocks 多一個（最後面的行） */
  gaps: string[][];
  blocks: SourceBlock[];
}

/** Markdown → 編輯器文件＋原文對照。 */
export function parseMarkdown(text: string): { doc: PMNode; source: Source } {
  const { src, maths } = extractMath(text);
  const ctx: Ctx = { maths };
  const tokens = md.parse(src, {});
  const lines = src.split("\n");
  const gaps: string[][] = [];
  const blocks: SourceBlock[] = [];
  let at = 0;
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i];
    // 找到這個最上層區塊的結尾 token
    let j = i + 1;
    if (t.nesting === 1) {
      let depth = 1;
      while (depth > 0) {
        depth += tokens[j].nesting;
        j++;
      }
    } else if (t.type === "inline") {
      j = i + 1;
    }
    const [a, b] = t.map ?? [at, at];
    gaps.push(lines.slice(at, a).map((l) => restoreMath(l, maths)));
    const blockText = restoreMath(lines.slice(a, b).join("\n"), maths);
    at = b;
    let node: PMNode | null = null;
    try {
      const [n] = blockNode(tokens, i, ctx);
      // 自我檢查：重新產生的寫法排出來要和原文一樣
      if (renderForCompare(serializeBlock(n)) === renderForCompare(blockText)) node = n;
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
    }
    blocks.push(node ? { src: blockText, node, raw: false } : { src: blockText, node: schema.nodes.raw_block.create({ src: blockText }), raw: true });
    i = j;
  }
  gaps.push(lines.slice(at).map((l) => restoreMath(l, maths)));
  const kids = blocks.map((b) => b.node);
  const doc = schema.nodes.doc.create(null, kids.length ? kids : [schema.nodes.paragraph.create()]);
  return { doc, source: { text, gaps, blocks } };
}

// ---------------------------------------------------------------- 寫出

const WORD = /[\p{L}\p{N}]/u;

/** 一段純文字的跳脫（只跳脫會被當成語法的字，盡量少改）。lineStart：這段字是不是在一行的開頭。 */
function escapeText(s: string, lineStart: boolean, inTable: boolean): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = s[i - 1] ?? "";
    const next = s[i + 1] ?? "";
    if (c === "\\" || c === "*" || c === "`" || c === "$") out += "\\" + c;
    else if (c === "_" && !(WORD.test(prev) && WORD.test(next))) out += "\\_";
    else if (c === "~" && (next === "~" || prev === "~")) out += "\\~";
    else if (c === "[" && s.indexOf("](", i) > i) out += "\\[";
    else if (c === "]" && next === "(") out += "\\]";
    else if (c === "<" && /[A-Za-z/!?]/.test(next)) out += "\\<";
    else if (c === "&" && /^&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(s.slice(i))) out += "\\&";
    else if (c === "|" && inTable) out += "\\|";
    else out += c;
  }
  if (lineStart) {
    // 行首會變成標題、引言、列點、編號、分隔線的字
    out = out
      .replace(/^(\s*)([#>+=])/, "$1\\$2")
      .replace(/^(\s*)-(?=\s|$|-)/, "$1\\-")
      .replace(/^(\s*)(\d+)([.)])(?=\s|$)/, "$1$2\\$3");
  }
  return out;
}

const MARK_OPEN: Record<string, (m: Mark) => string> = {
  link: () => "[",
  strong: (m) => m.attrs.delim,
  em: (m) => m.attrs.delim,
  strike: () => "~~",
  underline: () => "<u>",
  sup: () => "<sup>",
  sub: () => "<sub>",
};
const MARK_CLOSE: Record<string, (m: Mark) => string> = {
  link: (m) => `](${m.attrs.href}${m.attrs.title ? ` "${m.attrs.title}"` : ""})`,
  strong: (m) => m.attrs.delim,
  em: (m) => m.attrs.delim,
  strike: () => "~~",
  underline: () => "</u>",
  sup: () => "</sup>",
  sub: () => "</sub>",
};

function codeSpan(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((x) => x.length));
  const ticks = "`".repeat(longest + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return ticks + pad + s + pad + ticks;
}

/** 一個記號從第 i 個子節點起連續延續幾個（開記號時延續得久的放外層，才不會中途被迫關掉再開）。 */
function runLength(kids: PMNode[], i: number, m: Mark): number {
  let n = 0;
  while (i + n < kids.length && has(kids[i + n].marks, m)) n++;
  return n;
}

/** 同一種記號、同一種寫法（o 只是原文的巢狀層次，不算） */
const same = (a: Mark, b: Mark) => a.type === b.type && a.attrs.delim === b.attrs.delim && a.attrs.href === b.attrs.href;
const has = (set: readonly Mark[], m: Mark) => set.some((x) => same(x, m));

// 同時開始、一樣長的記號：照原文的巢狀層次（o）；網站上新加的（o = 9）照這個順序
const OUTER: Record<string, number> = { link: 0, underline: 1, sup: 1, sub: 1, strike: 2, strong: 3, em: 4 };

/** 段落、標題、儲存格的內容 → Markdown（一個字串，可能有 \n）。 */
export function serializeInline(node: PMNode, inTable = false): string {
  const kids: PMNode[] = [];
  node.forEach((c) => kids.push(c));
  let out = "";
  let active: Mark[] = [];
  let lineStart = true;
  const closeTo = (n: number) => {
    while (active.length > n) {
      const m = active.pop()!;
      out += MARK_CLOSE[m.type.name](m);
    }
  };
  kids.forEach((child, idx) => {
    const own = child.marks.filter((m) => m.type.name !== "code");
    // 已經開著、這個節點也有的記號留著（從外往內）
    let keep = 0;
    while (keep < active.length && has(own, active[keep])) keep++;
    const fresh = own
      .filter((m) => !has(active.slice(0, keep), m))
      .map((m) => ({ m, len: runLength(kids, idx, m) }))
      .sort((x, y) => y.len - x.len || x.m.attrs.o - y.m.attrs.o || OUTER[x.m.type.name] - OUTER[y.m.type.name])
      .map((x) => x.m);
    const marks = [...active.slice(0, keep), ...fresh];
    // 粗體結尾的空白搬到記號外面（** 字 ** 不是粗體）
    if (child.isText && keep < active.length) {
      const trail = /\s+$/.exec(out)?.[0] ?? "";
      if (trail) out = out.slice(0, -trail.length);
      closeTo(keep);
      out += trail;
    } else closeTo(keep);
    let lead = "";
    let body: string;
    if (child.isText) {
      const t = child.text ?? "";
      if (child.marks.some((m) => m.type.name === "code")) body = codeSpan(t);
      else {
        const m = fresh.length ? /^\s+/.exec(t) : null;
        lead = m ? m[0] : "";
        body = escapeText(t.slice(lead.length), lineStart && !lead, inTable);
      }
    } else if (child.type.name === "hard_break") {
      const k = child.attrs.kind as string;
      out += inTable ? (k.startsWith("<") ? k : "<br>") : k === "soft" ? "\n" : k === "hard" ? "\\\n" : k;
      lineStart = !inTable && !k.startsWith("<");
      // 換行不開新的記號
      active = active.slice(0, keep);
      return;
    } else if (child.type.name === "math_inline") body = child.attrs.tex ? `$${child.attrs.tex}$` : "";
    else if (child.type.name === "math_display") body = child.attrs.tex ? `$$${child.attrs.tex}$$` : "";
    else if (child.type.name === "image") body = `![${child.attrs.alt}](${child.attrs.src}${child.attrs.title ? ` "${child.attrs.title}"` : ""})`;
    else body = "";
    out += lead;
    for (const m of fresh) out += MARK_OPEN[m.type.name](m);
    active = marks;
    out += body;
    if (body) lineStart = false;
  });
  closeTo(0);
  return out;
}

const indent = (s: string, first: string, rest: string) =>
  s
    .split("\n")
    .map((l, i) => (i === 0 ? first + l : l ? rest + l : l))
    .join("\n");

/** 一個區塊 → Markdown。 */
export function serializeBlock(node: PMNode): string {
  switch (node.type.name) {
    case "paragraph":
      return serializeInline(node);
    case "heading":
      return "#".repeat(node.attrs.level) + " " + serializeInline(node).replace(/\n/g, " ");
    case "blockquote":
      return children(node, false)
        .split("\n")
        .map((l) => (l ? "> " + l : ">"))
        .join("\n");
    case "horizontal_rule":
      return node.attrs.markup;
    case "bullet_list":
    case "ordered_list": {
      const ordered = node.type.name === "ordered_list";
      const items: string[] = [];
      node.forEach((item, _, k) => {
        const marker = ordered ? `${node.attrs.start + k}${node.attrs.delim}` : node.attrs.marker;
        const body = children(item, node.attrs.tight);
        items.push(indent(body, marker + " ", " ".repeat(marker.length + 1)));
      });
      return items.join(node.attrs.tight ? "\n" : "\n\n");
    }
    case "table": {
      const rows: string[] = [];
      const aligns: (string | null)[] = [];
      node.forEach((row, _, r) => {
        const cells: string[] = [];
        row.forEach((cell, _, c) => {
          if (r === 0) aligns[c] = cell.attrs.align;
          cells.push(serializeInline(cell.firstChild!, true).trim());
        });
        rows.push("| " + cells.join(" | ") + " |");
        if (r === 0) rows.push("| " + aligns.map((a) => (a === "left" ? ":---" : a === "center" ? ":---:" : a === "right" ? "---:" : "---")).join(" | ") + " |");
      });
      return rows.join("\n");
    }
    case "raw_block":
    case "card_label":
      return node.attrs.src;
    default:
      return "";
  }
}

function children(node: PMNode, tight: boolean): string {
  const parts: string[] = [];
  node.forEach((c) => parts.push(serializeBlock(c)));
  return parts.join(tight ? "\n" : "\n\n");
}

// ---------------------------------------------------------------- 原文保留

/** 最長共同子序列：a[i] 對到 b[j] 的配對（行數很多時只比頭尾）。 */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  if (a.length * b.length > 250_000) {
    const pairs: [number, number][] = [];
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) pairs.push([p, p]), p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) pairs.push([a.length - 1 - s, b.length - 1 - s]), s++;
    return pairs;
  }
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) pairs.push([i, j]), i++, j++;
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** 改過的區塊：重新產生後，和「原本的節點重新產生」逐行比，沒變的行換回原文那一行。 */
export function preserveLines(orig: string, before: string, after: string): string {
  if (after === before) return orig;
  const o = orig.split("\n");
  const a = before.split("\n");
  if (o.length !== a.length) return after;
  const b = after.split("\n");
  const out = b.slice();
  for (const [i, j] of lcsPairs(a, b)) out[j] = o[i];
  const merged = out.join("\n");
  // 保險：換回原文的行之後排出來要和重新產生的一樣，不然就用重新產生的
  return renderForCompare(merged) === renderForCompare(after) ? merged : after;
}

/** 編輯器文件 → Markdown。沒改到的最上層區塊與區塊之間的空行用原文。 */
export function serializeMarkdown(doc: PMNode, source?: Source): string {
  // 空段落不寫出（編輯器為了讓游標進得去而留的；markdown-it 讀進來也不會有空段落）
  const kids: PMNode[] = [];
  doc.forEach((c) => {
    if (!(c.type.name === "paragraph" && c.content.size === 0)) kids.push(c);
  });
  if (!source || !source.blocks.length) {
    const fresh = kids.map(serializeBlock).join("\n\n");
    // 原文是空的（或只有空白）：沒寫東西就維持原樣
    return fresh.trim() ? fresh : (source?.text ?? "");
  }
  const orig = source.blocks;
  // 1. 每個新區塊對到原本的哪一個（同一個物件，或內容相同、順序往後）
  const match: (number | null)[] = kids.map(() => null);
  const byNode = new Map(orig.map((b, i) => [b.node, i]));
  let last = -1;
  kids.forEach((k, i) => {
    let j = byNode.get(k);
    if (j === undefined || j <= last) {
      j = undefined;
      for (let x = last + 1; x < orig.length; x++)
        if (orig[x].node.eq(k)) {
          j = x;
          break;
        }
    }
    if (j !== undefined) {
      match[i] = j;
      last = j;
    }
  });
  // 2. 改過的區塊：夾在兩個對到的區塊中間、而且原本那個位置也剛好空出一個同類的區塊 → 視為「改了那一個」
  const pair: (number | null)[] = match.slice();
  for (let i = 0; i < kids.length; i++) {
    if (pair[i] !== null) continue;
    const prev = i > 0 ? pair[i - 1] : -1;
    let k = i + 1;
    while (k < kids.length && match[k] === null) k++;
    const next = k < kids.length ? match[k]! : orig.length;
    if (prev === null) continue;
    const cand = prev + 1;
    if (cand < next && k - i === next - prev - 1 && orig[cand].node.type === kids[i].type) pair[i] = cand;
  }
  // 3. 接起來
  const lines: string[] = [...source.gaps[0]];
  kids.forEach((k, i) => {
    const j = pair[i];
    if (i > 0) {
      const pj = pair[i - 1];
      lines.push(...(j !== null && pj !== null && j === pj + 1 ? source.gaps[j] : [""]));
    }
    let text: string;
    if (match[i] !== null) text = orig[match[i]!].src;
    else if (j !== null && !orig[j].raw) text = preserveLines(orig[j].src, serializeBlock(orig[j].node), serializeBlock(k));
    else text = serializeBlock(k);
    lines.push(...text.split("\n"));
  });
  lines.push(...source.gaps[source.gaps.length - 1]);
  return lines.join("\n");
}

/** 一段 Markdown → 可以插進編輯器的內容（貼上用）。 */
export function markdownToFragment(text: string): Fragment {
  return parseMarkdown(text).doc.content;
}
