// 題目瀏覽的閱讀頁（第 2B 階段，規格書 §9.9）：/browse/p/<考卷>、/browse/s/<科目>/<來源>、/browse/c/<科目>/<章節>。
//
// - 照原卷題號（或章節的固定順序）連續看題目；分頁（10／20／50 題），題組的小題不拆到兩頁。
// - 顯示方式三選一：只看題目／題目＋答案／＋詳解（會同步，下次照舊）。「只看題目」時每題可以單獨展開。
// - 不算作答：不寫 attempt。螢光、筆記、手寫、圖上標記和單題頁是同一份。
// - 記住位置：畫面最上方那一題換了之後 2 秒、離開頁面、App 退到背景時寫進 browse.recent（會同步）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  BROWSE_MODES,
  PAGE_SIZES,
  browseRecent,
  browseView,
  content,
  flags,
  missingNumbers,
  pageOf,
  pageStarts,
  qKey,
  rangesText,
  resolveScope,
  restoreIndex,
  sessions,
  useAllContexts,
  useBrowseView,
  useChapterNames,
  useFlags,
  useLastAttempt,
  useQuestion,
  useTaxonomy,
  type BrowseMode,
  type IndexRow,
  type Scope,
} from "@/data";
import { formatAgo } from "@/lib/format";
import { GroupItem, GroupLayout } from "@/ui/content/GroupView";
import { QuestionRead } from "@/ui/content/QuestionView";
import { Icon } from "@/ui/icons";
import { Menu, useToast, type MenuItem } from "@/ui/overlays";
import { Badge, Button, Card, EmptyState, IconButton, Notice, Segmented, Skeleton } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { useQuestionMenu } from "./useQuestionMenu";

const SAVE_DELAY = 2000;
/** 頁首下緣：這條線以上的題目算「看過了」 */
const TOP = 96;

function scopeKey(kind: string | undefined, a: string | undefined, b: string | undefined): string | null {
  if (kind === "p" && a) return `p:${a}`;
  if ((kind === "s" || kind === "c") && a && b) return `${kind}:${a}:${b}`;
  return null;
}

export function BrowseReaderPage() {
  const { kind, a, b } = useParams();
  const key = scopeKey(kind, a, b);
  const tax = useTaxonomy().data;
  const all = useAllContexts();
  const view = useBrowseView();
  const scope = useMemo(() => (key && tax && all.data ? resolveScope(key, tax, all.data) : undefined), [key, tax, all.data]);

  if (!key) return <Page title="題目瀏覽" back="/browse"><Card><EmptyState title="網址不對">回到「考題」重新選一份考卷或一個章節。</EmptyState></Card></Page>;
  if (all.error) return <Page title="題目瀏覽" back="/browse"><EmptyState tone="error" title="讀不到題庫索引" action={<Button onClick={all.reload}>再試一次</Button>}>{all.error.message}</EmptyState></Page>;
  if (scope === undefined || !view) return <Page title="題目瀏覽" back="/browse"><Card className="p-5"><Skeleton lines={8} /></Card></Page>;
  if (scope === null || !scope.rows.length)
    return <Page title="題目瀏覽" back="/browse"><Card><EmptyState title="這個範圍沒有題目">可能是題庫改版後這份考卷或章節不在了。回到「考題」重新選。</EmptyState></Card></Page>;
  return <Reader key={scope.key} scope={scope} mode={view.mode} size={view.size} />;
}

