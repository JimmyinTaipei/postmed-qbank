// 刷題畫面（規格書 §9.2）：全螢幕、沒有導覽列。左右滑或 ← → 換題；A–H 作答；空白鍵顯示答案。
// 重新整理或關掉再開都能續做：進度（session.cursor）與作答都在資料層。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { attempts, content, flags, pageAt, pageLabel, pagesOf, qKey, sessions, useChapterNames, useFlags, useQuestion, useRows, useSession, useSessionAttempts, type Attempt, type ItemPage, type Question, type Session } from "@/data";
import { useSwipe } from "@/lib/useSwipe";
import { useQuestionMenu } from "./useQuestionMenu";
import { ExamPlayer } from "./ExamPlayer";
import { QuestionView, useAnswerFlow } from "@/ui/content/QuestionView";
import { GroupItem, GroupLayout } from "@/ui/content/GroupView";
import { SoloQuestion } from "./QuestionPage";
import { Icon } from "@/ui/icons";
import { Dialog, Menu, useToast } from "@/ui/overlays";
import { Button, EmptyState, IconButton, LinkButton, ProgressBar, Skeleton, cx } from "@/ui/primitives";

export function SessionPlayer() {
  const { sessionId } = useParams();
  const session = useSession(sessionId);
  const answered = useSessionAttempts(sessionId);

  if (session === undefined || !answered) return <Frame><Skeleton lines={6} className="mt-6" /></Frame>;
  if (session === null)
    return (
      <Frame>
        <EmptyState title="找不到這個題組" action={<LinkButton to="/practice" variant="primary">重新出題</LinkButton>}>
          它可能已經被捨棄；若是在另一台裝置上剛建立的，等幾秒同步完成後再開一次。
        </EmptyState>
      </Frame>
    );
  if (session.ended_at || session.items.length === 0) return <Navigate to={`/s/${session.id}/done`} replace />;
  if (session.mode === "exam") return <ExamPlayer session={session} />;
  return <Player session={session} answered={answered} />;
}

export function Frame({ children, top, bottom, wide }: { children: React.ReactNode; top?: React.ReactNode; bottom?: React.ReactNode; /** 題組頁：寬螢幕左右並排 */ wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {top}
      <main className={cx("mx-auto w-full flex-1 px-4 pt-4 pb-28 lg:px-8", wide ? "max-w-3xl split:max-w-7xl" : "max-w-3xl")}>{children}</main>
      {bottom}
    </div>
  );
}

/** 一場的頁：相鄰、同一篇文章的小題是一頁（第 8A 階段）。索引列還沒讀到時回 undefined。 */
export function useSessionPages(items: string[]): ItemPage[] | undefined {
  const rows = useRows(items);
  return useMemo(() => (rows.data ? pagesOf(items, (id) => rows.data!.get(id)?.gid) : undefined), [rows.data, items]);
}

function Player({ session, answered }: { session: Session; answered: Map<string, Attempt> }) {
  const pages = useSessionPages(session.items);
  if (!pages) return <Frame><Skeleton lines={6} className="mt-6" /></Frame>;
  return <PagedPlayer session={session} answered={answered} pages={pages} />;
}

