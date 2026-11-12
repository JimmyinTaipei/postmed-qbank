// 模擬考（規格書 §5.2 原卷模擬）：交卷前不顯示答案；時間到自動交卷；得分只算答對題數與用時。
// 作答存在會同步的 setting["exam.<場次>"]（data/personal.ts 的 exam），所以中途關掉 App、換裝置都能續考；
// 計時以場次的 started_at 為準，重開不會歸零。交卷時才記 attempt（mode = exam），之後照常進錯題本與複習。

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { content, exam, sessions, isChoice, isMulti, pageAt, pageLabel, qKey, splitQuestion, useExamPicks, useFlags, useQuestion, flags, type ItemPage, type Question, type Session } from "@/data";
import { useSwipe } from "@/lib/useSwipe";
import { Markdown } from "@/ui/content/Markdown";
import { Handwriting, useInkAttemptReset } from "@/ui/ink/Handwriting";
import { InkScope } from "@/ui/ink/FigInk";
import { Icon } from "@/ui/icons";
import { Dialog, useToast } from "@/ui/overlays";
import { Button, EmptyState, IconButton, Notice, OptionRow, Skeleton } from "@/ui/primitives";
import { ExamTimerBar } from "@/ui/templates";
import { BottomBar, Frame, useSessionPages } from "./SessionPlayer";
import { GroupItem, GroupLayout } from "@/ui/content/GroupView";

function useNow(ms = 1000): number {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(h);
  }, [ms]);
  return t;
}

export function ExamPlayer({ session }: { session: Session }) {
  const pages = useSessionPages(session.items);
  if (!pages) return <Frame><Skeleton lines={6} className="mt-6" /></Frame>;
  return <PagedExam session={session} pages={pages} />;
}

