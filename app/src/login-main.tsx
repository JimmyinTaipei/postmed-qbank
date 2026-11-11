// 登入頁的入口（login.html）。沒登入時 Worker 只放行這一頁與它用到的檔，App 本體要登入後才拿得到。
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ui/base.css";
import { useApplyTheme } from "./lib/theme";
import { Login } from "./pages/Login";

function LoginApp() {
  useApplyTheme();
  return <Login />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LoginApp />
  </StrictMode>,
);
