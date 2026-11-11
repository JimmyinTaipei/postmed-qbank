// 手寫引擎的純函式（第 6 階段）：筆畫 → SVG path、橡皮擦的命中判斷。沒有 DOM，可以單獨測試。
//
// 筆（pen）：依壓力變粗細，畫成一個填滿的外框（兩側各偏移半個筆寬，兩端圓頭）。
// 螢光筆（hl）：固定寬度，畫成一條 stroke（圓頭、圓角），由外層用「相乘」混色蓋在底下的字與線上。

import type { InkStroke } from "@/data";

type Pt = [number, number, number];

/** 筆寬隨壓力的變化：壓力 0.5（滑鼠、手指的預設值）時是 0.85 倍。 */
export const widthAt = (size: number, p: number) => size * (0.35 + Math.min(1, Math.max(0, p)));

const f = (n: number) => (Math.round(n * 10) / 10).toString();

/** 輕微平滑（三點加權平均），只用在顯示，不改存檔的點。 */
function smooth(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    out.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, b[2]]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 依序經過各點的平滑曲線（以相鄰兩點的中點為端點、點本身為控制點）。 */
function curve(points: [number, number][], move = true): string {
  if (!points.length) return "";
  const [x0, y0] = points[0];
  let d = move ? `M${f(x0)} ${f(y0)}` : `L${f(x0)} ${f(y0)}`;
  if (points.length === 1) return d;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += `Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
  }
  const [xl, yl] = points[points.length - 1];
  return d + `L${f(xl)} ${f(yl)}`;
}

function dot(x: number, y: number, r: number): string {
  return `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
}

/** 筆：填滿的外框。 */
export function penPath(s: Pick<InkStroke, "pts" | "size">): string {
  // 去掉重疊的點（停筆時會連續送同一點）
  const raw: Pt[] = [];
  for (const p of s.pts) {
    const last = raw[raw.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) raw.push(p as Pt);
  }
  if (!raw.length) return "";
  if (raw.length === 1) return dot(raw[0][0], raw[0][1], widthAt(s.size, raw[0][2]) / 2);
  const pts = smooth(raw);
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const r = widthAt(s.size, pts[i][2]) / 2;
    left.push([pts[i][0] - dy * r, pts[i][1] + dx * r]);
    right.push([pts[i][0] + dy * r, pts[i][1] - dx * r]);
  }
  const r0 = widthAt(s.size, pts[0][2]) / 2;
  const r1 = widthAt(s.size, pts[pts.length - 1][2]) / 2;
  const [el, er] = [right[right.length - 1], left[0]];
  // 左側 → 尾端半圓 → 右側（反向）→ 起點半圓
  return (
    curve(left) +
    `A${f(r1)} ${f(r1)} 0 0 1 ${f(el[0])} ${f(el[1])}` +
    curve(right.slice().reverse(), false) +
    `A${f(r0)} ${f(r0)} 0 0 1 ${f(er[0])} ${f(er[1])}Z`
  );
}

/** 螢光筆：一條固定寬度的線（寬度由 stroke-width 給）。 */
export function hlPath(s: Pick<InkStroke, "pts">): string {
  const pts = smooth(s.pts as Pt[]).map(([x, y]) => [x, y] as [number, number]);
  if (pts.length === 1) return `M${f(pts[0][0])} ${f(pts[0][1])}l0.01 0`;
  return curve(pts);
}

/** 點到線段的距離。 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 橡皮擦（整筆）：這個點（半徑 r）有沒有碰到這一筆。 */
export function hits(s: InkStroke, x: number, y: number, r: number): boolean {
  const pts = s.pts;
  if (!pts.length) return false;
  const reach = r + (s.tool === "pen" ? widthAt(s.size, 1) / 2 : s.size / 2);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    if (segDist(x, y, a[0], a[1], b[0], b[1]) <= reach) return true;
  }
  return false;
}

/** 認得、會畫的工具。其他的（之後的圖上膠帶等）原樣保留、不畫、橡皮擦也不擦。 */
export const KNOWN_TOOLS = new Set(["pen", "hl"]);
