// 單題頁：固定網址 /q/:id（從結束頁、清單、筆記連結進來）。可以直接作答，記成一筆不屬於任何題組的作答。

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { attempts, flags, qKey, useChapterNames, useFlags, useLastAttempt, useQuestion, useRows, type Attempt, type Question } from "@/data";
import { formatAgo } from "@/lib/format";
import { QuestionView, useAnswerFlow } from "@/ui/content/QuestionView";
import { Icon } from "@/ui/icons";
import { Menu, useToast } from "@/ui/overlays";
import { Button, Card, EmptyState, IconButton, ListCard, ListRow, Skeleton } from "@/ui/primitives";
import { GroupItem, GroupLayout } from "@/ui/content/GroupView";
import { Page } from "@/ui/shell";
import { useQuestionMenu } from "./useQuestionMenu";

export function QuestionPage() {
  const { id = "" } = useParams();
  const q = useQuestion(id);
  const flag = useFlags(id ? qKey(id) : undefined);
  const toast = useToast();
  const item = qKey(id);
  const menu = useQuestionMenu(item, id);

  const actions = (
    <>
      <IconButton label={flag.star ? "取消星號" : "加星號"} pressed={flag.star} onClick={() => { void flags.set(item, "star", !flag.star); toast(flag.star ? "已取消星號" : "已加星號"); }}>
        <Icon name={flag.star ? "starFilled" : "star"} />
      </IconButton>
      <Menu
        label="更多動作"
        items={menu}
      >
        <Icon name="dots" />
      </Menu>
    </>
  );

  return (
    <Page title="單題" back actions={actions} width={q.data && typeof q.data === "object" && q.data.group?.stem ? "wide" : "narrow"}>
      {q.loading && q.data === undefined ? (
        <Card className="p-5"><Skeleton lines={7} /></Card>
      ) : q.error ? (
        <EmptyState tone="error" title="讀不到這一題" action={<Button onClick={q.reload}>再試一次</Button>}>{q.error.message}</EmptyState>
      ) : q.data === "missing" ? (
        <Card><EmptyState icon="cloudOff" title="本文未下載">{id} 在題庫索引裡，但本文不在這台裝置上，現在也連不上伺服器。連上網路後再開一次，或到設定頁開啟這一科的離線下載。</EmptyState></Card>
      ) : !q.data ? (
        <Card><EmptyState title="找不到這一題">題庫裡沒有 {id}。請確認題號，或這題已經下架。</EmptyState></Card>
      ) : (
        <SoloPage q={q.data} />
      )}
    </Page>
  );
}

/** 題組裡的題目：文章一起顯示（第 8A 階段），同一組的其他小題列在下面。 */
function SoloPage({ q }: { q: Question }) {
  const others = (q.group?.members ?? []).filter((m) => m !== q.id);
  const rows = useRows(others).data;
  if (!q.group?.stem) return <SoloQuestion key={q.id} q={q} />;
  return (
    <GroupLayout gid={q.group.gid} passage={q.group.stem} figs={q.figs} label={q.group.order != null ? `第 ${q.group.order} 題` : undefined}>
      <GroupItem order={q.group.order}>
        <SoloQuestion key={q.id} q={q} />
      </GroupItem>
      {others.length > 0 && (
        <ListCard label="同一篇文章的其他小題">
          {others.map((id) => {
            const r = rows?.get(id);
            return (
              <li key={id}>
                <ListRow to={`/q/${encodeURIComponent(id)}`} title={<>{r?.label ?? "…"}<span className="mx-1 text-ink-muted">｜</span><span className="text-ink-muted">{id}</span></>} chevron />
              </li>
            );
          })}
        </ListCard>
      )}
    </GroupLayout>
  );
}

/** 單題作答（單題頁；題組頁裡這一場沒有出的小題也用它）。bare：不包卡片、不顯示「上次作答」。 */
export function SoloQuestion({ q, bare }: { q: Question; bare?: boolean }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [round, setRound] = useState(0);
  const last = useLastAttempt(qKey(q.id));
  const shownAt = useRef(performance.now());
  const chapters = useChapterNames();
  useEffect(() => () => void attempts.seal(), []);

  return (
    <>
      {last && !attempt && !bare && (
        <p className="text-meta text-ink-muted">上次作答：{last.correct ? "答對" : "答錯"}・{formatAgo(last.created_at)}</p>
      )}
      {(() => {
        const flow = (
          <SoloFlow key={round} q={q} attempt={attempt} chapter={chapters.get(q.chap)} hotkeys={!bare} onAnswer={async (chosen, correct) => {
            const a = await attempts.record({ item: qKey(q.id), sessionId: null, mode: "practice", chosen, correct, elapsedMs: Math.min(performance.now() - shownAt.current, 30 * 60_000), contentH: q.h.ques });
            setAttempt(a);
          }} />
        );
        return bare ? flow : <Card className="p-4 sm:p-6">{flow}</Card>;
      })()}
      {attempt && (
        <Button icon="undo" onClick={() => { void attempts.seal(); setAttempt(null); setRound((r) => r + 1); shownAt.current = performance.now(); window.scrollTo({ top: 0 }); }}>
          再答一次
        </Button>
      )}
    </>
  );
}

function SoloFlow({ q, attempt, chapter, onAnswer, hotkeys = true }: { q: Question; attempt: Attempt | null; chapter?: string; onAnswer: (chosen: string[] | null, correct: boolean) => Promise<void>; hotkeys?: boolean }) {
  const flow = useAnswerFlow(q, attempt, onAnswer);
  // 信心程度可改：讀最新的那一筆（setConfidence 之後畫面要跟著變）
  const live = useLastAttempt(attempt ? qKey(q.id) : undefined);
  const shown = attempt && live?.id === attempt.id ? live : attempt;
  return (
    <div className="space-y-4">
      <QuestionView q={q} flow={flow} attempt={shown} chapter={chapter} hotkeys={hotkeys} />
      {flow.phase === "multi" && <Button variant="primary" block disabled={!flow.canSubmit} onClick={flow.submit}>送出</Button>}
      {flow.phase === "self" && <Button variant="primary" block onClick={flow.reveal}>顯示答案</Button>}
    </div>
  );
}
