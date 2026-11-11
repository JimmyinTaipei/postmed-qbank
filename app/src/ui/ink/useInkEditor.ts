// 一個畫布（一頁手寫、一張圖的標記）的編輯狀態：筆畫、復原／重做。
// 筆畫陣列每次改都換一個新陣列（舊的筆畫物件共用），復原就是換回上一個陣列。

import { useCallback, useMemo, useRef, useState } from "react";
import type { InkStroke } from "@/data";

const HISTORY = 100;

export interface InkEditor {
  strokes: InkStroke[];
  canUndo: boolean;
  canRedo: boolean;
  /** 有使用者改過、還沒存的變更 */
  dirty: boolean;
  add: (s: InkStroke) => void;
  /** 一次擦除手勢從頭到尾算一步：begin 記下擦之前的狀態，期間 remove 多次，end 收尾 */
  eraseBegin: () => void;
  remove: (pick: (s: InkStroke) => boolean) => void;
  eraseEnd: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  /** 換成雲端／資料庫的內容（另一台裝置畫的）：清掉歷史，不算使用者的變更 */
  load: (strokes: InkStroke[]) => void;
  /** 存檔完成：只有在存檔開始後沒有新的變更（rev 相同）時才算存好了 */
  markSaved: (rev: number) => void;
  /** 每次使用者造成的變更都加 1（存檔排程用） */
  rev: number;
}

export function useInkEditor(initial: InkStroke[] = []): InkEditor {
  const [state, setState] = useState({ strokes: initial, past: [] as InkStroke[][], future: [] as InkStroke[][], dirty: false, rev: 0 });
  const erasing = useRef<InkStroke[] | null>(null);

  const commit = useCallback((next: (cur: InkStroke[]) => InkStroke[], before?: InkStroke[]) => {
    setState((s) => {
      const strokes = next(s.strokes);
      if (strokes === s.strokes && !before) return s;
      return { strokes, past: [...s.past, before ?? s.strokes].slice(-HISTORY), future: [], dirty: true, rev: s.rev + 1 };
    });
  }, []);

  const add = useCallback((st: InkStroke) => commit((cur) => [...cur, st]), [commit]);
  const eraseBegin = useCallback(() => {
    setState((s) => {
      erasing.current = s.strokes;
      return s;
    });
  }, []);
  const remove = useCallback((pick: (s: InkStroke) => boolean) => {
    setState((s) => {
      const strokes = s.strokes.filter((x) => !pick(x));
      return strokes.length === s.strokes.length ? s : { ...s, strokes };
    });
  }, []);
  const eraseEnd = useCallback(() => {
    setState((s) => {
      const before = erasing.current;
      erasing.current = null;
      if (!before || before.length === s.strokes.length) return s;
      return { ...s, past: [...s.past, before].slice(-HISTORY), future: [], dirty: true, rev: s.rev + 1 };
    });
  }, []);
  const undo = useCallback(() => {
    setState((s) => (s.past.length ? { strokes: s.past[s.past.length - 1], past: s.past.slice(0, -1), future: [s.strokes, ...s.future], dirty: true, rev: s.rev + 1 } : s));
  }, []);
  const redo = useCallback(() => {
    setState((s) => (s.future.length ? { strokes: s.future[0], past: [...s.past, s.strokes], future: s.future.slice(1), dirty: true, rev: s.rev + 1 } : s));
  }, []);
  const clear = useCallback(() => commit((cur) => (cur.length ? [] : cur)), [commit]);
  const load = useCallback((strokes: InkStroke[]) => setState((s) => ({ strokes, past: [], future: [], dirty: false, rev: s.rev })), []);
  const markSaved = useCallback((rev: number) => setState((s) => (s.dirty && s.rev === rev ? { ...s, dirty: false } : s)), []);

  return useMemo(
    () => ({ strokes: state.strokes, canUndo: state.past.length > 0, canRedo: state.future.length > 0, dirty: state.dirty, rev: state.rev, add, eraseBegin, remove, eraseEnd, undo, redo, clear, load, markSaved }),
    [state, add, eraseBegin, remove, eraseEnd, undo, redo, clear, load, markSaved],
  );
}
