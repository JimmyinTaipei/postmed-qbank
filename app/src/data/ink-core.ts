// 手寫資料的純函式（ink.ts 用；node 測試直接 import 這個檔）：整理座標、壓縮、解壓。
// 格式：JSON → deflate（zlib）→ base64。

import type { InkDoc, InkStroke } from "./types.ts";

/** 座標取到 0.1、壓力取到 0.01（規格書 §9.6），存檔前先整理。 */
export function roundStroke(s: InkStroke): InkStroke {
  return { ...s, size: Math.round(s.size * 100) / 100, pts: s.pts.map(([x, y, p]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(p * 100) / 100]) };
}


function toB64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeInk(doc: InkDoc): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  return toB64(await pipe(json, new CompressionStream("deflate")));
}

export const EMPTY: InkDoc = { v: 1, strokes: [] };

export async function decodeInk(s: string | null | undefined): Promise<InkDoc> {
  if (!s) return { ...EMPTY, strokes: [] };
  try {
    const raw = await pipe(fromB64(s), new DecompressionStream("deflate"));
    const doc = JSON.parse(new TextDecoder().decode(raw)) as InkDoc;
    return Array.isArray(doc?.strokes) ? doc : { ...EMPTY, strokes: [] };
  } catch {
    return { ...EMPTY, strokes: [] };
  }
}

