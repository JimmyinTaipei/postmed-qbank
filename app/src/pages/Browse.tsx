// 考題（第 2B 階段，規格書 §9.9）：主導覽的「考題」。原本「更多」裡的題庫瀏覽、原卷、錯題本都在這裡。
//
// - 繼續瀏覽：最近看過的範圍（最多 5 個），點了回到上次那一題。
// - 搜尋：題號、來源、內文（背景執行緒，data/search.worker.ts）。
// - 依考卷：考試類別 → 考科（物理化學、生物生化、英文…）→ 學校 × 年份。一格就是一整份考卷，跨科目接在一起照原卷題號排；
//   點了選「瀏覽」「整份練習」「模擬考」。
// - 依章節：章節樹，點一章用閱讀頁看。
// - 教材與講義：書 → 單元。

import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  buildPapers,
  content,
  missingNumbers,
  rangesText,
  scopeUrl,
  sessions,
  useAllContexts,
  useBrowseRecent,
  useChapterNames,
  useEndedSessions,
  useFlagCount,
  useRows,
  useSearch,
  useSubjectChoice,
  useTaxonomy,
  type ChapterNode,
  type FilterContext,
  type PaperInfo,
  type Session,
  type SubjectId,
} from "@/data";
import { formatAgo, formatDuration } from "@/lib/format";
import { Icon } from "@/ui/icons";
import { Dialog } from "@/ui/overlays";
import { Badge, Button, Card, Chip, EmptyState, ListCard, ListRow, Notice, ProgressBar, Segmented, Skeleton, Tabs } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { PaperGrid, SearchBar } from "@/ui/templates";

const PAGE = 40;
const WHERE = { ques: "題幹", idea: "思路", sol: "詳解" } as const;
type Tab = "paper" | "chapter" | "book";
const TABS: { value: Tab; label: string }[] = [
  { value: "paper", label: "依考卷" },
  { value: "chapter", label: "依章節" },
  { value: "book", label: "教材與講義" },
];

export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") : "paper") as Tab;
  const [q, setQ] = useState("");
  const wrong = useFlagCount("wrong");
  const recent = useBrowseRecent();
  const searching = !!q.trim();

  return (
    <Page title="考題" subtitle="整份考卷、章節、搜尋；看題目不算作答" width="wide">
      <SearchBar value={q} onChange={setQ} placeholder="題號、來源或內文，例如 PHY-000917、高醫 115、動量守恆" />
      {searching ? (
        <SearchResults q={q} />
      ) : (
        <>
          {!!recent?.length && (
            <section aria-labelledby="h-continue">
              <h2 id="h-continue" className="mb-2 text-ui font-semibold text-ink-muted">繼續瀏覽</h2>
              <ListCard label="繼續瀏覽">
                {recent.slice(0, 5).map((r) => (
                  <li key={r.scope}>
                    <ListRow to={scopeUrl(r.scope)} leading={<Icon name="book" size={20} />} title={r.title} meta={`看到第 ${r.idx + 1} 題（共 ${r.total} 題）・${formatAgo(r.at)}`} chevron />
                  </li>
                ))}
              </ListCard>
            </section>
          )}
          <ListCard label="錯題">
            <li>
              <ListRow to="/wrong" leading={<Icon name="x" size={20} />} title="錯題本" meta="答錯的題目；做對、標已掌握就離開" trailing={wrong ? <Badge tone="incorrect">{wrong}</Badge> : undefined} chevron />
            </li>
          </ListCard>
          <Tabs label="瀏覽方式" tabs={TABS} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
          {tab === "paper" ? <ByPaper /> : tab === "chapter" ? <ByChapter /> : <ByBook />}
        </>
      )}
    </Page>
  );
}

// ---------- 搜尋 ----------

