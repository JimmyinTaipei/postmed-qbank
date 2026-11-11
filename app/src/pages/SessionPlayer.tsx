// 刷題畫面（規格書 §9.2）：全螢幕、沒有導覽列。左右滑或 ← → 換題；A–H 作答；空白鍵顯示答案。
// 重新整理或關掉再開都能續做：進度（session.cursor）與作答都在資料層。

import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { attempts, content, flags, qKey, sessions, useChapterNames, useFlags, useQuestion, useSession, useSessionAttempts, type Attempt, type Question, type Session } from "@/data";
import { useSwipe } from "@/lib/useSwipe";
import { QuestionView, useAnswerFlow } from "@/ui/content/QuestionView";
import { Icon } from "@/ui/icons";
import { Dialog, Menu, useToast } from "@/ui/overlays";
import { Button, EmptyState, IconButton, LinkButton, ProgressBar, Skeleton } from "@/ui/primitives";

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
  return <Player session={session} answered={answered} />;
}

function Frame({ children, top, bottom }: { children: React.ReactNode; top?: React.ReactNode; bottom?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {top}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-28 lg:px-8">{children}</main>
      {bottom}
    </div>
  );
}

function Player({ session, answered }: { session: Session; answered: Map<string, Attempt> }) {
  const nav = useNavigate();
  const toast = useToast();
  const total = session.items.length;
  const cursor = Math.min(Math.max(0, session.cursor), total - 1);
  const id = session.items[cursor];
  const [dir, setDir] = useState<"next" | "prev">("next");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const item = qKey(id);
  const flag = useFlags(item);
  const unanswered = total - session.items.filter((x) => answered.has(x)).length;
  const swipeRef = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= total || to === cursor) return;
      setDir(to > cursor ? "next" : "prev");
      void attempts.seal(); // 離開這題：信心程度定案
      void sessions.setCursor(session.id, to);
      window.scrollTo({ top: 0 });
      const ahead = session.items[to + (to > cursor ? 1 : -1)];
      if (ahead) void content.question(ahead); // 預先讀下一題的包
    },
    [cursor, total, session.id, session.items],
  );
  const prev = useCallback(() => go(cursor - 1), [go, cursor]);
  const finish = useCallback(async () => {
    await sessions.end(session.id);
    nav(`/s/${session.id}/done`, { replace: true });
  }, [nav, session.id]);
  const next = useCallback(() => {
    if (cursor < total - 1) go(cursor + 1);
    else if (unanswered > 0) setConfirmEnd(true);
    else void finish();
  }, [cursor, total, go, unanswered, finish]);

  useSwipe(swipeRef, { onPrev: prev, onNext: () => cursor < total - 1 && go(cursor + 1) });

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

  const top = (
    <header className="pt-safe sticky top-0 z-20 border-b border-line bg-card">
      <div className="px-safe mx-auto flex h-14 max-w-3xl items-center gap-1 lg:px-8">
        <IconButton label="離開（進度會保留，可從今日頁續做）" className="-ml-2" onClick={() => { void attempts.seal(); nav("/"); }}>
          <Icon name="arrowLeft" />
        </IconButton>
        <h1 className="shrink-0 text-ui font-semibold tabular-nums text-ink-strong" aria-label={`第 ${cursor + 1} 題，共 ${total} 題`}>
          {cursor + 1} <span className="font-normal text-ink-muted">/ {total}</span>
        </h1>
        <ProgressBar className="mx-3 min-w-0 flex-1" value={total - unanswered} max={total} label="已作答題數" />
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
        <Menu
          label="更多動作"
          items={[
            { label: "存疑", icon: "flag", checked: flag.doubt, onSelect: () => { void flags.set(item, "doubt", !flag.doubt); toast(flag.doubt ? "已取消存疑" : "已標為存疑，之後可以篩出來集中處理"); } },
            { label: "編輯這一題", icon: "edit", disabledReason: "第 3 階段開放" },
            { label: "加入複習", icon: "repeat", disabledReason: "第 2 階段開放" },
            { label: "標為已確認", icon: "check", disabledReason: "第 3 階段開放" },
            { label: "結束這個題組", icon: "x", onSelect: () => (unanswered > 0 ? setConfirmEnd(true) : void finish()) },
          ]}
        >
          <Icon name="dots" />
        </Menu>
      </div>
    </header>
  );

  return (
    <>
      <Stage key={id} id={id} session={session} attempt={answered.get(id) ?? null} dir={dir} top={top} swipeRef={swipeRef} isFirst={cursor === 0} isLast={cursor === total - 1} onPrev={prev} onNext={next} />
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

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card">
      <div className="px-safe mx-auto flex max-w-3xl items-center gap-2 py-2.5 lg:px-8 [&>:first-child]:mr-auto">{children}</div>
    </div>
  );
}