/** 題組（第 8A 階段）佔一頁；答案卡仍是一題一格，點了跳到它所在的那一頁；得分照小題算。 */
function PagedExam({ session, pages }: { session: Session; pages: ItemPage[] }) {
  const nav = useNavigate();
  const toast = useToast();
  const picks = useExamPicks(session.id);
  const now = useNow();
  const total = session.items.length;
  const cursor = Math.min(Math.max(0, session.cursor), total - 1);
  const pi = pageAt(pages, cursor);
  const page = pages[pi];
  const ids = session.items.slice(page.start, page.end);
  const group = !!page.gid;
  const id = ids[0];
  const item = qKey(id);
  const flag = useFlags(item);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const swipeRef = useRef<HTMLDivElement>(null);
  const enteredAt = useRef(Date.now());
  const submitted = useRef(false);

  const limitMs = session.time_limit_s ? session.time_limit_s * 1000 : null;
  const remainingS = limitMs != null ? Math.ceil((session.started_at + limitMs - now) / 1000) : null;
  const elapsedS = Math.floor((now - session.started_at) / 1000);
  const answered = picks ? Object.keys(picks.picks).filter((k) => session.items.includes(k)).length : 0;

  const idsKey = ids.join(",");
  const leave = useCallback(() => {
    const ms = Date.now() - enteredAt.current;
    enteredAt.current = Date.now();
    // 題組頁：停留時間平分給這一頁的每一小題
    const each = Math.min(ms, 30 * 60_000) / Math.max(1, ids.length);
    for (const x of ids) void exam.addTime(session.id, x, each);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, idsKey]);

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    setSubmitting(true);
    leave();
    await exam.submit(session.id);
    nav(`/s/${session.id}/done`, { replace: true });
  }, [leave, nav, session.id]);

  // 時間到：自動交卷（重開 App 時已經超時也一樣）
  useEffect(() => {
    if (remainingS != null && remainingS <= 0 && picks) {
      toast("時間到，已自動交卷");
      void submit();
    }
  }, [remainingS, picks, submit, toast]);

  const isLast = pi === pages.length - 1;
  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= pages.length || to === pi) return;
      leave();
      void sessions.setCursor(session.id, pages[to].start);
      window.scrollTo({ top: 0 });
      const ahead = pages[to + 1];
      if (ahead) void content.question(session.items[ahead.start]);
    },
    [pi, pages, leave, session.id, session.items],
  );
  /** 答案卡：點第 i 題 → 跳到它所在的那一頁 */
  const goItem = useCallback((i: number) => go(pageAt(pages, i)), [go, pages]);
  const prev = useCallback(() => go(pi - 1), [go, pi]);
  const next = useCallback(() => (!isLast ? go(pi + 1) : setConfirm(true)), [go, pi, isLast]);
  useSwipe(swipeRef, { onPrev: prev, onNext: () => !isLast && go(pi + 1) });

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]") || document.querySelector("[aria-modal='true'], [role='menu']")) return;
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else return;
      e.preventDefault();
    };
    const hide = () => document.visibilityState === "hidden" && leave();
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [prev, next, leave]);

  const top = (
    <header className="pt-safe sticky top-0 z-20 border-b border-line bg-card">
      <div className={"px-safe mx-auto flex h-14 items-center gap-1 lg:px-8 " + (group ? "max-w-3xl split:max-w-7xl" : "max-w-3xl")}>
        <IconButton label="離開（計時不會暫停；可從今日頁續考）" className="-ml-2" onClick={() => { leave(); nav("/"); }}>
          <Icon name="arrowLeft" />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate text-ui font-semibold text-ink-strong">
          <span className="tabular-nums">{pageLabel(page)}</span> <span className="font-normal text-ink-muted">/ {total}・{session.filter.label}</span>
        </h1>
        {!group && (
          <IconButton label={flag.star ? "取消星號" : "加星號"} pressed={flag.star} onClick={() => void flags.set(item, "star", !flag.star)}>
            <Icon name={flag.star ? "starFilled" : "star"} />
          </IconButton>
        )}
      </div>
      <div className={"px-safe mx-auto px-4 pb-2 lg:px-8 " + (group ? "max-w-3xl split:max-w-7xl" : "max-w-3xl")}>
        <ExamTimerBar remainingS={remainingS} totalS={session.time_limit_s} elapsedS={elapsedS} answered={answered} total={total} onSubmit={() => setConfirm(true)} />
      </div>
    </header>
  );

  return (
    <>
      <Frame
        wide={group}
        top={top}
        bottom={
          <BottomBar>
            <Button variant="ghost" icon="arrowLeft" disabled={pi === 0} onClick={prev}>上一題</Button>
            {!isLast ? (
              <Button variant="secondary" iconEnd="arrowRight" onClick={next}>下一題</Button>
            ) : (
              <Button variant="primary" onClick={() => setConfirm(true)}>交卷</Button>
            )}
          </BottomBar>
        }
      >
        <div ref={swipeRef}>
          {group ? (
            <ExamGroup key={page.start} ids={ids} picks={picks?.picks ?? {}} onPick={(x, c) => void exam.pick(session.id, x, c)} />
          ) : (
            <ExamQuestion key={id} id={id} chosen={picks?.picks[id] ?? []} onPick={(c) => void exam.pick(session.id, id, c)} />
          )}
        </div>
        <Strip items={session.items} picks={picks?.picks ?? {}} cursor={page.start} end={page.end} onGo={goItem} />
      </Frame>
      {confirm && (
        <Dialog
          title="交卷？"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>繼續作答</Button>
              <Button variant="primary" loading={submitting} onClick={() => void submit()}>交卷並看結果</Button>
            </>
          }
        >
          {total - answered > 0 ? `還有 ${total - answered} 題沒作答，交卷後算答錯（不記作答紀錄）。` : "全部作答完畢。"}交卷後才會顯示答案。
        </Dialog>
      )}
    </>
  );
}