function PagedPlayer({ session, answered, pages }: { session: Session; answered: Map<string, Attempt>; pages: ItemPage[] }) {
  const nav = useNavigate();
  const toast = useToast();
  const total = session.items.length;
  const cursor = Math.min(Math.max(0, session.cursor), total - 1);
  const pi = pageAt(pages, cursor);
  const page = pages[pi];
  const ids = session.items.slice(page.start, page.end);
  const id = ids[0];
  const group = !!page.gid;
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const item = qKey(id);
  const flag = useFlags(item);
  const menu = useQuestionMenu(item, id);
  const unanswered = total - session.items.filter((x) => answered.has(x)).length;
  const swipeRef = useRef<HTMLDivElement>(null);
  const isLast = pi === pages.length - 1;

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= pages.length || to === pi) return;
      setDir(to > pi ? "next" : "prev");
      void attempts.seal(); // 離開這題：信心程度定案
      void sessions.setCursor(session.id, pages[to].start);
      window.scrollTo({ top: 0 });
      const ahead = pages[to + (to > pi ? 1 : -1)];
      if (ahead) void content.question(session.items[ahead.start]); // 預先讀下一題的包
    },
    [pi, pages, session.id, session.items],
  );
  const prev = useCallback(() => go(pi - 1), [go, pi]);
  const finish = useCallback(async () => {
    await sessions.end(session.id);
    nav(`/s/${session.id}/done`, { replace: true });
  }, [nav, session.id]);
  const next = useCallback(() => {
    if (!isLast) go(pi + 1);
    else if (unanswered > 0) setConfirmEnd(true);
    else void finish();
  }, [isLast, go, pi, unanswered, finish]);

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
    const hide = () => document.visibilityState === "hidden" && void attempts.seal();
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [prev, next]);

  const label = pageLabel(page);
  const top = (
    <header className="pt-safe sticky top-0 z-20 border-b border-line bg-card">
      <div className={cx("px-safe mx-auto flex h-14 items-center gap-1 lg:px-8", group ? "max-w-3xl split:max-w-7xl" : "max-w-3xl")}>
        <IconButton label="離開（進度會保留，可從今日頁續做）" className="-ml-2" onClick={() => { void attempts.seal(); nav("/"); }}>
          <Icon name="arrowLeft" />
        </IconButton>
        <h1 className="shrink-0 text-ui font-semibold tabular-nums text-ink-strong" aria-label={ids.length > 1 ? `第 ${label} 題，共 ${total} 題` : `第 ${cursor + 1} 題，共 ${total} 題`}>
          {label} <span className="font-normal text-ink-muted">/ {total}</span>
        </h1>
        <ProgressBar className="mx-3 min-w-0 flex-1" value={total - unanswered} max={total} label="已作答題數" />
        {!group && (
          <IconButton
            label={flag.star ? "取消星號" : "加星號"}
            pressed={flag.star}
            onClick={() => {
              void flags.set(item, "star", !flag.star);
              toast(flag.star ? "已取消星號" : "已加星號");
            }}
          >
            <Icon name={flag.star ? "starFilled" : "star"} />
          </IconButton>
        )}
        <Menu
          label="更多動作"
          items={[...(group ? [] : menu), { label: "結束這個題組", icon: "x", onSelect: () => (unanswered > 0 ? setConfirmEnd(true) : void finish()) }]}
        >
          <Icon name="dots" />
        </Menu>
      </div>
    </header>
  );

  return (
    <>
      {group ? (
        <GroupStage key={page.start + ":" + id} ids={ids} session={session} answered={answered} dir={dir} top={top} swipeRef={swipeRef} isFirst={pi === 0} isLast={isLast} onPrev={prev} onNext={next} />
      ) : (
        <Stage key={id} id={id} session={session} attempt={answered.get(id) ?? null} dir={dir} top={top} swipeRef={swipeRef} isFirst={pi === 0} isLast={isLast} onPrev={prev} onNext={next} />
      )}
      {confirmEnd && (
        <Dialog
          title="結束這個題組？"
          onClose={() => setConfirmEnd(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirmEnd(false)}>繼續作答</Button>
              <Button variant="primary" onClick={() => void finish()}>結束並看結果</Button>
            </>
          }
        >
          還有 {unanswered} 題沒作答，結束後會記為「略過」。
        </Dialog>
      )}
    </>
  );
}

interface StageProps {
  id: string;
  session: Session;
  attempt: Attempt | null;
  dir: "next" | "prev";
  top: React.ReactNode;
  swipeRef: React.RefObject<HTMLDivElement | null>;
  isFirst: boolean;
  isLast: boolean;
  onPrev: () => void;
  onNext: () => void;
}

function Stage(p: StageProps) {
  const q = useQuestion(p.id);
  const nav = (
    <BottomBar>
      <Button variant="ghost" icon="arrowLeft" disabled={p.isFirst} onClick={p.onPrev}>上一題</Button>
      <Button variant="secondary" iconEnd="arrowRight" onClick={p.onNext}>{p.isLast ? "結束" : "略過"}</Button>
    </BottomBar>
  );
  let body: React.ReactNode;
  if (q.loading && q.data === undefined) body = <Skeleton lines={7} className="mt-4" />;
  else if (q.error) body = <EmptyState tone="error" title="讀不到這一題" action={<Button onClick={q.reload}>再試一次</Button>}>{q.error.message}</EmptyState>;
  else if (q.data === "missing") body = <EmptyState icon="cloudOff" title="本文未下載">這一題（{p.id}）的本文不在這台裝置上，現在也連不上伺服器。先跳到下一題，或到設定頁開啟這一科的離線下載。</EmptyState>;
  else if (!q.data) body = <EmptyState title="此題已下架">題庫裡已經沒有 {p.id}。你的作答紀錄仍然保留。</EmptyState>;
  else return <Loaded {...p} q={q.data} />;
  return (
    <Frame top={p.top} bottom={nav}>
      <div ref={p.swipeRef}>{body}</div>
    </Frame>
  );
}

