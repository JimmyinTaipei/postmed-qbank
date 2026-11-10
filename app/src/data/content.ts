// 內容包的讀取（規格書 §4.1）。第 1A 階段直接向 /c/、/a/ 取檔（dev 伺服器把它們對到 app/fixtures/）。
// 1B 要換成「下載到 IndexedDB、離線可讀」時，只改這個檔，匯出的函式簽名不變。

import type { ContentInfo, IndexRow, KbDoc, Question, SubjectId, Taxonomy } from "./types";

interface Manifest {
  version: number;
  sample?: boolean;
  generated: string;
  counts: Record<string, number>;
  files: {
    taxonomy: string;
    index: Record<string, string>;
    packs: Record<string, string>;
    kb?: Record<string, string>;
    sample?: string;
  };
}

const once = new Map<string, Promise<unknown>>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = once.get(key) as Promise<T> | undefined;
  if (!p) {
    p = load().catch((e) => {
      once.delete(key); // 失敗不快取，下次重試
      throw e;
    });
    once.set(key, p);
  }
  return p;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch("/" + path.split("/").map(encodeURIComponent).join("/"), init);
  if (!res.ok) throw new Error(`讀不到內容檔 ${path}（${res.status}）`);
  return (await res.json()) as T;
}

const manifest = () => cached("manifest", () => getJson<Manifest>("c/manifest.json", { cache: "no-cache" }));

export const content = {
  async info(): Promise<ContentInfo> {
    const m = await manifest();
    return { version: m.version, generated: m.generated, counts: m.counts, sample: !!m.sample, kb: Object.keys(m.files.kb ?? {}) };
  },

  taxonomy(): Promise<Taxonomy> {
    return cached("taxonomy", async () => getJson<Taxonomy>((await manifest()).files.taxonomy));
  },

  /** 該科全部題目的索引列。 */
  index(subject: SubjectId): Promise<IndexRow[]> {
    return cached(`index:${subject}`, async () => {
      const file = (await manifest()).files.index[subject];
      if (!file) throw new Error(`內容包裡沒有科目 ${subject}`);
      return getJson<IndexRow[]>(file);
    });
  },

  /** 有本文可顯示的題目 ID；null 代表全部都有（正式內容包）。 */
  bodyIds(): Promise<Set<string> | null> {
    return cached("bodyIds", async () => {
      const m = await manifest();
      if (!m.sample || !m.files.sample) return null;
      const s = await getJson<{ ids: string[] }>(m.files.sample);
      return new Set(s.ids);
    });
  },

  /** 樣本的「特殊情況 → 題目」對照（只有樣本模式有；給 /dev/ui 用）。 */
  sampleCases(): Promise<Record<string, { desc: string; ids: string[] }>> {
    return cached("sampleCases", async () => {
      const m = await manifest();
      if (!m.files.sample) return {};
      return (await getJson<{ cases: Record<string, { desc: string; ids: string[] }> }>(m.files.sample)).cases;
    });
  },

  async row(id: string): Promise<IndexRow | null> {
    const tax = await content.taxonomy();
    for (const s of tax.subjects) {
      if (!new RegExp(s.id_pattern).test(id)) continue;
      const map = await cached(`rowmap:${s.id}`, async () => new Map((await content.index(s.id)).map((r) => [r.id, r])));
      const row = map.get(id);
      if (row) return row;
    }
    return null;
  },

  /** 題目本文。找不到這一題回 null；本文不在裝置上（樣本模式、或 1B 尚未下載）回 "missing"。 */
  async question(id: string): Promise<Question | null | "missing"> {
    const row = await content.row(id);
    if (!row) return null;
    const file = (await manifest()).files.packs[row.pack];
    if (!file) return "missing";
    const pack = await cached(`pack:${row.pack}`, async () => {
      const p = await getJson<{ questions: Question[] }>(file);
      return new Map(p.questions.map((q) => [q.id, q]));
    });
    return pack.get(id) ?? "missing";
  },

  kb(key: string): Promise<KbDoc> {
    return cached(`kb:${key}`, async () => {
      const file = (await manifest()).files.kb?.[key];
      if (!file) throw new Error(`內容包裡沒有筆記 ${key}`);
      return getJson<KbDoc>(file);
    });
  },

  /** 圖檔網址。src 是內容包裡的鍵（"a/<sha>.svg"）。 */
  assetUrl(src: string): string {
    return "/" + src;
  },
};