/** 題號列：看哪幾題還沒作答，點了跳過去。 */
function Strip({ items, picks, cursor, end = cursor + 1, onGo }: { items: string[]; picks: Record<string, string[]>; cursor: number; /** 題組頁：這一頁的範圍 [cursor, end) 都標成目前 */ end?: number; onGo: (i: number) => void }) {
  return (
    <nav aria-label="題號" className="mt-8 border-t border-line pt-4">
      <ol className="flex flex-wrap gap-1.5">
        {items.map((x, i) => {
          const done = !!picks[x]?.length;
          return (
            <li key={x}>
              <button
                type="button"
                onClick={() => onGo(i)}
                aria-current={i >= cursor && i < end ? "step" : undefined}
                aria-label={`第 ${i + 1} 題${done ? "，已作答" : "，未作答"}`}
                className={
                  "flex size-(--tap) items-center justify-center rounded-btn border text-meta tabular-nums transition-colors duration-(--dur-fast) " +
                  (i >= cursor && i < end ? "border-blue-deep bg-blue-deep text-on-deep" : done ? "border-blue-deep bg-blue-light text-blue-ink" : "border-line text-ink hover:bg-hover")
                }
              >
                {i + 1}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** 模擬考的題組頁：文章＋這一組的小題；快捷鍵 A–H 給第一個還沒作答的小題。 */
function ExamGroup({ ids, picks, onPick }: { ids: string[]; picks: Record<string, string[]>; onPick: (id: string, c: string[]) => void }) {
  const head = useQuestion(ids[0]);
  const q0 = head.data && typeof head.data === "object" ? head.data : null;
  const firstOpen = ids.find((x) => !picks[x]?.length) ?? null;
  if (head.loading && head.data === undefined) return <Skeleton lines={7} className="mt-4" />;
  const list = ids.map((x) => <ExamQuestion key={x} id={x} chosen={picks[x] ?? []} onPick={(c) => onPick(x, c)} hotkeys={x === firstOpen} inGroup />);
  if (!q0?.group) return <div className="space-y-8">{list}</div>;
  const o = q0.group.order;
  return (
    <GroupLayout gid={q0.group.gid} passage={q0.group.stem} figs={q0.figs} label={o != null ? `第 ${o}–${o + ids.length - 1} 題` : undefined}>
      {list}
    </GroupLayout>
  );
}

function ExamQuestion({ id, chosen, onPick, hotkeys = true, inGroup }: { id: string; chosen: string[]; onPick: (c: string[]) => void; hotkeys?: boolean; inGroup?: boolean }) {
  const q = useQuestion(id);
  if (q.loading && q.data === undefined) return <Skeleton lines={7} className="mt-4" />;
  if (q.error) return <EmptyState tone="error" title="讀不到這一題" action={<Button onClick={q.reload}>再試一次</Button>}>{q.error.message}</EmptyState>;
  if (q.data === "missing") return <EmptyState icon="cloudOff" title="本文未下載">這一題（{id}）的本文不在這台裝置上，現在也連不上伺服器。</EmptyState>;
  if (!q.data) return <EmptyState title="此題已下架">題庫裡已經沒有 {id}。</EmptyState>;
  const body = <Body q={q.data} chosen={chosen} onPick={onPick} hotkeys={hotkeys} />;
  return inGroup ? <GroupItem order={q.data.group?.order}>{body}</GroupItem> : body;
}

function Body({ q, chosen, onPick, hotkeys }: { q: Question; chosen: string[]; onPick: (c: string[]) => void; hotkeys: boolean }) {
  const choice = isChoice(q);
  const multi = isMulti(q);
  const parts = choice ? splitQuestion(q) : null;
  useInkAttemptReset(q, true);
  const pick = useCallback(
    (letter: string) => {
      if (multi) onPick(chosen.includes(letter) ? chosen.filter((x) => x !== letter) : [...chosen, letter].sort());
      else onPick(chosen[0] === letter ? [] : [letter]);
    },
    [chosen, multi, onPick],
  );
  useEffect(() => {
    if (!parts || !hotkeys) return;
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]") || document.querySelector("[aria-modal='true'], [role='menu']")) return;
      const k = e.key.toUpperCase();
      if (/^[A-H]$/.test(k) && parts.options.some((o) => o.letter === k)) {
        pick(k);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  return (
    <InkScope value={{ base: `q:${q.id}` }}>
    <article className="space-y-4" aria-labelledby={`q-${q.id}`}>
      <h2 id={`q-${q.id}`} className="text-ui font-semibold text-ink-strong">
        {q.label}
        <span className="mx-1 text-ink-muted">｜</span>
        <span className="font-normal text-ink-muted">{q.id}</span>
      </h2>
      {parts ? (
        <>
          <Markdown text={parts.stem} figs={q.figs} role="q" />
          {multi && <p className="text-meta text-ink-muted">複選題：選好所有答案即可，交卷時一起判分。</p>}
          <div role={multi ? "group" : "radiogroup"} aria-label="選項" className="space-y-2">
            {parts.options.map((o) => (
              <OptionRow key={o.letter} letter={o.letter} multi={multi} state={chosen.includes(o.letter) ? "selected" : "idle"} onSelect={() => pick(o.letter)}>
                <Markdown text={o.md} figs={q.figs} role="q" tight />
              </OptionRow>
            ))}
          </div>
          {parts.tail.trim() && <Markdown text={parts.tail} figs={q.figs} role="q" />}
          {chosen.length > 0 && !multi && <p className="text-meta text-ink-muted">再點一次同一個選項可以取消。</p>}
        </>
      ) : (
        <>
          <Markdown text={q.ques} figs={q.figs} role="q" />
          <Notice icon="info">這題不是選擇題，模擬考裡不計分；交卷後可以在結果頁點進去自己對答案。</Notice>
        </>
      )}
      <Handwriting target={`q:${q.id}`} />
    </article>
    </InkScope>
  );
}
