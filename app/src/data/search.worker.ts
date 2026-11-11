// 搜尋的背景執行緒（規格書 §9.1 /browse：在裝置上搜尋題幹、詳解、ID、來源，不卡畫面）。
// 直接從 IndexedDB 讀內容包（db.cfile），建一份正規化過的純文字，查詢時逐題比對。
// 一科約 1–2 萬題、幾 MB 文字，逐題 includes 在 iPad 上約幾十毫秒，不需要另建倒排索引。

/// <reference lib="webworker" />
import { db } from "./db";
import type { Question } from "./types";

export interface SearchHit {
  id: string;
  /** 0 題號／來源完全符合；1 題號／來源含所有關鍵字；2 本文含所有關鍵字 */
  rank: 0 | 1 | 2;
  /** 命中在本文的哪一段（rank 2 才有） */
  where?: "ques" | "idea" | "sol";
  snippet?: string;
}

export type SearchRequest =
  | { type: "load"; subject: string; keys: string[] }
  | { type: "query"; subject: string; q: string; limit: number; seq: number };

export type SearchResponse =
  | { type: "loaded"; subject: string; count: number }
  | { type: "result"; seq: number; hits: SearchHit[]; total: number; ms: number };

interface Doc {
  id: string;
  head: string; // 題號＋來源
  ques: string;
  idea: string;
  sol: string;
  raw: { ques: string; idea: string; sol: string };
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase();
const plain = (md: string) =>
  md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s+/g, " ");

const docs = new Map<string, { keys: string; list: Doc[] }>();

async function load(subject: string, keys: string[]): Promise<number> {
  const sig = keys.slice().sort().join(",");
  const cur = docs.get(subject);
  if (cur?.keys === sig) return cur.list.length;
  const list: Doc[] = [];
  const files = await db.cfile.bulkGet(keys);
  for (const f of files) {
    if (!f) continue;
    for (const q of (f.data as { questions: Question[] }).questions ?? []) {
      const raw = { ques: plain(q.ques), idea: plain(q.idea ?? ""), sol: plain(q.sol ?? "") };
      list.push({ id: q.id, head: norm(`${q.id} ${q.label}`), ques: norm(raw.ques), idea: norm(raw.idea), sol: norm(raw.sol), raw });
    }
  }
  docs.set(subject, { keys: sig, list });
  return list.length;
}

function snippet(raw: string, low: string, term: string): string {
  const at = low.indexOf(term);
  if (at < 0) return raw.slice(0, 80);
  const from = Math.max(0, at - 30);
  return (from > 0 ? "…" : "") + raw.slice(from, at + term.length + 50).trim() + (at + term.length + 50 < raw.length ? "…" : "");
}

function query(subject: string, q: string, limit: number): { hits: SearchHit[]; total: number } {
  const list = docs.get(subject)?.list ?? [];
  const phrase = norm(q.trim()).replace(/\s+/g, " ");
  const terms = phrase.split(" ").filter(Boolean);
  if (!terms.length) return { hits: [], total: 0 };
  const r0: SearchHit[] = [];
  const r1: SearchHit[] = [];
  const r2: SearchHit[] = [];
  for (const d of list) {
    if (d.head.includes(phrase)) r0.push({ id: d.id, rank: 0 });
    else if (terms.every((t) => d.head.includes(t))) r1.push({ id: d.id, rank: 1 });
    else {
      const all = d.head + " " + d.ques + " " + d.idea + " " + d.sol;
      if (!terms.every((t) => all.includes(t))) continue;
      const t = terms.find((x) => !d.head.includes(x)) ?? terms[0];
      const where = d.ques.includes(t) ? "ques" : d.idea.includes(t) ? "idea" : "sol";
      r2.push({ id: d.id, rank: 2, where, snippet: snippet(d.raw[where], d[where], t) });
    }
  }
  const all = [...r0, ...r1, ...r2];
  return { hits: all.slice(0, limit), total: all.length };
}

self.onmessage = async (e: MessageEvent<SearchRequest>) => {
  const m = e.data;
  if (m.type === "load") {
    const count = await load(m.subject, m.keys);
    (self as unknown as Worker).postMessage({ type: "loaded", subject: m.subject, count } satisfies SearchResponse);
  } else {
    const t = performance.now();
    const r = query(m.subject, m.q, m.limit);
    (self as unknown as Worker).postMessage({ type: "result", seq: m.seq, ...r, ms: Math.round(performance.now() - t) } satisfies SearchResponse);
  }
};
