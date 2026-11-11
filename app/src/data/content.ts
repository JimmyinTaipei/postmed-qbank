// 內容包（規格書 §4.1、§8）。
//
// 第 1B 階段起：內容包下載到 IndexedDB（db.cfile），離線也能讀。
// - 目前用的 manifest 存在 db.kv["content.manifest"]；開 App 時先用它（不等網路）。
// - 同步時比對伺服器的 manifest 雜湊；有新版就在背景下載變動的檔，全部到齊才切換（不打斷作答中的題目：
//   已經顯示的題目物件不會被換掉，下一次讀題才用新版）。
// - 每科可以選要不要「離線下載」（prefs.offline）：開著就預先下載該科全部的包；關著只在讀到時下載並留著。
// - 檔名含雜湊、內容永不變，所以記憶體與 IndexedDB 都以檔名當快取鍵。
//
// 匯出的函式簽名與 1A 相同，畫面不用改。

import { useSyncExternalStore } from "react";
import { db } from "./db";
import { Offline, request, ServerError } from "./net";
import { prefs } from "./prefs";
import { sha256 } from "@/lib/sha256";
import type { ContentInfo, IndexRow, KbCatalog, KbDoc, KbRelated, Question, SubjectId, Taxonomy } from "./types";

export interface Manifest {
  version: number;
  sample?: boolean;
  generated: string;
  counts: Record<string, number>;
  files: {
    taxonomy: string;
    index: Record<string, string>;
    packs: Record<string, string>;
    kb?: Record<string, string>;
    /** 資料庫目錄、題目 → 相關筆記（第 4 階段） */
    kbcat?: string;
    kbrel?: string;
    sample?: string;
    cases?: string;
  };
}

interface Stored {
  h: string;
  m: Manifest;
}

// ---------- 下載狀態（設定頁顯示） ----------

export interface ContentStatus {
  /** 目前用的版本產生時間；null = 裝置上還沒有任何內容 */
  generated: string | null;
  h: string | null;
  /** 正在下載新版或離線包：已完成／總數 */
  downloading: { done: number; total: number } | null;
  /** 每科的包：裝置上有幾個／總共幾個 */
  subjects: Record<string, { have: number; total: number; bytes: number }>;
  error: string | null;
}

let status: ContentStatus = { generated: null, h: null, downloading: null, subjects: {}, error: null };
const listeners = new Set<() => void>();
function setStatus(p: Partial<ContentStatus>) {
  status = { ...status, ...p };
  listeners.forEach((fn) => fn());
}
export function useContentStatus(): ContentStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => status,
  );
}

// ---------- 檔案 ----------

const mem = new Map<string, Promise<unknown>>();

async function fetchText(key: string): Promise<string> {
  const res = await request("/" + key.split("/").map(encodeURIComponent).join("/"), { timeoutMs: 120_000 });
  if (!res.ok) throw new ServerError(res.status, `讀不到內容檔 ${key}（${res.status}）`);
  return res.text();
}

async function download(key: string): Promise<unknown> {
  const text = await fetchText(key);
  const data = JSON.parse(text) as unknown;
  await db.cfile.put({ key, data, bytes: text.length, at: Date.now() });
  return data;
}

/** 讀一個內容檔：記憶體 → IndexedDB → 網路（下載後留在裝置上）。 */
function file<T>(key: string): Promise<T> {
  let p = mem.get(key);
  if (!p) {
    p = (async () => {
      const hit = await db.cfile.get(key);
      return hit ? hit.data : download(key);
    })().catch((e) => {
      mem.delete(key); // 失敗不快取，下次重試
      throw e;
    });
    mem.set(key, p);
  }
  return p as Promise<T>;
}

const has = async (key: string) => (await db.cfile.where("key").equals(key).count()) > 0;

// ---------- manifest ----------

