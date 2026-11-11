// 只屬於這台裝置、不同步的偏好（外觀、圖片反相、裝置名稱、哪些科目離線下載）。存 localStorage，可同步讀取。
// 會同步的設定（例如上次的出題條件）走 personal.ts 的 settings。

import { useSyncExternalStore } from "react";
import type { ThemePref } from "./types";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // 私密瀏覽等情況：退回預設值
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 存不了就只在這次開啟期間有效 */
  }
  emit();
}

if (typeof window !== "undefined") window.addEventListener("storage", emit);

export const prefs = {
  theme(): ThemePref {
    const v = read("pmq.theme");
    return v === "light" || v === "dark" ? v : "system";
  },
  setTheme(v: ThemePref) {
    write("pmq.theme", v);
  },
  figInvert(): boolean {
    return read("pmq.figInvert") === "1";
  },
  setFigInvert(on: boolean) {
    write("pmq.figInvert", on ? "1" : "0");
  },
  /** 裝置代號：第一次開啟時產生（規格書 §8），設定頁可改成「iPad」「Mac」。寫進每一筆作答的 device 欄位。 */
  device(): string {
    let d = read("pmq.device");
    if (!d) {
      d = "dev-" + Math.random().toString(36).slice(2, 8);
      write("pmq.device", d);
    }
    return d;
  },
  setDevice(name: string) {
    const v = name.trim().slice(0, 40);
    if (v) write("pmq.device", v);
  },
  /** 是否顯示「未確認」徽章（規格書 §4.4；預設不顯示） */
  showUnverified(): boolean {
    return read("pmq.showUnverified") === "1";
  },
  setShowUnverified(on: boolean) {
    write("pmq.showUnverified", on ? "1" : "0");
  },
  /** 這一科的題目是否整科下載到裝置（離線可做）。預設開。 */
  offline(subject: string): boolean {
    return read("pmq.offline." + subject) !== "0";
  },
  setOffline(subject: string, on: boolean) {
    write("pmq.offline." + subject, on ? "1" : "0");
  },
  /** 卡片翻面時自動播放背面的聲音（第 5 階段；預設開，和 Anki 一樣） */
  cardAutoplay(): boolean {
    return read("pmq.cardAutoplay") !== "0";
  },
  setCardAutoplay(on: boolean) {
    write("pmq.cardAutoplay", on ? "1" : "0");
  },
  /** 上次新增卡片用的牌組 */
  lastDeck(): string | null {
    return read("pmq.lastDeck");
  },
  setLastDeck(id: string) {
    write("pmq.lastDeck", id);
  },
  /** 手寫工具（第 6 階段）：上次用的工具、筆色、粗細、螢光色。這台裝置記住，不同步。 */
  inkTool(): InkToolPref {
    try {
      const v = JSON.parse(read("pmq.inkTool") ?? "null") as Partial<InkToolPref> | null;
      return { ...INK_TOOL_DEFAULT, ...(v && typeof v === "object" ? v : {}) };
    } catch {
      return INK_TOOL_DEFAULT;
    }
  },
  setInkTool(v: Partial<InkToolPref>) {
    write("pmq.inkTool", JSON.stringify({ ...prefs.inkTool(), ...v }));
  },
  /** Apple Pencil 直接在內文的圖上畫（規格書 §9.7；預設開） */
  pencilOnFigures(): boolean {
    return read("pmq.pencilOnFigures") !== "0";
  },
  setPencilOnFigures(on: boolean) {
    write("pmq.pencilOnFigures", on ? "1" : "0");
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export interface InkToolPref {
  tool: "pen" | "hl" | "eraser";
  pen: string; // "ink-blue"…
  size: 0 | 1 | 2; // 細、中、粗
  hl: string; // "hl-yellow"…
}
export const INK_TOOL_DEFAULT: InkToolPref = { tool: "pen", pen: "ink-blue", size: 1, hl: "hl-yellow" };

let inkToolRaw: string | null = null;
let inkToolSnap: InkToolPref = INK_TOOL_DEFAULT;
export function useInkToolPref(): InkToolPref {
  return useSyncExternalStore(prefs.subscribe, () => {
    const raw = read("pmq.inkTool");
    if (raw !== inkToolRaw) {
      inkToolRaw = raw;
      inkToolSnap = prefs.inkTool();
    }
    return inkToolSnap;
  });
}
export function usePencilOnFigures(): boolean {
  return useSyncExternalStore(prefs.subscribe, prefs.pencilOnFigures);
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(prefs.subscribe, prefs.theme);
}
export function useDeviceName(): string {
  return useSyncExternalStore(prefs.subscribe, prefs.device);
}
export function useOfflinePref(subject: string): boolean {
  return useSyncExternalStore(prefs.subscribe, () => prefs.offline(subject));
}
export function useFigInvert(): boolean {
  return useSyncExternalStore(prefs.subscribe, prefs.figInvert);
}
export function useShowUnverified(): boolean {
  return useSyncExternalStore(prefs.subscribe, prefs.showUnverified);
}
export function useCardAutoplay(): boolean {
  return useSyncExternalStore(prefs.subscribe, prefs.cardAutoplay);
}
