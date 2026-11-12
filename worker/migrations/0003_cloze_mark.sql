-- 第 5B 階段（規格書 §4.6、§9.8）：克漏字在原文上的位置。只新增這一張表與它的 seq 觸發器，不動既有的表。
-- 正式站套用前先備份：pmq backup pull（docs/部署步驟.md）。
-- 卡片本身仍是普通的克漏字卡（card.front_md 裡的 {{cN::…}}）；這張表只記「它在原文的哪裡」。
-- 膠帶顏色不存：由那張卡的複習紀錄算出來（沒錯過藍、錯 1 次橘、2 次以上紅）。

CREATE TABLE cloze_mark (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,           -- 同 highlight：'kb:<doc>#<bid>'｜'q:PHY-…/sol'｜'q:PHY-…/idea'（題幹不能挖）
  quote TEXT NOT NULL, prefix TEXT, suffix TEXT,   -- 定位方式與 highlight 相同
  start INTEGER, "end" INTEGER,
  note TEXT NOT NULL,             -- 卡片那一則筆記的鍵（＝card.origin.note）；同一個區塊的挖空共用一則
  n INTEGER NOT NULL,             -- 克漏字編號 1、2…；同號一起遮、是同一張卡
  hint TEXT,                      -- 提示（{{c1::答案::提示}}）
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0, seq INTEGER
);

CREATE TRIGGER cloze_mark_seq_i AFTER INSERT ON cloze_mark BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE cloze_mark SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER cloze_mark_seq_u AFTER UPDATE OF target, quote, prefix, suffix, start, "end", note, n, hint, updated_at, deleted ON cloze_mark BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE cloze_mark SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

CREATE INDEX cloze_mark_seq_idx ON cloze_mark(seq);
CREATE INDEX cloze_mark_note_idx ON cloze_mark(note);
