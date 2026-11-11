// 最外層的錯誤攔截：任何畫面出錯時，顯示錯誤訊息與復原按鈕，而不是整頁白掉。
// 不依賴 App 裡的任何 Provider，出錯時也一定畫得出來。

import { Component, type ReactNode } from "react";

/** 清掉 Service Worker 與它的快取（App 外殼、圖），再重新載入。作答與題庫內容（IndexedDB）不動。 */
async function resetShell(): Promise<void> {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* 沒有 Service Worker（例如 iPad 用 http 連）就略過 */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* 同上 */ }
  location.reload();
}

export class ErrorScreen extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[app] 畫面出錯", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const detail = `${error.name}: ${error.message}\n網址：${location.pathname}\n瀏覽器：${navigator.userAgent}\n\n${error.stack ?? ""}`;
    return (
      <div className="min-h-dvh bg-page px-4 py-10 text-ink">
        <div className="mx-auto max-w-xl space-y-4">
          <h1 className="text-xl font-semibold text-ink-strong">畫面出錯了</h1>
          <p>作答紀錄沒有遺失。依序試試：</p>
          <ol className="list-decimal space-y-1 pl-6">
            <li>按「重新載入」。</li>
            <li>還是不行，按「清除快取後重新載入」（只清 App 外殼，作答與題庫內容不動）。</li>
            <li>再不行，把下面的錯誤訊息截圖給 Claude。</li>
          </ol>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="rounded-lg bg-blue-deep px-4 py-2 text-on-deep" onClick={() => location.reload()}>
              重新載入
            </button>
            <button type="button" className="rounded-lg border border-line-strong px-4 py-2" onClick={() => void resetShell()}>
              清除快取後重新載入
            </button>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-card p-3 text-xs text-ink-muted">{detail}</pre>
        </div>
      </div>
    );
  }
}