function Loaded({ q, session, attempt, dir, top, swipeRef, isFirst, isLast, onPrev, onNext }: StageProps & { q: Question }) {
  const shownAt = useRef(performance.now());
  const chapters = useChapterNames();
  const flow = useAnswerFlow(q, attempt, async (chosen, correct) => {
    await attempts.record({ item: qKey(q.id), sessionId: session.id, mode: session.mode, chosen, correct, elapsedMs: Math.min(performance.now() - shownAt.current, 30 * 60_000), contentH: q.h.ques });
  });

  // 一個畫面只有一個主要按鈕：依作答階段決定是哪一顆
  let main: React.ReactNode;
  if (flow.phase === "done") main = <Button variant="primary" iconEnd="arrowRight" onClick={onNext}>{isLast ? "看結果" : "下一題"}</Button>;
  else if (flow.phase === "multi") main = <Button variant="primary" disabled={!flow.canSubmit} onClick={flow.submit}>送出</Button>;
  else if (flow.phase === "self") main = <Button variant="primary" onClick={flow.reveal}>顯示答案</Button>;
  else main = <Button variant="secondary" iconEnd="arrowRight" onClick={onNext}>{isLast ? "結束" : "略過"}</Button>;

  return (
    <Frame
      top={top}
      bottom={
        <BottomBar>
          <Button variant="ghost" icon="arrowLeft" disabled={isFirst} onClick={onPrev}>上一題</Button>
          {(flow.phase === "multi" || flow.phase === "self") && !isLast && <Button variant="ghost" onClick={onNext}>略過</Button>}
          {main}
        </BottomBar>
      }
    >
      <div ref={swipeRef} className={dir === "next" ? "anim-next" : "anim-prev"}>
        <QuestionView q={q} flow={flow} attempt={attempt} chapter={chapters.get(q.chap)} hotkeys />
      </div>
    </Frame>
  );
}

export function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card">
      <div className="px-safe mx-auto flex max-w-3xl items-center gap-2 py-2.5 lg:px-8 [&>:first-child]:mr-auto">{children}</div>
    </div>
  );
}

// ---------- 題組頁（第 8A 階段） ----------

interface GroupStageProps extends Omit<StageProps, "id" | "attempt"> {
  ids: string[];
  answered: Map<string, Attempt>;
}

/** 同一篇文章的小題放在同一頁：每一小題各自作答、各自顯示對錯與詳解。 */
function GroupStage({ ids, session, answered, dir, top, swipeRef, isFirst, isLast, onPrev, onNext }: GroupStageProps) {
  const head = useQuestion(ids[0]);
  const q0 = head.data && typeof head.data === "object" ? head.data : null;
  const done = ids.every((x) => answered.has(x));
  const firstOpen = ids.find((x) => !answered.has(x));
  // 這一組裡、這一場沒有出的小題（複習、錯題本只排到期或答錯的那幾題）：收合成一列，可點開
  const others = (q0?.group?.members ?? []).filter((m) => !ids.includes(m));
  const order = q0?.group?.order;
  const label = order != null ? (ids.length > 1 ? `第 ${order}–${order + ids.length - 1} 題` : `第 ${order} 題`) : undefined;

  const bottom = (
    <BottomBar>
      <Button variant="ghost" icon="arrowLeft" disabled={isFirst} onClick={onPrev}>上一題</Button>
      {done ? (
        <Button variant="primary" iconEnd="arrowRight" onClick={onNext}>{isLast ? "看結果" : "下一題"}</Button>
      ) : (
        <Button variant="secondary" iconEnd="arrowRight" onClick={onNext}>{isLast ? "結束" : "略過"}</Button>
      )}
    </BottomBar>
  );

  let body: React.ReactNode;
  if (head.loading && head.data === undefined) body = <Skeleton lines={7} className="mt-4" />;
  else if (!q0) body = ids.map((id) => <SubQuestion key={id} id={id} session={session} attempt={answered.get(id) ?? null} hotkeys={id === firstOpen} />);
  else
    body = (
      <GroupLayout gid={q0.group!.gid} passage={q0.group!.stem} figs={q0.figs} label={label}>
        {ids.map((id) => (
          <SubQuestion key={id} id={id} session={session} attempt={answered.get(id) ?? null} hotkeys={id === firstOpen} />
        ))}
        {others.length > 0 && (
          <section aria-label="同一篇文章的其他小題" className="space-y-2 border-t border-line pt-4">
            <h3 className="text-ui font-semibold text-ink-muted">同一篇文章的其他小題（這次沒有排到）</h3>
            {others.map((id) => (
              <OtherQuestion key={id} id={id} />
            ))}
          </section>
        )}
      </GroupLayout>
    );

  return (
    <Frame top={top} bottom={bottom} wide={!!q0?.group?.stem}>
      <div ref={swipeRef} className={dir === "next" ? "anim-next" : "anim-prev"}>{body}</div>
    </Frame>
  );
}

