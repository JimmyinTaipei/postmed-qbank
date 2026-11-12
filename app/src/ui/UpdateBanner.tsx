// 部署新版之後提示更新（2026-11-12 使用者回報：部署後開著的網站還在跑舊版，題組沒有文章）。
//
// Service Worker 每次部署都會換版（sw.js 內含這一版的檔案清單），新版裝好後會接管頁面（skipWaiting＋clients.claim），
// 這時觸發 controllerchange。頁面本身的 JS 還是舊的，所以在畫面上方顯示「有新版」，點了重新整理。
// 不自動重新整理：可能有正在寫的筆記或卡片。作答進度都已存在 IndexedDB，重新整理不會掉。
// 另外：回到這個分頁（visibilitychange）時主動檢查一次 sw.js，iPad 主畫面的 App 放在背景好幾天也能發現新版。

import { useEffect, useState } from "react";
import { Button } from "./primitives";
import { Icon } from "./icons";

export function UpdateBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!import.meta.env.PROD || !sw) return;
    // 第一次安裝時（本來沒有 controller）也會觸發 controllerchange，那不是新版
    let had = !!sw.controller;
    const onChange = () => {
      if (had) setReady(true);
      had = true;
    };
    const check = () => {
      if (document.visibilityState !== "visible") return;
      sw.getRegistration().then((r) => r?.update()).catch(() => {});
    };
    sw.addEventListener("controllerchange", onChange);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      sw.removeEventListener("controllerchange", onChange);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, []);
  if (!ready) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center px-4 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]">
      <div role="alert" className="anim-rise pointer-events-auto flex items-center gap-3 rounded-card border border-line bg-card py-2 pr-2 pl-4 shadow-pop">
        <Icon name="info" size={18} className="shrink-0 text-ink-muted" />
        <span className="text-ui text-ink">網站有新版</span>
        <Button variant="primary" onClick={() => location.reload()}>
          更新
        </Button>
      </div>
    </div>
  );
}