function SearchResults({ q }: { q: string }) {
  const tax = useTaxonomy().data;
  const [subject, setSubject] = useSubjectChoice();
  const chapters = useChapterNames();
  const [limit, setLimit] = useState(PAGE);
  const search = useSearch(subject, q);
  const hits = search.result?.q === q.trim() ? search.result : null;
  const hitIds = useMemo(() => hits?.hits.slice(0, limit).map((h) => h.id), [hits, limit]);
  const rows = useRows(hitIds).data;
  return (
    <>
      <div className="space-y-3">
        {tax && <Segmented label="科目" value={subject} onChange={(v) => { setSubject(v); setLimit(PAGE); }} options={tax.subjects.map((s) => ({ value: s.id, label: s.name }))} />}
        {search.preparing && (
          <div className="space-y-1">
            <p className="text-meta text-ink-muted">第一次搜尋這一科：正在準備本文（{search.preparing.done} / {search.preparing.total} 包）</p>
            <ProgressBar value={search.preparing.done} max={search.preparing.total} label="準備搜尋" />
          </div>
        )}
        {search.error && <Notice tone="warning" icon="cloudOff">搜尋還不能用：{search.error}。只能先用題號與來源找。</Notice>}
      </div>
      {!hits ? (
        <Card className="p-4"><Skeleton lines={4} /></Card>
      ) : hits.total === 0 ? (
        <Card><EmptyState icon="search" title="找不到符合的題目">換個寫法試試：題號要含連字號，來源寫成「學校 年份」；多個詞用空白分開，會找同時含有它們的題目。</EmptyState></Card>
      ) : (
        <>
          <p className="text-meta text-ink-muted">找到 {hits.total.toLocaleString()} 題・{hits.ms} 毫秒</p>
          <ListCard label="搜尋結果">
            {hits.hits.slice(0, limit).map((h) => {
              const r = rows?.get(h.id);
              return (
                <li key={h.id}>
                  <ListRow
                    to={`/q/${encodeURIComponent(h.id)}`}
                    title={<>{r?.label ?? "…"}<span className="mx-1 text-ink-muted">｜</span><span className="text-ink-muted">{h.id}</span></>}
                    meta={h.snippet ?? (r ? chapters.get(r.chap) : undefined)}
                    trailing={h.where ? <Badge>{WHERE[h.where]}</Badge> : undefined}
                  />
                </li>
              );
            })}
          </ListCard>
          {Math.min(hits.hits.length, hits.total) > limit && <Button block onClick={() => setLimit((n) => n + PAGE)}>再顯示 {PAGE} 題</Button>}
          {hits.total > hits.hits.length && <p className="text-meta text-ink-muted">只列出前 {hits.hits.length} 題，請加關鍵字縮小範圍。</p>}
        </>
      )}
    </>
  );
}

// ---------- 依考卷 ----------

type Group = "postmed" | "exam";
const GROUPS: { value: Group; label: string }[] = [
  { value: "postmed", label: "後醫" },
  { value: "exam", label: "其他考試" },
];

/** 這份考卷最近一次結束的場次。舊的場次（第 2B 階段以前）記的是「科目|類別|學校|年份」。 */
function lastSession(ended: Session[] | undefined, p: PaperInfo): Session | undefined {
  const keys = new Set([p.scope, ...(p.subjects.length === 1 ? [`${p.subjects[0]}|${p.group}|${p.school}|${p.year}`] : [])]);
  let best: Session | undefined;
  for (const s of ended ?? []) if (s.filter.paper && keys.has(s.filter.paper) && (!best || (s.ended_at ?? 0) > (best.ended_at ?? 0))) best = s;
  return best;
}

