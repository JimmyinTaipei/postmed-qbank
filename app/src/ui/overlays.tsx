// 浮層：對話框、面板（窄螢幕從底部、寬螢幕從右側）、選單、提示訊息。
// 共同行為：開啟時焦點移進去並鎖在裡面、Esc 或點背景關閉、關閉後焦點回到觸發的按鈕。

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { Button, IconButton, cx } from "./primitives";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useModal(ref: RefObject<HTMLElement | null>, onClose: () => void, lockScroll = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";
    return () => {
      el.removeEventListener("keydown", key);
      if (lockScroll) document.body.style.overflow = overflow;
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function Scrim({ onClose, children, align }: { onClose: () => void; children: ReactNode; align: string }) {
  return createPortal(
    <div className={cx("anim-fade fixed inset-0 z-40 flex bg-scrim", align)} onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-noswipe>
      {children}
    </div>,
    document.body,
  );
}

// ---------- 對話框 ----------

interface DialogProps {
  title: string;
  children?: ReactNode;
  onClose: () => void;
  /** 按鈕列：主要動作放最後一個 */
  actions: ReactNode;
}

/** 需要使用者決定才能繼續的事（捨棄、清除、改答案的確認）。不要拿來顯示一般訊息。 */
export function Dialog({ title, children, onClose, actions }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useModal(ref, onClose);
  return (
    <Scrim onClose={onClose} align="items-center justify-center p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="anim-rise w-full max-w-sm rounded-card border border-line bg-card p-5 shadow-pop">
        <h2 id={id} className="text-title font-semibold text-ink-strong">
          {title}
        </h2>
        {children && <div className="mt-2 text-ui text-ink">{children}</div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </Scrim>
  );
}

// ---------- 面板 ----------

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** wide：編輯面板等需要寬度的內容 */
  size?: "normal" | "wide";
}

/** 窄螢幕是底部面板，寬螢幕（≥ 1024px）是右側面板。內容自己捲動，不帶動背後的頁面。 */
export function Sheet({ title, onClose, children, footer, size = "normal" }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useModal(ref, onClose);
  return (
    <Scrim onClose={onClose} align="items-end justify-center lg:items-stretch lg:justify-end">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={cx(
          "anim-sheet lg:anim-panel flex max-h-[92dvh] w-full flex-col rounded-t-card border border-line bg-card shadow-pop lg:max-h-none lg:rounded-none lg:border-y-0 lg:border-r-0",
          size === "wide" ? "lg:w-[min(56rem,90vw)]" : "lg:w-[26rem]",
        )}
      >
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line pr-1 pl-4">
          <h2 id={id} className="min-w-0 flex-1 truncate text-ui font-semibold text-ink-strong">
            {title}
          </h2>
          <IconButton label="關閉" onClick={onClose}>
            <Icon name="x" />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <footer className="pb-safe shrink-0 border-t border-line"><div className="flex justify-end gap-2 p-3">{footer}</div></footer>}
      </div>
    </Scrim>
  );
}

// ---------- 選單 ----------

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect?: () => void;
  /** 尚未開放的功能：顯示但不能按，並說明原因 */
  disabledReason?: string;
  checked?: boolean;
  danger?: boolean;
}

/** ⋯ 選單。寬螢幕貼著按鈕展開，窄螢幕從底部升起。 */
export function Menu({ label, items, children }: { label: string; items: MenuItem[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div ref={anchor} className="relative">
      <IconButton label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {children}
      </IconButton>
      {open && <MenuList label={label} items={items} onClose={() => setOpen(false)} />}
    </div>
  );
}

function MenuList({ label, items, onClose }: { label: string; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose, false);
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    nodes[(i + (e.key === "ArrowDown" ? 1 : nodes.length - 1)) % nodes.length]?.focus();
  };
  return (
    <>
      <div className="anim-fade fixed inset-0 z-40 bg-scrim lg:bg-transparent" onPointerDown={onClose} data-noswipe />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={move}
        data-noswipe
        className="anim-sheet lg:anim-rise pb-safe fixed inset-x-0 bottom-0 z-50 rounded-t-card border border-line bg-card py-2 shadow-pop lg:absolute lg:inset-x-auto lg:top-full lg:right-0 lg:bottom-auto lg:mt-1 lg:w-64 lg:rounded-card lg:pb-2"
      >
        {items.map((it) => {
          const disabled = !!it.disabledReason;
          return (
            <button
              key={it.label}
              type="button"
              role={it.checked == null ? "menuitem" : "menuitemcheckbox"}
              aria-checked={it.checked}
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (disabled) return;
                onClose();
                it.onSelect?.();
              }}
              className={cx(
                "flex min-h-(--tap) w-full items-center gap-3 px-4 py-2 text-left text-ui",
                disabled ? "cursor-default text-ink-muted" : it.danger ? "text-incorrect-ink hover:bg-hover" : "text-ink-strong hover:bg-hover",
              )}
            >
              {it.icon && <Icon name={it.icon} size={18} />}
              <span className="min-w-0 flex-1">
                {it.label}
                {disabled && <span className="block text-meta">{it.disabledReason}</span>}
              </span>
              {it.checked && <Icon name="check" size={18} className="text-blue-deep" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ---------- 提示訊息 ----------

interface Toast {
  id: number;
  text: string;
  tone: "neutral" | "error";
  action?: { label: string; run: () => void };
}

const ToastCtx = createContext<(text: string, opts?: { tone?: Toast["tone"]; action?: Toast["action"] }) => void>(() => {});

/** 短暫的結果回報（「已加星號」「已標為粗心錯」＋復原）。需要使用者處理的錯誤不要用它，用 EmptyState 或 Notice。 */
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, opts?: { tone?: Toast["tone"]; action?: Toast["action"] }) => {
    const id = ++seq.current;
    setList((l) => [...l.slice(-2), { id, text, tone: opts?.tone ?? "neutral", action: opts?.action }]);
    window.setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), opts?.action ? 6000 : 3200);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] lg:pb-6" aria-live="polite" role="status">
          {list.map((t) => (
            <div key={t.id} className={cx("anim-rise pointer-events-auto flex max-w-md items-center gap-3 rounded-btn border px-4 py-2.5 text-ui shadow-pop", t.tone === "error" ? "border-incorrect bg-incorrect-bg text-incorrect-ink" : "border-line bg-card text-ink-strong")}>
              {t.tone === "error" && <Icon name="alert" size={18} />}
              <span className="min-w-0 flex-1">{t.text}</span>
              {t.action && (
                <Button
                  variant="ghost"
                  className="-my-1.5 -mr-2"
                  onClick={() => {
                    t.action!.run();
                    setList((l) => l.filter((x) => x.id !== t.id));
                  }}
                >
                  {t.action.label}
                </Button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}
