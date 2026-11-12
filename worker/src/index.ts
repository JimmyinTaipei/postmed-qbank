// postmed-qbank Worker：登入・同步 API・發佈 API・送出靜態檔與內容包（規格書 §3、§10）。
//
// 每個請求都先經過這裡（wrangler.toml 的 assets.run_worker_first = true）：
// 沒有有效 cookie 時，除了登入頁與它需要的幾個靜態檔，其他一律 401（網頁導覽則轉到 /login）。

import { Hono } from "hono";
import { backupNow, deleteObjects, exportCards, listObjects, getBlob, exportZip, getManifest, have, importRows, listPatches, putBlob, putManifest, restoreRoute, updatePatches, usage } from "./admin";
import { checkAdmin, checkSession, listDevices, login, loginStatus, logout, revokeDevice } from "./auth";
import { buildExportZip, nightlyBackup } from "./backup";
import type { App, Env } from "./env";
import { pull, push } from "./sync";
import { taipeiDate } from "./util";

// ---------- 安全標頭（全站） ----------

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // KaTeX 與 React 的 style 屬性
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function secure(res: Response): Response {
  const r = new Response(res.body, res);
  r.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  r.headers.set("Content-Security-Policy", CSP);
  r.headers.set("X-Content-Type-Options", "nosniff");
  r.headers.set("Referrer-Policy", "no-referrer");
  r.headers.set("X-Frame-Options", "DENY");
  return r;
}

// ---------- API ----------

const api = new Hono<App>();

api.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server_error", message: String(err.message ?? err).slice(0, 300) }, 500);
});

api.post("/api/login", login);
api.get("/api/login", loginStatus);

api.use("/api/admin/*", async (c, next) => {
  const r = checkAdmin(c.env, c.req.raw);
  if (r === "unconfigured") return c.json({ error: "not_configured", message: "伺服器還沒設定 ADMIN_TOKEN。" }, 503);
  if (r === "denied") return c.json({ error: "unauthorized" }, 401);
  await next();
});
api.post("/api/admin/have", have);
api.put("/api/admin/blob/*", putBlob);
api.get("/api/admin/blob/*", getBlob);
api.post("/api/admin/manifest", putManifest);
api.get("/api/admin/manifest", getManifest);
api.get("/api/admin/export", exportZip);
api.post("/api/admin/restore", restoreRoute);
api.post("/api/admin/backup", backupNow);
api.get("/api/admin/usage", usage);
api.get("/api/admin/list", listObjects);
api.post("/api/admin/delete", deleteObjects);
api.get("/api/admin/patches", listPatches);
api.post("/api/admin/patches", updatePatches);
api.post("/api/admin/rows", importRows);
api.get("/api/admin/cards", exportCards);

api.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/login" || c.req.path.startsWith("/api/admin/")) return next();
  const s = await checkSession(c.env, c.req.raw);
  if (!s) return c.json({ error: "unauthorized" }, 401);
  c.set("session", s.th);
  if (s.setCookie) c.header("Set-Cookie", s.setCookie, { append: true });
  await next();
});

api.get("/api/me", async (c) => {
  const m = await c.env.DB.prepare("SELECT value FROM meta WHERE key = 'manifest_h'").first<{ value: string }>();
  return c.json({ ok: true, now: Date.now(), manifest_h: m?.value ?? null });
});
api.post("/api/logout", logout);
api.get("/api/auth/devices", listDevices);
api.delete("/api/auth/devices/:id", revokeDevice);
api.post("/api/sync/push", push);
api.get("/api/sync/pull", pull);
api.get("/api/export", async (c) => {
  const { zip } = await buildExportZip(c.env);
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="postmed-qbank-${taipeiDate(Date.now())}.zip"`,
      "Cache-Control": "no-store",
    },
  });
});
api.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

// ---------- 靜態檔與內容包 ----------

/** 沒登入也能取的檔：登入頁、主畫面 App 需要的圖示與 manifest、Service Worker 本身。 */
const PUBLIC = new Set(["/login", "/login.html", "/sw.js", "/manifest.webmanifest", "/icon.svg", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/theme.js", "/login-assets.json", "/favicon.ico"]);

let loginAssets: Set<string> | null = null;
/** 登入頁用到的 JS／CSS（建置時由 app/vite.config.ts 寫進 dist/login-assets.json）。 */
async function loginAllow(env: Env, origin: string): Promise<Set<string>> {
  if (loginAssets) return loginAssets;
  try {
    const r = await env.ASSETS.fetch(new Request(origin + "/login-assets.json"));
    loginAssets = r.ok ? new Set((await r.json()) as string[]) : new Set();
  } catch {
    loginAssets = new Set();
  }
  return loginAssets;
}

async function serveR2(req: Request, env: Env, key: string): Promise<Response> {
  const head = req.method === "HEAD";
  const obj = head ? await env.R2.head(key) : await env.R2.get(key, { onlyIf: req.headers });
  if (!obj) return new Response("not found", { status: 404 });
  const h = new Headers();
  obj.writeHttpMetadata(h);
  h.set("ETag", obj.httpEtag);
  h.set("Cache-Control", key === "c/manifest.json" ? "no-cache" : "private, max-age=31536000, immutable");
  if (head) {
    h.set("Content-Length", String(obj.size));
    return new Response(null, { headers: h });
  }
  const body = "body" in obj ? (obj as R2ObjectBody).body : null;
  if (!body) return new Response(null, { status: 304, headers: h });
  return new Response(body, { headers: h });
}

function wantsHtml(req: Request): boolean {
  return req.method === "GET" && (req.headers.get("Sec-Fetch-Mode") === "navigate" || (req.headers.get("Accept") ?? "").includes("text/html"));
}

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path.startsWith("/api/")) return api.fetch(req, env, ctx);

  const session = await checkSession(env, req);

  if (path === "/login" || path === "/login.html") {
    if (session) return Response.redirect(url.origin + "/", 302);
    return env.ASSETS.fetch(new Request(url.origin + "/login", req));
  }
  if (!session) {
    if (PUBLIC.has(path) || (await loginAllow(env, url.origin)).has(path)) return env.ASSETS.fetch(req);
    if (!/^\/(c|a|m|assets)\//.test(path) && wantsHtml(req)) {
      const next = path === "/" ? "" : `?next=${encodeURIComponent(path + url.search)}`;
      return Response.redirect(`${url.origin}/login${next}`, 302);
    }
    return new Response("unauthorized", { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  let res: Response;
  if (path.startsWith("/c/") || path.startsWith("/a/") || path.startsWith("/m/")) {
    let key: string;
    try {
      key = decodeURIComponent(path.slice(1));
    } catch {
      return new Response("bad path", { status: 400 });
    }
    res = await serveR2(req, env, key);
  } else {
    res = await env.ASSETS.fetch(req);
    if (path.startsWith("/assets/") && res.ok) {
      res = new Response(res.body, res);
      res.headers.set("Cache-Control", "private, max-age=31536000, immutable");
    } else if ((res.headers.get("Content-Type") ?? "").includes("text/html")) {
      res = new Response(res.body, res);
      res.headers.set("Cache-Control", "no-cache");
    }
  }
  if (session.setCookie) {
    res = new Response(res.body, res);
    res.headers.append("Set-Cookie", session.setCookie);
  }
  return res;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return secure(await handle(req, env, ctx));
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(nightlyBackup(env).then((r) => console.log("backup", r.key, JSON.stringify(r.counts), "pruned", r.pruned.length)));
  },
} satisfies ExportedHandler<Env>;
