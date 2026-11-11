export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  ASSETS: Fetcher;
  /** PBKDF2 雜湊：pbkdf2_sha256$100000$<salt base64>$<hash base64>（規格書 §10）。由使用者用 scripts/set-secrets.sh 設定。 */
  AUTH_HASH?: string;
  /** 管理 API 金鑰（pmq publish 用）。本體存在 Mac 鑰匙圈。 */
  ADMIN_TOKEN?: string;
  /** 只在本機 wrangler dev（.dev.vars）設為 "1"：cookie 不加 Secure，讓 http://localhost 也能登入。 */
  DEV?: string;
}

export type App = { Bindings: Env; Variables: { session: string | null } };
