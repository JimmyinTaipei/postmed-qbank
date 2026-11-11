// 「記住上次看到哪裡」（第 4B 階段，規格書 §9.4；§9.9 題目瀏覽之後也用同一個函式）。
// 存在會同步的設定（setting）裡：一個陣列，最新的在前，同一個對象只留一筆。兩台裝置各自讀，同步後留較新的整份。

import { useLiveQuery } from "dexie-react-hooks";
import { settings } from "./personal";

/** 把一筆放到最前面（同一個對象的舊紀錄拿掉），最多留 limit 筆。 */
export async function pushRecent<T extends { at: number }>(key: string, same: (e: T) => boolean, entry: T, limit = 30): Promise<void> {
  const list = (await settings.get<T[]>(key)) ?? [];
  await settings.set(key, [entry, ...(Array.isArray(list) ? list : []).filter((e) => !same(e))].slice(0, limit));
}

/** 資料庫筆記讀到哪裡：畫面最上方的區塊；標題路徑與捲動比例是區塊找不到時（筆記改版）的備援。 */
export interface KbRecent {
  key: string;
  bid: string;
  /** 這個區塊所在的標題路徑（由外到內） */
  path: string[];
  /** 捲動比例 0–1 */
  ratio: number;
  /** 展開到第幾層 */
  depth: number;
  at: number;
}
export const KB_RECENT = "kb.recent";

export const kbRecent = {
  get: async (docKey: string): Promise<KbRecent | null> => ((await settings.get<KbRecent[]>(KB_RECENT)) ?? []).find((e) => e.key === docKey) ?? null,
  save: (e: KbRecent) => pushRecent<KbRecent>(KB_RECENT, (x) => x.key === e.key, e),
};

/** 最近讀過的筆記（最新的在前）。undefined = 還在讀 */
export function useKbRecent(): KbRecent[] | undefined {
  return useLiveQuery(async () => {
    const v = await settings.get<KbRecent[]>(KB_RECENT);
    return Array.isArray(v) ? v : [];
  }, []);
}
