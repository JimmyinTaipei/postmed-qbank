// 單題頁：固定網址 /q/:id（從結束頁、清單、筆記連結進來）。可以直接作答，記成一筆不屬於任何題組的作答。

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { attempts, flags, qKey, useChapterNames, useFlags, useLastAttempt, useQuestion, type Attempt, type Question } from "@/data";
import { formatAgo } from "@/lib/format";
import { QuestionView, useAnswerFlow } from "@/ui/content/QuestionView";
import { Icon } from "@/ui/icons";
import { Menu, useToast } from "@/ui/overlays";
import { Button, Card, EmptyState, IconButton, Skeleton } from "@/ui/primitives";
import { Page } from "@/ui/shell";

export function QuestionPage() {
  const { id = "" } = useParams();
  const q = useQuestion(id);
  const flag = useFlags(id ? qKey(id) : undefined);
  const toast = useToast();
  const item = qKey(id);

  const actions = (
    <>
      <IconButton label={flag.star ? "取消星號" : "加星號"} pressed={flag.star} onClick={() => { void flags.set(item, "star", !flag.star); toast(flag.star ? "已取消星號" : "已加星號"); }}>
        <Icon name={flag.star ? "starFilled" : "star"} />
      </IconButton>
      <Menu
        label="更多動作"
        items={[
          { label: "存疑", icon: "flag", checked: flag.doubt, onSelect: () => void flags.set(item, "doubt", !flag.doubt) },
          { label: "編輯這一題", icon: "edit", disabledReason: "第 3 階段開放" },
          { label: "加入複習", icon: "repeat", disabledReason: "第 2 階段開放" },
          { label: "標為已確認", icon: "check", disabledReason: "第 3 階段開放" },
        ]}
      >
        <Icon name="dots" />
      </Menu>
    </>
  );

  return (
    <Page title="單題" back actions={actions}>
      {q.loading && q.data === undefined ? (
        <Card className="p-5"><Skeleton lines={7} /></Card>
      ) : q.error ? (
        <EmptyState tone="error" title="讀不到這一題" action={<Button onClick={q.reload}>再試一次</Button>}>{q.error.message}</EmptyState>
      ) : q.data === "missing" ? (
        <Card><EmptyState icon="cloudOff" title="本文未下載">{id} 在題庫索引裡，但本文不在這台裝置上，現在也連不上伺服器。連上網路後再開一次，或到設定頁開啟這一科的離線下載。</EmptyState></Card>
      ) : !q.data ? (
        <Card><EmptyState title="找不到這一題">題庫裡沒有 {id}。請確認題號，或這題已經下架。</EmptyState></Card>
      ) : (
        <Solo key={q.data.id} q={q.data} />
      )}
    </Page>
  );
}

function Solo({ q }: { q: Question }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [round, setRound] = useState(0);
  const last = useLastAttempt(qKey(q.id));
  const shownAt = useRef(performance.now());
  const chapters = useChapterNames();
  useEffect(() => () => void attempts.seal(), []);

  return (
    <>
      {last && !attempt && (
        <p className="text-meta text-ink-muted">上次作答：{last.correct ? "答對" : "答錯"}・{formatAgo(last.created_at)}</p>
      )}
      <Card className="p-4 sm:p-6">
        <SoloFlow key={round} q={q} attempt={attempt} chapter={chapters.get(q.chap)} onAnswer={async (chosen, correct) => {
          const a = await attempts.record({ item: qKey(q.id), sessionId: null, mode: "practice", chosen, correct, elapsedMs: Math.min(performance.now() - shownAt.current, 30 * 60_000), contentH: q.h.ques });
          setAttempt(a);
        }} />
      </Card>
      {attempt && (
        <Button icon="undo" onClick={() => { void attempts.seal(); setAttempt(null); setRound((r) => r + 1); shownAt.current = performance.now(); window.scrollTo({ top: 0 }); }}>
          再答一次
        </Button>
      )}
    </>
  );
}

function SoloFlow({ q, attempt, chapter, onAnswer }: { q: Question; attempt: Attempt | null; chapter?: string; onAnswer: (chosen: string[] | null, correct: boolean) => Promise<void> }) {
  const flow = useAnswerFlow(q, attempt, onAnswer);
  // 信心程度可改：讀最新的那一筆（setConfidence 之後畫面要跟著變）
  const live = useLastAttempt(attempt ? qKey(q.id) : undefined);
  const shown = attempt && live?.id === attempt.id ? live : attempt;
  return (
    <div className="space-y-4">
      <QuestionView q={q} flow={flow} attempt={shown} chapter={chapter} hotkeys />
      {flow.phase === "multi" && <Button variant="primary" block disabled={!flow.canSubmit} onClick={flow.submit}>送出</Button>}
      {flow.phase === "self" && <Button variant="primary" block onClick={flow.reveal}>顯示答案</Button>}
    </div>
  );
}