function Reader({ scope, mode, size }: { scope: Scope; mode: BrowseMode; size: number }) {
  const nav = useNavigate();
  const toast = useToast();
  const rows = scope.rows;
  const starts = useMemo(() => pageStarts(rows, size), [rows, size]);
  const [page, setPage] = useState<number | null>(null);
  /** 換頁之後要捲到的那一題 */
  const target = useRef<string | null>(null);
  const cur = useRef<number>(0);
  const saved = useRef<string>("");
  const missing = useMemo(() => (scope.paper ? missingNumbers(rows) : []), [scope.paper, rows]);
  const wide = useMemo(() => rows.some((r) => r.gid), [rows]);

  // 進來時回到上次的位置
  useEffect(() => {
    let live = true;
    void browseRecent.get(scope.key).then((rec) => {
      if (!live) return;
      const idx = restoreIndex(rows, rec);
      cur.current = idx;
      setPage(pageOf(starts, idx));
      if (idx > 0) {
        target.current = rows[idx].id;
        toast("回到上次看到的地方", { action: { label: "從頭看", run: () => goTo(0) } });
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每頁題數改了：留在同一題
  const prevStarts = useRef(starts);
  useEffect(() => {
    if (prevStarts.current === starts || page == null) return;
    prevStarts.current = starts;
    target.current = rows[cur.current]?.id ?? null;
    setPage(pageOf(starts, cur.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starts]);

  const save = useCallback(() => {
    const idx = cur.current;
    const r = rows[idx];
    if (!r) return;
    const sig = `${r.id}|${mode}`;
    if (sig === saved.current) return;
    saved.current = sig;
    void browseRecent.save({ scope: scope.key, title: scope.title, qid: r.id, idx, total: rows.length, mode, at: Date.now() });
  }, [rows, scope.key, scope.title, mode]);

  // 畫面最上方的題目：換了之後 2 秒存；離開、退到背景時再存一次
  useEffect(() => {
    if (page == null) return;
    let timer = 0;
    let raf = 0;
    const measure = () => {
      raf = 0;
      let best: number | null = null;
      for (const el of document.querySelectorAll<HTMLElement>("[data-ridx]")) {
        const t = el.getBoundingClientRect().top;
        if (t <= TOP) best = Number(el.dataset.ridx);
        else {
          if (best == null) best = Number(el.dataset.ridx);
          break;
        }
      }
      if (best != null && best !== cur.current) {
        cur.current = best;
        clearTimeout(timer);
        timer = window.setTimeout(save, SAVE_DELAY);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    const onHide = () => document.visibilityState === "hidden" && save();
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", save);
    // 剛進來（或換頁）也記一筆：入口頁的「繼續瀏覽」才會出現
    timer = window.setTimeout(save, SAVE_DELAY);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", save);
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(timer);
      save();
    };
  }, [page, save]);

  // 換頁、回到上次位置：等題目排好再捲
  useEffect(() => {
    if (page == null) return;
    const id = target.current;
    target.current = null;
    if (!id) {
      window.scrollTo({ top: 0 });
      return;
    }
    let tries = 0;
    const go = () => {
      const el = document.getElementById(`r-${id}`);
      if (el) window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - TOP + 8) });
      // 題目本文是一題一題載入的：前面的題目長高了，再對一次
      if (tries++ < 6) setTimeout(go, 250);
    };
    requestAnimationFrame(go);
  }, [page]);

  function goTo(idx: number) {
    const i = Math.min(Math.max(0, idx), rows.length - 1);
    cur.current = i;
    target.current = i === starts[pageOf(starts, i)] ? null : rows[i].id;
    const p = pageOf(starts, i);
    if (p === page) {
      if (target.current) {
        const el = document.getElementById(`r-${rows[i].id}`);
        el && window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - TOP + 8) });
        target.current = null;
      } else window.scrollTo({ top: 0 });
    } else setPage(p);
  }

  async function practiceFrom() {
    let i = cur.current;
    while (i > 0 && rows[i].gid && rows[i - 1].gid === rows[i].gid) i--; // 題組從第一小題開始
    const items = rows.slice(i).map((r) => r.id);
    const s = await sessions.create({ mode: "practice", filter: { label: `瀏覽・${scope.title}・從第 ${i + 1} 題` }, items });
    void content.question(items[0]);
    nav(`/s/${s.id}`);
  }

  const menu: MenuItem[] = [
    { label: "從這一題開始刷題", icon: "pencil", onSelect: () => void practiceFrom() },
    ...PAGE_SIZES.map((n) => ({ label: `每頁 ${n} 題`, checked: n === size, onSelect: () => void browseView.set({ size: n }) })),
    { label: "從頭看", icon: "undo", onSelect: () => goTo(0) },
  ];

  const p = page ?? 0;
  const from = starts[p] ?? 0;
  const to = starts[p + 1] ?? rows.length;
  const pageRows = rows.slice(from, to);

  return (
    <Page
      title={scope.title}
      subtitle={`${rows.length} 題・看題目不算作答`}
      back="/browse"
      width={wide ? "wide" : "narrow"}
      floatingActions
      actions={
        <Menu label="瀏覽的更多動作" items={menu}>
          <Icon name="dots" />
        </Menu>
      }
    >
      <Segmented label="顯示方式" value={mode} onChange={(m) => void browseView.set({ mode: m })} options={BROWSE_MODES} />
      {missing.length > 0 && p === 0 && <Notice>原卷第 {rangesText(missing)} 題題庫裡還沒有（那幾科還沒上站，或不屬於已上站的科目）。</Notice>}
      {page == null ? (
        <Card className="p-5"><Skeleton lines={8} /></Card>
      ) : (
        <>
          <Pager page={p} pages={starts.length} from={from} to={to} total={rows.length} onPage={(n) => goTo(starts[n])} onJump={(n) => goTo(n - 1)} />
          <PageItems rows={pageRows} offset={from} mode={mode} />
          <Pager page={p} pages={starts.length} from={from} to={to} total={rows.length} onPage={(n) => goTo(starts[n])} onJump={(n) => goTo(n - 1)} bottom />
        </>
      )}
    </Page>
  );
}

function Pager({ page, pages, from, to, total, onPage, onJump, bottom }: { page: number; pages: number; from: number; to: number; total: number; onPage: (p: number) => void; onJump: (n: number) => void; bottom?: boolean }) {
  const [n, setN] = useState("");
  return (
    <nav aria-label={bottom ? "換頁（下）" : "換頁"} className="flex flex-wrap items-center gap-2">
      <Button icon="chevronLeft" disabled={page === 0} onClick={() => onPage(page - 1)}>上一頁</Button>
      <span className="text-ui tabular-nums text-ink-muted">第 {from + 1}–{to} 題，共 {total} 題</span>
      <Button iconEnd="chevronRight" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>下一頁</Button>
      <form
        className="ml-auto flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const v = Number(n);
          if (Number.isInteger(v) && v >= 1 && v <= total) onJump(v);
          setN("");
        }}
      >
        <label className="text-meta text-ink-muted" htmlFor={bottom ? "jump-b" : "jump-t"}>跳到第</label>
        <input id={bottom ? "jump-b" : "jump-t"} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} className="h-(--tap) w-16 rounded-btn border border-line bg-card px-2 text-center text-ui tabular-nums" placeholder="N" />
        <span className="text-meta text-ink-muted">題</span>
        <Button type="submit" variant="ghost" disabled={!n}>跳</Button>
      </form>
    </nav>
  );
}

