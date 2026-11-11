export const enc = new TextEncoder();

export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buf = typeof data === "string" ? enc.encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", buf);
  return hex(new Uint8Array(d));
}

export function hex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function b64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}

export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64url(b: Uint8Array): string {
  return b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 長度不同時也花一樣的時間比較（避免從回應時間猜出金鑰）。 */
export function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TYPES: Record<string, string> = {
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  gz: "application/gzip",
  zip: "application/zip",
};

export function contentType(key: string): string {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return TYPES[ext] ?? "application/octet-stream";
}

/** 台北時間的日期字串 YYYY-MM-DD。 */
export function taipeiDate(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}
