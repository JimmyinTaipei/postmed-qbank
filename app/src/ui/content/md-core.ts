// 閱讀頁與編輯器共用的 Markdown 解析設定（第 3B 階段從 render.ts 拆出來）。
// 不碰 DOM、只用相對路徑 import：node 的全庫往返測試直接載入這個檔。
//
// 規則：公式先抽成佔位字（判定與 Python 端同規則）→ markdown-it。編輯器讀入時用同一個解析器，
// 「編輯時看到的」和「存檔後閱讀頁顯示的」才不會不一樣（規格書 §9.10）。

import MarkdownIt from "markdown-it";
import { mathRanges } from "../../../../schema/ts/options.ts";

export const md = new MarkdownIt({ html: true, breaks: true, linkify: false, typographer: false });

// 圖：![alt](fig:<fid>) → 佔位字；卡片的圖 ![](m/<sha256>.<副檔名>)（第 5 階段）→ 另一種佔位字；
// 其他來源的圖一律不顯示（主檔的相對路徑在網站上無效）
export const MEDIA = /^m\/[0-9a-f]{64}\.[a-z0-9]{2,5}$/;
md.renderer.rules.image = (tokens, idx) => {
  const src = String(tokens[idx].attrGet("src") ?? "");
  const m = /^fig:([0-9A-Za-z_-]+)$/.exec(src);
  if (m) return `@@F${m[1]}@@`;
  return MEDIA.test(src) ? `@@G${src.slice(2)}@@` : "";
};

// 卡片的聲音：[sound:m/<sha256>.mp3]
export const SOUND = /\[sound:(m\/[0-9a-f]{64}\.[a-z0-9]{2,5})\]/g;

export interface MathPiece {
  tex: string;
  display: boolean;
  /** 原文（含 $ 或 $$） */
  raw: string;
}

/** 公式 → @@M<n>@@。回傳換好的文字與公式清單。空的公式（$$ 中間沒字）不抽。 */
export function extractMath(text: string): { src: string; maths: MathPiece[] } {
  const maths: MathPiece[] = [];
  let src = "";
  let last = 0;
  for (const [a, b, display] of mathRanges(text)) {
    const tex = display ? text.slice(a + 2, b - 2) : text.slice(a + 1, b - 1);
    if (!tex.trim()) continue;
    src += text.slice(last, a) + `@@M${maths.length}@@`;
    maths.push({ tex, display, raw: text.slice(a, b) });
    last = b;
  }
  return { src: src + text.slice(last), maths };
}

/** 佔位字換回原文。 */
export function restoreMath(s: string, maths: MathPiece[]): string {
  return s.replace(/@@M(\d+)@@/g, (all, n: string) => maths[Number(n)]?.raw ?? all);
}

/** 排版的前半（公式佔位 → markdown-it → ==螢光== → 對齊 class）。閱讀頁與往返測試共用。
 *  回傳的 HTML 還沒清理、公式還是佔位字。 */
export function preRender(text: string): { html: string; maths: MathPiece[] } {
  const { src, maths } = extractMath(text);
  let html = md.render(src.replace(SOUND, (_, m: string) => `@@S${m.slice(2)}@@`));
  html = html.replace(/==([^=\n<>]+)==/g, "<mark>$1</mark>").replace(/ style="text-align:(left|center|right)"/g, ' class="ta-$1"');
  return { html, maths };
}

/** 往返測試用：排出來的 HTML（公式換成它的原始碼，不經過 KaTeX 與清理）。兩段文字這個值相同 ⇒ 閱讀頁顯示相同。 */
export function renderForCompare(text: string): string {
  if (!text.trim()) return "";
  const { html, maths } = preRender(text);
  return html.replace(/@@M(\d+)@@/g, (_, n: string) => {
    const m = maths[Number(n)];
    return m ? `<math-${m.display ? "d" : "i"}>${m.tex.trim()}</math>` : "";
  });
}
