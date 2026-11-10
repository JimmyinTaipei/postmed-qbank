import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = import.meta.dirname;

const TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * 第 1A 階段：把 app/fixtures/ 當成內容包，掛在與正式站相同的網址（/c/…、/a/…）。
 * 只在 dev 與 preview 伺服器生效；建置成品不含樣本。1B 由 Worker 從 R2 提供同樣的路徑。
 */
function contentFromFixtures(): Plugin {
  const root = path.join(here, "fixtures");
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    let url: string;
    try {
      url = decodeURIComponent((req.url ?? "").split("?")[0]);
    } catch {
      return next();
    }
    if (!/^\/(c|a)\//.test(url)) return next();
    const file = path.normalize(path.join(root, url));
    if (!file.startsWith(root + path.sep)) return next();
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
      res.setHeader("Content-Length", st.size);
      // 檔名含雜湊的檔案永不變；manifest 每次都要重抓
      res.setHeader("Cache-Control", url.endsWith("manifest.json") ? "no-cache" : "public, max-age=31536000, immutable");
      fs.createReadStream(file).pipe(res);
    });
  };
  return {
    name: "pmq-content-from-fixtures",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), contentFromFixtures()],
  resolve: {
    alias: {
      "@schema": path.join(here, "../schema"),
      "@": path.join(here, "src"),
    },
  },
  server: { port: 5183, strictPort: true, fs: { allow: [path.join(here, "..")] } },
  preview: { port: 5184, strictPort: true },
  build: { target: "safari16", sourcemap: false, chunkSizeWarningLimit: 900 },
});
