// 出題設定（規格書 §5.2）：篩選器對真實索引即時算題數。條件之間是「且」，同一組內是「或」。

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  chapterState, content, defaultFilter, describeFilter, facetCounts, pickItems, sanitizeFilter, sessions, toggleChapter,
  useBodyIds, useContentInfo, useFilterContext, useSetting, useStatusSets, useTaxonomy, withStatus, STATUS_KEYS,
  type ChapterNode, type FacetCounts, type FilterContext, type FilterSpec, type SubjectId,
} from "@/data";
import { Icon } from "@/ui/icons";
import { Button, Card, Checkbox, Chip, EmptyState, FilterGroup, Notice, Segmented, Skeleton } from "@/ui/primitives";
import { Page } from "@/ui/shell";

const KIND_GROUPS: [string, string][] = [["postmed", "後醫"], ["exam", "其他考試"], ["material", "教材"], ["ai", "AI 生成"], ["self", "自編"]];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function PracticeSetup() {
  const nav = useNavigate();
  const tax = useTaxonomy().data;
  const info = useContentInfo().data;
  const [saved, save, ready] = useSetting<Partial<FilterSpec> | null>("practice.last", null);
  const [subject, setSubject] = useState<SubjectId | undefined>();
  const ctxQ = useFilterContext(subject);
  const status = useStatusSets();
  const base = ctxQ.data?.subject === subject ? ctxQ.data : undefined;
  const ctx = useMemo(() => (base ? withStatus(base, status) : undefined), [base, status]);
  const body = useBodyIds().data;
  const [spec, setSpec] = useState<FilterSpec | null>(null);
  const [starting, setStarting] = useState(false);

  // 第一次進來：用上次的科目與條件
  useEffect(() => {
    if (!subject && ready && tax) setSubject(saved?.subject && tax.subjects.some((s) => s.id === saved.subject) ? saved.subject : tax.subjects[0]?.id);
  }, [subject, ready, tax, saved]);
  useEffect(() => {
    if (ctx && (!spec || spec.subject !== ctx.subject)) setSpec(sanitizeFilter(ctx, saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const live = ctx && spec && spec.subject === ctx.subject ? spec : null;
  const counts = useMemo(() => (ctx && live ? facetCounts(ctx, live) : null), [ctx, live]);
  const available = useMemo(() => {
    if (!ctx || !live) return 0;
    if (body === undefined) return 0;
    return pickItems(ctx, { ...live, count: "all", order: "original" }, body ?? null).length;
  }, [ctx, live, body]);

  const update = (patch: Partial<FilterSpec>) => setSpec((s) => (s ? { ...s, ...patch } : s));
  const willPick = live ? (live.count === "all" ? available : Math.min(live.count, available)) : 0;

  async function start() {
    if (!ctx || !live || !tax || body === undefined) return;
    setStarting(true);
    const items = pickItems(ctx, live, body ?? null);
    const name = tax.subjects.find((s) => s.id === live.subject)?.name ?? live.subject;
    save(live);
    const s = await sessions.create({ mode: "practice", filter: { ...live, label: describeFilter(ctx, live, name) }, items });
    void content.question(items[0]); // 先把第一題的包抓回來
    nav(`/s/${s.id}`);
  }

  if (ctxQ.error)
    return (
      <Page title="刷題">
        <EmptyState tone="error" title="讀不到題庫索引" action={<Button onClick={ctxQ.reload}>再試一次</Button>}>{ctxQ.error.message}</EmptyState>
      </Page>
    );

  return (
    <Page title="刷題" subtitle="選好條件，右邊（或下方）會即時顯示符合的題數" width="wide">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {tax && subject && (
            <Segmented
              label="科目"
              className="w-full sm:w-auto"
              value={subject}
              onChange={(v) => setSubject(v)}
              options={tax.subjects.map((s) => ({ value: s.id, label: `${s.name} ${(info?.counts[s.id] ?? 0).toLocaleString()}` }))}
            />
          )}
          {!ctx || !live || !counts ? (
            <Card className="p-4"><Skeleton lines={8} /></Card>
          ) : (
            <Card>
              <Filters ctx={ctx} spec={live} counts={counts} update={update} />
            </Card>
          )}
        </div>

        {/* 摘要與開始：寬螢幕固定在右邊，窄螢幕固定在底部分頁列上方 */}
        <aside className="hidden lg:sticky lg:top-6 lg:block">
          <Card className="space-y-4 p-5">
            <Summary total={counts?.total} available={available} willPick={willPick} sample={!!info?.sample} />
            {live && <Extras spec={live} update={update} />}
            <Button variant="primary" block icon="pencil" disabled={!willPick} loading={starting} onClick={start}>
              開始（{willPick} 題）
            </Button>
            {live && ctx && <Button variant="ghost" block onClick={() => setSpec(defaultFilter(ctx))}>還原預設條件</Button>}
          </Card>
        </aside>
      </div>

      <div className="lg:hidden">
        {live && (
          <Card className="space-y-4 p-4">
            <Extras spec={live} update={update} />
            {ctx && <Button variant="ghost" block onClick={() => setSpec(defaultFilter(ctx))}>還原預設條件</Button>}
          </Card>
        )}
        <div className="h-24" />
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+3.5rem)] z-20 border-t border-line bg-card">
          <div className="px-safe mx-auto flex max-w-3xl items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <Summary total={counts?.total} available={available} willPick={willPick} sample={!!info?.sample} compact />
            </div>
            <Button variant="primary" icon="pencil" disabled={!willPick} loading={starting} onClick={start}>
              開始（{willPick} 題）
            </Button>
          </div>
        </div>
      </div>
    </Page>
  );
}

function Summary({ total, available, willPick, sample, compact }: { total?: number; available: number; willPick: number; sample: boolean; compact?: boolean }) {
  if (total == null) return <Skeleton lines={1} />;
  return (
    <div aria-live="polite">
      <p className={compact ? "text-ui text-ink-strong" : "text-ui text-ink-muted"}>
        符合 <strong className={compact ? "text-title tabular-nums text-ink-strong" : "text-display font-semibold tabular-nums text-ink-strong"}>{total.toLocaleString()}</strong> 題
      </p>
      {sample && <p className="mt-0.5 text-meta text-ink-muted">樣本資料：其中 {available.toLocaleString()} 題有本文</p>}
      {!compact && total > 0 && willPick === 0 && <Notice tone="warning" icon="alert">符合的題目都還沒有本文，請放寬條件。</Notice>}
      {!compact && total === 0 && <Notice tone="warning" icon="alert">沒有符合的題目，請放寬條件。</Notice>}
    </div>
  );
}

function Extras({ spec, update }: { spec: FilterSpec; update: (p: Partial<FilterSpec>) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-ui font-medium text-ink-strong">題數</div>
        <Segmented label="題數" className="w-full" value={spec.count} onChange={(count) => update({ count })} options={[{ value: 10, label: "10" }, { value: 20, label: "20" }, { value: 50, label: "50" }, { value: "all", label: "全部" }]} />
      </div>
      <div>
        <div className="mb-1.5 text-ui font-medium text-ink-strong">順序</div>
        <Segmented label="順序" className="w-full" value={spec.order} onChange={(order) => update({ order })} options={[{ value: "random", label: "隨機" }, { value: "original", label: "原順序" }]} />
      </div>
    </div>
  );
}

function Filters({ ctx, spec, counts, update }: { ctx: FilterContext; spec: FilterSpec; counts: FacetCounts; update: (p: Partial<FilterSpec>) => void }) {
  const present = useMemo(() => new Set(ctx.rows.map((r) => r.kind)), [ctx]);
  const kinds = ctx.kindOrder.filter((k) => present.has(k));
  // 選項 = 目前有題的 ＋ 已經勾的（即使變成 0 題也要看得到才能取消）
  const options = <T extends string | number>(m: Map<T, number>, selected: T[]) => [...new Set([...m.keys(), ...selected])];
  const schools = options(counts.schools, spec.schools).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const years = options(counts.years, spec.years).sort((a, b) => b - a);
  const books = options(counts.books, spec.books).sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const cmp = new Intl.Collator("zh-Hant", { numeric: true });
  const units = spec.books.length === 1 ? options(counts.units, spec.units).sort(cmp.compare) : [];
  const short = (xs: (string | number)[]) => (xs.length > 3 ? `${xs.slice(0, 3).join("、")}…共 ${xs.length} 項` : xs.join("、"));

  return (
    <>
      <FilterGroup title="來源類別" defaultOpen summary={short(spec.kinds.map((k) => ctx.kindName.get(k) ?? k))} onClear={() => update({ kinds: [] })}>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {KIND_GROUPS.map(([g, name]) => {
            const ks = kinds.filter((k) => ctx.kindGroup.get(k) === g);
            if (!ks.length) return null;
            return (
              <div key={g} role="group" aria-label={name} className="mb-1">
                <div className="px-2 pt-2 pb-1 text-meta font-medium text-ink-muted">{name}</div>
                {ks.map((k) => (
                  <Checkbox key={k} checked={spec.kinds.includes(k)} onChange={() => update({ kinds: toggle(spec.kinds, k) })} label={ctx.kindName.get(k) ?? k} count={counts.kinds.get(k) ?? 0} />
                ))}
              </div>
            );
          })}
        </div>
      </FilterGroup>

      {schools.length > 0 && (
        <FilterGroup title="學校" summary={short(spec.schools)} onClear={() => update({ schools: [] })}>
          <div className="flex flex-wrap gap-2">
            {schools.map((s) => (
              <Chip key={s} selected={spec.schools.includes(s)} onToggle={() => update({ schools: toggle(spec.schools, s) })} count={counts.schools.get(s) ?? 0}>{s}</Chip>
            ))}
          </div>
        </FilterGroup>
      )}

      {years.length > 0 && (
        <FilterGroup title="年份" summary={short(spec.years.slice().sort((a, b) => b - a))} onClear={() => update({ years: [] })}>
          <div className="flex flex-wrap gap-2">
            {years.map((y) => (
              <Chip key={y} selected={spec.years.includes(y)} onToggle={() => update({ years: toggle(spec.years, y) })} count={counts.years.get(y) ?? 0}>{y}</Chip>
            ))}
          </div>
        </FilterGroup>
      )}

      {books.length > 0 && (
        <FilterGroup title="書與單元" summary={short([...spec.books, ...spec.units])} onClear={() => update({ books: [], units: [] })}>
          <div className="flex flex-wrap gap-2">
            {books.map((b) => (
              <Chip key={b} selected={spec.books.includes(b)} onToggle={() => update({ books: toggle(spec.books, b), units: [] })} count={counts.books.get(b) ?? 0}>{b}</Chip>
            ))}
          </div>
          {units.length > 0 ? (
            <div className="mt-3 flex max-h-64 flex-wrap gap-2 overflow-y-auto overscroll-contain border-t border-line pt-3">
              {units.map((u) => (
                <Chip key={u} selected={spec.units.includes(u)} onToggle={() => update({ units: toggle(spec.units, u) })} count={counts.units.get(u) ?? 0}>{u}</Chip>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-meta text-ink-muted">只選一本書時，可以再選單元。</p>
          )}
        </FilterGroup>
      )}

      <FilterGroup title="狀態" summary={short((spec.status ?? []).map((k) => STATUS_KEYS.find((x) => x.id === k)?.name ?? k))} onClear={() => update({ status: [] })}>
        <div className="flex flex-wrap gap-2">
          {STATUS_KEYS.map((k) => (
            <Chip key={k.id} selected={!!spec.status?.includes(k.id)} onToggle={() => update({ status: toggle(spec.status ?? [], k.id) })} count={counts.status.get(k.id) ?? 0}>{k.name}</Chip>
          ))}
        </div>
        <p className="mt-2 text-meta text-ink-muted">勾多個時，符合任一個就算。「做錯過」包含已經離開錯題本的題目。</p>
      </FilterGroup>

      <FilterGroup title="章節" summary={spec.chapters.length ? `已選 ${spec.chapters.length} 項` : ""} onClear={() => update({ chapters: [] })}>
        <ul>
          {ctx.tree.map((n) => (
            <ChapterItem key={n.id} node={n} ctx={ctx} selected={spec.chapters} counts={counts.chapters} onToggle={(id) => update({ chapters: toggleChapter(ctx, spec.chapters, id) })} depth={0} />
          ))}
        </ul>
      </FilterGroup>
    </>
  );
}

function ChapterItem({ node, ctx, selected, counts, onToggle, depth }: { node: ChapterNode; ctx: FilterContext; selected: string[]; counts: Map<string, number>; onToggle: (id: string) => void; depth: number }) {
  const [open, setOpen] = useState(false);
  const state = chapterState(ctx, selected, node.id);
  const kids = node.children;
  return (
    <li>
      <div className="flex items-center" style={{ paddingLeft: depth * 20 }}>
        {kids.length ? (
          <button type="button" aria-expanded={open} aria-label={`${open ? "收合" : "展開"} ${node.label}`} onClick={() => setOpen((v) => !v)} className="flex size-(--tap) shrink-0 items-center justify-center rounded-btn text-ink-muted hover:bg-hover">
            <Icon name="chevronRight" size={18} className={open ? "rotate-90 transition-transform duration-(--dur-fast)" : "transition-transform duration-(--dur-fast)"} />
          </button>
        ) : (
          <span className="w-(--tap) shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <Checkbox checked={state === "on" ? true : state === "partial" ? "partial" : false} onChange={() => onToggle(node.id)} label={node.label} count={counts.get(node.id) ?? 0} />
        </div>
      </div>
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <ChapterItem key={k.id} node={k} ctx={ctx} selected={selected} counts={counts} onToggle={onToggle} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}
