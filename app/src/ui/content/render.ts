// Markdown ＋ 公式 ＋ 圖 → 安全的 HTML（規格書 §3.1、§6）。
// 步驟：先把公式抽成佔位字（公式判定與 Python 端同規則）→ markdown-it → DOMPurify 白名單
// → 把佔位字換成 KaTeX 與題圖。KaTeX 與題圖的 HTML 是這裡自己產生的，所以放在清理之後才插入。

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import katex from "katex";
import "katex/contrib/mhchem";
import { mathRanges } from "@schema/ts/options.ts";
import macros from "@schema/katex-macros.json";
import type { Fig } from "@/data";

const md = new MarkdownIt({ html: true, breaks: true, linkify: false, typographer: false });

// 圖：![alt](fig:<fid>) → 佔位字；卡片的圖 ![](m/<sha256>.<副檔名>)（第 5 階段）→ 另一種佔位字；
// 其他來源的圖一律不顯示（主檔的相對路徑在網站上無效）
const MEDIA = /^m\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/;
md.renderer.rules.image = (tokens, idx) => {
  const src = String(tokens[idx].attrGet("src") ?? "");
  const m = /^fig:([0-9A-Za-z_-]+)$/.exec(src);
  if (m) return `@@F${m[1]}@@`;
  return MEDIA.test(src) ? `@@G${src.slice(2)}@@` : "";
};

// 卡片的聲音：[sound:m/<sha256>.mp3] → 播放鈕（點了才下載，不進離線快取，規格書 §9.5）
const SOUND = /\[sound:(m\/[0-9a-f]{64}\.[a-z0-9]{2,5})\]/g;

const ALLOWED_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "del", "sub", "sup", "mark", "code", "pre", "blockquote",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td", "span", "div", "a",
];
const ALLOWED_ATTR = ["href", "colspan", "rowspan", "class", "start", "title"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SPEAKER = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';

const mathCache = new Map<string, string>();

function renderMath(tex: string, display: boolean): string {
  const key = (display ? "D" : "I") + tex;
  let html = mathCache.get(key);
  if (html === undefined) {
    try {
      html = katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: "ignore", trust: false, macros: { ...macros }, output: "htmlAndMathml" });
    } catch {
      // 排不出來：顯示原始碼加紅色波浪底線，不讓整題壞掉（規格書 §6.1）
      html = `<code class="math-error" title="這個公式排不出來，顯示的是原始碼">${esc(display ? `$$${tex}$$` : `$${tex}$`)}</code>`;
    }
    if (mathCache.size > 4000) mathCache.clear();
    mathCache.set(key, html);
  }
  return display ? `<span class="math-display" data-noswipe>${html}</span>` : `<span class="math-inline">${html}</span>`;
}

export interface RenderOptions {
  figs?: Fig[];
  /** 這段文字在題幹（q）還是詳解（sol、kb）：同一張圖有題目版與解答版時用來挑。 */
  role?: Fig["role"];
  assetUrl: (src: string) => string;
}

/** 題內顯示寬度（px）：SVG 取原始寬 × 1.6（沿用全冊 PDF 的設定）；有 max_w 以它為上限；點陣圖不放大。 */
export function figDisplayWidth(f: Fig): number {
  if (f.max_w) return f.max_w;
  if (/\.svg$/i.test(f.src)) return Math.round(f.w * 1.6);
  return Math.min(f.w, 560);
}

export function pickFig(figs: Fig[] | undefined, fid: string, role?: Fig["role"]): Fig | undefined {
  return figs?.find((f) => f.fid === fid && f.role === role) ?? figs?.find((f) => f.fid === fid);
}

function renderFig(fid: string, o: RenderOptions): string {
  const f = pickFig(o.figs, fid, o.role);
  if (!f) return `<span class="fig-missing">圖檔不在這個內容包裡</span>`;
  const w = figDisplayWidth(f);
  const h = Math.round((w * f.h) / Math.max(1, f.w));
  const alt = f.alt || "題圖";
  return (
    `<span class="fig${f.mono ? " mono" : ""}" role="button" tabindex="0" data-fig="${esc(f.fid)}" data-role="${f.role}" aria-label="放大圖片：${esc(alt)}">` +
    `<img src="${esc(o.assetUrl(f.src))}" alt="${esc(alt)}" width="${w}" height="${h}" decoding="async" draggable="false"` +
    (f.fallback ? ` data-fallback="${esc(o.assetUrl(f.fallback))}"` : "") +
    `></span>`
  );
}

export function renderMarkdown(text: string, o: RenderOptions): string {
  if (!text.trim()) return "";
  // 1. 公式 → 佔位字
  const maths: { tex: string; display: boolean }[] = [];
  let src = "";
  let last = 0;
  for (const [a, b, display] of mathRanges(text)) {
    const tex = display ? text.slice(a + 2, b - 2) : text.slice(a + 1, b - 1);
    if (!tex.trim()) continue;
    src += text.slice(last, a) + `@@M${maths.length}@@`;
    maths.push({ tex, display });
    last = b;
  }
  src += text.slice(last);
  src = src.replace(SOUND, (_, m: string) => `@@S${m.slice(2)}@@`);

  // 2. Markdown → HTML
  let html = md.render(src);
  html = html
    .replace(/==([^=\n<>]+)==/g, "<mark>$1</mark>")
    .replace(/ style="text-align:(left|center|right)"/g, ' class="ta-$1"');

  // 3. 白名單清理
  html = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOWED_URI_REGEXP: /^https?:\/\//i });

  // 4. 表格包一層可橫向捲動的容器；連結另開分頁
  html = html
    .replace(/<table>/g, '<div class="md-scroll" data-noswipe><table>')
    .replace(/<\/table>/g, "</table></div>")
    .replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=');

  // 5. 佔位字 → 公式、圖。獨立公式前後的換行拿掉，避免多出空行
  html = html.replace(/(?:<br>\s*)?@@M(\d+)@@(?:\s*<br>)?/g, (all, n: string) => {
    const m = maths[Number(n)];
    if (!m) return "";
    if (!m.display) return all.replace(`@@M${n}@@`, renderMath(m.tex, false));
    return renderMath(m.tex, true);
  });
  html = html.replace(/@@F([0-9A-Za-z_-]+)@@/g, (_, fid: string) => renderFig(fid, o));
  html = html.replace(/@@G([0-9a-f]{64}\.[a-z0-9]{2,5})@@/g, (_, f: string) => `<span class="fig card-fig" role="button" tabindex="0" data-m="${f}" aria-label="放大圖片"><img class="card-img" src="/m/${f}" alt="" decoding="async" loading="lazy" draggable="false"></span>`);
  html = html.replace(/@@S([0-9a-f]{64}\.[a-z0-9]{2,5})@@/g, (_, f: string) => `<button type="button" class="snd" data-snd="/m/${f}" aria-label="播放聲音">${SPEAKER}</button>`);
  return html;
}
