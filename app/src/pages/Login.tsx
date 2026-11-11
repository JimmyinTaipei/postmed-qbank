// 登入頁（規格書 §10）。正式站上這一頁是獨立的 login.html（沒登入時只有它與它需要的檔可以取），
// 所以登入成功後用整頁導向進入 App，而不是在 App 內換頁。
// 錯太多次被鎖時：輸入框與按鈕停用，顯示倒數；一打開頁面也會先問伺服器是否被鎖（重新整理、換裝置都一樣）。

import { useEffect, useState, type FormEvent } from "react";
import { auth } from "@/data";
import { Icon } from "@/ui/icons";
import { Button, Card, Notice, TextField } from "@/ui/primitives";

function nextPath(): string {
  const n = new URLSearchParams(location.search).get("next") ?? "/";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/";
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** 鎖定倒數：lockUntil 是解鎖的時間點（ms），回傳剩下幾秒，每秒更新；到 0 時呼叫 onDone。 */
function useCountdown(lockUntil: number, onDone: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lockUntil) return;
    setNow(Date.now());
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= lockUntil) {
        clearInterval(t);
        onDone();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [lockUntil]); // eslint-disable-line react-hooks/exhaustive-deps
  return lockUntil ? Math.max(0, Math.ceil((lockUntil - now) / 1000)) : 0;
}

export function Login() {
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const lockLeft = useCountdown(lockUntil, () => setLockUntil(0));
  const locked = lockLeft > 0;
  const lock = (s: number) => {
    setError("");
    setPw("");
    setLockUntil(Date.now() + s * 1000);
  };
  useEffect(() => {
    void auth.lockedFor().then((s) => s > 0 && lock(s));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (locked) return;
    if (!pw.trim()) return setError("請輸入密碼");
    setBusy(true);
    const r = await auth.login(pw);
    if (r.ok) {
      location.replace(nextPath());
      return;
    }
    setBusy(false);
    if (r.reason === "wrong") setError(r.remaining > 0 ? `密碼不對，還可以再試 ${r.remaining} 次` : "密碼不對");
    else if (r.reason === "locked") lock(r.retryAfterS);
    else if (r.reason === "offline") setError("連不上伺服器。請確認網路後再試一次");
    else setError(`登入失敗：${r.message}`);
  };
  return (
    <main className="px-safe flex min-h-dvh flex-col items-center justify-center py-10">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-card bg-blue-deep text-on-deep"><Icon name="lock" size={26} /></span>
          <h1 className="mt-4 text-display font-semibold text-ink-strong">後醫題庫</h1>
          <p className="mt-1 text-ui text-ink-muted">私人題庫，請輸入密碼</p>
        </div>
        <Card as="form" className="space-y-4 p-5" {...{ onSubmit: (e: FormEvent) => void submit(e), noValidate: true }}>
          <TextField label="密碼" type="password" name="password" autoComplete="current-password" enterKeyHint="go" value={pw} disabled={locked} onChange={(e) => { setPw(e.target.value); setError(""); }} error={error} />
          {locked && (
            <Notice tone="warning" icon="lock">
              <span role="timer" aria-live="off">嘗試太多次，暫時鎖住。<b className="tabular-nums">{mmss(lockLeft)}</b> 後才能再試</span>
            </Notice>
          )}
          <Button type="submit" variant="primary" block loading={busy} disabled={busy || locked}>{locked ? `鎖定中 ${mmss(lockLeft)}` : "登入"}</Button>
        </Card>
        <Notice>登入一次可以用 180 天；每次使用會自動延長。</Notice>
      </div>
    </main>
  );
}
