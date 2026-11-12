// 原卷（規格書 §5.2、§9.1）：學校 × 年份方格。點一格選「整份練習」或「模擬考」（計時、交卷前不顯示答案）。
// 格子顯示這份考卷最近一次結束的得分（答對題數 ÷ 總題數）。

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { content, sessions, useEndedSessions, useFilterContext, useTaxonomy, type FilterContext, type IndexRow, useSubjectChoice } from "@/data";
import { formatAgo, formatDuration } from "@/lib/format";
import { Dialog } from "@/ui/overlays";
import { Button, Card, EmptyState, Segmented, Skeleton } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { PaperGrid } from "@/ui/templates";

type Group = "postmed" | "exam";
const GROUPS: { value: Group; label: string }[] = [
  { value: "postmed", label: "後醫" },
  { value: "exam", label: "其他考試" },
];

const cmp = new Intl.Collator("zh-Hant", { numeric: true });

interface Paper {
  key: string;
  school: string;
  year: number;
  rows: IndexRow[];
}

function papersOf(ctx: FilterContext, group: Group): Map<string, Paper> {
  const out = new Map<string, Paper>();
  for (const r of ctx.rows) {
    if (ctx.kindGroup.get(r.kind) !== group || !r.school || !r.year) continue;
    const key = `${ctx.subject}|${group}|${r.school}|${r.year}`;
    let p = out.get(key);
    if (!p) out.set(key, (p = { key, school: r.school, year: r.year, rows: [] }));
    p.rows.push(r);
  }
  for (const p of out.values()) p.rows.sort((a, b) => cmp.compare(a.sid, b.sid) || cmp.compare(a.label, b.label));
  return out;
}

const LIMITS = [0, 60, 80, 100, 120] as const;

export function PapersPage() {
  const nav = useNavigate();
  const tax = useTaxonomy().data;
  const [subject, setSubject] = useSubjectChoice();
  const [group, setGroup] = useState<Group>("postmed");
  const ctxQ = useFilterContext(subject);
  const ctx = ctxQ.data?.subject === subject ? ctxQ.data : undefined;
  const ended = useEndedSessions();
  const [open, setOpen] = useState<Paper | null>(null);
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(80);
  const [busy, setBusy] = useState(false);

  const papers = useMemo(() => (ctx ? papersOf(ctx, group) : null), [ctx, group]);
  const grid = useMemo(() => {
    if (!papers) return null;
    const list = [...papers.values()];
    return { schools: [...new Set(list.map((p) => p.school))].sort((a, b) => a.localeCompare(b, "zh-Hant")), years: [...new Set(list.map((p) => p.year))].sort((a, b) => b - a) };
  }, [papers]);
  /** 每份考卷最近一次結束的場次 */
  const last = useMemo(() => {
    const m = new Map<string, NonNullable<typeof ended>[number]>();
    for (const s of ended ?? []) {
      const k = s.filter.paper;
      if (!k) continue;
      const cur = m.get(k);
      if (!cur || (s.ended_at ?? 0) > (cur.ended_at ?? 0)) m.set(k, s);
    }
    return m;
  }, [ended]);

  const subjectName = tax?.subjects.find((s) => s.id === subject)?.name ?? subject;

  async function start(p: Paper, mode: "practice" | "exam") {
    setBusy(true);
    const items = p.rows.map((r) => r.id);
    const label = `${mode === "exam" ? "模擬考" : "原卷"}・${p.school} ${p.year}・${subjectName}`;
    const s = await sessions.create({ mode, filter: { label, paper: p.key }, items, timeLimitS: mode === "exam" && limit ? limit * 60 : null });
    void content.question(items[0]);
    nav(`/s/${s.id}`);
  }

  const prevOf = open ? last.get(open.key) : undefined;
  return (
    <Page title="原卷" subtitle="選一份考卷整份練習，或計時模擬考" back="/more" width="wide">
      <div className="flex flex-wrap gap-3">
        {tax && <Segmented label="科目" value={subject} onChange={setSubject} options={tax.subjects.map((s) => ({ value: s.id, label: s.name }))} />}
        <Segmented label="考試類別" value={group} onChange={setGroup} options={GROUPS} />
      </div>
      {ctxQ.error ? (
        <EmptyState tone="error" title="讀不到題庫索引" action={<Button onClick={ctxQ.reload}>再試一次</Button>}>{ctxQ.error.message}</EmptyState>
      ) : !grid || !papers ? (
        <Card className="p-4"><Skeleton lines={5} /></Card>
      ) : grid.schools.length === 0 ? (
        <Card><EmptyState icon="file" title="這一科沒有這類考卷">換一個考試類別看看。</EmptyState></Card>
      ) : (
        <>
          <PaperGrid
            schools={grid.schools}
            years={grid.years}
            cell={(s, y) => {
              const p = papers.get(`${subject}|${group}|${s}|${y}`);
              if (!p) return null;
              return { count: p.rows.length, score: last.get(p.key)?.score ?? null };
            }}
            onOpen={(s, y) => setOpen(papers.get(`${subject}|${group}|${s}|${y}`) ?? null)}
          />
          <p className="text-meta text-ink-muted">格子裡是題數；做過的格子顯示最近一次的答對率。表格可以左右捲動。</p>
        </>
      )}

      {open && (
        <Dialog
          title={`${open.school} ${open.year}・${subjectName}（${open.rows.length} 題）`}
          onClose={() => setOpen(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setOpen(null)}>取消</Button>
              <Button disabled={busy} onClick={() => void start(open, "practice")}>整份練習</Button>
              <Button variant="primary" loading={busy} onClick={() => void start(open, "exam")}>開始模擬考</Button>
            </>
          }
        >
          <div className="space-y-4">
            {prevOf && (
              <p className="text-ui text-ink">
                上次：答對 {Math.round((prevOf.score ?? 0) * open.rows.length)} / {open.rows.length} 題・
                {prevOf.mode === "exam" ? `用時 ${formatDuration((prevOf.ended_at ?? 0) - prevOf.started_at)}・` : ""}
                {formatAgo(prevOf.ended_at ?? 0)}
              </p>
            )}
            <div>
              <div className="mb-1.5 text-ui font-medium text-ink-strong">模擬考時間</div>
              <Segmented label="模擬考時間" className="w-full" value={limit} onChange={setLimit} options={LIMITS.map((m) => ({ value: m, label: m ? `${m} 分` : "不計時" }))} />
            </div>
            <p className="text-meta text-ink-muted">
              整份練習：每題作答後立刻看答案。模擬考：交卷前不顯示答案，時間到自動交卷，中途離開可以續考（計時不會暫停）。得分只算答對題數，不倒扣。
            </p>
          </div>
        </Dialog>
      )}
    </Page>
  );
}
