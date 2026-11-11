// 搜尋（畫面這一側）：確保該科的包都在裝置上，交給背景執行緒（search.worker.ts）建文字、查詢。

import { useEffect, useRef, useState } from "react";
import { content } from "./content";
import type { SearchHit, SearchRequest, SearchResponse } from "./search.worker";
import type { SubjectId } from "./types";

export type { SearchHit };

let worker: Worker | null = null;
const loaded = new Map<SubjectId, Promise<number>>();
const waiting = new Map<number, (r: Extract<SearchResponse, { type: "result" }>) => void>();
const loadWait = new Map<string, (n: number) => void>();
let seq = 0;

function w(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./search.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<SearchResponse>) => {
      const m = e.data;
      if (m.type === "loaded") {
        loadWait.get(m.subject)?.(m.count);
        loadWait.delete(m.subject);
      } else {
        waiting.get(m.seq)?.(m);
        waiting.delete(m.seq);
      }
    };
  }
  return worker;
}

/** 準備某一科的搜尋（第一次會下載缺的包並建文字，之後很快）。 */
export function prepareSearch(subject: SubjectId, onProgress?: (done: number, total: number) => void): Promise<number> {
  let p = loaded.get(subject);
  if (!p) {
    p = (async () => {
      const keys = await content.ensurePacks(subject, onProgress);
      return new Promise<number>((resolve) => {
        loadWait.set(subject, resolve);
        w().postMessage({ type: "load", subject, keys } satisfies SearchRequest);
      });
    })().catch((e) => {
      loaded.delete(subject);
      throw e;
    });
    loaded.set(subject, p);
  }
  return p;
}

export async function searchText(subject: SubjectId, q: string, limit = 200): Promise<{ hits: SearchHit[]; total: number; ms: number }> {
  await prepareSearch(subject);
  const id = ++seq;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    w().postMessage({ type: "query", subject, q, limit, seq: id } satisfies SearchRequest);
  });
}

export interface SearchState {
  preparing: { done: number; total: number } | null;
  ready: boolean;
  /** 本文有幾題可以搜（離線時沒下載的包不在內） */
  count: number;
  result: { q: string; hits: SearchHit[]; total: number; ms: number } | null;
  error: string | null;
}

/** 畫面用：輸入停 200 毫秒後才查；只採用最新一次查詢的結果。 */
export function useSearch(subject: SubjectId | undefined, q: string): SearchState {
  const [st, setSt] = useState<SearchState>({ preparing: null, ready: false, count: 0, result: null, error: null });
  const latest = useRef(0);
  useEffect(() => {
    if (!subject) return;
    let live = true;
    setSt((s) => ({ ...s, ready: false, result: null, error: null }));
    prepareSearch(subject, (done, total) => live && setSt((s) => ({ ...s, preparing: { done, total } })))
      .then((count) => live && setSt((s) => ({ ...s, preparing: null, ready: true, count })))
      .catch((e: Error) => live && setSt((s) => ({ ...s, preparing: null, error: e.message })));
    return () => {
      live = false;
    };
  }, [subject]);
  useEffect(() => {
    if (!subject || !st.ready) return;
    const k = q.trim();
    if (!k) {
      setSt((s) => ({ ...s, result: null }));
      return;
    }
    const my = ++latest.current;
    const h = setTimeout(() => {
      void searchText(subject, k).then((r) => {
        if (my === latest.current) setSt((s) => ({ ...s, result: { q: k, ...r } }));
      });
    }, 200);
    return () => clearTimeout(h);
  }, [subject, q, st.ready]);
  return st;
}
