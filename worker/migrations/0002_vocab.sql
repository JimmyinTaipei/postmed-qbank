-- 第 8B-1 階段（規格書 §4.6、§9.11）：單字卡的欄位、查過的單字。只新增欄位與新表，不動既有資料。
-- 正式站套用前先備份：pmq backup pull（docs/部署步驟.md）。
-- 註：規劃文件原本把這一份編為 0003、克漏字（5B）的 cloze_mark 編為 0002；8B-1 先做，所以這一份是 0002，cloze_mark 改用 0003。

-- 有欄位的卡（vocab）：JSON，各欄位的 Markdown；有值時以它為準，front_md／back_md 由它產生。其他種類是 NULL。
ALTER TABLE card ADD COLUMN fields TEXT;

-- 卡片的 seq 觸發程序要把 fields 算進去（只改 fields 也要同步）
DROP TRIGGER card_seq_u;
CREATE TRIGGER card_seq_u AFTER UPDATE OF deck_id, kind, front_md, back_md, fields, tags, origin, updated_at, deleted ON card BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE card SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

-- 查過的單字（第 8B 階段）：做題時在哪裡查了哪個字、連到哪張單字卡。8B-2 開始寫入；8B-1 先建表與同步。
CREATE TABLE vocab_mark (
  id TEXT PRIMARY KEY,
  lemma TEXT NOT NULL,            -- 原形（小寫）
  card TEXT,                      -- 連到的單字卡 ID；還沒有卡時是 NULL
  target TEXT NOT NULL,           -- 'q:ENG-000058/ques'｜'g:<gid>'（題組的文章）｜'kb:<doc>#<bid>'
  quote TEXT NOT NULL, prefix TEXT, suffix TEXT,
  start INTEGER, "end" INTEGER,
  kind TEXT NOT NULL,             -- lookup（查過）｜link（手動連到現有的卡）
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0, seq INTEGER
);

CREATE TRIGGER vocab_mark_seq_i AFTER INSERT ON vocab_mark BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE vocab_mark SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER vocab_mark_seq_u AFTER UPDATE OF lemma, card, target, quote, prefix, suffix, start, "end", kind, updated_at, deleted ON vocab_mark BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE vocab_mark SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

CREATE INDEX vocab_mark_seq_idx ON vocab_mark(seq);
CREATE INDEX vocab_mark_lemma_idx ON vocab_mark(lemma);
