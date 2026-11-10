// 本機資料庫（IndexedDB／Dexie）。只有 src/data/ 裡的檔案可以 import 這個檔。
// 表與欄位照規格書 §4.6；1A 只用到 attempt、session、flag、setting、srs_state，
// 其餘先建好表，之後的階段不用為了加表而升版。

import Dexie, { type Table } from "dexie";
import type { Attempt, Flag, Session, Setting } from "./types";

export interface SrsState {
  item: string;
  due: number;
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
  suspended: 0 | 1;
  updated_at: number;
  seq?: number;
}

class PmqDB extends Dexie {
  attempt!: Table<Attempt, string>;
  session!: Table<Session, string>;
  flag!: Table<Flag, [string, string]>;
  setting!: Table<Setting, string>;
  srs_state!: Table<SrsState, string>;

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
  }
}

export const db = new PmqDB();
