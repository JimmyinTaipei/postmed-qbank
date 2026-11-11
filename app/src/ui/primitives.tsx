// 基礎元件（規格書 §13.4）。每個元件的每種狀態都在 /dev/ui 展示；用法與規則見 docs/UI規範.md。
// 顏色、字級、圓角一律用 tokens.css 的代碼（Tailwind 的 bg-card、text-ink、rounded-btn…），不寫數值。

import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./icons";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

const PRESS = "transition-[background-color,border-color,color,transform,opacity] duration-(--dur-fast) ease-out active:scale-[0.98]";

// ---------- 按鈕 ----------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON: Record<ButtonVariant, string> = {
  // 一個畫面只有一個 primary
  primary: "bg-blue-deep text-on-deep hover:opacity-90",
  secondary: "bg-blue-light text-blue-ink hover:bg-blue-mid",
  ghost: "bg-transparent text-blue-deep hover:bg-hover",
  danger: "bg-incorrect-bg text-incorrect-ink hover:opacity-90",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  iconEnd?: IconName;
  block?: boolean;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "secondary", icon, iconEnd, block, loading, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex min-h-(--tap) items-center justify-center gap-2 rounded-btn px-4 text-ui font-medium whitespace-nowrap",
        PRESS,
        BUTTON[variant],
        "disabled:opacity-45 disabled:active:scale-100",
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={18} /> : icon && <Icon name={icon} size={18} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={18} />}
    </button>
  );
}

