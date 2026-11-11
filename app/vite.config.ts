import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = import.meta.dirname;

/** 本機的 Worker（cd worker && pnpm dev）。開發伺服器把 API 與內容包轉給它。 */
const WORKER = process.env.PMQ_WORKER ?? "http://127.0.0.1:8787";

/**
 * 建置後產生兩個檔（第 1B 階段）：
 * - dist/login-assets.json：登入頁用到的 JS／CSS／字型。Worker 只對這些檔與 login.html 放行未登入的請求。
 * - dist/sw.js：Service Worker，內含這一版 App 外殼的檔案清單（sw/sw.template.js）。
 */
function shellFiles(): Plugin {
  let outDir = "dist";
  return {
    name: "pmq-shell-files",
    apply: "build",
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    writeBundle(_opts, bundle) {
      const refs = (text: string) => [...text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"|url\((\/assets\/[^)]+)\)/g)].map((m) => m[1] ?? m[2]);
      const loginHtml = fs.readFileSync(path.join(outDir, "login.html"), "utf8");
      const allow = new Set<string>();
      const visit = (p: string) => {
        if (allow.has(p)) return;
        allow.add(p);
        const item = bundle[p.slice(1)];
        if (!item) return;
        if (item.type === "chunk") {
          for (const i of item.imports) visit("/" + i);
          const meta = (item as { viteMetadata?: { importedCss: Set<string>; importedAssets: Set<string> } }).viteMetadata;
          meta?.importedCss.forEach((f) => visit("/" + f));
          meta?.importedAssets.forEach((f) => visit("/" + f));
        } else if (p.endsWith(".css")) {
          for (const r of refs(String(item.source))) visit(r);
        }
      };
      for (const r of refs(loginHtml)) visit(r);
      fs.writeFileSync(path.join(outDir, "login-assets.json"), JSON.stringify([...allow].sort(), null, 1));

      // App 外殼：index.html、全部 JS／CSS、woff2 字型（KaTeX）、圖示與 manifest
      const files = Object.keys(bundle)
        .filter((f) => f.startsWith("assets/") && /\.(js|css|woff2)$/.test(f))
        .map((f) => "/" + f)
        .sort();
      const precache = ["/", ...files, "/theme.js", "/manifest.webmanifest", "/icon.svg", "/apple-touch-icon.png", "/icon-192.png"];
      const version = `${Date.now().toString(36)}-${crypto.createHash("sha256").update(precache.join("\n")).digest("hex").slice(0, 10)}`;
      const sw = fs
        .readFileSync(path.join(here, "sw/sw.template.js"), "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(precache));
      fs.writeFileSync(path.join(outDir, "sw.js"), sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), shellFiles()],
  resolve: {
    alias: {
      "@schema": path.join(here, "../schema"),
      "@": path.join(here, "src"),
    },
  },
  server: {
    port: 5183,
    strictPort: true,
    fs: { allow: [path.join(here, "..")] },
    proxy: {
      "/api": WORKER,
      "/c/": WORKER,
      "/a/": WORKER,
    },
  },
  preview: { port: 5184, strictPort: true },
  build: {
    target: "safari16",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: path.join(here, "index.html"),
        login: path.join(here, "login.html"),
      },
    },
  },
});
