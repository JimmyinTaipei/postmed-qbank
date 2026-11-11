// 題目的編輯面板（規格書 §9.3「iPad 改錯字」、第 3 階段）：⋯ →「編輯這一題」。
// 欄位：題幹與選項／思路／詳解（Markdown＋即時預覽、貼上 AI 回覆自動轉換）、答案（多一步確認）、章節、標籤。
// 存檔 = 寫一筆修訂（content_patch），題目立刻顯示新內容並標「已修訂・待寫回」；之後在 Mac 上 pmq patches pull。

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { answerValue, FIELD_NAME, fieldValue, patches, useQuestion, useTaxonomy, type AnswerValue, type PatchField, type Question } from "@/data";
import { Dialog, Sheet, useToast } from "@/ui/overlays";
import { Button, Chip, EmptyState, Notice, Segmented, Select, Skeleton, Tabs, TextField } from "@/ui/primitives";
import { MarkdownEditor } from "@/ui/templates";
import { HighlightEdit } from "@/ui/content/Highlights";

const Ctx = createContext<(id: string, field?: PatchField) => void>(() => {});

/** 開編輯面板：useEditor()(題目 ID)。 */
export const useEditor = () => useContext(Ctx);

export function EditorProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ id: string; field?: PatchField } | null>(null);
  // 選字框的「編輯」：target "q:<題號>/<ques|idea|sol>" → 開那一題、那一欄
  const editFromTarget = useMemo(
    () => (target: string) => {
      const m = /^q:([^/]+)\/(ques|idea|sol)$/.exec(target);
      if (m) setOpen({ id: m[1], field: m[2] as PatchField });
    },
    [],
  );
  return (
    <Ctx.Provider value={(id, field) => setOpen({ id, field })}>
      <HighlightEdit.Provider value={editFromTarget}>{children}</HighlightEdit.Provider>
      {open && <EditQuestion key={open.id} id={open.id} initialField={open.field} onClose={() => setOpen(null)} />}
    </Ctx.Provider>
  );
}

type Draft = Partial<Record<PatchField, string>>;

function EditQuestion({ id, initialField, onClose }: { id: string; initialField?: PatchField; onClose: () => void }) {
  const q = useQuestion(id);
  const data = q.data && typeof q.data === "object" ? q.data : null;
  return (
    <Sheet title={data ? `編輯｜${data.label}｜${data.id}` : "編輯這一題"} size="wide" onClose={onClose}>
      {q.loading && !data ? (
        <div className="p-4"><Skeleton lines={6} /></div>
      ) : !data ? (
        <EmptyState tone="error" title="讀不到這一題">{q.error?.message ?? "這題的本文不在裝置上，連上網路後再試。"}</EmptyState>
      ) : (
        <Editor q={data} initialField={initialField} onClose={onClose} />
      )}
    </Sheet>
  );
}

const MD_FIELDS = ["ques", "idea", "sol"] as const;