async function hashText(text: string): Promise<string> {
  const d = await sha256(new TextEncoder().encode(text));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

let active: Stored | null = null;
let activeP: Promise<Stored> | null = null;

async function fetchManifest(): Promise<Stored> {
  const res = await request("/c/manifest.json", { cache: "no-cache", timeoutMs: 20_000 });
  if (!res.ok) throw new ServerError(res.status, res.status === 404 ? "伺服器上還沒有題庫內容（請先在 Mac 上 pmq publish）" : `讀不到題庫目錄（${res.status}）`);
  const text = await res.text();
  return { h: await hashText(text), m: JSON.parse(text) as Manifest };
}

/** 一版內容至少要有的檔：目錄、各科索引、資料庫目錄與相關筆記對照、特殊情況表。
 *  題目包與筆記是按需或依「離線下載」設定下載（舊的樣本內容包沒有資料庫目錄，筆記仍算必要）。 */
function essentials(m: Manifest): string[] {
  const f = m.files;
  const kb = f.kbcat ? [f.kbcat, ...(f.kbrel ? [f.kbrel] : [])] : Object.values(f.kb ?? {});
  return [f.taxonomy, ...Object.values(f.index), ...kb, ...(f.cases ? [f.cases] : []), ...(f.sample ? [f.sample] : [])];
}

/** 某一科的題目包與筆記（離線下載的單位）。 */
function subjectFiles(m: Manifest): [string, string][] {
  return [...Object.entries(m.files.packs), ...Object.entries(m.files.kb ?? {})].map(([k, v]) => [k.split("/")[0], v]);
}

function wantedPacks(m: Manifest): string[] {
  return subjectFiles(m)
    .filter(([s]) => prefs.offline(s))
    .map(([, k]) => k);
}

async function fetchAll(keys: string[], onProgress?: (done: number) => void): Promise<void> {
  const todo: string[] = [];
  for (const k of new Set(keys)) if (!(await has(k))) todo.push(k);
  let done = keys.length - todo.length;
  onProgress?.(done);
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const k = todo[i++];
      await download(k);
      onProgress?.(++done);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

async function activate(s: Stored): Promise<void> {
  await db.kv.put({ key: "content.manifest", value: s });
  active = s;
  activeP = Promise.resolve(s);
  rowMaps.clear();
  setStatus({ generated: s.m.generated, h: s.h });
  void refreshSubjectStatus();
}

async function current(): Promise<Stored> {
  if (active) return active;
  if (!activeP) {
    activeP = (async () => {
      const saved = (await db.kv.get("content.manifest"))?.value as Stored | undefined;
      if (saved?.m?.files) {
        active = saved;
        setStatus({ generated: saved.m.generated, h: saved.h });
        void refreshSubjectStatus();
        return saved;
      }
      // 第一次開：先把目錄與索引抓下來才能用
      const s = await fetchManifest();
      await fetchAll(essentials(s.m));
      await activate(s);
      return s;
    })().catch((e) => {
      activeP = null;
      setStatus({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    });
  }
  return activeP;
}

const manifest = async () => (await current()).m;

let updating: Promise<boolean> | null = null;

/**
 * 檢查並下載新版內容（同步時呼叫；remoteH 是伺服器回報的 manifest 雜湊，相同就不必抓 manifest）。
 * 全部檔案到齊才切換。回傳是否換了新版。
 */
export function updateContent(remoteH?: string | null): Promise<boolean> {
  if (updating) return updating;
  updating = (async () => {
    try {
      const cur = active ?? (await current().catch(() => null));
      if (cur && remoteH && cur.h === remoteH) {
        await fetchOffline(cur.m);
        return false;
      }
      const s = await fetchManifest();
      if (cur && s.h === cur.h) {
        await fetchOffline(cur.m);
        return false;
      }
      const keys = [...essentials(s.m), ...wantedPacks(s.m)];
      setStatus({ downloading: { done: 0, total: keys.length }, error: null });
      await fetchAll(keys, (done) => setStatus({ downloading: { done, total: keys.length } }));
      await activate(s);
      await gc(s.m);
      return true;
    } catch (e) {
      if (!(e instanceof Offline)) setStatus({ error: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      setStatus({ downloading: null });
      updating = null;
    }
  })();
  return updating;
}

/** 依「離線下載」設定補齊目前這版的包。 */
async function fetchOffline(m: Manifest): Promise<void> {
  const keys = wantedPacks(m);
  const missing: string[] = [];
  for (const k of keys) if (!(await has(k))) missing.push(k);
  if (!missing.length) return refreshSubjectStatus();
  setStatus({ downloading: { done: 0, total: missing.length }, error: null });
  try {
    await fetchAll(missing, (done) => setStatus({ downloading: { done, total: missing.length } }));
  } finally {
    setStatus({ downloading: null });
    void refreshSubjectStatus();
  }
}

/** 刪掉新版不再引用的檔（舊版的包、索引）。 */
async function gc(m: Manifest): Promise<void> {
  const keep = new Set([...essentials(m), ...Object.values(m.files.packs), ...Object.values(m.files.kb ?? {})]);
  const drop: string[] = [];
  await db.cfile.each((f) => {
    if (!keep.has(f.key)) drop.push(f.key);
  });
  for (const k of drop) mem.delete(k);
  await db.cfile.bulkDelete(drop);
  void refreshSubjectStatus();
}

async function refreshSubjectStatus(): Promise<void> {
  const m = active?.m;
  if (!m) return;
  const out: ContentStatus["subjects"] = {};
  const sizes = new Map<string, number>();
  await db.cfile.each((f) => sizes.set(f.key, f.bytes));
  for (const [s, key] of subjectFiles(m)) {
    const e = (out[s] ??= { have: 0, total: 0, bytes: 0 });
    e.total++;
    if (sizes.has(key)) {
      e.have++;
      e.bytes += sizes.get(key)!;
    }
  }
  setStatus({ subjects: out });
}

/** 設定頁：開關某一科的離線下載。關掉時刪除已下載的包。 */
export async function setOffline(subject: SubjectId, on: boolean): Promise<void> {
  prefs.setOffline(subject, on);
  const m = active?.m;
  if (!m) return;
  if (on) {
    await fetchOffline(m).catch(() => undefined);
  } else {
    const keys = subjectFiles(m)
      .filter(([s]) => s === subject)
      .map(([, k]) => k);
    for (const k of keys) mem.delete(k);
    await db.cfile.bulkDelete(keys);
  }
  await refreshSubjectStatus();
}

const rowMaps = new Map<string, Promise<Map<string, IndexRow>>>();
const packMaps = new WeakMap<object, Map<string, Question>>();

export const content = {
  async info(): Promise<ContentInfo> {
    const m = await manifest();
    return { version: m.version, generated: m.generated, counts: m.counts, sample: !!m.sample, kb: Object.keys(m.files.kb ?? {}) };
  },

  async taxonomy(): Promise<Taxonomy> {
    return file<Taxonomy>((await manifest()).files.taxonomy);
  },

  /** 該科全部題目的索引列。 */
  async index(subject: SubjectId): Promise<IndexRow[]> {
    const f = (await manifest()).files.index[subject];
    if (!f) throw new Error(`內容包裡沒有科目 ${subject}`);
    return file<IndexRow[]>(f);
  },

  /** 有本文可顯示的題目 ID；null 代表全部都有（正式內容包）。 */
  async bodyIds(): Promise<Set<string> | null> {
    const m = await manifest();
    if (!m.sample || !m.files.sample) return null;
    return new Set((await file<{ ids: string[] }>(m.files.sample)).ids);
  },

  /** 「特殊情況 → 題目」對照（給 /dev/ui 用）。正式內容包由 pmq publish 一併產生。 */
  async sampleCases(): Promise<Record<string, { desc: string; ids: string[] }>> {
    const m = await manifest();
    const f = m.files.cases ?? m.files.sample;
    if (!f) return {};
    return (await file<{ cases: Record<string, { desc: string; ids: string[] }> }>(f)).cases ?? {};
  },

  async row(id: string): Promise<IndexRow | null> {
    const tax = await content.taxonomy();
    for (const s of tax.subjects) {
      if (!new RegExp(s.id_pattern).test(id)) continue;
      const fkey = (await manifest()).files.index[s.id];
      let map = rowMaps.get(fkey);
      if (!map) {
        map = content.index(s.id).then((rows) => new Map(rows.map((r) => [r.id, r])));
        rowMaps.set(fkey, map);
      }
      const row = (await map).get(id);
      if (row) return row;
    }
    return null;
  },

  /** 題目本文。找不到這一題回 null；本文不在裝置上而且現在下載不到（離線）回 "missing"。 */
  async question(id: string): Promise<Question | null | "missing"> {
    const row = await content.row(id);
    if (!row) return null;
    const key = (await manifest()).files.packs[row.pack];
    if (!key) return "missing";
    let pack: { questions: Question[] };
    try {
      pack = await file<{ questions: Question[] }>(key);
    } catch (e) {
      if (e instanceof Offline) return "missing";
      throw e;
    }
    let byId = packMaps.get(pack);
    if (!byId) {
      byId = new Map(pack.questions.map((q) => [q.id, q]));
      packMaps.set(pack, byId);
    }
    return byId.get(id) ?? "missing";
  },

  /** 一份筆記；不在這版內容包裡回 null。 */
  async kb(key: string): Promise<KbDoc | null> {
    const f = (await manifest()).files.kb?.[key];
    if (!f) return null;
    return file<KbDoc>(f);
  },

  /** 資料庫目錄。舊的內容包沒有目錄檔時，用筆記本身湊一份。 */
  async kbCatalog(): Promise<KbCatalog> {
    const m = await manifest();
    if (m.files.kbcat) return file<KbCatalog>(m.files.kbcat);
    const tax = await content.taxonomy();
    const docs = await Promise.all(Object.keys(m.files.kb ?? {}).map((k) => content.kb(k)));
    const subjects: KbCatalog["subjects"] = [];
    for (const d of docs) {
      if (!d) continue;
      let s = subjects.find((x) => x.id === d.subject);
      if (!s) subjects.push((s = { id: d.subject, name: tax.subjects.find((x) => x.id === d.subject)?.name ?? d.subject, imported: true, groups: [{ id: "_", title: "筆記", docs: [] }] }));
      s.groups[0].docs.push({ key: `${d.subject}/${d.doc}`, title: d.title, file: d.file, counts: {}, sections: [] });
    }
    return { subjects };
  },

  /** 引用這一題的筆記段落。 */
  async kbRelated(qid: string): Promise<KbRelated[]> {
    const m = await manifest();
    if (!m.files.kbrel) return [];
    return (await file<Record<string, KbRelated[]>>(m.files.kbrel))[qid] ?? [];
  },

  /** 某一科全部的內容包鍵（搜尋用）。 */
  async packKeys(subject: SubjectId): Promise<string[]> {
    const m = await manifest();
    return Object.entries(m.files.packs)
      .filter(([pack]) => pack.split("/")[0] === subject)
      .map(([, k]) => k);
  },

  /** 確保某一科的包都在裝置上（搜尋要讀全部本文）。回傳實際在裝置上的鍵（離線時可能少幾個）。 */
  async ensurePacks(subject: SubjectId, onProgress?: (done: number, total: number) => void): Promise<string[]> {
    const keys = await content.packKeys(subject);
    const ok: string[] = [];
    let done = 0;
    let i = 0;
    const worker = async () => {
      while (i < keys.length) {
        const k = keys[i++];
        try {
          // 只確保在 IndexedDB 裡（由搜尋的背景執行緒去讀），不把整科的包留在畫面這邊的記憶體
          if (!(await has(k))) await download(k);
          ok.push(k);
        } catch {
          /* 離線又沒下載：略過這一包 */
        }
        onProgress?.(++done, keys.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    void refreshSubjectStatus();
    return ok;
  },

  /** 圖檔網址。src 是內容包裡的鍵（"a/<sha>.svg"）。圖由 Service Worker 快取（看過的圖離線可看）。 */
  assetUrl(src: string): string {
    return "/" + src;
  },
};