/** 連結長成按鈕的樣子（頁面跳轉用 <a>，動作用 <button>）。 */
export function LinkButton({ to, variant = "secondary", icon, iconEnd, block, className, children }: { to: string; variant?: ButtonVariant; icon?: IconName; iconEnd?: IconName; block?: boolean; className?: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cx("inline-flex min-h-(--tap) items-center justify-center gap-2 rounded-btn px-4 text-ui font-medium whitespace-nowrap no-underline select-none", PRESS, BUTTON[variant], block && "w-full", className)}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
      {iconEnd && <Icon name={iconEnd} size={18} />}
    </Link>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  label: string; // 必填：螢幕報讀與提示文字
  pressed?: boolean; // 切換型按鈕（星號、反相）
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ label, pressed, className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx(
        "inline-flex size-(--tap) shrink-0 items-center justify-center rounded-btn text-ink",
        PRESS,
        "hover:bg-hover disabled:opacity-35 disabled:active:scale-100",
        pressed && "bg-blue-light text-blue-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------- 徽章、卡片 ----------

type Tone = "neutral" | "blue" | "correct" | "incorrect" | "warning";

const TONE: Record<Tone, string> = {
  neutral: "bg-hover text-ink",
  blue: "bg-blue-light text-blue-ink",
  correct: "bg-correct-bg text-correct-ink",
  incorrect: "bg-incorrect-bg text-incorrect-ink",
  warning: "bg-warning-bg text-warning-ink",
};

export function Badge({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-meta font-medium whitespace-nowrap", TONE[tone], className)}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

/** 白底、一條細邊線、12px 圓角。不加陰影、不疊卡片。 */
export function Card({ className, children, as: Tag = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" | "aside" | "form"; "aria-label"?: string; "aria-labelledby"?: string }) {
  return (
    <Tag className={cx("rounded-card border border-line bg-card", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
      <h2 id={id} className="text-ui font-semibold text-ink-muted">
        {children}
      </h2>
      {action}
    </div>
  );
}

// ---------- 清單列 ----------

interface ListRowProps {
  title: ReactNode;
  meta?: ReactNode; // 第二行：輔助資訊
  leading?: ReactNode;
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  chevron?: boolean;
  className?: string;
}

/** 清單的一列。給 to 就是連結、給 onClick 就是按鈕、都不給就是純顯示。放在 <ul> 的 <li> 裡。 */
export function ListRow({ title, meta, leading, trailing, to, onClick, chevron, className }: ListRowProps) {
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center text-ink-muted">{leading}</span>}
      <span className="min-w-0 flex-1 py-2.5">
        <span className="block truncate text-ui text-ink-strong">{title}</span>
        {meta && <span className="mt-0.5 block truncate text-meta text-ink-muted">{meta}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-meta text-ink-muted">{trailing}</span>}
      {(chevron ?? !!(to || onClick)) && <Icon name="chevronRight" size={18} className="text-ink-muted" />}
    </>
  );
  const cls = cx("flex min-h-(--option-h) w-full items-center gap-3 px-4 text-left", (to || onClick) && cx("hover:bg-hover active:bg-hover", PRESS, "active:scale-100"), className);
  if (to)
    return (
      <Link to={to} className={cx(cls, "no-underline")}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}

/** 把多個 ListRow 包成一張卡，列與列之間有分隔線。 */
export function ListCard({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cx("divide-y divide-line overflow-hidden rounded-card border border-line bg-card", className)}>
      {children}
    </ul>
  );
}

// ---------- 選項列 ----------

export type OptionState = "idle" | "selected" | "correct" | "incorrect" | "missed" | "dimmed";

const OPTION: Record<OptionState, string> = {
  idle: "border-line bg-card hover:bg-hover",
  selected: "border-blue-deep bg-blue-light",
  correct: "border-correct bg-correct-bg",
  incorrect: "border-incorrect bg-incorrect-bg",
  missed: "border-correct bg-card", // 正解但沒選到
  dimmed: "border-line bg-card opacity-60",
};
const OPTION_LETTER: Record<OptionState, string> = {
  idle: "border-line-strong text-ink",
  selected: "border-blue-deep bg-blue-deep text-on-deep",
  correct: "border-correct-ink bg-correct-ink text-correct-bg",
  incorrect: "border-incorrect-ink bg-incorrect-ink text-incorrect-bg",
  missed: "border-correct-ink text-correct-ink",
  dimmed: "border-line-strong text-ink-muted",
};
const OPTION_NOTE: Partial<Record<OptionState, string>> = { correct: "正解", incorrect: "你的答案", missed: "正解" };

interface OptionRowProps {
  letter: string;
  state: OptionState;
  /** 複選題：外觀用方框、語意是 checkbox；單選是 radio */
  multi?: boolean;
  /** 作答後鎖住 */
  locked?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}

/** 整列可點、高度 ≥ 56px。對錯除了顏色還有圖示與文字（不只靠紅綠）。 */
export function OptionRow({ letter, state, multi, locked, onSelect, children }: OptionRowProps) {
  const chosen = state === "selected" || state === "correct" || state === "incorrect";
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={chosen}
      aria-disabled={locked || undefined}
      data-letter={letter}
      data-state={state}
      onClick={locked ? undefined : onSelect}
      className={cx(
        "flex min-h-(--option-h) w-full items-start gap-3 rounded-btn border px-3 py-3 text-left",
        "transition-[background-color,border-color,opacity] duration-(--dur-fast) ease-out",
        OPTION[state],
        locked ? "cursor-default" : "active:bg-hover",
        locked && state === "idle" && "hover:bg-card",
      )}
    >
      <span
        className={cx("mt-0.5 flex size-7 shrink-0 items-center justify-center border text-ui font-semibold", multi ? "rounded-chip" : "rounded-full", OPTION_LETTER[state])}
        aria-hidden="true"
      >
        {letter}
      </span>
      <span className="sr-only">選項 {letter}：</span>
      <span className="min-w-0 flex-1 self-center">{children}</span>
      {OPTION_NOTE[state] && (
        <span className={cx("mt-1 flex shrink-0 items-center gap-1 text-meta font-medium", state === "incorrect" ? "text-incorrect-ink" : "text-correct-ink")}>
          <Icon name={state === "incorrect" ? "x" : "check"} size={16} />
          {OPTION_NOTE[state]}
        </span>
      )}
    </button>
  );
}

// ---------- 分段切換、分頁 ----------

interface Choice<T extends string | number> {
  value: T;
  label: ReactNode;
}

/** 2–5 個互斥選項（外觀、題數、順序）。更多選項改用 Chip 或下拉。 */
export function Segmented<T extends string | number>({ label, options, value, onChange, className }: { label: string; options: Choice<T>[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("inline-flex max-w-full rounded-btn bg-hover p-1", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "min-h-[calc(var(--tap)-8px)] min-w-12 flex-1 rounded-chip px-3 text-ui whitespace-nowrap transition-colors duration-(--dur-fast)",
              on ? "bg-card font-semibold text-blue-deep ring-1 ring-line" : "text-ink hover:text-ink-strong",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 同一頁內切換幾個並列的檢視。 */
export function Tabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: Choice<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              const i = tabs.findIndex((x) => x.value === value);
              const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
              onChange(next.value);
              (e.currentTarget.parentElement?.children[tabs.indexOf(next)] as HTMLElement | undefined)?.focus();
            }}
            className={cx("-mb-px min-h-(--tap) border-b-2 px-3 text-ui whitespace-nowrap", on ? "border-blue-deep font-semibold text-blue-deep" : "border-transparent text-ink-muted hover:text-ink-strong")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- 勾選、開關、選項片 ----------

export function Checkbox({ checked, onChange, label, count, disabled }: { checked: boolean | "partial"; onChange: (next: boolean) => void; label: ReactNode; count?: number; disabled?: boolean }) {
  const on = checked === true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === "partial" ? "mixed" : on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex min-h-(--tap) w-full items-center gap-3 rounded-btn px-2 text-left text-ui text-ink-strong hover:bg-hover disabled:opacity-45"
    >
      <span className={cx("flex size-5 shrink-0 items-center justify-center rounded-[5px] border-[1.5px]", checked ? "border-blue-deep bg-blue-deep text-on-deep" : "border-line-strong bg-card")} aria-hidden="true">
        {on && <Icon name="check" size={14} />}
        {checked === "partial" && <Icon name="minus" size={14} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null && <span className="shrink-0 text-meta tabular-nums text-ink-muted">{count.toLocaleString()}</span>}
    </button>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <button type="button" role="switch" aria-checked={checked} aria-describedby={hint ? id : undefined} onClick={() => onChange(!checked)} className="flex min-h-(--option-h) w-full items-center gap-3 px-4 text-left hover:bg-hover">
      <span className="min-w-0 flex-1 py-2">
        <span className="block text-ui text-ink-strong">{label}</span>
        {hint && (
          <span id={id} className="mt-0.5 block text-meta text-ink-muted">
            {hint}
          </span>
        )}
      </span>
      <span className={cx("relative h-7 w-12 shrink-0 rounded-full border-[1.5px] transition-colors duration-(--dur-fast)", checked ? "border-blue-deep bg-blue-deep" : "border-line-strong bg-card")} aria-hidden="true">
        <span className={cx("absolute top-[2.5px] size-5 rounded-full transition-[left] duration-(--dur-fast) ease-out", checked ? "left-[22px] bg-on-deep" : "left-[2.5px] bg-line-strong")} />
      </span>
    </button>
  );
}

/** 可複選的小選項（學校、年份、書）。 */
export function Chip({ selected, onToggle, children, count }: { selected: boolean; onToggle: () => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={cx(
        "inline-flex min-h-(--tap) items-center gap-1.5 rounded-btn border px-3 text-ui whitespace-nowrap transition-colors duration-(--dur-fast)",
        selected ? "border-blue-deep bg-blue-light font-medium text-blue-ink" : "border-line bg-card text-ink-strong hover:bg-hover",
      )}
    >
      {selected && <Icon name="check" size={15} />}
      {children}
      {count != null && <span className={cx("text-meta tabular-nums", selected ? "text-blue-ink" : "text-ink-muted")}>{count.toLocaleString()}</span>}
    </button>
  );
}

// ---------- 篩選群組 ----------

/** 出題設定的一組條件：標題列可收合，右邊顯示已選摘要。 */
export function FilterGroup({ title, summary, defaultOpen, onClear, children }: { title: string; summary?: string; defaultOpen?: boolean; onClear?: () => void; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group border-b border-line last:border-b-0">
      <summary className="flex min-h-(--option-h) items-center gap-3 px-4 hover:bg-hover">
        <span className="text-ui font-semibold text-ink-strong">{title}</span>
        <span className="min-w-0 flex-1 truncate text-right text-meta text-ink-muted">{summary || "不限"}</span>
        <Icon name="chevronDown" size={18} className="text-ink-muted transition-transform duration-(--dur-fast) group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4">
        {children}
        {onClear && summary && (
          <button type="button" onClick={onClear} className="mt-2 min-h-(--tap) rounded-btn px-2 text-ui text-blue-deep hover:bg-hover">
            清除這一組
          </button>
        )}
      </div>
    </details>
  );
}

// ---------- 進度條、載入、空白 ----------

export function ProgressBar({ value, max, label, className }: { value: number; max: number; label: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className={cx("h-1.5 overflow-hidden rounded-full bg-hover", className)}>
      <div className="h-full rounded-full bg-blue-accent transition-[width] duration-(--dur) ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner({ size = 22, label }: { size?: number; label?: string }) {
  return (
    <span role={label ? "status" : undefined} aria-label={label} className="inline-flex">
      <svg viewBox="0 0 24 24" width={size} height={size} className="anim-spin" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** 載入骨架：內容形狀已知時用它，不用轉圈。 */
export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label="載入中" className={cx("anim-pulse space-y-3", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 rounded-chip bg-hover" style={{ width: `${[92, 78, 85, 60, 88, 70][i % 6]}%` }} />
      ))}
    </div>
  );
}

/** 空白、錯誤、尚未開放都用這個：說明發生什麼事、接下來能做什麼。 */
export function EmptyState({ icon = "info", title, children, action, tone = "neutral" }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode; tone?: "neutral" | "error" }) {
  return (
    <div role={tone === "error" ? "alert" : undefined} className="flex flex-col items-center px-6 py-10 text-center">
      <span className={cx("flex size-12 items-center justify-center rounded-full", tone === "error" ? "bg-incorrect-bg text-incorrect-ink" : "bg-hover text-ink-muted")}>
        <Icon name={tone === "error" ? "alert" : icon} />
      </span>
      <h3 className="mt-3 text-ui font-semibold text-ink-strong">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-ui text-ink-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** 頁面內的提示條：樣板說明、樣本模式、待寫回。 */
export function Notice({ tone = "blue", icon = "info", children, action }: { tone?: "blue" | "warning" | "incorrect"; icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx("flex items-start gap-2.5 rounded-btn px-3 py-2.5 text-ui", TONE[tone])}>
      <Icon name={icon} size={18} className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

// ---------- 表單欄位 ----------

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  hideLabel?: boolean;
  leading?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, hint, error, hideLabel, leading, className, id: givenId, ...rest }: TextFieldProps) {
  const auto = useId();
  const id = givenId ?? auto;
  const describe = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : "mb-1.5 block text-ui font-medium text-ink-strong"}>
        {label}
      </label>
      <div className="relative">
        {leading && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted">{leading}</span>}
        <input
          id={id}
          aria-invalid={!!error || undefined}
          aria-describedby={describe}
          className={cx(
            "min-h-(--tap) w-full rounded-btn border bg-card px-3 text-base placeholder:text-ink-muted disabled:cursor-not-allowed disabled:bg-hover disabled:text-ink-muted",
            !!leading && "pl-10",
            error ? "border-incorrect" : "border-line-strong",
          )}
          {...rest}
        />
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1.5 flex items-center gap-1 text-meta text-incorrect-ink">
          <Icon name="alert" size={14} />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-meta text-ink-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** 大數字＋說明（今日頁、結束頁、統計）。 */
export function Stat({ value, label, hint }: { value: ReactNode; label: string; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-display font-semibold tabular-nums text-ink-strong">{value}</div>
      <div className="mt-0.5 text-meta text-ink-muted">{label}</div>
      {hint && <div className="mt-0.5 text-meta text-ink-muted">{hint}</div>}
    </div>
  );
}
