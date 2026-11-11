// 手寫工具列（第 6 階段）：筆（八色、三種粗細）、螢光筆（六色、三種粗細）、橡皮擦（整筆）、復原、重做、清除。
// 手寫區與圖上標記共用。選的工具與顏色記在這台裝置（prefs.inkTool），兩處一起變。

import { useState } from "react";
import { prefs, useInkToolPref, type InkToolPref } from "@/data";
import { Icon } from "../icons";
import { Dialog } from "../overlays";
import { Button, IconButton, cx } from "../primitives";
import type { InkBrush } from "./InkLayer";

export const PEN_COLORS: { id: string; name: string }[] = [
  { id: "ink-blue", name: "藍" },
  { id: "ink-red", name: "紅" },
  { id: "ink-rust", name: "磚紅" },
  { id: "ink-orange", name: "橘" },
  { id: "ink-green", name: "綠" },
  { id: "ink-purple", name: "紫" },
  { id: "ink-black", name: "黑" },
  { id: "ink-white", name: "白" },
];
export const HL_COLORS: { id: string; name: string }[] = [
  { id: "hl-yellow", name: "黃" },
  { id: "hl-blue", name: "藍" },
  { id: "hl-purple", name: "紫" },
  { id: "hl-pink", name: "粉紅" },
  { id: "hl-green", name: "綠" },
  { id: "hl-orange", name: "橘" },
];
const SIZES: { px: number; name: string }[] = [
  { px: 1.6, name: "細" },
  { px: 2.6, name: "中" },
  { px: 4.2, name: "粗" },
];
const HL_SIZES: { px: number; name: string }[] = [
  { px: 9, name: "細" },
  { px: 16, name: "中" },
  { px: 26, name: "粗" },
];

export function brushOf(p: InkToolPref): InkBrush {
  if (p.tool === "hl") return { tool: "hl", color: p.hl, px: HL_SIZES[p.hlSize]?.px ?? HL_SIZES[1].px };
  if (p.tool === "eraser") return { tool: "eraser", color: "", px: 0 };
  return { tool: "pen", color: p.pen, px: SIZES[p.size]?.px ?? SIZES[1].px };
}

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  /** 「清空這一頁」「清除這張圖的標記」 */
  clearLabel: string;
  className?: string;
  /** 工具列右邊額外的東西（加頁、完成） */
  extra?: React.ReactNode;
}

function Swatch({ color, name, selected, onPick }: { color: string; name: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      aria-pressed={selected}
      onClick={onPick}
      className={cx("inline-flex size-9 shrink-0 items-center justify-center rounded-full", selected ? "ring-2 ring-focus" : "hover:bg-hover")}
    >
      <span className="size-6 rounded-full border border-line-strong" style={{ background: `var(--${color})` }} />
    </button>
  );
}

/** 三種粗細。bar：螢光筆用橫條（該色）表示，筆用圓點 */
function SizePicker({ label, value, onPick, dots, bar }: { label: string; value: number; onPick: (i: 0 | 1 | 2) => void; dots: { name: string; d: number }[]; bar?: string }) {
  return (
    <div role="group" aria-label={label} className="flex">
      {dots.map((s, i) => (
        <button
          key={s.name}
          type="button"
          aria-label={s.name}
          title={s.name}
          aria-pressed={value === i}
          onClick={() => onPick(i as 0 | 1 | 2)}
          className={cx("inline-flex size-9 items-center justify-center rounded-btn", value === i ? "bg-blue-light" : "hover:bg-hover")}
        >
          {bar ? (
            <span className="w-5 rounded-chip border border-line-strong" style={{ height: s.d, background: `var(--${bar})` }} />
          ) : (
            <span className="rounded-full bg-ink-strong" style={{ width: s.d, height: s.d }} />
          )}
        </button>
      ))}
    </div>
  );
}

export function InkToolbar({ canUndo, canRedo, canClear, onUndo, onRedo, onClear, clearLabel, className, extra }: Props) {
  const p = useInkToolPref();
  const [confirm, setConfirm] = useState(false);
  const set = (v: Partial<InkToolPref>) => prefs.setInkTool(v);

  return (
    <div role="toolbar" aria-label="手寫工具" className={cx("flex flex-wrap items-center gap-x-1 gap-y-1 rounded-btn border border-line bg-card p-1", className)}>
      <IconButton label="筆" pressed={p.tool === "pen"} onClick={() => set({ tool: "pen" })}>
        <Icon name="pencil" />
      </IconButton>
      <IconButton label="螢光筆" pressed={p.tool === "hl"} onClick={() => set({ tool: "hl" })}>
        <Icon name="highlighter" />
      </IconButton>
      <IconButton label="橡皮擦（整筆擦掉）" pressed={p.tool === "eraser"} onClick={() => set({ tool: "eraser" })}>
        <Icon name="eraser" />
      </IconButton>

      {p.tool !== "eraser" && <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />}
      {p.tool === "pen" && (
        <>
          <div role="group" aria-label="筆的顏色" className="flex flex-wrap">
            {PEN_COLORS.map((c) => (
              <Swatch key={c.id} color={c.id} name={c.name} selected={p.pen === c.id} onPick={() => set({ pen: c.id })} />
            ))}
          </div>
          <SizePicker label="粗細" value={p.size} onPick={(i) => set({ size: i })} dots={SIZES.map((s) => ({ name: s.name, d: s.px * 2 + 2 }))} />
        </>
      )}
      {p.tool === "hl" && (
        <div role="group" aria-label="螢光筆的顏色" className="flex flex-wrap">
          {HL_COLORS.map((c) => (
            <Swatch key={c.id} color={c.id} name={c.name} selected={p.hl === c.id} onPick={() => set({ hl: c.id })} />
          ))}
          <SizePicker label="螢光筆粗細" value={p.hlSize} onPick={(i) => set({ hlSize: i })} bar={p.hl} dots={HL_SIZES.map((s) => ({ name: s.name, d: Math.round(s.px / 2) + 2 }))} />
        </div>
      )}

      <span className="ml-auto flex items-center">
        <IconButton label="復原" disabled={!canUndo} onClick={onUndo}>
          <Icon name="undo" />
        </IconButton>
        <IconButton label="重做" disabled={!canRedo} onClick={onRedo}>
          <Icon name="redo" />
        </IconButton>
        <IconButton label={clearLabel} disabled={!canClear} onClick={() => setConfirm(true)}>
          <Icon name="trash" />
        </IconButton>
        {extra}
      </span>

      {confirm && (
        <Dialog
          title={`${clearLabel}？`}
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>取消</Button>
              <Button
                variant="danger"
                onClick={() => {
                  onClear();
                  setConfirm(false);
                }}
              >
                清除
              </Button>
            </>
          }
        >
          清除後可以按「復原」救回來；離開這個畫面後就不能復原了。
        </Dialog>
      )}
    </div>
  );
}