function ByPaper() {
  const tax = useTaxonomy().data;
  const all = useAllContexts();
  const ended = useEndedSessions();
  const [group, setGroup] = useState<Group>("postmed");
  const [name, setName] = useState<string | null>(null);
  const [open, setOpen] = useState<PaperInfo | null>(null);

  const papers = useMemo(() => (tax && all.data ? buildPapers(tax, all.data) : null), [tax, all.data]);
  const inGroup = useMemo(() => [...(papers?.values() ?? [])].filter((p) => p.group === group), [papers, group]);
  /** 考科：照科目順序（物理 → 生化 → 英文…），同一科裡題數多的在前（物理化學、物理） */
  const names = useMemo(() => {
    const at = new Map((tax?.subjects ?? []).map((s, i) => [s.id, i]));
    const n = new Map<string, { count: number; order: number }>();
    for (const p of inGroup) {
      const cur = n.get(p.name) ?? { count: 0, order: 99 };
      n.set(p.name, { count: cur.count + p.rows.length, order: Math.min(cur.order, ...p.subjects.map((s) => at.get(s) ?? 99)) });
    }
    return [...n].sort((a, b) => a[1].order - b[1].order || b[1].count - a[1].count).map(([k, v]) => [k, v.count] as const);
  }, [inGroup, tax]);
  const cur = name && names.some(([n]) => n === name) ? name : names[0]?.[0];
  const shown = inGroup.filter((p) => p.name === cur);
  const grid = useMemo(() => {
    const cell = new Map<string, PaperInfo>();
    for (const p of shown) cell.set(`${p.school}|${p.year}`, p); // 同一格兩種來源類型（極少）：後面的蓋前面
    return {
      cell,
      schools: [...new Set(shown.map((p) => p.school))].sort((a, b) => a.localeCompare(b, "zh-Hant")),
      years: [...new Set(shown.map((p) => p.year))].sort((a, b) => b - a),
    };
  }, [shown]);

  if (all.error) return <EmptyState tone="error" title="讀不到題庫索引" action={<Button onClick={all.reload}>再試一次</Button>}>{all.error.message}</EmptyState>;
  if (!papers) return <Card className="p-4"><Skeleton lines={5} /></Card>;
  return (
    <section className="space-y-4" aria-label="依考卷">
      <Segmented label="考試類別" value={group} onChange={(g) => { setGroup(g); setName(null); }} options={GROUPS} />
      {names.length === 0 ? (
        <Card><EmptyState icon="file" title="這一類沒有考卷">換一個考試類別看看。</EmptyState></Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="考科">
            {names.map(([n, count]) => (
              <Chip key={n} selected={n === cur} onToggle={() => setName(n)} count={count}>{n}</Chip>
            ))}
          </div>
          <PaperGrid
            schools={grid.schools}
            years={grid.years}
            cell={(s, y) => {
              const p = grid.cell.get(`${s}|${y}`);
              return p ? { count: p.rows.length, score: lastSession(ended, p)?.score ?? null } : null;
            }}
            onOpen={(s, y) => setOpen(grid.cell.get(`${s}|${y}`) ?? null)}
          />
          <p className="text-meta text-ink-muted">一格是一整份考卷，格子裡是題庫目前有的題數；做過的格子顯示最近一次的答對率。表格可以左右捲動。</p>
        </>
      )}
      {open && <PaperDialog p={open} last={lastSession(ended, open)} onClose={() => setOpen(null)} />}
    </section>
  );
}

const LIMITS = [0, 60, 80, 100, 120] as const;

