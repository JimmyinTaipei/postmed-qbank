// RichEditor 的載入點：編輯器（ProseMirror）只在進入編輯時才下載，首頁與閱讀頁不含它（規格書 §9.10）。
// 下載完成前先顯示排好的內容，版面不跳。

import { lazy, Suspense } from "react";
import type { RichEditorProps } from "./editor/RichEditor";
import { Markdown } from "./content/Markdown";

const Impl = lazy(() => import("./editor/RichEditor"));

export function RichEditor(p: RichEditorProps) {
  return (
    <Suspense fallback={<div aria-busy="true" className="opacity-70"><Markdown text={p.initial} figs={p.figs} role={p.role} tight={p.placement === "card"} /></div>}>
      <Impl {...p} />
    </Suspense>
  );
}

/** 先下載編輯器（例如滑鼠移到「編輯」上時），按下去就不用等 */
export const preloadEditor = () => void import("./editor/RichEditor");

export type { EditResult, EditorMode, RichEditorProps } from "./editor/RichEditor";
