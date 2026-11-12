// 導覽外殼：寬螢幕（≥ 1024px）是左側欄，窄螢幕是底部分頁列。兩邊是同一組項目、同一份程式（規格書 §2.5）。

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useSyncState, type SyncState } from "@/data";
import { Icon, type IconName } from "./icons";
import { IconButton, Notice, cx } from "./primitives";

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: "/", label: "今日", icon: "home", end: true },
  { to: "/practice", label: "刷題", icon: "pencil" },
  // 第 2B 階段：考題（題目瀏覽、整份考卷、搜尋、錯題本）與卡片從「更多」搬上來
  { to: "/browse", label: "考題", icon: "file" },
  { to: "/review", label: "複習", icon: "repeat" },
  { to: "/cards", label: "卡片", icon: "list" },
  { to: "/kb", label: "資料庫", icon: "book" },
  { to: "/more", label: "更多", icon: "grid" },
];

export function AppShell() {
  return (
    <div className="min-h-dvh lg:pl-60">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-btn focus:bg-card focus:px-3 focus:py-2">
        跳到主要內容
      </a>

      {/* 寬螢幕：側欄 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-sidebar lg:flex">
        <div className="pt-safe">
          <div className="flex h-16 items-center px-5 text-title font-semibold text-ink-strong">後醫題庫</div>
        </div>
        <nav aria-label="主導覽" className="flex-1 px-3">
          <ul className="space-y-1">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    cx("flex min-h-(--tap) items-center gap-3 rounded-btn px-3 text-ui no-underline select-none", isActive ? "bg-blue-light font-semibold text-blue-ink" : "text-ink hover:bg-hover")
                  }
                >
                  <Icon name={n.icon} size={20} />
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="pb-safe px-3">
          <div className="border-t border-line py-3">
            <SyncStatus />
          </div>
        </div>
      </aside>

      <main id="main" className="pb-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] lg:pb-10">
        <Outlet />
      </main>

      {/* 窄螢幕：底部分頁列 */}
      <nav aria-label="主導覽" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-sidebar lg:hidden">
        <ul className="mx-auto flex max-w-xl">
          {NAV.map((n) => (
            <li key={n.to} className="flex-1">
              <NavLink
                to={n.to}
                end={n.end}
                className={({ isActive }) => cx("flex h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-meta whitespace-nowrap no-underline select-none", isActive ? "font-semibold text-blue-deep" : "text-ink-muted")}
              >
                {({ isActive }) => (
                  <>
                    <span className={cx("flex h-7 w-full max-w-14 items-center justify-center rounded-full transition-colors duration-(--dur-fast)", isActive && "bg-blue-light text-blue-ink")}>
                      <Icon name={n.icon} size={20} />
                    </span>
                    {n.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

interface PageProps {
  title: string;
  subtitle?: ReactNode;
  /** 有值就顯示返回鈕；true = 回上一頁 */
  back?: string | true;
  actions?: ReactNode;
  /** narrow：閱讀與表單（內文欄寬）；wide：清單、方格、圖表 */
  width?: "narrow" | "wide";
  /** 往下捲、頁首離開畫面時，右上動作變成浮在右上角的膠囊（資料庫閱讀頁） */
  floatingActions?: boolean;
  children: ReactNode;
}

/** 右上動作：floating 時，頁首捲出畫面就改成固定在右上角的膠囊。同一組元素搬位置，不複製（選單的狀態不會分家）。 */
function Actions({ children, floating }: { children: ReactNode; floating?: boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  const [out, setOut] = useState(false);
  const [box, setBox] = useState<{ w: number; h: number; right: number } | null>(null);

  useEffect(() => {
    const el = slot.current;
    if (!floating || !el) return;
    const io = new IntersectionObserver(([e]) => setOut(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [floating]);

  // 量原本位置：膠囊對齊原本的右緣；原位留同樣大小的空位，頁首不跳動
  useLayoutEffect(() => {
    if (!floating) return;
    const measure = () => {
      const el = slot.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height, right: Math.max(12, document.documentElement.clientWidth - r.right) });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [floating, out]);

  const float = floating && out;
  return (
    <div ref={slot} className="shrink-0" style={float && box ? { width: box.w, height: box.h } : undefined}>
      <div
        className={cx("flex items-center gap-1", float && "anim-rise fixed z-20 rounded-full border border-line bg-card px-1 shadow-pop print:hidden")}
        style={float ? { top: "calc(env(safe-area-inset-top) + 8px)", right: box?.right ?? 12 } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/** 每一頁最外層都用它：頁首（標題、返回、右上動作）＋固定的左右邊距與最大寬度。 */
export function Page({ title, subtitle, back, actions, width = "narrow", floatingActions, children }: PageProps) {
  const nav = useNavigate();
  return (
    <div className={cx("mx-auto w-full", width === "narrow" ? "max-w-3xl" : "max-w-6xl")}>
      <header className="pt-safe">
        <div className="px-safe flex min-h-16 items-center gap-2 py-3 lg:px-8 lg:pt-6">
          {back && (
            <IconButton label="返回" className="-ml-2" onClick={() => (back === true ? nav(-1) : nav(back))}>
              <Icon name="arrowLeft" />
            </IconButton>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-display font-semibold text-ink-strong">{title}</h1>
            {subtitle && <p className="mt-0.5 truncate text-ui text-ink-muted">{subtitle}</p>}
          </div>
          {actions && <Actions floating={floatingActions}>{actions}</Actions>}
        </div>
      </header>
      <div className="px-safe space-y-6 pb-6 lg:px-8">{children}</div>
    </div>
  );
}

const SYNC: Record<SyncState["kind"], { icon: IconName; text: (s: never) => string; tone: string }> = {
  local: { icon: "device", text: () => "只存在這台裝置", tone: "text-ink-muted" },
  synced: { icon: "cloud", text: () => "已同步", tone: "text-ink-muted" },
  pending: { icon: "cloud", text: (s: { count: number }) => `待送 ${s.count} 筆`, tone: "text-ink" },
  syncing: { icon: "refresh", text: () => "同步中", tone: "text-ink" },
  offline: { icon: "cloudOff", text: (s: { count: number }) => (s.count ? `離線・待送 ${s.count} 筆` : "離線"), tone: "text-warning-ink" },
  error: { icon: "alert", text: () => "同步失敗", tone: "text-incorrect-ink" },
};

/** 同步狀態（規格書 §8）。state 不給就讀目前的狀態；/dev/ui 用 state 展示各種情況。 */
export function SyncStatus({ state, compact }: { state?: SyncState; compact?: boolean }) {
  const live = useSyncState();
  const s = state ?? live;
  const d = SYNC[s.kind];
  const text = (d.text as (s: SyncState) => string)(s);
  return (
    <span className={cx("inline-flex min-h-9 items-center gap-2 rounded-btn px-2 text-meta", d.tone)} role="status" title={s.kind === "error" ? s.message : undefined}>
      <Icon name={d.icon} size={16} className={s.kind === "syncing" ? "anim-spin" : undefined} />
      {compact ? <span className="sr-only">{text}</span> : text}
    </span>
  );
}

/** 樣板頁最上面的說明：這一頁目前是版面，功能在哪個階段接上。 */
export function TemplateNotice({ stage, children }: { stage: string; children?: ReactNode }) {
  return (
    <Notice>
      這一頁目前只有版面與操作手感，{children ?? "資料是示範用的"}；功能在{stage}接上。
    </Notice>
  );
}