/** 點一份考卷：瀏覽（不作答）、整份練習、模擬考。 */
export function PaperDialog({ p, last, onClose }: { p: PaperInfo; last?: Session; onClose: () => void }) {
  const nav = useNavigate();
  const tax = useTaxonomy().data;
  const [limit, setLimit] = useState<(typeof LIMITS)[number]>(80);
  const [busy, setBusy] = useState(false);
  const missing = useMemo(() => missingNumbers(p.rows), [p.rows]);
  const subjNames = p.subjects.map((s) => tax?.subjects.find((x) => x.id === s)?.name ?? s);
  const title = `${p.school} ${p.year} ${p.name}`;

  async function start(mode: "practice" | "exam") {
    setBusy(true);
    const items = p.rows.map((r) => r.id);
    const label = `${mode === "exam" ? "模擬考" : "原卷"}・${title}`;
    const s = await sessions.create({ mode, filter: { label, paper: p.scope }, items, timeLimitS: mode === "exam" && limit ? limit * 60 : null });
    void content.question(items[0]);
    nav(`/s/${s.id}`);
  }

  return (
    <Dialog
      title={`${title}（${p.rows.length} 題）`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button disabled={busy} onClick={() => void start("practice")}>整份練習</Button>
          <Button disabled={busy} onClick={() => void start("exam")}>模擬考</Button>
          <Button variant="primary" icon="book" onClick={() => nav(scopeUrl(p.scope))}>瀏覽</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ui text-ink">
          題庫裡有 {p.rows.length} 題{p.subjects.length > 1 || missing.length ? `（${subjNames.join("、")}）` : ""}。
          {missing.length > 0 && <>原卷第 {rangesText(missing)} 題還沒有（那幾科還沒上站，或不是這一科的題目）。</>}
        </p>
        {last && (
          <p className="text-ui text-ink">
            上次：答對 {Math.round((last.score ?? 0) * last.items.length)} / {last.items.length} 題・
            {last.mode === "exam" ? `用時 ${formatDuration((last.ended_at ?? 0) - last.started_at)}・` : ""}
            {formatAgo(last.ended_at ?? 0)}
          </p>
        )}
        <div>
          <div className="mb-1.5 text-ui font-medium text-ink-strong">模擬考時間</div>
          <Segmented label="模擬考時間" className="w-full" value={limit} onChange={setLimit} options={LIMITS.map((m) => ({ value: m, label: m ? `${m} 分` : "不計時" }))} />
        </div>
        <p className="text-meta text-ink-muted">
          瀏覽：照原卷題號看題目、答案、詳解，不算作答，會記住看到哪一題。整份練習：每題作答後立刻看答案。模擬考：交卷前不顯示答案，時間到自動交卷，中途離開可以續考（計時不會暫停）。得分只算答對題數，不倒扣。
        </p>
      </div>
    </Dialog>
  );
}

// ---------- 依章節 ----------

function countByNode(ctx: FilterContext): Map<string, number> {
  const n = new Map<string, number>();
  for (const r of ctx.rows) {
    const ids = new Set<string>();
    for (const c of [r.chap, ...(r.xchap ?? [])]) for (const id of ctx.chain.get(c) ?? []) ids.add(id);
    for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  }
  return n;
}

function ByChapter() {
  const tax = useTaxonomy().data;
  const all = useAllContexts();
  const [subject, setSubject] = useSubjectChoice();
  const ctx = all.data?.get(subject);
  const counts = useMemo(() => (ctx ? countByNode(ctx) : null), [ctx]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const rows: { n: ChapterNode; depth: number }[] = [];
  const walk = (ns: ChapterNode[], depth: number) => {
    for (const n of ns) {
      if (!(counts?.get(n.id) ?? 0)) continue;
      rows.push({ n, depth });
      if (open.has(n.id)) walk(n.children, depth + 1);
    }
  };
  if (ctx) walk(ctx.tree, 0);

  return (
    <section className="space-y-4" aria-label="依章節">
      {tax && <Segmented label="科目" value={subject} onChange={setSubject} options={tax.subjects.map((s) => ({ value: s.id, label: s.name }))} />}
      {all.error ? (
        <EmptyState tone="error" title="讀不到題庫索引" action={<Button onClick={all.reload}>再試一次</Button>}>{all.error.message}</EmptyState>
      ) : !ctx || !counts ? (
        <Card className="p-4"><Skeleton lines={6} /></Card>
      ) : (
        <ListCard label="章節">
          {rows.map(({ n, depth }) => {
            const kids = n.children.some((c) => counts.get(c.id));
            return (
              <li key={n.id} className="flex items-center" style={{ paddingLeft: depth * 20 }}>
                {kids ? (
                  <button type="button" aria-label={open.has(n.id) ? `收起 ${n.label}` : `展開 ${n.label}`} aria-expanded={open.has(n.id)} onClick={() => toggle(n.id)} className="flex size-(--tap) shrink-0 items-center justify-center rounded-btn text-ink-muted hover:bg-hover">
                    <Icon name="chevronRight" size={18} className={open.has(n.id) ? "rotate-90 transition-transform duration-(--dur-fast)" : "transition-transform duration-(--dur-fast)"} />
                  </button>
                ) : (
                  <span className="size-(--tap) shrink-0" aria-hidden />
                )}
                <Link to={scopeUrl(`c:${subject}:${n.id}`)} className="flex min-h-(--tap) min-w-0 flex-1 items-center gap-2 rounded-btn pr-3 no-underline hover:bg-hover">
                  <span className="min-w-0 flex-1 truncate text-ui text-ink-strong">{n.label}</span>
                  <span className="shrink-0 text-meta tabular-nums text-ink-muted">{counts.get(n.id)}</span>
                </Link>
              </li>
            );
          })}
        </ListCard>
      )}
      <p className="text-meta text-ink-muted">一題屬於多個章節時（例如英文文法題歸到講義的兩章），每一章都看得到它。</p>
    </section>
  );
}

// ---------- 教材與講義 ----------

function ByBook() {
  const tax = useTaxonomy().data;
  const all = useAllContexts();
  const [subject, setSubject] = useSubjectChoice();
  const ctx = all.data?.get(subject);
  const books = useMemo(() => {
    if (!tax || !ctx) return null;
    const n = new Map<string, number>();
    for (const r of ctx.rows) n.set(r.sid, (n.get(r.sid) ?? 0) + 1);
    const out = new Map<string, { sid: string; unit: string | null; count: number }[]>();
    for (const s of tax.sources) {
      if (s.subject !== subject || !s.book || !n.get(s.sid)) continue;
      const list = out.get(s.book) ?? [];
      list.push({ sid: s.sid, unit: s.unit, count: n.get(s.sid)! });
      out.set(s.book, list);
    }
    const cmp = new Intl.Collator("zh-Hant", { numeric: true });
    for (const l of out.values()) l.sort((a, b) => cmp.compare(a.unit ?? "", b.unit ?? ""));
    return [...out].sort((a, b) => cmp.compare(a[0], b[0]));
  }, [tax, ctx, subject]);

  return (
    <section className="space-y-4" aria-label="教材與講義">
      {tax && <Segmented label="科目" value={subject as SubjectId} onChange={setSubject} options={tax.subjects.map((s) => ({ value: s.id, label: s.name }))} />}
      {!books ? (
        <Card className="p-4"><Skeleton lines={5} /></Card>
      ) : books.length === 0 ? (
        <Card><EmptyState icon="book" title="這一科沒有教材或講義的題目" /></Card>
      ) : (
        books.map(([book, units]) => (
          <details key={book} className="group rounded-card border border-line bg-card">
            <summary className="flex min-h-(--tap) items-center gap-2 px-4 text-ui font-medium text-ink-strong">
              <span className="min-w-0 flex-1 truncate">{book}</span>
              <span className="text-meta tabular-nums text-ink-muted">{units.reduce((a, u) => a + u.count, 0)} 題</span>
              <Icon name="chevronDown" size={18} className="transition-transform duration-(--dur-fast) group-open:rotate-180" />
            </summary>
            <ul className="border-t border-line">
              {units.map((u) => (
                <li key={u.sid}>
                  <ListRow to={scopeUrl(`s:${subject}:${u.sid}`)} title={u.unit ?? u.sid} trailing={<span className="text-meta tabular-nums text-ink-muted">{u.count}</span>} chevron />
                </li>
              ))}
            </ul>
          </details>
        ))
      )}
    </section>
  );
}
