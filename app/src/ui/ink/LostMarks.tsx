// 筆記最下面的「失聯的圖上標記」（第 6B 階段，規格書 §9.7）。
// 筆記圖的 fid 由圖檔內容算出來，圖檔一換 fid 就變，原本的標記對不到圖。這些標記不刪，列在這裡：可以刪除，或移到這份筆記的另一張圖。

import { useState } from "react";
import { content, ink, useInkUnder, type Fig, type InkRow } from "@/data";
import { Icon } from "../icons";
import { Dialog, Sheet, useToast } from "../overlays";
import { Button } from "../primitives";
import { InkPreview } from "./FigInk";

export function LostMarks({ base, figs }: { base: string; figs: Fig[] }) {
  const prefix = `${base}/fig:`;
  const rows = useInkUnder(prefix);
  const have = new Set(figs.map((f) => f.fid));
  const lost = (rows ?? []).filter((r) => !have.has(r.target.slice(prefix.length).replace(/@(q|sol)$/, "")));
  const [moving, setMoving] = useState<InkRow | null>(null);
  const [removing, setRemoving] = useState<InkRow | null>(null);
  const toast = useToast();
  if (!lost.length) return null;

  return (
    <details className="rounded-btn border border-warning bg-warning-bg print:hidden">
      <summary className="flex min-h-(--tap) items-center gap-2 px-3 text-ui font-medium text-warning-ink">
        <Icon name="alert" size={18} />
        <span className="min-w-0 flex-1">失聯的圖上標記（{lost.length}）</span>
        <Icon name="chevronDown" size={18} />
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <p className="text-ui text-warning-ink">這些標記原本畫在這份筆記的某張圖上，那張圖後來換了檔案，所以對不到了。可以刪除，或移到這份筆記的另一張圖。</p>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {lost.map((r) => (
            <li key={r.id} className="space-y-2 rounded-btn border border-line bg-card p-2">
              <div className="rounded-chip border border-line bg-paper">
                <InkPreview row={r} className="w-full" />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" icon="trash" onClick={() => setRemoving(r)}>刪除</Button>
                <Button variant="secondary" icon="arrowRight" disabled={!figs.length} onClick={() => setMoving(r)}>移到這張圖</Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {moving && (
        <Sheet title="移到哪一張圖？" onClose={() => setMoving(null)}>
          <ul className="grid grid-cols-2 gap-3 p-3">
            {figs.map((f) => (
              <li key={f.fid}>
                <button
                  type="button"
                  className="w-full rounded-btn border border-line bg-paper p-2 hover:border-blue-accent"
                  onClick={async () => {
                    await ink.move(moving, `${prefix}${f.fid}`, f.w, f.h);
                    setMoving(null);
                    toast("已移到那張圖");
                  }}
                >
                  <img src={content.assetUrl(f.src)} alt={f.alt || "筆記的圖"} className="mx-auto max-h-40 w-auto" />
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {removing && (
        <Dialog
          title="刪除這些標記？"
          onClose={() => setRemoving(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setRemoving(null)}>保留</Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await ink.remove(removing);
                  setRemoving(null);
                }}
              >
                刪除
              </Button>
            </>
          }
        >
          刪除後不能復原。
        </Dialog>
      )}
    </details>
  );
}
