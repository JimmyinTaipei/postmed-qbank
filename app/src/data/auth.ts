// 登入、登出、登入中的裝置（規格書 §10）。畫面經 @/data 使用。

import { db } from "./db";
import { goLogin, Offline, request, requestJson } from "./net";
import { prefs } from "./prefs";
import { syncNow } from "./sync";

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: "wrong"; remaining: number }
  | { ok: false; reason: "locked"; retryAfterS: number }
  | { ok: false; reason: "offline" }
  | { ok: false; reason: "server"; message: string };

export interface DeviceSession {
  id: string;
  label: string;
  created_at: number;
  last_seen: number;
  current: boolean;
}

export const auth = {
  async login(password: string): Promise<LoginResult> {
    let res: Response;
    try {
      res = await fetch("/api/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, label: prefs.device() }),
      });
    } catch {
      return { ok: false, reason: "offline" };
    }
    const j = (await res.json().catch(() => ({}))) as { error?: string; remaining?: number; retry_after_s?: number; message?: string };
    if (res.ok) return { ok: true };
    if (res.status === 429 || j.error === "locked") return { ok: false, reason: "locked", retryAfterS: j.retry_after_s ?? 900 };
    if (res.status === 401) return { ok: false, reason: "wrong", remaining: j.remaining ?? 0 };
    return { ok: false, reason: "server", message: j.message ?? `伺服器回 ${res.status}` };
  },

  /** 登出這台裝置：先盡量把待送資料送出。裝置上的題庫與作答副本留著，重新登入後繼續。 */
  async logout(): Promise<{ unsent: number }> {
    await syncNow().catch(() => undefined);
    const unsent = await db.outbox.count();
    await request("/api/logout", { method: "POST" }).catch(() => undefined);
    goLogin();
    return { unsent };
  },

  async devices(): Promise<DeviceSession[]> {
    return (await requestJson<{ devices: DeviceSession[] }>("/api/auth/devices")).devices;
  },

  async revoke(id: string): Promise<void> {
    await requestJson(`/api/auth/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  /** 「匯出全部」的下載網址（zip：各表 NDJSON、筆記 Markdown）。 */
  exportUrl: "/api/export",

  /** 伺服器連得上而且已登入嗎（設定頁用）。 */
  async check(): Promise<"ok" | "offline"> {
    try {
      await requestJson("/api/me");
      return "ok";
    } catch (e) {
      if (e instanceof Offline) return "offline";
      throw e;
    }
  },
};
