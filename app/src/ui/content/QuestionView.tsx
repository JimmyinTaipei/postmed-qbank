// 一題的完整顯示與作答流程（規格書 §5.1、§9.2）。刷題畫面與單題頁共用。
// 用法：外層用 useAnswerFlow 拿到流程狀態，交給 <QuestionView> 顯示，並用同一個 flow 決定底部主要按鈕。
// 題目瀏覽（第 2B 階段）用 <QuestionRead>：同一個元件的唯讀模式，不能作答、不寫 attempt。

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { answerText, attempts, isChoice, isMulti, judge, notes, qKey, splitQuestion, useCareless, useKbRelated, useNote, useVocabSubjects, type Attempt, type FieldMark, type Question } from "@/data";
import { Icon, type IconName } from "../icons";
import { useToast } from "../overlays";
import { Badge, Button, Notice, OptionRow, Segmented, cx, type OptionState } from "../primitives";
import { HighlightableMarkdown } from "./Highlights";
import { QuestionWords } from "./VocabLookup";
import { Markdown } from "./Markdown";
import { RichEditor } from "../RichEditorLazy";
import { FieldEditor, useInlineField } from "./FieldEditor";
import { SourceBadges } from "./SourceBadges";
import { Handwriting, useInkAttemptReset } from "../ink/Handwriting";
import { InkScope } from "../ink/FigInk";

/** read：題目瀏覽的唯讀模式（第 2B 階段） */
export type Phase = "choose" | "multi" | "self" | "revealed" | "done" | "read";

export interface AnswerFlow {
  phase: Phase;
  picked: string[];
  canSubmit: boolean;
  select: (letter: string) => void;
  submit: () => void;
  reveal: () => void;
  grade: (correct: boolean) => void;
}

/**
 * 作答流程。選擇題：點選項即判定（複選要再送出）；自評題：顯示答案後自己按對或錯。
 * 換題時外層元件要換 key，讓這裡的狀態歸零。
 */
export function useAnswerFlow(q: Question, attempt: Attempt | null | undefined, onAnswer: (chosen: string[] | null, correct: boolean) => void | Promise<void>): AnswerFlow {
  const [picked, setPicked] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);
  const busy = useRef(false);
  const choice = isChoice(q);
  const multi = isMulti(q);
  const phase: Phase = attempt ? "done" : choice ? (multi ? "multi" : "choose") : revealed ? "revealed" : "self";

  const send = useCallback(
    (chosen: string[] | null, correct: boolean) => {
      if (busy.current) return;
      busy.current = true;
      Promise.resolve(onAnswer(chosen, correct)).catch(() => {
        busy.current = false; // 寫入失敗：讓使用者可以再按一次
      });
    },
    [onAnswer],
  );

  return {
    phase,
    picked,
    canSubmit: phase === "multi" && picked.length > 0,
    select: (letter) => {
      if (phase === "choose") send([letter], judge(q, [letter]));
      else if (phase === "multi") setPicked((p) => (p.includes(letter) ? p.filter((x) => x !== letter) : [...p, letter].sort()));
    },
    submit: () => {
      if (phase === "multi" && picked.length) send(picked, judge(q, picked));
    },
    reveal: () => phase === "self" && setRevealed(true),
    grade: (correct) => phase === "revealed" && send(null, correct),
  };
}

function optionState(letter: string, flow: AnswerFlow, q: Question, attempt: Attempt | null | undefined, reveal: boolean): OptionState {
  if (flow.phase === "read") {
    // 題目瀏覽：點了選項就對答案（不記錄）；沒點、只是顯示答案時把正解框出來
    const key = q.answer.keys.includes(letter);
    if (flow.picked.length) return flow.picked.includes(letter) ? (key ? "correct" : "incorrect") : key ? "missed" : "dimmed";
    return reveal && key ? "missed" : "idle";
  }
  if (flow.phase !== "done") return flow.picked.includes(letter) ? "selected" : "idle";
  const chosen = attempt?.chosen ?? [];
  const key = q.answer.keys.includes(letter);
  if (chosen.includes(letter)) return key ? "correct" : "incorrect";
  return key ? "missed" : "dimmed";
}

