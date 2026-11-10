// 登入頁：1A 只有畫面與表單行為（規格書 §10 的邏輯在 1B 接上）。

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/icons";
import { Button, Card, Notice, TextField } from "@/ui/primitives";

export function Login() {
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pw.trim()) return setError("請輸入密碼");
    nav("/"); // 1B：POST /api/login；失敗時用 setError 顯示「密碼不對，還可以再試 N 次」
  };
  return (
    <main className="px-safe flex min-h-dvh flex-col items-center justify-center py-10">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-card bg-blue-deep text-on-deep"><Icon name="lock" size={26} /></span>
          <h1 className="mt-4 text-display font-semibold text-ink-strong">後醫題庫</h1>
          <p className="mt-1 text-ui text-ink-muted">私人題庫，請輸入密碼</p>
        </div>
        <Card as="form" className="space-y-4 p-5" {...{ onSubmit: submit, noValidate: true }}>
          <TextField label="密碼" type="password" name="password" autoComplete="current-password" enterKeyHint="go" value={pw} onChange={(e) => { setPw(e.target.value); setError(""); }} error={error} />
          <Button type="submit" variant="primary" block>登入</Button>
        </Card>
        <Notice>登入在第 1B 階段接上；現在輸入任何內容都會進入首頁。</Notice>
      </div>
    </main>
  );
}
