// 一個畫布和資料庫的一列（ink）之間的存取：開啟時讀、另一台裝置改了就換、停筆 2 秒自動存、離開時立刻存。
// 手寫區的每一頁、每一張圖的標記都用這一個 hook。

import { useCallback, useEffect, useRef } from "react";
import { ink, InkTooLarge, readInk, type InkDoc, type InkRow } from "@/data";
import { useToast } from "../overlays";
import { useInkEditor, type InkEditor } from "./useInkEditor";

const SAVE_DELAY = 2000;

interface Options {
  target: string;
  page: number;
  /** 資料庫的這一列；undefined = 還在讀；null = 沒有 */
  row: InkRow | null | undefined;
  /** 存檔時的座標空間 */
  size: () => { w: number; h: number };
  /** 存檔時一起寫進去的欄位（att、src） */
  meta?: () => Partial<InkDoc>;
  /** 讀到資料時（手寫區用來還原紙的高度） */
  onLoad?: (row: InkRow | null, doc: InkDoc) => void;
}

export interface PersistentInk {
  editor: InkEditor;
  /** 立刻存（force：沒有改筆畫也存，例如紙加長了） */
  save: (force?: boolean) => Promise<void>;
  /** 目前畫面上這一份的內容（含 src、att） */
  doc: React.RefObject<InkDoc | null>;
}

export function usePersistentInk({ target, page, row, size, meta, onLoad }: Options): PersistentInk {
  const toast = useToast();
  const editor = useInkEditor();
  const known = useRef<number | null>(null); // 畫面上這一份對應的 updated_at
  const doc = useRef<InkDoc | null>(null);
  const edRef = useRef(editor);
  edRef.current = editor;
  const opts = useRef({ size, meta, onLoad });
  opts.current = { size, meta, onLoad };

  // 資料庫 → 畫面（開啟時、另一台裝置畫了、物理重新作答被清掉）。自己還有沒存的變更時不蓋掉。
  const at = row === undefined ? undefined : (row?.updated_at ?? null);
  useEffect(() => {
    if (at === undefined || at === known.current || edRef.current.dirty) return;
    let alive = true;
    void readInk(row).then((d) => {
      if (!alive || edRef.current.dirty) return;
      known.current = at;
      doc.current = row && !row.deleted ? d : null;
      edRef.current.load(d.strokes);
      opts.current.onLoad?.(row ?? null, d);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);

  const save = useCallback(
    async (force = false) => {
      const e = edRef.current;
      if (!target || (!e.dirty && !force)) return;
      const rev = e.rev;
      const { w, h } = opts.current.size();
      const extra = opts.current.meta?.() ?? {};
      const next: InkDoc = { v: 1, ...extra, strokes: e.strokes };
      for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
      try {
        const r = await ink.save(target, page, next, w, h);
        known.current = r.updated_at;
        doc.current = r.deleted ? null : next;
        e.markSaved(rev);
      } catch (err) {
        toast(err instanceof InkTooLarge ? err.message : "筆跡沒有存成功，請再畫一筆試試");
      }
    },
    [target, page, toast],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  // 停筆 2 秒自動存
  useEffect(() => {
    if (!editor.dirty) return;
    const t = setTimeout(() => void saveRef.current(), SAVE_DELAY);
    return () => clearTimeout(t);
  }, [editor.rev, editor.dirty]);

  // 離開畫面、App 進背景：立刻存
  useEffect(() => {
    const flush = () => void saveRef.current();
    const vis = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return { editor, save, doc };
}
