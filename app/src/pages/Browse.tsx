// 題庫瀏覽與搜尋（規格書 §9.1 /browse）：題號、來源（「高醫 115」）、題幹、思路、詳解都搜得到。
// 搜尋在背景執行緒做（data/search.worker.ts），打字不會卡；結果先列題號／來源符合的，再列本文符合的。

import { useMemo, useState } from "react";
import { useChapterNames, useFilterContext, useRows, useSearch, useTaxonomy, useSubjectChoice } from "@/data";
import { Badge, Button, Card, EmptyState, ListCard, ListRow, Notice, ProgressBar, Segmented, Skeleton } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { SearchBar } from "@/ui/templates";

const PAGE = 40;
const WHERE = { ques: "題幹", idea: "思路", sol: "詳解" } as const;

export function BrowsePage() {
  const tax = useTaxonomy().data;
  const [subject, setSubject] = useSubjectChoice();
  const ctx = useFilterContext(subject).data;
  const chapters = useChapterNames();
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const search = useSearch(subject, q);
  const hits = search.result?.q === q.trim() ? search.result : null;
  const hitIds = useMemo(() => hits?.hits.slice(0, limit).map((h) => h.id), [hits, limit]);
  const rows = useRows(hitIds).data;
  const all = ctx && ctx.subject === subject ? ctx.rows : null;
  const searching = !!q.trim();

  return (
    <Page title="題庫瀏覽" subtitle={searching ? (hits ? `找到 ${hits.total.toLocaleString()} 題` : "搜尋中…") : all ? `${all.length.toLocaleString()} 題` : undefined} back="/more">
      <div className="space-y-3">
        {tax && <Segmented label="科目" value={subject} onChange={(v) => { setSubject(v); setLimit(PAGE); }} options={tax.subjects.map((s) => ({ value: s.id, label: s.name }))} />}
        <SearchBar value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} placeholder="題號、來源或內文，例如 PHY-000917、高醫 115、動量守恆" />
        {search.preparing && (
          <div className="space-y-1">
            <p className="text-meta text-ink-muted">第一次搜尋這一科：正在準備本文（{search.preparing.done} / {search.preparing.total} 包）</p>
            <ProgressBar value={search.preparing.done} max={search.preparing.total} label="準備搜尋" />
          </div>
        )}
        {search.error && <Notice tone="warning" icon="cloudOff">搜尋還不能用：{search.error}。只能先用題號與來源找。</Notice>}
        {search.ready && all && search.count < all.length && (
          <Notice icon="cloudOff">這台裝置上只有 {search.count.toLocaleString()} 題的本文（離線而且沒下載的章節搜不到）。到設定頁開啟離線下載可以搜全部。</Notice>
        )}
      </div>

      {searching ? (
        !hits ? (
          <Card className="p-4"><Skeleton lines={4} /></Card>
        ) : hits.total === 0 ? (
          <Card><EmptyState icon="search" title="找不到符合的題目">換個寫法試試：題號要含連字號，來源寫成「學校 年份」；多個詞用空白分開，會找同時含有它們的題目。</EmptyState></Card>
        ) : (
          <>
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
            <p className="text-meta text-ink-muted">搜尋用了 {hits.ms} 毫秒。</p>
          </>
        )
      ) : !all ? (
        <Card className="p-4"><Skeleton lines={5} /></Card>
      ) : (
        <>
          <ListCard label="題目">
            {all.slice(0, limit).map((r) => (
              <li key={r.id}>
                <ListRow to={`/q/${encodeURIComponent(r.id)}`} title={<>{r.label}<span className="mx-1 text-ink-muted">｜</span><span className="text-ink-muted">{r.id}</span></>} meta={chapters.get(r.chap)} trailing={r.has_fig ? <Badge>有圖</Badge> : undefined} />
              </li>
            ))}
          </ListCard>
          {all.length > limit && <Button block onClick={() => setLimit((n) => n + PAGE)}>再顯示 {PAGE} 題（還有 {(all.length - limit).toLocaleString()} 題）</Button>}
        </>
      )}
    </Page>
  );
}
