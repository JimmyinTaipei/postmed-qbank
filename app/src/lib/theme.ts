// 外觀：把「跟隨系統／淺色／深色」套到 <html data-theme>，並同步瀏覽器外框顏色與圖片反相。

import { useEffect } from "react";
import { useFigInvert, useThemePref } from "@/data";

export function useApplyTheme() {
  const pref = useThemePref();
  const invert = useFigInvert();
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      if (pref === "system") delete root.dataset.theme;
      else root.dataset.theme = pref;
      const dark = pref === "dark" || (pref === "system" && mq.matches);
      // 純黑白線稿只在深色模式反相
      if (dark && invert) root.dataset.figInvert = "1";
      else delete root.dataset.figInvert;
      const page = getComputedStyle(root).getPropertyValue("--page").trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", page);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref, invert]);
}
