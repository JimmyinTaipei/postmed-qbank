-- 個人資料（規格書 §4.6）。第 1B 階段一次建好全部的表，之後的階段不用為了加表而動 D1。
-- 每張會同步的表都有 seq：由下面的觸發程序在每次寫入時從 meta.sync_seq 遞增取號。
-- 用觸發程序而不是在 Worker 裡算，是為了讓「取號＋寫入」永遠在同一個 SQL 敘述內完成，兩台裝置同時推也不會拿到重複的號碼。

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
INSERT INTO meta (key, value) VALUES ('sync_seq', '0');

-- 作答：只增
CREATE TABLE attempt (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  session_id TEXT,
  mode TEXT NOT NULL,
  chosen TEXT,
  correct INTEGER,
  confidence INTEGER,
  elapsed_ms INTEGER,
  content_h TEXT,
  device TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seq INTEGER
);

CREATE TABLE session (
  id TEXT PRIMARY KEY, mode TEXT NOT NULL,
  filter TEXT NOT NULL,
  items TEXT NOT NULL,
  cursor INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL, ended_at INTEGER,
  time_limit_s INTEGER, score REAL,
  device TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0, seq INTEGER
);

CREATE TABLE srs_state (
  item TEXT PRIMARY KEY,
  due INTEGER NOT NULL, stability REAL, difficulty REAL,
  reps INTEGER, lapses INTEGER, state INTEGER,
  last_review INTEGER, suspended INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL, seq INTEGER
);

-- 複習評分：只增
CREATE TABLE review_log (
  id TEXT PRIMARY KEY, item TEXT NOT NULL,
  rating INTEGER NOT NULL,
  state_before INTEGER, elapsed_days REAL, scheduled_days REAL,
  duration_ms INTEGER, attempt_id TEXT,
  device TEXT NOT NULL, reviewed_at INTEGER NOT NULL, seq INTEGER
);

CREATE TABLE flag (
  item TEXT NOT NULL, kind TEXT NOT NULL,
  value INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, seq INTEGER,
  PRIMARY KEY (item, kind)
);

CREATE TABLE note (
  id TEXT PRIMARY KEY, target TEXT NOT NULL,
  body_md TEXT NOT NULL,
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0, seq INTEGER
);

CREATE TABLE highlight (
  id TEXT PRIMARY KEY, target TEXT NOT NULL,
  quote TEXT NOT NULL, prefix TEXT, suffix TEXT,
  start INTEGER, "end" INTEGER,
  color TEXT NOT NULL, comment_md TEXT,
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0, seq INTEGER
);

CREATE TABLE ink (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, page INTEGER NOT NULL DEFAULT 0,
  strokes BLOB NOT NULL,
  w INTEGER, h INTEGER,
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0, seq INTEGER
);

CREATE TABLE content_patch (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  field TEXT NOT NULL,
  base_h TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT, device TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, seq INTEGER
);

CREATE TABLE deck (id TEXT PRIMARY KEY, name TEXT NOT NULL, subject TEXT, parent TEXT,
                   updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0, seq INTEGER);
CREATE TABLE card (
  id TEXT PRIMARY KEY, deck_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  front_md TEXT NOT NULL, back_md TEXT NOT NULL,
  tags TEXT,
  origin TEXT,
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0, seq INTEGER
);
CREATE TABLE media (sha TEXT PRIMARY KEY, mime TEXT, bytes INTEGER, created_at INTEGER, seq INTEGER);

CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL, seq INTEGER);

-- 不同步的伺服器表
CREATE TABLE auth_session (token_hash TEXT PRIMARY KEY, label TEXT, created_at INTEGER, last_seen INTEGER, expires_at INTEGER);
CREATE TABLE auth_fail (at INTEGER NOT NULL);

-- ---------- seq ----------
-- 寫入後取號。UPDATE 觸發程序只看資料欄位（AFTER UPDATE OF …），自己改 seq 時不會再觸發。

