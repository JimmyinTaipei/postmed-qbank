// 對本站伺服器的請求。只有 src/data/ 用。
// 401 代表登入過期或被登出：轉到登入頁（離線時不轉，照常用裝置上的資料）。

export class Unauthorized extends Error {
  constructor() {
    super("登入已過期");
  }
}

/** 網路不通（離線、伺服器連不上）。與伺服器回錯誤分開，同步狀態才能顯示「離線」。 */
export class Offline extends Error {
  constructor() {
    super("連不上伺服器");
  }
}

export class ServerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let redirecting = false;
export function goLogin() {
  if (redirecting || typeof location === "undefined") return;
  if (location.pathname === "/login") return;
  redirecting = true;
  const next = location.pathname + location.search;
  location.assign(next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login");
}

export async function request(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init?.timeoutMs ?? 30_000);
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init, signal: ctl.signal });
  } catch {
    throw new Offline();
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    goLogin();
    throw new Unauthorized();
  }
  return res;
}

export async function requestJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await request(path, init);
  if (!res.ok) {
    let msg = `伺服器回 ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string; error?: string };
      if (j.message || j.error) msg += `：${j.message ?? j.error}`;
    } catch {
      /* 不是 JSON */
    }
    throw new ServerError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);
