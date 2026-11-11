// 單一密碼登入（規格書 §10）。
// - 密碼只以 PBKDF2-SHA256（100,000 次、16 位元組鹽）的結果存在 secret AUTH_HASH。
// - 登入成功發 32 位元組隨機代碼，雜湊後存 auth_session；cookie HttpOnly; Secure; SameSite=Lax，180 天，使用時順延。
// - 15 分鐘內失敗 5 次 → 鎖 15 分鐘（全站）；每次失敗固定延遲 1 秒。

import type { Context } from "hono";
import type { App, Env } from "./env";
import { b64url, enc, safeEqual, sha256Hex, sleep, unb64 } from "./util";

export const COOKIE = "pmq_s";
const DAY = 86_400_000;
export const SESSION_MS = 180 * DAY;
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
const REFRESH_MS = 3600_000; // 最後使用時間超過 1 小時才寫回，避免每個請求都寫 D1

export async function verifyPassword(stored: string | undefined, password: string): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100_000) return false;
  const salt = unb64(parts[2]);
  const expect = unb64(parts[3]);
  const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, expect.length * 8);
  return safeEqual(new Uint8Array(bits), expect);
}

/** 目前是否被鎖。回傳還要等幾秒（0 = 沒鎖）。 */
export async function lockedFor(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare("SELECT at FROM auth_fail ORDER BY at DESC LIMIT ?").bind(MAX_FAILS).all<{ at: number }>();
  if (results.length < MAX_FAILS) return 0;
  const newest = results[0].at;
  const oldest = results[MAX_FAILS - 1].at;
  if (newest - oldest > WINDOW_MS) return 0; // 這 5 次不在同一個 15 分鐘內
  const until = newest + WINDOW_MS;
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

async function failsInWindow(env: Env, now: number): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM auth_fail WHERE at > ?").bind(now - WINDOW_MS).first<{ n: number }>();
  return r?.n ?? 0;
}

function cookieHeader(env: Env, value: string, maxAgeS: number): string {
  const secure = env.DEV === "1" ? "" : "; Secure";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure}`;
}

function readCookie(req: Request): string | null {
  const raw = req.headers.get("Cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) {
      const v = part.slice(i + 1).trim();
      return /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : null;
    }
  }
  return null;
}

export async function login(c: Context<App>): Promise<Response> {
  const env = c.env;
  const now = Date.now();
  if (!env.AUTH_HASH) return c.json({ error: "not_configured", message: "伺服器還沒設定密碼（AUTH_HASH）。" }, 503);
  let body: { password?: unknown; label?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  const password = typeof body.password === "string" ? body.password : "";
  const label = typeof body.label === "string" ? body.label.slice(0, 60) : "";
  const wait = await lockedFor(env, now);
  if (wait > 0) return c.json({ error: "locked", retry_after_s: wait }, 429, { "Retry-After": String(wait) });

  if (!password || !(await verifyPassword(env.AUTH_HASH, password))) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO auth_fail (at) VALUES (?)").bind(now),
      env.DB.prepare("DELETE FROM auth_fail WHERE at < ?").bind(now - DAY),
    ]);
    await sleep(1000);
    const lock = await lockedFor(env, Date.now());
    if (lock > 0) return c.json({ error: "locked", retry_after_s: lock }, 429, { "Retry-After": String(lock) });
    const remaining = Math.max(0, MAX_FAILS - (await failsInWindow(env, Date.now())));
    return c.json({ error: "wrong_password", remaining }, 401);
  }

  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const th = await sha256Hex(token);
  const ua = c.req.header("User-Agent") ?? "";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO auth_session (token_hash, label, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)").bind(
      th,
      label || guessDevice(ua),
      now,
      now,
      now + SESSION_MS,
    ),
    env.DB.prepare("DELETE FROM auth_fail"),
    env.DB.prepare("DELETE FROM auth_session WHERE expires_at < ?").bind(now),
  ]);
  return c.json({ ok: true }, 200, { "Set-Cookie": cookieHeader(env, token, SESSION_MS / 1000) });
}

function guessDevice(ua: string): string {
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Macintosh/.test(ua)) return /Mobile/.test(ua) ? "iPad" : "Mac"; // iPadOS 的 Safari 會自稱 Macintosh
  if (/Windows/.test(ua)) return "Windows";
  return "瀏覽器";
}

/** 檢查 cookie。有效時回傳 token 雜湊，並視需要順延效期（回傳要加的 Set-Cookie）。 */
export async function checkSession(env: Env, req: Request): Promise<{ th: string; setCookie: string | null } | null> {
  const token = readCookie(req);
  if (!token) return null;
  const th = await sha256Hex(token);
  const now = Date.now();
  const row = await env.DB.prepare("SELECT last_seen, expires_at FROM auth_session WHERE token_hash = ?").bind(th).first<{ last_seen: number; expires_at: number }>();
  if (!row || row.expires_at < now) return null;
  if (now - row.last_seen < REFRESH_MS) return { th, setCookie: null };
  await env.DB.prepare("UPDATE auth_session SET last_seen = ?, expires_at = ? WHERE token_hash = ?").bind(now, now + SESSION_MS, th).run();
  return { th, setCookie: cookieHeader(env, token, SESSION_MS / 1000) };
}

export async function logout(c: Context<App>): Promise<Response> {
  const th = c.get("session");
  if (th) await c.env.DB.prepare("DELETE FROM auth_session WHERE token_hash = ?").bind(th).run();
  return c.json({ ok: true }, 200, { "Set-Cookie": cookieHeader(c.env, "", 0) });
}

export async function listDevices(c: Context<App>): Promise<Response> {
  const now = Date.now();
  const { results } = await c.env.DB.prepare("SELECT token_hash, label, created_at, last_seen FROM auth_session WHERE expires_at > ? ORDER BY last_seen DESC")
    .bind(now)
    .all<{ token_hash: string; label: string; created_at: number; last_seen: number }>();
  const cur = c.get("session");
  return c.json({
    devices: results.map((r) => ({ id: r.token_hash.slice(0, 16), label: r.label, created_at: r.created_at, last_seen: r.last_seen, current: r.token_hash === cur })),
  });
}

export async function revokeDevice(c: Context<App>): Promise<Response> {
  const id = c.req.param("id") ?? "";
  if (!/^[0-9a-f]{16}$/.test(id)) return c.json({ error: "bad_request" }, 400);
  const r = await c.env.DB.prepare("DELETE FROM auth_session WHERE substr(token_hash, 1, 16) = ?").bind(id).run();
  return c.json({ ok: true, removed: r.meta.changes ?? 0 });
}

/** 管理 API：Authorization: Bearer <ADMIN_TOKEN>。 */
export function checkAdmin(env: Env, req: Request): "ok" | "unconfigured" | "denied" {
  const want = env.ADMIN_TOKEN ?? "";
  if (want.length < 32) return "unconfigured";
  const got = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return safeEqual(enc.encode(got), enc.encode(want)) ? "ok" : "denied";
}