function Editor({ q, initialField, onClose }: { q: Question; initialField?: PatchField; onClose: () => void }) {
  const toast = useToast();
  const base = q.patch?.base ?? q;
  const phy = q.subject === "PHY";
  const fields: PatchField[] = phy ? ["ques", "idea", "sol", "answer", "chap", "tags"] : ["ques", "sol", "answer", "chap"];
  const [field, setField] = useState<PatchField>(initialField && fields.includes(initialField) ? initialField : "sol");
  // 編輯器裡看到的是目前畫面上的版本（含還沒寫回的修訂）
  const initial = useMemo(() => {
    const d: Draft = {};
    for (const f of fields) d[f] = MD_FIELDS.includes(f as (typeof MD_FIELDS)[number]) ? fieldValue(q, f).trim() : fieldValue(q, f);
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (f: PatchField, v: string) => setDraft((d) => ({ ...d, [f]: v }));
  const changed = fields.filter((f) => draft[f] !== initial[f]);
  const mark = q.patch?.marks;
  const blocked = changed.filter((f) => mark?.[f] === "conflict");

  const save = async () => {
    setBusy(true);
    try {
      for (const f of changed) await patches.save(base, f, draft[f] ?? "");
      toast(`已存檔（${changed.map((f) => FIELD_NAME[f]).join("、")}）：標為「已修訂・待寫回」`);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const tabs = fields.map((f) => ({ value: f, label: FIELD_NAME[f] + (draft[f] !== initial[f] ? " •" : "") }));

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-4 pt-2">
        <Tabs label="要改的欄位" tabs={tabs} value={field} onChange={setField} />
      </div>
      <div className="flex-1 space-y-4 p-4">
        {mark?.[field] === "conflict" && (
          <Notice tone="incorrect" icon="alert" action={<Link to="/patches" className="text-ui">到修訂佇列</Link>}>
            這一段的修訂和 Mac 上的主檔衝突了，先到修訂佇列決定要用哪個版本，再回來改。
          </Notice>
        )}
        {mark?.[field] === "stale" && <Notice tone="warning" icon="alert">題庫已經更新過這一段，你之前的修訂沒有套用（修訂佇列裡可以看兩個版本）。這裡顯示的是題庫目前的內容。</Notice>}
        {(field === "ques" || field === "idea" || field === "sol") && (
          <MarkdownEditor key={field} value={draft[field] ?? ""} onChange={(v) => set(field, v)} figs={q.figs} role={field === "ques" ? "q" : "sol"} label={FIELD_NAME[field] + "（Markdown）"} />
        )}
        {field === "ques" && <p className="text-meta text-ink-muted">選項用 (A)(B)(C)… 標記，存檔後會重新切選項。題圖寫成 ![說明](fig:圖代號)，不要改括號裡的代號。</p>}
        {field === "answer" && <AnswerForm q={q} value={draft.answer ?? ""} onChange={(v) => set("answer", v)} />}
        {field === "chap" && <ChapForm q={q} value={draft.chap ?? ""} onChange={(v) => set("chap", v)} />}
        {field === "tags" && <TagsForm value={draft.tags ?? "{}"} onChange={(v) => set("tags", v)} />}
        {(field === "answer" || field === "sol") && <p className="text-meta text-ink-muted">改答案或詳解時，這題會一併標為「✓ 已確認」。</p>}
      </div>
      <footer className="pb-safe sticky bottom-0 border-t border-line bg-card">
        <div className="flex flex-wrap items-center justify-end gap-2 p-3">
          <span className="mr-auto text-meta text-ink-muted">
            {blocked.length ? `${blocked.map((f) => FIELD_NAME[f]).join("、")}有衝突，不能存` : changed.length ? `改了：${changed.map((f) => FIELD_NAME[f]).join("、")}` : "還沒有修改"}
          </span>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" loading={busy} disabled={!changed.length || blocked.length > 0} onClick={() => (changed.includes("answer") ? setConfirm(true) : void save())}>
            儲存
          </Button>
        </div>
      </footer>
      {confirm && (
        <Dialog
          title="要改這題的答案嗎？"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>取消</Button>
              <Button variant="primary" onClick={() => { setConfirm(false); void save(); }}>改答案</Button>
            </>
          }
        >
          <p>
            答案從 <strong>{describeAnswer(initial.answer)}</strong> 改成 <strong>{describeAnswer(draft.answer)}</strong>。
          </p>
          <p className="mt-2 text-ink-muted">這題會標「答案曾修訂」。已經做過的作答紀錄不會重算對錯。</p>
        </Dialog>
      )}
    </div>
  );
}

function parseAnswer(v: string | undefined): AnswerValue | null {
  try {
    return v ? (JSON.parse(v) as AnswerValue) : null;
  } catch {
    return null;
  }
}

function describeAnswer(v: string | undefined): string {
  const a = parseAnswer(v);
  if (!a) return "（無）";
  if (a.keys.length) return a.keys.map((k) => `(${k})`).join(a.mode === "any" ? " 或 " : "");
  return a.text?.trim() || "（待定）";
}

function AnswerForm({ q, value, onChange }: { q: Question; value: string; onChange: (v: string) => void }) {
  const a = parseAnswer(value) ?? answerValue(q);
  // 選項在圖裡（沒切出選項）但答案是字母：一樣給 A–E（或到答案用到的最後一個字母）
  const letterMode = a.mode === "single" || a.mode === "all" || a.mode === "any";
  const parsed = q.opt?.map((o) => o[0]) ?? [];
  const last = Math.max(4, ...a.keys.map((k) => "ABCDEFGH".indexOf(k)));
  const letters = parsed.length >= 2 ? parsed : letterMode ? "ABCDEFGH".slice(0, last + 1).split("") : [];
  const emit = (next: AnswerValue) => onChange(JSON.stringify({ mode: next.mode, keys: next.keys, text: next.text }));
  if (letters.length >= 2) {
    const toggle = (k: string) => {
      const keys = a.keys.includes(k) ? a.keys.filter((x) => x !== k) : [...a.keys, k].sort();
      const mode = keys.length > 1 ? (a.mode === "any" ? "any" : "all") : "single";
      emit({ mode, keys, text: null });
    };
    return (
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-2 text-ui font-medium text-ink-strong">正確答案</legend>
          <div className="flex flex-wrap gap-2">
            {letters.map((k) => (
              <Chip key={k} selected={a.keys.includes(k)} onToggle={() => toggle(k)}>
                ({k})
              </Chip>
            ))}
          </div>
        </fieldset>
        {a.keys.length > 1 && (
          <Segmented
            label="多個答案時怎麼算"
            value={a.mode === "any" ? "any" : "all"}
            onChange={(m) => emit({ ...a, mode: m })}
            options={[
              { value: "all", label: "全選才算對（複選）" },
              { value: "any", label: "選任一個都算對" },
            ]}
          />
        )}
        {a.keys.length === 0 && <Notice tone="warning" icon="alert">至少要選一個答案。</Notice>}
      </div>
    );
  }
  if (q.subject !== "PHY") return <Notice tone="warning" icon="alert">這題沒有切出選項，生化只能改選擇題的答案字母。請先在「題幹與選項」把 (A)(B)… 標好。</Notice>;
  return (
    <TextField
      label="答案（文字或數值）"
      value={a.text ?? ""}
      onChange={(e) => emit({ mode: a.mode === "numeric" ? "numeric" : "text", keys: [], text: e.target.value })}
      hint="非選擇題的答案原文；公式可用 $…$。"
    />
  );
}

function ChapForm({ q, value, onChange }: { q: Question; value: string; onChange: (v: string) => void }) {
  const tax = useTaxonomy().data;
  const options = useMemo(() => {
    const chs = (tax?.chapters ?? []).filter((c) => c.subject === q.subject && (q.subject !== "PHY" || c.parent !== null));
    return chs.map((c) => ({ value: c.id, label: `${c.id.split(":")[1]}　${c.title}` }));
  }, [tax, q.subject]);
  if (!tax) return <Skeleton lines={1} />;
  return <Select label="章節" value={value} onChange={onChange} options={value && !options.some((o) => o.value === value) ? [{ value, label: value }, ...options] : options} hint="改章節後，出題設定的章節篩選要等 Mac 上 pmq publish 之後才會跟著變。" />;
}

const TAG_KINDS = [
  ["topic", "主題"],
  ["type", "題型"],
  ["method", "解法"],
] as const;

function TagsForm({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  let t: Record<string, string[]> = {};
  try {
    t = JSON.parse(value);
  } catch {
    /* 空白 */
  }
  const [text, setText] = useState(() => Object.fromEntries(TAG_KINDS.map(([k]) => [k, (t[k] ?? []).join("、")])));
  const emit = (k: string, v: string) => {
    const next = { ...text, [k]: v };
    setText(next);
    const out: Record<string, string[]> = {};
    for (const key of Object.keys({ ...t, ...next }).sort()) {
      const raw = key in next ? next[key] : (t[key] ?? []).join("、");
      out[key] = raw.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
    }
    onChange(JSON.stringify(out));
  };
  return (
    <div className="space-y-4">
      {TAG_KINDS.map(([k, name]) => (
        <TextField key={k} label={name} value={text[k]} onChange={(e) => emit(k, e.target.value)} hint="多個用頓號「、」分開" />
      ))}
    </div>
  );
}
