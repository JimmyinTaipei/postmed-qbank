// 今日頁（規格書 §9.1）：到期複習數、續做、今天做了多少、錯題數、各科進度。

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { sessions, useActiveSessions, useContentInfo, useFlagCount, useReviewQueue, useSubjectProgress, useTaxonomy, useTodaySummary, type Session } from "@/data";
import { formatAgo, percent } from "@/lib/format";
import { Icon } from "@/ui/icons";
import { Dialog } from "@/ui/overlays";
import { Button, Card, EmptyState, IconButton, LinkButton, ListCard, ListRow, Notice, ProgressBar, SectionTitle, Skeleton, Stat } from "@/ui/primitives";
import { Page, SyncStatus } from "@/ui/shell";

export function Today() {
  const nav = useNavigate();
  const info = useContentInfo();
  const tax = useTaxonomy().data;
  const active = useActiveSessions();
  const today = useTodaySummary();
  const wrong = useFlagCount("wrong");
  const progress = useSubjectProgress();
  const review = useReviewQueue();
  const [discard, setDiscard] = useState<Session | null>(null);
  const date = new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" });

  if (info.error)
    return (
      <Page title="今日">
        <EmptyState tone="error" title="讀不到題庫內容" action={<Button onClick={info.reload}>再試一次</Button>}>
          {info.error.message}。請確認網路，或稍後再試。
        </EmptyState>
      </Page>
    );

  return (
    <Page title="今日" subtitle={date} actions={<span className="lg:hidden"><SyncStatus /></span>}>
      {info.data?.sample && <Notice>目前是樣本資料：題數是真的，但只有約 260 題有本文可以作答。</Notice>}

      <Card className="grid grid-cols-3 gap-4 p-5">
        <Stat value={today?.done ?? "—"} label="今天做的題數" />
        <Stat value={today ? percent(today.right, today.done) : "—"} label="今天答對率" />
        <Stat value={wrong ?? "—"} label="錯題本" hint={wrong ? <LinkButton to="/wrong" variant="ghost" className="-ml-4">看錯題</LinkButton> : undefined} />
      </Card>

      {review && review.items.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <LinkButton to="/review" variant="primary" block icon="repeat">
            今日複習（{review.items.length} 題）
          </LinkButton>
          <LinkButton to="/practice" block icon="pencil">
            開始刷題
          </LinkButton>
        </div>
      ) : (
        <>
          <LinkButton to="/practice" variant="primary" block icon="pencil">
            開始刷題
          </LinkButton>
          {review && <p className="-mt-3 text-meta text-ink-muted">今天沒有要複習的題目{review.dueTotal > 0 ? "（已達每日上限）" : ""}。</p>}
        </>
      )}

      <section aria-labelledby="h-resume">
        <SectionTitle id="h-resume">續做</SectionTitle>
        {!active ? (
          <Card className="p-4"><Skeleton lines={2} /></Card>
        ) : active.length === 0 ? (
          <Card><EmptyState icon="pencil" title="沒有做到一半的題組">開始刷題後，中途離開的題組會出現在這裡。</EmptyState></Card>
        ) : (
          <ListCard label="做到一半的題組">
            {active.slice(0, 5).map((s) => (
              <li key={s.id} className="flex items-center">
                <ListRow
                  className="min-w-0 flex-1"
                  to={`/s/${s.id}`}
                  title={s.filter.label}
                  meta={`第 ${Math.min(s.cursor + 1, s.items.length)} / ${s.items.length} 題・${formatAgo(s.updated_at)}`}
                  leading={<Icon name="repeat" size={20} />}
                />
                <IconButton label={`捨棄「${s.filter.label}」`} className="mr-1" onClick={() => setDiscard(s)}>
                  <Icon name="trash" size={20} />
                </IconButton>
              </li>
            ))}
          </ListCard>
        )}
      </section>

      <section aria-labelledby="h-subjects">
        <SectionTitle id="h-subjects">各科進度</SectionTitle>
        <Card className="divide-y divide-line">
          {!tax || !info.data ? (
            <div className="p-4"><Skeleton lines={3} /></div>
          ) : (
            tax.subjects.map((s) => {
              const total = info.data!.counts[s.id] ?? 0;
              const done = progress?.get(s.id) ?? 0;
              return (
                <div key={s.id} className="px-4 py-3.5">
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="text-ui font-semibold text-ink-strong">{s.name}</span>
                    <span className="text-meta tabular-nums text-ink-muted">做過 {done.toLocaleString()} / {total.toLocaleString()} 題</span>
                  </div>
                  <ProgressBar value={done} max={total} label={`${s.name}進度`} />
                </div>
              );
            })
          )}
        </Card>
      </section>


      {discard && (
        <Dialog
          title="捨棄這個題組？"
          onClose={() => setDiscard(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setDiscard(null)}>保留</Button>
              <Button
                variant="danger"
                onClick={() => {
                  void sessions.remove(discard.id);
                  setDiscard(null);
                  nav("/");
                }}
              >
                捨棄
              </Button>
            </>
          }
        >
          「{discard.filter.label}」會從續做清單移除。已經作答的紀錄會留著。
        </Dialog>
      )}
    </Page>
  );
}
