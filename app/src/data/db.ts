// 本機資料庫（IndexedDB／Dexie）。只有 src/data/ 裡的檔案可以 import 這個檔。
// 表與欄位照規格書 §4.6；1A 只用到 attempt、session、flag、setting、srs_state，
// 其餘先建好表，之後的階段不用為了加表而升版。
// 第 1B 階段（版本 2）加了：cfile（下載到裝置的內容包檔案）、kv（同步游標、目前的 manifest 等本機狀態）。

import Dexie, { type Table } from "dexie";
import type { Attempt, ContentPatch, Flag, Highlight, Note, ReviewLog, Session, Setting, SrsState } from "./types";
export type { SrsState } from "./types";

/** 待送佇列的一筆：哪張表的哪一列（主鍵）。送出時才讀那一列目前的值，同一列改很多次只送最後一次。 */
export interface OutboxEntry {
  n?: number;
  table: string;
  key: string | string[];
  at: number;
}

/** 下載到裝置的內容檔（檔名含雜湊，內容永不變）。 */
export interface ContentFile {
  key: string; // "c/pack/PHY/Ch15-<hash>.json"
  data: unknown;
  bytes: number;
  at: number;
}

export interface Kv {
  key: string;
  value: unknown;
}


class PmqDB extends Dexie {
  attempt!: Table<Attempt, string>;
  session!: Table<Session, string>;
  flag!: Table<Flag, [string, string]>;
  setting!: Table<Setting, string>;
  srs_state!: Table<SrsState, string>;
  review_log!: Table<ReviewLog, string>;
  note!: Table<Note, string>;
  highlight!: Table<Highlight, string>;
  content_patch!: Table<ContentPatch, string>;
  outbox!: Table<OutboxEntry, number>;
  cfile!: Table<ContentFile, string>;
  kv!: Table<Kv, string>;

  constructor() {
    super("postmed-qbank");
    this.version(1).stores({
      attempt: "id, item, session_id, created_at, open",
      session: "id, updated_at",
      flag: "[item+kind], kind, updated_at",
      setting: "key",
      srs_state: "item, due",
      review_log: "id, item, reviewed_at",
      note: "id, target",
      highlight: "id, target",
      ink: "id, target",
      content_patch: "id, target, status",
      deck: "id",
      card: "id, deck_id",
      media: "sha",
      outbox: "++n, table", // 1B：待送佇列
    });
    this.version(2).stores({
      cfile: "key",
      kv: "key",
    });
  }
}

export const db = new PmqDB();