function SubQuestion({ id, session, attempt, hotkeys }: { id: string; session: Session; attempt: Attempt | null; hotkeys: boolean }) {
  const q = useQuestion(id);
  if (q.loading && q.data === undefined) return <Skeleton lines={5} />;
  if (q.error) return <EmptyState tone="error" title="讀不到這一題" action={<Button onClick={q.reload}>再試一次</Button>}>{q.error.message}</EmptyState>;
  if (q.data === "missing") return <EmptyState icon="cloudOff" title="本文未下載">這一題（{id}）的本文不在這台裝置上，現在也連不上伺服器。</EmptyState>;
  if (!q.data) return <EmptyState title="此題已下架">題庫裡已經沒有 {id}。你的作答紀錄仍然保留。</EmptyState>;
  return <SubLoaded q={q.data} session={session} attempt={attempt} hotkeys={hotkeys} />;
}

function SubLoaded({ q, session, attempt, hotkeys }: { q: Question; session: Session; attempt: Attempt | null; hotkeys: boolean }) {
  const shownAt = useRef(performance.now());
  const chapters = useChapterNames();
  const toast = useToast();
  const item = qKey(q.id);
  const flag = useFlags(item);
  const menu = useQuestionMenu(item, q.id);
  const flow = useAnswerFlow(q, attempt, async (chosen, correct) => {
    await attempts.record({ item, sessionId: session.id, mode: session.mode, chosen, correct, elapsedMs: Math.min(performance.now() - shownAt.current, 30 * 60_000), contentH: q.h.ques });
  });
  const extra = (
    <>
      <IconButton label={flag.star ? "取消星號" : "加星號"} pressed={flag.star} onClick={() => { void flags.set(item, "star", !flag.star); toast(flag.star ? "已取消星號" : "已加星號"); }}>
        <Icon name={flag.star ? "starFilled" : "star"} />
      </IconButton>
      <Menu label="這一題的更多動作" items={menu}>
        <Icon name="dots" />
      </Menu>
    </>
  );
  return (
    <GroupItem order={q.group?.order}>
      <QuestionView q={q} flow={flow} attempt={attempt} chapter={chapters.get(q.chap)} hotkeys={hotkeys} headerExtra={extra} />
      {flow.phase === "multi" && <Button variant="primary" className="mt-3" block disabled={!flow.canSubmit} onClick={flow.submit}>送出</Button>}
      {flow.phase === "self" && <Button variant="secondary" className="mt-3" block onClick={flow.reveal}>顯示答案</Button>}
    </GroupItem>
  );
}

/** 同一組裡這一場沒有出的小題：一列，點開可以作答（記成不屬於這一場的作答，和單題頁相同）。 */
function OtherQuestion({ id }: { id: string }) {
  const row = useRows([id]).data?.get(id);
  const [open, setOpen] = useState(false);
  const q = useQuestion(open ? id : undefined);
  return (
    <details className="rounded-btn border border-line" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="flex min-h-(--tap) items-center gap-2 px-3 text-ui text-ink-strong">
        <span className="min-w-0 flex-1 truncate">{row?.label ?? id}<span className="mx-1 text-ink-muted">｜</span><span className="text-ink-muted">{id}</span></span>
        <Icon name="chevronDown" size={18} />
      </summary>
      {open && <div className="px-3 pb-3">{q.data && typeof q.data === "object" ? <SoloQuestion q={q.data} bare /> : <Skeleton lines={4} />}</div>}
    </details>
  );
}
