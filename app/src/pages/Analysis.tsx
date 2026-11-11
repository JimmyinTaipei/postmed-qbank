// 考題分析（規格書 §9.1 /analysis）：各科通用的「章節 × 學校 × 年份」出題比例，全部由題庫索引即時算出，
// 新科目自動有。比例 = 該章題數 ÷ 所選範圍的總題數（與舊站 build_exam_analysis.py 的 pct 相同）。
// 物理原有的各章公式與易錯提示在第 7 階段補上。

import { useMemo, useState } from "react";
import { chapterLevel, useFilterContext, useTaxonomy, type FilterContext, type IndexRow, type SubjectId } from "@/data";
import { Button, Card, Chip, EmptyState, Segmented, Skeleton } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { BarList, ChartCard, HeatTable } from "@/ui/templates";

type Group = "postmed" | "exam";
type Level = "top" | "chapter";
type Shown = "count" | "pct";

const pct = (n: number, t: number) => (t ? Math.round((n / t) * 1000) / 10 : 0);

function rowKey(ctx: FilterContext, r: IndexRow, level: Level): string {
  if (level === "chapter") return chapterLevel(ctx, r.chap);
  const up = ctx.chain.get(r.chap) ?? [r.chap];
  return up[up.length - 1];
}

export function AnalysisPage() {
  const tax = useTaxonomy().data;
  const [subject, setSubject] = useState<SubjectId>("PHY");
  const [group, setGroup] = useState<Group>("postmed");
  const [schools, setSchools] = useState<string[]>([]);
  const [level, setLevel] = useState<Level>("top");
  const [shown, setShown] = useState<Shown>("pct");
  const ctxQ = useFilterContext(subject);
  const ctx = ctxQ.data?.subject === subject ? ctxQ.data : undefined;

  const data = useMemo(() => {
    if (!ctx) return null;
    const inGroup = ctx.rows.filter((r) => ctx.kindGroup.get(r.kind) === group && r.year);
    const allSchools = [...new Set(inGroup.map((r) => r.school).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
    const rows = schools.length ? inGroup.filter((r) => r.school && schools.includes(r.school)) : inGroup;
    const years = [...new Set(rows.map((r) => r.year!))].sort((a, b) => a - b);
    const maxY = years.at(-1) ?? 0;
    const keys = new Map<string, number>(); // 列 → 排序用的順序
    const order = new Map<string, number>();
    let i = 0;
    const walk = (nodes: typeof ctx.tree) => nodes.forEach((n) => { order.set(n.id, i++); walk(n.children); });
    walk(ctx.tree);
    const cell = new Map<string, number>();
    const bySchool = new Map<string, number>();
    const yearTotal = new Map<number, number>();
    const schoolTotal = new Map<string, number>();
    const span = { all: 0, ten: 0, five: 0 };
    const spanBy = new Map<string, { all: number; ten: number; five: number }>();
    for (const r of rows) {
      const k = rowKey(ctx, r, level);
      keys.set(k, order.get(k) ?? 1e9);
      cell.set(`${k}|${r.year}`, (cell.get(`${k}|${r.year}`) ?? 0) + 1);
      yearTotal.set(r.year!, (yearTotal.get(r.year!) ?? 0) + 1);
      if (r.school) {
        bySchool.set(`${k}|${r.school}`, (bySchool.get(`${k}|${r.school}`) ?? 0) + 1);
        schoolTotal.set(r.school, (schoolTotal.get(r.school) ?? 0) + 1);
      }
      const s = spanBy.get(k) ?? { all: 0, ten: 0, five: 0 };
      s.all++;
      span.all++;
      if (r.year! > maxY - 10) { s.ten++; span.ten++; }
      if (r.year! > maxY - 5) { s.five++; span.five++; }
      spanBy.set(k, s);
    }
    const list = [...keys].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    return { allSchools, rows, years, maxY, list, cell, bySchool, yearTotal, schoolTotal, span, spanBy, schoolsShown: schools.length ? schools : allSchools };
  }, [ctx, group, schools, level]);

  const label = (k: string) => ctx?.nodeLabel.get(k) ?? k;
  const v = (n: number, t: number) => (shown === "pct" ? pct(n, t) : n);

  return (
    <Page title="考題分析" subtitle="各單元在歷年考卷裡出了幾題、占多少比例" back="/more" width="wide">
      <div className="flex flex-wrap gap-3">
        {tax && <Segmented label="科目" value={subject} onChange={(s) => { setSubject(s); setSchools([]); }} options={tax.subjects.map((s) => ({ value: s.id, label: s.name }))} />}
        <Segmented label="考試類別" value={group} onChange={(g) => { setGroup(g); setSchools([]); }} options={[{ value: "postmed" as const, label: "後醫" }, { value: "exam" as const, label: "其他考試" }]} />
        <Segmented label="分到哪一層" value={level} onChange={setLevel} options={[{ value: "top" as const, label: "大單元" }, { value: "chapter" as const, label: "章" }]} />
        <Segmented label="顯示" value={shown} onChange={setShown} options={[{ value: "pct" as const, label: "比例 %" }, { value: "count" as const, label: "題數" }]} />
      </div>

      {ctxQ.error ? (
        <EmptyState tone="error" title="讀不到題庫索引" action={<Button onClick={ctxQ.reload}>再試一次</Button>}>{ctxQ.error.message}</EmptyState>
      ) : !data || !ctx ? (
        <Card className="p-4"><Skeleton lines={6} /></Card>
      ) : data.allSchools.length === 0 ? (
        <Card><EmptyState icon="grid" title="這一科沒有這類考卷">換一個考試類別看看。</EmptyState></Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="學校">
            <Chip selected={!schools.length} onToggle={() => setSchools([])}>全部學校</Chip>
            {data.allSchools.map((s) => (
              <Chip key={s} selected={schools.includes(s)} onToggle={() => setSchools((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))}>{s}</Chip>
            ))}
          </div>

          <ChartCard title="出題比例" subtitle={`${data.rows.length.toLocaleString()} 題；近十年 = ${data.maxY - 9}–${data.maxY}，近五年 = ${data.maxY - 4}–${data.maxY}`}>
            <div className="overflow-x-auto overscroll-x-contain" data-noswipe>
              <table className="w-full text-meta tabular-nums">
                <thead>
                  <tr className="text-ink-muted">
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">{level === "top" ? "大單元" : "章"}</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">全部（{data.span.all}）</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">近十年（{data.span.ten}）</th>
                    <th scope="col" className="px-2 py-1.5 text-right font-medium">近五年（{data.span.five}）</th>
                  </tr>
                </thead>
                <tbody>
                  {data.list.map((k) => {
                    const s = data.spanBy.get(k)!;
                    return (
                      <tr key={k} className="border-t border-line">
                        <th scope="row" className="px-2 py-1.5 text-left font-normal whitespace-nowrap text-ink-strong">{label(k)}</th>
                        <td className="px-2 py-1.5 text-right">{s.all} <span className="text-ink-muted">（{pct(s.all, data.span.all)}%）</span></td>
                        <td className="px-2 py-1.5 text-right">{s.ten} <span className="text-ink-muted">（{pct(s.ten, data.span.ten)}%）</span></td>
                        <td className="px-2 py-1.5 text-right">{s.five} <span className="text-ink-muted">（{pct(s.five, data.span.five)}%）</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>

          <ChartCard title={`${level === "top" ? "大單元" : "章"} × 年份`} subtitle={shown === "pct" ? "格子是該年的出題比例（%）；顏色越深越多" : "格子是題數；顏色越深越多"}>
            <HeatTable rowLabel={level === "top" ? "大單元" : "章"} rows={data.list} cols={data.years.slice().reverse()} value={(r, c) => v(data.cell.get(`${r}|${c}`) ?? 0, data.yearTotal.get(c as number) ?? 0)} rowName={label} />
          </ChartCard>

          <ChartCard title={`${level === "top" ? "大單元" : "章"} × 學校`} subtitle={shown === "pct" ? "格子是該校全部年份的出題比例（%）" : "格子是題數"}>
            <HeatTable rowLabel={level === "top" ? "大單元" : "章"} rows={data.list} cols={data.schoolsShown} value={(r, c) => v(data.bySchool.get(`${r}|${c}`) ?? 0, data.schoolTotal.get(c as string) ?? 0)} rowName={label} />
          </ChartCard>

          <ChartCard title="全部年份的占比">
            <BarList max={100} format={(x) => `${x}%`} rows={data.list.map((k) => ({ label: label(k), value: pct(data.spanBy.get(k)!.all, data.span.all), note: `${data.spanBy.get(k)!.all}` }))} />
          </ChartCard>
        </>
      )}
    </Page>
  );
}
