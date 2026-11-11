// 結束頁：答對率、每題結果、重做錯題。

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { sessions, useRows, useSession, useSessionAttempts } from "@/data";
import { formatDuration, percent } from "@/lib/format";
import { Icon } from "@/ui/icons";
import { Badge, Button, Card, EmptyState, LinkButton, ListCard, ListRow, SectionTitle, Skeleton, Stat } from "@/ui/primitives";
import { Page } from "@/ui/shell";

export function SessionDone() {
  const { sessionId } = useParams();
  const nav = useNavigate();
  const session = useSession(sessionId);
  const answered = useSessionAttempts(sessionId);
  const rows = useRows(session?.items).data;
  const [busy, setBusy] = useState(false);

  if (session === undefined || !answered) return <Page title="結果"><Skeleton lines={5} /></Page>;
  if (session === null)
    return (
      <Page title="結果">
        <EmptyState title="找不到這個題組" action={<LinkButton to="/">回今日</LinkButton>} />
      </Page>
    );

  const list = session.items.map((id) => ({ id, a: answered.get(id) ?? null }));
  const right = list.filter((x) => x.a?.correct).length;
  const wrongIds = list.filter((x) => x.a && !x.a.correct).map((x) => x.id);
  const skipped = list.filter((x) => !x.a).length;
  const done = list.length - skipped;
  const isExam = session.mode === "exam";
  const time = isExam && session.ended_at ? session.ended_at - session.started_at : list.reduce((s, x) => s + (x.a?.elapsed_ms ?? 0), 0);

  async function redo() {
    setBusy(true);
    const s = await sessions.create({ mode: "practice", filter: { label: `重做錯題・${session!.filter.label}` }, items: wrongIds });
    nav(`/s/${s.id}`);
  }

  return (
    <Page title="結果" subtitle={session.filter.label}>
      <Card className="grid grid-cols-2 gap-x-4 gap-y-5 p-5 sm:grid-cols-4">
        {isExam ? (
          <Stat value={`${right} / ${list.length}`} label="得分（答對題數）" hint={percent(right, list.length)} />
        ) : (
          <Stat value={percent(right, done)} label="答對率" hint={`${right} / ${done} 題`} />
        )}
        <Stat value={wrongIds.length} label="答錯" />
        <Stat value={skipped} label={isExam ? "未作答" : "略過"} />
        <Stat value={formatDuration(time)} label={isExam ? "用時" : "作答時間"} />
      </Card>

      <div className="flex flex-wrap gap-2">
        {wrongIds.length > 0 ? (
          <Button variant="primary" icon="repeat" loading={busy} onClick={redo}>重做錯題（{wrongIds.length} 題）</Button>
        ) : (
          <LinkButton to="/practice" variant="primary" icon="pencil">再做一組</LinkButton>
        )}
        {wrongIds.length > 0 && <LinkButton to="/practice" icon="pencil">再做一組</LinkButton>}
        <LinkButton to="/" variant="ghost">回今日</LinkButton>
      </div>

      <section aria-labelledby="h-items">
        <SectionTitle id="h-items">每一題</SectionTitle>
        <ListCard label="這個題組的題目">
          {list.map(({ id, a }, i) => (
            <li key={id}>
              <ListRow
                to={`/q/${encodeURIComponent(id)}`}
                leading={<span className="w-6 text-right text-meta tabular-nums">{i + 1}</span>}
                title={<>{rows?.get(id)?.label ?? "…"}<span className="mx-1 text-ink-muted">｜</span><span className="text-ink-muted">{id}</span></>}
                trailing={
                  !a ? <Badge>{isExam ? "未作答" : "略過"}</Badge> : a.correct ? <Badge tone="correct" icon="check">答對</Badge> : <Badge tone="incorrect" icon="x">答錯</Badge>
                }
              />
            </li>
          ))}
        </ListCard>
        {list.length === 0 && <Card><EmptyState icon="pencil" title="這個題組沒有題目" /></Card>}
      </section>
      <p className="flex items-center gap-1.5 text-meta text-ink-muted"><Icon name="info" size={14} />答錯的題目已記進錯題本。</p>
    </Page>
  );
}
