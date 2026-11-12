// 題目欄位就地編輯（規格書 §9.10「題目的欄位」，第 3B 階段）：題幹與選項、思路、詳解在題目頁上原地變成編輯器。
// 從選字框的「編輯」或 ⋯ →「編輯這一題」→ 選欄位進來。答案、章節、標籤是表單，仍在編輯面板裡改。
// 存檔＝寫一筆修訂（和原本的編輯面板相同：patches.save），跳出「已存成修訂」與「復原」。

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { FIELD_NAME, fieldValue, patches, type PatchField, type Question } from "@/data";
import { useToast } from "../overlays";
import { RichEditor } from "../RichEditorLazy";

export type InlineField = "ques" | "idea" | "sol";

export interface InlineFieldApi {
  cur: { id: string; field: InlineField } | null;
  start: (id: string, field: InlineField) => void;
  stop: () => void;
  /** 畫面上有顯示的題目（就地編輯只對看得到的題目；看不到的改開編輯面板） */
  mount: (id: string) => () => void;
}

export const InlineFieldCtx = createContext<InlineFieldApi | null>(null);

/** 這一題正在就地編輯哪一欄（同時登記「這題在畫面上」）。 */
export function useInlineField(id: string): InlineField | null {
  const api = useContext(InlineFieldCtx);
  useEffect(() => api?.mount(id), [api, id]);
  return api?.cur?.id === id ? api.cur.field : null;
}

export function FieldEditor({ q, field, extra }: { q: Question; field: InlineField; extra?: ReactNode }) {
  const api = useContext(InlineFieldCtx);
  const toast = useToast();
  const initial = fieldValue(q, field as PatchField).trim();
  const base = q.patch?.base ?? q;
  return (
    <div className="rounded-btn border border-blue-accent px-3 py-2" data-field-editor={field}>
      <RichEditor
        initial={initial}
        label={`編輯${FIELD_NAME[field]}`}
        figs={q.figs}
        role={field === "ques" ? "q" : "sol"}
        barStart={<span className="mr-1 text-meta font-medium text-ink-muted">{FIELD_NAME[field]}</span>}
        onNotice={(t) => toast(t)}
        onCancel={() => api?.stop()}
        onDone={(r) => {
          api?.stop();
          if (!r.changed || r.md.trim() === initial) return;
          void patches.save(base, field, r.md).then((ok) => {
            if (!ok) return toast("這一段的修訂有衝突，請先到修訂佇列處理");
            toast(`已存成修訂（${FIELD_NAME[field]}）：標為「已修訂・待寫回」`, { action: { label: "復原", run: () => void patches.save(base, field, initial).then(() => toast("已復原")) } });
          });
        }}
      />
      {extra}
      {field === "ques" && <p className="mt-1 text-meta text-ink-muted">選項用 (A)(B)(C)… 標記，存檔後會重新切選項。題圖寫成 ![說明](fig:圖代號)，不要改括號裡的代號。</p>}
    </div>
  );
}
