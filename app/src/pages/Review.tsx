// 今日複習（規格書 §5.2、§5.4）：到期的題目（FSRS）加上今天可以開始的新卡，套每日上限。
// 按「開始複習」建立一場 mode = review 的題組，用刷題畫面作答；評分由作答結果自動換算（答錯 Again、猜的 Hard…）。

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { sessions, useActiveSessions, useDueForecast, useReviewQueue } from "@/data";
import { Icon } from "@/ui/icons";
import { Button, Card, EmptyState, LinkButton, Notice, Skeleton, Stat } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { ChartCard, ColumnChart } from "@/ui/templates";

export function ReviewPage() {
  const nav = useNavigate();
  const q = useReviewQueue();
  const active = useActiveSessions();
  const forecast = useDueForecast(14);
  const [busy, setBusy] = useState(false);
  const running = active?.find((s) => s.mode === "review");

  async function start() {
    if (!q?.items.length) return;
    setBusy(true);
    const s = await sessions.create({ mode: "review", filter: { label: `今日複習・${new Date().toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" })}` }, items: q.items });
    nav(`/s/${s.id}`);
  }

  const over = q ? q.dueTotal - q.dueShown : 0;
  return (
    <Page title="今日複習" subtitle="答錯的題目與手動加入的題目，依記憶曲線排程">
      {!q ? (
        <Card className="p-5"><Skeleton lines={3} /></Card>
      ) : (
        <>
          <Card className="grid grid-cols-3 gap-4 p-5">
            <Stat value={q.dueShown} label="今天要複習" hint={over > 0 ? `另有 ${over} 題明天再出` : undefined} />
            <Stat value={q.newShown} label="今天的新題" hint={q.newTotal > q.newShown ? `共 ${q.newTotal} 題等著開始` : undefined} />
            <Stat value={q.doneToday.reviews + q.doneToday.news} label="今天已複習" />
          </Card>

          {running ? (
            <div className="flex flex-wrap gap-2">
              <LinkButton to={`/s/${running.id}`} variant="primary" icon="repeat">
                繼續複習（第 {Math.min(running.cursor + 1, running.items.length)} / {running.items.length} 題）
              </LinkButton>
              {q.items.length > 0 && <Button loading={busy} onClick={start}>重新排一組（{q.items.length} 題）</Button>}
            </div>
          ) : q.items.length > 0 ? (
            <Button variant="primary" block icon="repeat" loading={busy} onClick={start}>
              開始複習（{q.items.length} 題）
            </Button>
          ) : (
            <Card>
              <EmptyState icon="check" title="今天的複習做完了" action={<LinkButton to="/practice">去刷新題</LinkButton>}>
                {q.dueTotal + q.newTotal === 0 ? "答錯的題目會自動排進來；任何題目也可以從 ⋯ 選單「加入複習」。" : "超過每日上限的題目會在明天出現。"}
              </EmptyState>
            </Card>
          )}

          {over > 0 && (
            <Notice icon="info">
              今天到期 {q.dueTotal} 題，超過每日上限 {q.cfg.maxReviews} 題；多的會留到明天。上限可以在設定頁改。
            </Notice>
          )}
        </>
      )}

      <ChartCard title="未來兩週到期" subtitle="每天會到期的題數（今天含逾期）">
        {forecast ? (
          <ColumnChart unit="題" data={forecast.map((value, i) => ({ label: i === 0 ? "今" : i % 2 ? "" : `+${i}`, value }))} />
        ) : (
          <Skeleton lines={3} />
        )}
      </ChartCard>

      <p className="flex items-start gap-1.5 text-meta text-ink-muted">
        <Icon name="info" size={14} className="mt-0.5 shrink-0" />
        評分自動換算：答錯 → 重來；答對但「猜的」→ 困難；答對 → 良好；「很確定」又比平常快一倍 → 簡單。標「粗心錯，不追蹤」的題目不會排進來。目標記憶率 {q ? Math.round(q.cfg.retention * 100) : 90}%，每日上限複習 {q?.cfg.maxReviews ?? 200}、新題 {q?.cfg.maxNew ?? 20}（設定頁可改）。
      </p>
    </Page>
  );
}
