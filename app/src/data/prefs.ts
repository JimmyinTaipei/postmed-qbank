// 只屬於這台裝置、不同步的偏好（外觀、圖片反相、裝置代號）。存 localStorage，可同步讀取。
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
  /** 裝置代號：第一次開啟時產生（規格書 §8）。 */
  device(): string {
    let d = read("pmq.device");
    if (!d) {
      d = "dev-" + Math.random().toString(36).slice(2, 8);
      write("pmq.device", d);
    }
    return d;
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useThemePref(): ThemePref {
  return useSyncExternalStore(prefs.subscribe, prefs.theme);
}
export function useFigInvert(): boolean {
  return useSyncExternalStore(prefs.subscribe, prefs.figInvert);
}
