// Service Worker（規格書 §2.1）：快取 App 外殼與看過的圖。由 vite.config.ts 在建置時填入版本與檔案清單。
//
// - App 外殼（index.html、/assets/*）：安裝時全部先存；之後 /assets/* 一律先用快取（檔名含雜湊）。
// - 網頁導覽：先上網（5 秒逾時），連不上就用快取的 index.html —— 所以飛航模式也能開 App。
// - 圖（/a/*）：看過就存，之後離線也看得到。
// - 內容包（/c/*）與 API 不經過這裡：內容包由 App 存在 IndexedDB。

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const SHELL = "pmq-shell-" + VERSION;
const IMG = "pmq-img-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            const res = await fetch(url, { credentials: "same-origin", cache: "no-cache" });
            if (res.ok && !res.redirected) await cache.put(url, res);
          } catch {
            /* 某個檔抓不到不擋安裝；用到時再從網路拿 */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 留目前與上一版的外殼（上一版的頁面可能還開著、還會延遲載入舊的檔），更舊的刪掉
      const shells = (await caches.keys()).filter((k) => k.startsWith("pmq-shell-")).sort();
      const keep = new Set([SHELL, ...shells.filter((k) => k !== SHELL).slice(-1)]);
      await Promise.all(shells.filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

async function navigate(req) {
  try {
    const res = await Promise.race([fetch(req), timeout(5000)]);
    if (res.ok && !res.redirected && (res.headers.get("Content-Type") || "").includes("text/html")) {
      const cache = await caches.open(SHELL);
      await cache.put("/", res.clone());
    }
    return res;
  } catch {
    const hit = (await caches.open(SHELL).then((c) => c.match("/"))) || (await caches.match("/"));
    return (
      hit ||
      new Response("目前離線，而且這台裝置還沒有存下 App。請連上網路後再開一次。", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") {
    const cache = await caches.open(name);
    await cache.put(req, res.clone());
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p.startsWith("/api/") || p.startsWith("/c/") || p === "/login" || p === "/login.html" || p === "/sw.js") return;
  if (req.mode === "navigate") return event.respondWith(navigate(req));
  if (p.startsWith("/assets/") || PRECACHE.includes(p)) return event.respondWith(cacheFirst(req, SHELL));
  if (p.startsWith("/a/")) return event.respondWith(cacheFirst(req, IMG));
});
