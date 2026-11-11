// 卡片聲音的播放：先整個下載成 blob 再播。Safari 的 <audio> 直接讀網址時要伺服器支援分段下載（Range），
// 我們的 /m/ 不支援，所以一律走 blob。下載過的留在記憶體（這次開著網頁期間），重播不再下載。

const blobs = new Map<string, Promise<string>>();
let current: HTMLAudioElement | null = null;

function blobUrl(src: string): Promise<string> {
  let p = blobs.get(src);
  if (!p) {
    p = fetch(src, { credentials: "same-origin" }).then(async (r) => {
      if (!r.ok) throw new Error(`聲音檔讀不到（${r.status}）`);
      return URL.createObjectURL(await r.blob());
    });
    p.catch(() => blobs.delete(src));
    blobs.set(src, p);
    if (blobs.size > 300) {
      const [k, v] = blobs.entries().next().value as [string, Promise<string>];
      blobs.delete(k);
      void v.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    }
  }
  return p;
}

/** 播放一個聲音檔（同時只播一個）。失敗不丟例外，回傳 false。 */
export async function playSound(src: string): Promise<boolean> {
  if (!src) return false;
  try {
    const url = await blobUrl(src);
    current?.pause();
    current = new Audio(url);
    await current.play();
    return true;
  } catch {
    return false;
  }
}

/** 一段 Markdown 裡的聲音檔網址（依出現順序）。 */
export function soundsIn(md: string): string[] {
  return [...md.matchAll(/\[sound:(m\/[0-9a-f]{64}\.[a-z0-9]{2,5})\]/g)].map((m) => "/" + m[1]);
}

/** 先下載好（翻面前預先抓，翻面時就能立刻播）。 */
export function preloadSounds(md: string): void {
  for (const s of soundsIn(md)) void blobUrl(s).catch(() => {});
}
