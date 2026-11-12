// 題組（第 8A 階段，規格書 §9.11「8A」）：同一篇文章（或物理的同一大題）的小題放在同一頁。純函式。
//
// - 索引列有 gid（題組 id）與 go（組內順序＝原卷題號）的題目就在題組裡。
// - 出題：篩到題組裡任何一小題，就整組一起出（不拆）；題數照小題算。
// - 一場的 items 仍然是一題一格（答案卡、得分、錯題本、複習都以小題為單位）；
//   畫面把 items 裡相鄰、同一個 gid 的題目合成一「頁」。

import type { IndexRow } from "./types";

type Row = Pick<IndexRow, "id" | "gid" | "go">;

/** 同一個 gid 的題目，照組內順序。只收有 gid、而且組裡至少兩題的。 */
export function groupsOf(rows: Row[]): Map<string, string[]> {
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.gid) continue;
    let g = by.get(r.gid);
    if (!g) by.set(r.gid, (g = []));
    g.push(r);
  }
  const out = new Map<string, string[]>();
  for (const [gid, g] of by) {
    if (g.length < 2) continue;
    g.sort((a, b) => (a.go ?? 0) - (b.go ?? 0));
    out.set(gid, g.map((r) => r.id));
  }
  return out;
}

/**
 * 出題的單位：單題是一個單位，題組是整組一個單位。
 * picked：篩到的題目（順序就是單位的順序：第一次碰到某一組時整組放在那裡）；
 * all：該科全部索引列（整組要從這裡補齊，不管其他小題有沒有被篩到）。
 * available：有本文的題目（樣本內容包）；null＝全部都有。
 */
export function expandUnits(picked: Row[], all: Row[], available: Set<string> | null = null): string[][] {
  const groups = groupsOf(all);
  const units: string[][] = [];
  const seen = new Set<string>();
  for (const r of picked) {
    if (seen.has(r.id)) continue;
    const g = r.gid ? groups.get(r.gid) : undefined;
    const ids = (g ?? [r.id]).filter((id) => !available || available.has(id));
    for (const id of ids) seen.add(id);
    if (ids.length) units.push(ids);
  }
  return units;
}

/** 取單位直到小題數達到 n（最後一個題組可以超過，不拆）。 */
export function takeUnits(units: string[][], n: number): string[] {
  const out: string[] = [];
  for (const u of units) {
    if (out.length >= n) break;
    out.push(...u);
  }
  return out;
}

/**
 * 一場的題目順序：同一組的小題排在一起（放在這一組第一次出現的位置，照組內順序）。
 * 錯題本、複習、重做錯題這些清單本來是照時間排的，同一篇文章的小題可能分散。
 */
export function clusterItems(items: string[], rowOf: (id: string) => Row | null | undefined): string[] {
  const by = new Map<string, Row[]>();
  for (const id of items) {
    const r = rowOf(id);
    if (!r?.gid) continue;
    let g = by.get(r.gid);
    if (!g) by.set(r.gid, (g = []));
    g.push(r);
  }
  const out: string[] = [];
  const done = new Set<string>();
  for (const id of items) {
    if (done.has(id)) continue;
    const r = rowOf(id);
    const g = r?.gid ? by.get(r.gid) : undefined;
    if (g && g.length > 1) {
      for (const m of g.slice().sort((a, b) => (a.go ?? 0) - (b.go ?? 0))) {
        if (!done.has(m.id)) {
          out.push(m.id);
          done.add(m.id);
        }
      }
    } else {
      out.push(id);
      done.add(id);
    }
  }
  return out;
}

export interface Page {
  /** items 的範圍 [start, end) */
  start: number;
  end: number;
  gid: string | null;
}

/** 把一場的 items 切成頁：相鄰、同一個 gid 的是一頁，其他一題一頁。 */
export function pagesOf(items: string[], gidOf: (id: string) => string | null | undefined): Page[] {
  const pages: Page[] = [];
  for (let i = 0; i < items.length; ) {
    const gid = gidOf(items[i]) ?? null;
    let j = i + 1;
    if (gid) while (j < items.length && gidOf(items[j]) === gid) j++;
    pages.push({ start: i, end: j, gid }); // 只有一小題也記 gid：複習時那一題仍然帶著文章
    i = j;
  }
  return pages;
}

/** cursor（items 的位置）在第幾頁。 */
export function pageAt(pages: Page[], cursor: number): number {
  const i = pages.findIndex((p) => cursor >= p.start && cursor < p.end);
  return i < 0 ? 0 : i;
}

/** 題號顯示：「41–45」或「7」（1 起算）。 */
export function pageLabel(p: Page): string {
  return p.end - p.start > 1 ? `${p.start + 1}–${p.end}` : `${p.start + 1}`;
}
