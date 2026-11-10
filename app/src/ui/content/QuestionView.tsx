// 一題的完整顯示與作答流程（規格書 §5.1、§9.2）。刷題畫面與單題頁共用。
// 用法：外層用 useAnswerFlow 拿到流程狀態，交給 <QuestionView> 顯示，並用同一個 flow 決定底部主要按鈕。

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { answerText, attempts, isChoice, isMulti, judge, qKey, splitQuestion, useCareless, type Attempt, type Question } from "@/data";
import { Icon, type IconName } from "../icons";
import { useToast } from "../overlays";
import { Badge, Button, Notice, OptionRow, Segmented, cx, type OptionState } from "../primitives";
import { Markdown } from "./Markdown";
import { SourceBadges } from "./SourceBadges";

export type Phase = "choose" | "multi" | "self" | "revealed" | "done";

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

function optionState(letter: string, flow: AnswerFlow, q: Question, attempt: Attempt | null | undefined): OptionState {
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
}

export function QuestionView({ q, flow, attempt, chapter, hotkeys }: Props) {
  const choice = isChoice(q);
  const multi = isMulti(q);
  const parts = choice ? splitQuestion(q) : null;
  const done = flow.phase === "done";
  const showAnswer = done || flow.phase === "revealed";

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

  return (
    <article className="space-y-4" aria-labelledby={`q-${q.id}`}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* 題目一律寫成「來源｜ID」 */}
        <h2 id={`q-${q.id}`} className="text-ui font-semibold text-ink-strong select-text">
          {q.label}
          <span className="mx-1 text-ink-muted">｜</span>
          <span className="font-normal text-ink-muted">{q.id}</span>
        </h2>
        {chapter && <span className="text-meta text-ink-muted">{chapter}</span>}
      </header>

      {parts ? (
        <>
          <Markdown text={parts.stem} figs={q.figs} role="q" />
          {multi && !done && <p className="text-meta text-ink-muted">複選題：選好所有答案後按「送出」。</p>}
          <div role={multi ? "group" : "radiogroup"} aria-label="選項" className="space-y-2">
            {parts.options.map((o) => (
              <OptionRow key={o.letter} letter={o.letter} multi={multi} locked={done} state={optionState(o.letter, flow, q, attempt)} onSelect={() => flow.select(o.letter)}>
                <Markdown text={o.md} figs={q.figs} role="q" tight />
              </OptionRow>
            ))}
          </div>
          {parts.tail.trim() && <Markdown text={parts.tail} figs={q.figs} role="q" />}
        </>
      ) : (
        <>
          <Markdown text={q.ques} figs={q.figs} role="q" />
          {flow.phase === "self" && <p className="text-meta text-ink-muted">這題要自己對答案：想好後按「顯示答案」，再標記對或錯。</p>}
        </>
      )}

      {showAnswer && (
        <div className="anim-rise space-y-4">
          <Result q={q} flow={flow} attempt={attempt} />
          <Solution q={q} />
        </div>
      )}
    </article>
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
      {q.answer.mode === "any" && <Notice>{q.answer.note ? `${q.answer.note}：` : ""}這題有不只一個答案算對（{q.answer.keys.join("、")}）。</Notice>}
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
  return (
    <div className="space-y-4">
      {q.idea.trim() && (
        <Section title="思路">
          <Markdown text={q.idea} figs={q.figs} role="sol" />
        </Section>
      )}
      <Section title="詳解">{q.sol.trim() ? <Markdown text={q.sol} figs={q.figs} role="sol" /> : <p className="text-ui text-ink-muted">這題還沒有詳解。</p>}</Section>

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

      {/* 之後的階段在這兩個外框裡接功能（第 3 階段：個人筆記；第 6 階段：手寫） */}
      <div className="space-y-2">
        <Fold title="我的筆記" icon="note">
          <p className="text-ui text-ink-muted">個人筆記在第 3 階段開放：可寫 Markdown 與公式，兩台裝置同步。</p>
        </Fold>
        <Fold title="手寫區" icon="pencil">
          <div data-noswipe className="flex h-40 items-center justify-center rounded-btn border border-dashed border-line-strong text-ui text-ink-muted">
            Apple Pencil 手寫在第 6 階段開放
          </div>
        </Fold>
      </div>
    </div>
  );
}
