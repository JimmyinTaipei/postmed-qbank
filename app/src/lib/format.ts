export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} 分 ${s % 60} 秒` : `${Math.floor(m / 60)} 小時 ${m % 60} 分`;
}

export function formatAgo(t: number, now: number = Date.now()): string {
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} 天前` : new Date(t).toLocaleDateString("zh-TW");
}

export const percent = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");