function Section({ title, icon, children }: { title: string; icon?: IconName; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-ui font-semibold text-ink-muted">
        {icon && <Icon name={icon} size={16} />}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fold({ title, icon, tone, children, defaultOpen }: { title: ReactNode; icon?: IconName; tone?: "warning"; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className={cx("group rounded-btn border", tone === "warning" ? "border-warning bg-warning-bg" : "border-line")}>
      <summary className={cx("flex min-h-(--tap) items-center gap-2 px-3 text-ui font-medium", tone === "warning" ? "text-warning-ink" : "text-ink-strong")}>
        {icon && <Icon name={icon} size={18} />}
        <span className="min-w-0 flex-1">{title}</span>
        <Icon name="chevronDown" size={18} className="transition-transform duration-(--dur-fast) group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  );
}

interface Props {
  q: Question;
  flow: AnswerFlow;
  attempt: Attempt | null | undefined;
  /** 章節名稱（「Ch23 壓力・靜水壓」）；查不到就不顯示 */
  chapter?: string;
  /** 快捷鍵 A–H 作答、空白鍵顯示答案、Enter 送出。同一畫面只能有一個 QuestionView 開著。 */
  hotkeys?: boolean;
  /** 標題列右邊的按鈕（題組頁每一小題自己的星號與 ⋯） */
  headerExtra?: ReactNode;
  /** 唯讀模式顯示到哪裡（flow.phase 是 "read" 時）：q 只有題目、a 加答案、all 再加詳解 */
  show?: "q" | "a" | "all";
}

export function QuestionView({ q, flow, attempt, chapter, hotkeys, headerExtra, show }: Props) {
  const choice = isChoice(q);
  const multi = isMulti(q);
  const parts = choice ? splitQuestion(q) : null;
  const read = flow.phase === "read";
  const done = flow.phase === "done";
  const showAnswer = done || flow.phase === "revealed" || (read && show !== "q");
  // 物理：重新作答時手寫區與圖上標記是空白的（第 6 階段）
  useInkAttemptReset(q, !done);

  useEffect(() => {
    if (!hotkeys) return;
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [aria-modal='true'], [role='menu']") || document.querySelector("[aria-modal='true']")) return;
      const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (parts && /^[A-H]$/.test(k) && parts.options.some((o) => o.letter === k)) flow.select(k);
      else if (k === " " && flow.phase === "self") flow.reveal();
      else if (k === "Enter" && flow.phase === "multi" && flow.canSubmit && t.tagName !== "BUTTON") flow.submit();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // 圖上標記掛在這一題（第 6B 階段）；物理在已作答畫面上畫的記下那次作答
  const inkScope = useMemo(() => ({ base: `q:${q.id}`, att: done ? attempt?.id : undefined }), [q.id, done, attempt?.id]);
  const editField = useInlineField(q.id);

  return (
    <InkScope value={inkScope}>
    <article className="space-y-4" aria-labelledby={`q-${q.id}`}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* 題目一律寫成「來源｜ID」 */}
        <h2 id={`q-${q.id}`} className="text-ui font-semibold text-ink-strong select-text">
          {q.label}
          <span className="mx-1 text-ink-muted">｜</span>
          <span className="font-normal text-ink-muted">{q.id}</span>
        </h2>
        {chapter && <span className="text-meta text-ink-muted">{chapter}</span>}
        <PatchBadge q={q} />
        {q.answer.note === "送分" && <Badge tone="warning">送分</Badge>}
        {headerExtra && <span className="ml-auto flex items-center">{headerExtra}</span>}
      </header>

      {editField === "ques" ? (
        <FieldEditor q={q} field="ques" />
      ) : parts ? (
        <>
          <HighlightableMarkdown target={`q:${q.id}/ques`} text={parts.stem} figs={q.figs} role="q" />
          {multi && !done && !read && <p className="text-meta text-ink-muted">複選題：選好所有答案後按「送出」。</p>}
          <div role={multi ? "group" : "radiogroup"} aria-label="選項" className="space-y-2">
            {parts.options.map((o) => (
              <OptionRow key={o.letter} letter={o.letter} multi={multi} locked={done || (read && (flow.picked.length > 0 || !choice))} state={optionState(o.letter, flow, q, attempt, showAnswer)} onSelect={() => flow.select(o.letter)}>
                <Markdown text={o.md} figs={q.figs} role="q" tight />
              </OptionRow>
            ))}
          </div>
          {parts.tail.trim() && <Markdown text={parts.tail} figs={q.figs} role="q" />}
        </>
      ) : (
        <>
          <HighlightableMarkdown target={`q:${q.id}/ques`} text={q.ques} figs={q.figs} role="q" />
          {flow.phase === "self" && <p className="text-meta text-ink-muted">這題要自己對答案：想好後按「顯示答案」，再標記對或錯。</p>}
        </>
      )}

      {/* 第 6 階段：題目下方的手寫區（預設收合） */}
      <Handwriting target={`q:${q.id}`} att={done ? attempt?.id : undefined} />

      {showAnswer && (
        <div className="anim-rise space-y-4">
          <Result q={q} flow={flow} attempt={attempt} />
          {(!read || show === "all") && <Solution q={q} />}
        </div>
      )}
    </article>
    </InkScope>
  );
}


/**
 * 題目瀏覽用的唯讀顯示（第 2B 階段，規格書 §9.9）：題幹、選項、螢光、手寫、答案、詳解都和作答畫面是同一份，
 * 只是不能點選項作答、不寫 attempt。show 是「只看題目」時，題目下方可以單獨展開這一題的答案與詳解。
 */
export function QuestionRead({ q, show, chapter, headerExtra }: { q: Question; show: "q" | "a" | "all"; chapter?: string; headerExtra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => setOpen(false), [show]);
  const eff = open ? "all" : show;
  // 點選項＝自己對答案：標出對錯、展開答案與詳解，但不寫 attempt（2026-11-12 使用者：可以點，預設不紀錄）
  const flow = useMemo<AnswerFlow>(
    () => ({ phase: "read", picked, canSubmit: false, select: (l) => { setPicked([l]); setOpen(true); }, submit: () => {}, reveal: () => {}, grade: () => {} }),
    [picked],
  );
  const right = picked.length > 0 && judge(q, picked);
  return (
    <div className="space-y-3">
      {picked.length > 0 && (
        <p role="status" className={cx("text-ui font-medium", right ? "text-correct-ink" : "text-incorrect-ink")}>
          你選 {picked.join("、")}：{right ? "答對" : "答錯"}（瀏覽模式不記錄作答）
          <Button variant="ghost" className="ml-2" onClick={() => { setPicked([]); setOpen(false); }}>重選</Button>
        </p>
      )}
      <QuestionView q={q} flow={flow} attempt={null} chapter={chapter} headerExtra={headerExtra} show={eff} />
      {show !== "all" && (
        <Button variant="ghost" icon={open ? "eyeOff" : "eye"} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? (show === "q" ? "收起答案與詳解" : "收起詳解") : show === "q" ? "看這一題的答案與詳解" : "看這一題的詳解"}
        </Button>
      )}
    </div>
  );
}

function Result({ q, flow, attempt }: { q: Question; flow: AnswerFlow; attempt: Attempt | null | undefined }) {
  const toast = useToast();
  const item = qKey(q.id);
  const careless = useCareless(item);
  const ans = answerText(q);
  const pending = q.answer.mode === "pending";

  return (
    <div className="space-y-3">
      {attempt && (
        <div role="status" className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-btn px-3 py-2.5", attempt.correct ? "bg-correct-bg text-correct-ink" : "bg-incorrect-bg text-incorrect-ink")}>
          <span className="flex items-center gap-1.5 text-ui font-semibold">
            <Icon name={attempt.correct ? "check" : "x"} size={18} />
            {attempt.chosen ? (attempt.correct ? "答對了" : "答錯了") : attempt.correct ? "你標記為答對" : "你標記為答錯"}
          </span>
          {attempt.correct ? (
            attempt.open ? (
              <Segmented
                label="這題的把握程度"
                className="ml-auto"
                value={attempt.confidence}
                onChange={(c) => void attempts.setConfidence(attempt.id, c)}
                options={[
                  { value: 1, label: "猜的" },
                  { value: 2, label: "普通" },
                  { value: 3, label: "很確定" },
                ]}
              />
            ) : (
              <span className="ml-auto text-meta">{["", "猜的", "普通", "很確定"][attempt.confidence]}</span>
            )
          ) : careless ? (
            <span className="ml-auto flex items-center gap-1 text-meta">
              已標為粗心錯，不追蹤
              <Button variant="ghost" className="text-incorrect-ink" onClick={() => void attempts.undoCareless(item)}>
                復原
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              className="ml-auto text-incorrect-ink"
              onClick={() => {
                void attempts.markCareless(item);
                toast("已標為粗心錯：不進錯題本，也不排進複習", { action: { label: "復原", run: () => void attempts.undoCareless(item) } });
              }}
            >
              粗心錯，不追蹤
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {ans && (
          <div className="flex min-w-0 items-baseline gap-2 text-body text-ink-strong">
            <span className="shrink-0 text-ui font-semibold text-ink-muted">正解</span>
            {q.answer.keys.length ? <span className="font-semibold">{ans}</span> : <Markdown text={ans} figs={q.figs} role="sol" tight />}
          </div>
        )}
        {q.patch?.answerRevised && <Badge tone="warning" icon="edit">答案曾修訂</Badge>}
        <span className="ml-auto">
          <SourceBadges q={q} />
        </span>
      </div>

      {flow.phase === "revealed" && (
        <div className="flex gap-2" role="group" aria-label="自己對答案">
          <Button variant="danger" block icon="x" onClick={() => flow.grade(false)}>
            我答錯了
          </Button>
          <Button variant="secondary" block icon="check" onClick={() => flow.grade(true)}>
            我答對了
          </Button>
        </div>
      )}

      {pending && <Notice tone="warning" icon="alert">這題的答案還沒定案，下面的內容僅供參考。</Notice>}
      {q.answer.mode === "any" && (q.answer.note === "送分" ? <Notice>送分題：任何作答都算對。</Notice> : <Notice>{q.answer.note ? `${q.answer.note}：` : ""}這題有不只一個答案算對（{q.answer.keys.join("、")}）。</Notice>)}
      {q.answer.mode === "text" && q.answer.note && <Notice>{q.answer.note}</Notice>}
      {q.source_answer && (
        <p className="text-meta text-ink-muted">
          教材原答：{Array.isArray(q.source_answer.value) ? q.source_answer.value.join("、") : q.source_answer.value}
          {q.source_answer.note && `（${q.source_answer.note}）`}
        </p>
      )}
      {q.sol_meta.issues.length > 0 && (
        <Fold tone="warning" icon="alert" title={`疑點（${q.sol_meta.issues.length}）`}>
          <ul className="list-disc space-y-1 pl-5 text-ui text-warning-ink">
            {q.sol_meta.issues.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </Fold>
      )}
    </div>
  );
}

function Solution({ q }: { q: Question }) {
  const editField = useInlineField(q.id);
  return (
    <div className="space-y-4">
      {(q.idea.trim() || editField === "idea") && (
        <Section title="思路">
          {editField === "idea" ? <FieldEditor q={q} field="idea" /> : <HighlightableMarkdown target={`q:${q.id}/idea`} text={q.idea} figs={q.figs} role="sol" />}
        </Section>
      )}
      <Section title="詳解">
        {editField === "sol" ? (
          <FieldEditor q={q} field="sol" />
        ) : q.sol.trim() ? (
          <HighlightableMarkdown target={`q:${q.id}/sol`} text={q.sol} figs={q.figs} role="sol" />
        ) : (
          <p className="text-ui text-ink-muted">這題還沒有詳解。</p>
        )}
      </Section>

      {q.teacher.length > 0 && (
        <div className="space-y-2">
          {q.teacher.map((t, i) => (
            <Fold key={i} title={t.title || "老師原解"}>
              <Markdown text={t.md.replace(/^# .*\n+/, "")} figs={q.figs} role="sol" />
            </Fold>
          ))}
        </div>
      )}

      {q.alt_sources.length > 0 && (
        <Section title="同一題的其他出處">
          <ul className="flex flex-wrap gap-2">
            {q.alt_sources.map((a) => (
              <li key={a.id}>
                <Link to={`/q/${encodeURIComponent(a.id)}`} className="inline-flex min-h-(--tap) items-center gap-2 rounded-btn border border-line px-3 text-ui no-underline hover:bg-hover">
                  {a.label}｜{a.id}
                  {a.relation === "adapted" && <Badge>改編</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <RelatedNotes id={q.id} />
      <QuestionWordsIf q={q} />

      {/* 第 3 階段：個人筆記（手寫區在題目下方） */}
      <NoteBox q={q} />
    </div>
  );
}

const MARK_BADGE: Record<FieldMark, { tone: "warning" | "blue" | "incorrect"; text: string }> = {
  conflict: { tone: "incorrect", text: "修訂有衝突" },
  stale: { tone: "warning", text: "修訂待處理" },
  pending: { tone: "warning", text: "已修訂・待寫回" },
  written: { tone: "blue", text: "已修訂・待發佈" },
};

/** 規格書 §8：已修訂・待寫回／修訂待處理。只看內容欄位（「已確認」由來源徽章顯示）。 */
function PatchBadge({ q }: { q: Question }) {
  const marks = Object.entries(q.patch?.marks ?? {}).filter(([f]) => f !== "human_verified").map(([, m]) => m);
  const m = (["conflict", "stale", "pending", "written"] as FieldMark[]).find((k) => marks.includes(k));
  if (!m) return null;
  return (
    <Link to="/patches" className="no-underline">
      <Badge tone={MARK_BADGE[m].tone} icon={m === "conflict" || m === "stale" ? "alert" : "edit"}>
        {MARK_BADGE[m].text}
      </Badge>
    </Link>
  );
}

/** 這一題的單字（第 8B-2 階段）：只在開了查單字的科目出現 */
function QuestionWordsIf({ q }: { q: Question }) {
  const subs = useVocabSubjects();
  return subs?.includes(q.subject) ? <QuestionWords qid={q.id} subject={q.subject} /> : null;
}

/** 相關筆記（規格書 §9.4）：哪些講義筆記的段落在句尾引用了這一題。點了跳到那個段落。
 *  第 8C 階段起也列出這一題的章節對應的整份講義（bid 是空字串：開在最上面）。 */
function RelatedNotes({ id }: { id: string }) {
  const rel = useKbRelated(id).data;
  if (!rel?.length) return null;
  return (
    <Section title="相關筆記" icon="book">
      <ul className="space-y-1">
        {rel.map((r) => (
          <li key={r.key + r.bid}>
            <Link to={`/kb/${r.key.split("/").map(encodeURIComponent).join("/")}${r.bid ? `#b-${r.bid}` : ""}`} className="flex min-h-(--tap) flex-col justify-center rounded-btn px-2 py-1 no-underline hover:bg-hover">
              <span className="text-ui text-blue-deep">{[r.title, ...r.path].join(" › ")}</span>
              {r.text && <span className="line-clamp-2 text-meta text-ink-muted">{r.text}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** 我的筆記（規格書 §4.6 note）：一題一則 Markdown，會同步、會出現在「匯出全部」。就地編輯（第 3B 階段）。 */
function NoteBox({ q }: { q: Question }) {
  const target = `q:${q.id}`;
  const note = useNote(target);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const has = !!note?.body_md.trim();
  return (
    <Fold title={has ? "我的筆記（有內容）" : "我的筆記"} icon="note" defaultOpen={has}>
      {editing ? (
        <div className="rounded-btn border border-blue-accent px-3 py-2">
          <RichEditor
            initial={note?.body_md ?? ""}
            label="我的筆記"
            placeholder="寫下自己的理解、易錯點…（可以打 $公式$、- 列點、/表格）"
            figs={q.figs}
            role="sol"
            onCancel={() => setEditing(false)}
            onDone={(r) => {
              setEditing(false);
              if (!r.changed) return;
              const before = note?.body_md ?? "";
              void notes.save(target, r.md);
              toast(r.md.trim() ? "已儲存筆記" : "已刪除筆記", { action: { label: "復原", run: () => void notes.save(target, before) } });
            }}
          />
        </div>
      ) : has ? (
        <div className="space-y-2">
          <button type="button" onClick={() => setEditing(true)} title="點一下修改" className="block w-full rounded-btn text-left hover:bg-hover">
            <Markdown text={note!.body_md} figs={q.figs} role="sol" />
          </button>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" icon="trash" onClick={() => { const before = note!.body_md; void notes.remove(target); toast("已刪除筆記", { action: { label: "復原", run: () => void notes.save(target, before) } }); }}>刪除</Button>
            <Button variant="secondary" icon="edit" onClick={() => setEditing(true)}>編輯筆記</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-ui text-ink-muted">寫下自己的理解、易錯點。可用公式與表格，兩台裝置會同步。</p>
          <Button variant="secondary" icon="plus" onClick={() => setEditing(true)}>寫筆記</Button>
        </div>
      )}
    </Fold>
  );
}
