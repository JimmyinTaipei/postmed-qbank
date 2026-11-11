// 統計（規格書 §9.1）：每日題數、答對率、各章答對率（弱點章節）、各來源答對率、複習負擔預測。
// 全部由這台裝置上的作答紀錄即時算出（同步後兩台相同）。弱點章節點了直接出 20 題那一章。

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  chapterLevel, defaultFilter, describeFilter, localDay, pickItems, sessions, startOfDay, useAllAttempts, useAllContexts, useDueForecast,
  useFlagCount, useTaxonomy, type FilterContext, type SubjectId,
} from "@/data";
import { percent } from "@/lib/format";
import { Icon } from "@/ui/icons";
import { Button, Card, EmptyState, LinkButton, ListCard, ListRow, Segmented, Skeleton, Stat } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { BarList, ChartCard, ColumnChart } from "@/ui/templates";

const DAY = 86_400_000;
const MIN_WEAK = 10;

export function StatsPage() {
  const nav = useNavigate();
  const tax = useTaxonomy().data;
  const all = useAllAttempts();
  const ctxs = useAllContexts();
  const wrong = useFlagCount("wrong");
  const forecast = useDueForecast(7);
  const [subject, setSubject] = useState<SubjectId | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);

  const subjOf = useMemo(() => {
    const pats = (tax?.subjects ?? []).map((s) => [s.id, new RegExp(s.id_pattern)] as const);
    return (id: string) => pats.find(([, re]) => re.test(id))?.[0];
  }, [tax]);

  const data = useMemo(() => {
    if (!all || !ctxs.data) return null;
    const rows = new Map<string, { ctx: FilterContext; chap: string; kind: string }>();
    for (const ctx of ctxs.data.values()) for (const r of ctx.rows) rows.set(r.id, { ctx, chap: r.chap, kind: r.kind });
    const list = all.filter((a) => a.open !== 1 && (subject === "all" || subjOf(a.item.slice(2)) === subject));
    const today = startOfDay();
    const week = list.filter((a) => a.created_at >= today - 6 * DAY);
    // 每日題數（最近 14 天）
    const daily = Array.from({ length: 14 }, (_, i) => {
      const from = today - (13 - i) * DAY;
      const n = list.filter((a) => a.created_at >= from && a.created_at < from + DAY).length;
      const d = new Date(from);
      return { label: i === 13 ? "今" : i % 2 ? "" : `${d.getMonth() + 1}/${d.getDate()}`, value: n };
    });
    // 連續天數：到今天（今天還沒做就從昨天算）
    const days = new Set(list.map((a) => localDay(a.created_at)));
    let streak = 0;
    for (let t = days.has(localDay(today)) ? today : today - DAY; days.has(localDay(t)); t -= DAY) streak++;
    // 各章、各來源
    const byChap = new Map<string, { ok: number; n: number; ctx: FilterContext; label: string }>();
    const byKind = new Map<string, { ok: number; n: number; name: string }>();
    for (const a of list) {
      const r = rows.get(a.item.slice(2));
      if (!r) continue;
      const ch = chapterLevel(r.ctx, r.chap);
      const c = byChap.get(ch) ?? { ok: 0, n: 0, ctx: r.ctx, label: r.ctx.nodeLabel.get(ch) ?? ch };
      c.n++;
      c.ok += a.correct;
      byChap.set(ch, c);
      const k = byKind.get(r.kind) ?? { ok: 0, n: 0, name: r.ctx.kindName.get(r.kind) ?? r.kind };
      k.n++;
      k.ok += a.correct;
      byKind.set(r.kind, k);
    }
    const weak = [...byChap].filter(([, v]) => v.n >= MIN_WEAK).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).slice(0, 6);
    return {
      total: list.length,
      right: list.filter((a) => a.correct).length,
      week: week.length,
      weekRight: week.filter((a) => a.correct).length,
      daily,
      streak,
      weak,
      chapCount: byChap.size,
      kinds: [...byKind.values()].sort((a, b) => b.n - a.n),
    };
  }, [all, ctxs.data, subject, subjOf]);

  async function practiceChapter(ch: string, ctx: FilterContext) {
    setBusy(ch);
    let f = { ...defaultFilter(ctx), chapters: [ch], count: 20 as const };
    let items = pickItems(ctx, f, null);
    if (!items.length) {
      f = { ...f, kinds: [] };
      items = pickItems(ctx, f, null);
    }
    const name = tax?.subjects.find((s) => s.id === ctx.subject)?.name ?? ctx.subject;
    const s = await sessions.create({ mode: "practice", filter: { ...f, label: `弱點章節・${describeFilter(ctx, f, name)}` }, items });
    nav(`/s/${s.id}`);
  }

  return (
    <Page title="統計" back="/more" width="wide">
      {tax && <Segmented label="科目" value={subject} onChange={setSubject} options={[{ value: "all" as const, label: "全部" }, ...tax.subjects.map((s) => ({ value: s.id, label: s.name }))]} />}
      {ctxs.error ? (
        <EmptyState tone="error" title="讀不到題庫索引" action={<Button onClick={ctxs.reload}>再試一次</Button>}>{ctxs.error.message}</EmptyState>
      ) : !data ? (
        <Card className="p-5"><Skeleton lines={4} /></Card>
      ) : data.total === 0 ? (
        <Card><EmptyState icon="chart" title="還沒有作答紀錄" action={<LinkButton to="/practice" variant="primary">去刷題</LinkButton>}>做幾題之後，這裡會出現每日題數、答對率與弱點章節。</EmptyState></Card>
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
            <Stat value={data.week.toLocaleString()} label="最近 7 天題數" hint={`累計 ${data.total.toLocaleString()} 題`} />
            <Stat value={percent(data.weekRight, data.week)} label="最近 7 天答對率" hint={`累計 ${percent(data.right, data.total)}`} />
            <Stat value={wrong ?? "—"} label="錯題本" />
            <Stat value={`${data.streak} 天`} label="連續天數" />
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="每日題數" subtitle="最近 14 天">
              <ColumnChart unit="題" data={data.daily} />
            </ChartCard>
            <ChartCard title="複習負擔預測" subtitle="未來 7 天每天到期的題數（全部科目）">
              {forecast ? <ColumnChart unit="題" data={forecast.map((value, i) => ({ label: i === 0 ? "今" : `+${i}`, value }))} /> : <Skeleton lines={3} />}
            </ChartCard>
          </div>

          <section aria-labelledby="h-weak" className="space-y-2">
            <h2 id="h-weak" className="text-ui font-semibold text-ink-strong">弱點章節</h2>
            <p className="text-meta text-ink-muted">答對率最低的章（至少做過 {MIN_WEAK} 題）。點一章直接出 20 題。</p>
            {data.weak.length === 0 ? (
              <Card><EmptyState icon="chart" title="還看不出弱點">每一章做滿 {MIN_WEAK} 題後才會列在這裡（目前做過 {data.chapCount} 章）。</EmptyState></Card>
            ) : (
              <ListCard label="弱點章節">
                {data.weak.map(([ch, v]) => (
                  <li key={ch}>
                    <ListRow
                      onClick={() => void practiceChapter(ch, v.ctx)}
                      title={v.label}
                      meta={`做過 ${v.n} 題・答對 ${v.ok} 題`}
                      leading={<Icon name="chart" size={18} />}
                      trailing={<span className="text-ui font-semibold tabular-nums text-ink-strong">{busy === ch ? "…" : percent(v.ok, v.n)}</span>}
                    />
                  </li>
                ))}
              </ListCard>
            )}
          </section>

          <ChartCard title="各來源答對率" subtitle="依來源類別；右邊是做過的題數">
            <BarList max={100} format={(v) => `${v}%`} rows={data.kinds.map((k) => ({ label: k.name, value: Math.round((k.ok / k.n) * 100), note: `${k.n}` }))} />
          </ChartCard>
        </>
      )}
    </Page>
  );
}