/** 一頁的題目：同一個題組（共用文章）的小題放進同一個題組版面。 */
function PageItems({ rows, offset, mode }: { rows: IndexRow[]; offset: number; mode: BrowseMode }) {
  const chunks: { gid: string | null; items: { r: IndexRow; idx: number }[] }[] = [];
  rows.forEach((r, i) => {
    const last = chunks.at(-1);
    if (r.gid && last?.gid === r.gid) last.items.push({ r, idx: offset + i });
    else chunks.push({ gid: r.gid ?? null, items: [{ r, idx: offset + i }] });
  });
  return (
    <div className="space-y-6">
      {chunks.map((c) =>
        c.gid && c.items.length ? (
          <GroupChunk key={c.items[0].r.id} items={c.items} mode={mode} />
        ) : (
          <ReadItem key={c.items[0].r.id} r={c.items[0].r} idx={c.items[0].idx} mode={mode} card />
        ),
      )}
    </div>
  );
}

function GroupChunk({ items, mode }: { items: { r: IndexRow; idx: number }[]; mode: BrowseMode }) {
  const q0 = useQuestion(items[0].r.id).data;
  const q = q0 && typeof q0 === "object" ? q0 : null;
  const body = items.map(({ r, idx }) => (
    <GroupItem key={r.id} order={r.go}>
      <ReadItem r={r} idx={idx} mode={mode} />
    </GroupItem>
  ));
  if (!q?.group?.stem) return <div className="space-y-6">{items.map(({ r, idx }) => <ReadItem key={r.id} r={r} idx={idx} mode={mode} card />)}</div>;
  const o = items[0].r.go;
  return (
    <Card className="p-4 sm:p-6">
      <GroupLayout gid={q.group.gid} passage={q.group.stem} figs={q.figs} label={o != null ? `第 ${o}–${o + items.length - 1} 題` : undefined}>
        {body}
      </GroupLayout>
    </Card>
  );
}

function ReadItem({ r, idx, mode, card }: { r: IndexRow; idx: number; mode: BrowseMode; card?: boolean }) {
  const q = useQuestion(r.id);
  const chapters = useChapterNames();
  const item = qKey(r.id);
  const flag = useFlags(item);
  const last = useLastAttempt(item);
  const toast = useToast();
  const nav = useNavigate();
  const menu = useQuestionMenu(item, r.id);
  const extra = (
    <>
      {last && <Badge tone={last.correct ? "correct" : "incorrect"} icon={last.correct ? "check" : "x"}>{`上次${last.correct ? "答對" : "答錯"}・${formatAgo(last.created_at)}`}</Badge>}
      <IconButton label={flag.star ? "取消星號" : "加星號"} pressed={flag.star} onClick={() => { void flags.set(item, "star", !flag.star); toast(flag.star ? "已取消星號" : "已加星號"); }}>
        <Icon name={flag.star ? "starFilled" : "star"} />
      </IconButton>
      <Menu label="這一題的更多動作" items={[{ label: "去作答（開單題頁）", icon: "pencil", onSelect: () => nav(`/q/${encodeURIComponent(r.id)}`) }, ...menu]}>
        <Icon name="dots" />
      </Menu>
    </>
  );
  const inner =
    q.data === undefined ? (
      <Skeleton lines={4} />
    ) : q.data === "missing" ? (
      <p className="text-ui text-ink-muted"><span className="font-semibold text-ink-strong">{r.label}｜{r.id}</span>　本文未下載：連上網路後再開，或到設定頁開啟這一科的離線下載。</p>
    ) : !q.data ? (
      <p className="text-ui text-ink-muted">{r.label}｜{r.id}：讀不到這一題。</p>
    ) : (
      <QuestionRead q={q.data} show={mode} chapter={chapters.get(q.data.chap)} headerExtra={extra} />
    );
  return (
    <div id={`r-${r.id}`} data-ridx={idx} className="scroll-mt-24">
      <p className="mb-1 text-meta tabular-nums text-ink-muted">第 {idx + 1} 題</p>
      {card ? <Card className="p-4 sm:p-6">{inner}</Card> : inner}
    </div>
  );
}