CREATE TRIGGER attempt_seq AFTER INSERT ON attempt BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE attempt SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER review_log_seq AFTER INSERT ON review_log BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE review_log SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER media_seq AFTER INSERT ON media BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE media SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE sha = NEW.sha;
END;

CREATE TRIGGER session_seq_i AFTER INSERT ON session BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE session SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER session_seq_u AFTER UPDATE OF mode, filter, items, cursor, started_at, ended_at, time_limit_s, score, device, updated_at, deleted ON session BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE session SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

CREATE TRIGGER srs_state_seq_i AFTER INSERT ON srs_state BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE srs_state SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE item = NEW.item;
END;
CREATE TRIGGER srs_state_seq_u AFTER UPDATE OF due, stability, difficulty, reps, lapses, state, last_review, suspended, updated_at ON srs_state BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE srs_state SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE item = NEW.item;
END;

CREATE TRIGGER flag_seq_i AFTER INSERT ON flag BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE flag SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE item = NEW.item AND kind = NEW.kind;
END;
CREATE TRIGGER flag_seq_u AFTER UPDATE OF value, updated_at ON flag BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE flag SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE item = NEW.item AND kind = NEW.kind;
END;

CREATE TRIGGER note_seq_i AFTER INSERT ON note BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE note SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER note_seq_u AFTER UPDATE OF target, body_md, updated_at, deleted ON note BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE note SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

CREATE TRIGGER highlight_seq_i AFTER INSERT ON highlight BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE highlight SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER highlight_seq_u AFTER UPDATE OF target, quote, prefix, suffix, start, "end", color, comment_md, updated_at, deleted ON highlight BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE highlight SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

CREATE TRIGGER ink_seq_i AFTER INSERT ON ink BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE ink SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER ink_seq_u AFTER UPDATE OF target, page, strokes, w, h, updated_at, deleted ON ink BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE ink SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

CREATE TRIGGER content_patch_seq_i AFTER INSERT ON content_patch BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE content_patch SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER content_patch_seq_u AFTER UPDATE OF target, field, base_h, value, status, note, device, created_at, updated_at ON content_patch BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE content_patch SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

CREATE TRIGGER deck_seq_i AFTER INSERT ON deck BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE deck SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER deck_seq_u AFTER UPDATE OF name, subject, parent, updated_at, deleted ON deck BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE deck SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

CREATE TRIGGER card_seq_i AFTER INSERT ON card BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE card SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;
CREATE TRIGGER card_seq_u AFTER UPDATE OF deck_id, kind, front_md, back_md, tags, origin, updated_at, deleted ON card BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE card SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE id = NEW.id;
END;

CREATE TRIGGER setting_seq_i AFTER INSERT ON setting BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE setting SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE key = NEW.key;
END;
CREATE TRIGGER setting_seq_u AFTER UPDATE OF value, updated_at ON setting BEGIN
  UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'sync_seq';
  UPDATE setting SET seq = (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'sync_seq') WHERE key = NEW.key;
END;

-- 拉取（seq > 游標）用的索引
CREATE INDEX attempt_seq_idx ON attempt(seq);
CREATE INDEX attempt_item_idx ON attempt(item);
CREATE INDEX session_seq_idx ON session(seq);
CREATE INDEX srs_state_seq_idx ON srs_state(seq);
CREATE INDEX review_log_seq_idx ON review_log(seq);
CREATE INDEX flag_seq_idx ON flag(seq);
CREATE INDEX note_seq_idx ON note(seq);
CREATE INDEX highlight_seq_idx ON highlight(seq);
CREATE INDEX ink_seq_idx ON ink(seq);
CREATE INDEX content_patch_seq_idx ON content_patch(seq);
CREATE INDEX deck_seq_idx ON deck(seq);
CREATE INDEX card_seq_idx ON card(seq);
CREATE INDEX media_seq_idx ON media(seq);
CREATE INDEX setting_seq_idx ON setting(seq);
