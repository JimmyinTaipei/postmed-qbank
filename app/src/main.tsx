import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ui/base.css";
import { App } from "./App";
import { ErrorScreen } from "./ui/ErrorScreen";
import { startSync } from "./data";

startSync();

// Service Worker：快取 App 外殼與看過的圖（規格書 §2.1）。開發伺服器上不註冊。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => console.warn("[sw] 註冊失敗", e));
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorScreen>
      <App />
    </ErrorScreen>
  </StrictMode>,
);
