// 之後各階段要用的頁面。1A 只交版面與操作手感：能用真實資料的地方用真實資料，其餘是示範資料。
// 接功能時：保留這裡的版面，把示範資料換成 @/data 的函式。

import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { content, useAsync, useContentInfo, useFilterContext, useFlagged, useKb, useRows, useTaxonomy, type KbBlock, type SubjectId } from "@/data";
import { formatAgo } from "@/lib/format";
import { Icon } from "@/ui/icons";
import { useToast } from "@/ui/overlays";
import { Badge, Button, Card, EmptyState, IconButton, LinkButton, ListCard, ListRow, Notice, SectionTitle, Segmented, Skeleton, Stat } from "@/ui/primitives";
import { Page, TemplateNotice } from "@/ui/shell";
import { BarList, ChartCard, ColumnChart, EditPanel, ExamTimerBar, HeatTable, HighlightPalette, KbBlocks, PaperGrid, ReviewCard, SearchBar } from "@/ui/templates";

const Title = ({ label, id }: { label: string; id: string }) => (
  <>
    {label}
    <span className="mx-1 text-ink-muted">｜</span>
    <span className="text-ink-muted">{id}</span>
  </>
);

// ---------- 複習（第 2 階段） ----------

const DEMO_CARDS = [
  { front: "一質點作簡諧運動，位移 $x = A\\cos(\\omega t + \\phi)$。**最大加速度**的大小是多少？", back: "$$a_{\\max} = \\omega^2 A$$\n\n加速度 $a = -\\omega^2 x$，位移最大時加速度也最大。" },
  { front: "PDH complex 的五個輔酶是哪些？", back: "**TPP、Lipoamide、CoA、FAD、NAD⁺**\n\n- E1：TPP\n- E2：Lipoamide、CoA\n- E3：FAD、NAD⁺" },
];

export function ReviewTemplate() {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = DEMO_CARDS[i % DEMO_CARDS.length];
  return (
    <Page title="今日複習" subtitle={`示範卡片 ${(i % DEMO_CARDS.length) + 1} / ${DEMO_CARDS.length}`}>
      <TemplateNotice stage="第 2 階段">卡片是示範內容、評分不會被記錄</TemplateNotice>
      <ReviewCard
        key={i}
        front={card.front}
        back={card.back}
        flipped={flipped}
        onFlip={() => setFlipped(true)}
        onRate={() => { setFlipped(false); setI((n) => n + 1); }}
        ratings={[{ value: 1, label: "重來", next: "10 分鐘" }, { value: 2, label: "困難", next: "1 天" }, { value: 3, label: "良好", next: "3 天" }, { value: 4, label: "簡單", next: "7 天" }]}
      />
    </Page>
  );
}

// ---------- 清單頁：錯題本、題庫瀏覽、修訂佇列共用同一種版面 ----------

export function WrongPage() {
  const list = useFlagged("wrong");
  const rows = useRows(list?.map((x) => x.id)).data;
  return (
    <Page title="錯題本" subtitle={list ? `${list.length} 題` : undefined} back="/more" width="narrow">
      <TemplateNotice stage="第 2 階段">清單是真的，但「錯題重練」與「連續答對 2 次後離開」的規則還沒接上</TemplateNotice>
      {!list ? (
        <Card className="p-4"><Skeleton lines={4} /></Card>
      ) : list.length === 0 ? (
        <Card><EmptyState icon="check" title="錯題本是空的" action={<LinkButton to="/practice">去刷題</LinkButton>}>答錯的題目會自動出現在這裡。</EmptyState></Card>
      ) : (
        <ListCard label="錯題">
          {list.map((x) => (
            <li key={x.id}>
              <ListRow to={`/q/${encodeURIComponent(x.id)}`} title={<Title label={rows?.get(x.id)?.label ?? "…"} id={x.id} />} meta={`答錯於 ${formatAgo(x.at)}`} leading={<Icon name="x" size={18} />} />
            </li>
          ))}
        </ListCard>
      )}
    </Page>
  );
}

export function BrowsePage() {
  const tax = useTaxonomy().data;
  const [subject, setSubject] = useState<SubjectId>("PHY");
  const ctx = useFilterContext(subject).data;
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(40);
  const hits = useMemo(() => {
    if (!ctx || ctx.subject !== subject) return null;
    const k = q.trim().toLowerCase();
    return k ? ctx.rows.filter((r) => r.id.toLowerCase().includes(k) || r.label.toLowerCase().includes(k)) : ctx.rows;
  }, [ctx, subject, q]);
  return (
    <Page title="題庫瀏覽" subtitle={hits ? `${hits.length.toLocaleString()} 題` : undefined} back="/more">
      <TemplateNotice stage="第 2 階段">目前只能用題號與來源名稱找；搜尋題幹與詳解還沒接上</TemplateNotice>
      <div className="space-y-3">
        {tax && <Segmented label="科目" value={subject} onChange={(v) => { setSubject(v); setLimit(40); }} options={tax.subjects.map((s) => ({ value: s.id, label: s.name }))} />}
        <SearchBar value={q} onChange={(v) => { setQ(v); setLimit(40); }} placeholder="題號或來源，例如 PHY-000917、高醫 115" />
      </div>
      {!hits ? (
        <Card className="p-4"><Skeleton lines={5} /></Card>
      ) : hits.length === 0 ? (
        <Card><EmptyState icon="search" title="找不到符合的題目">換個寫法試試：題號要含連字號，來源寫成「學校 年份」。</EmptyState></Card>
      ) : (
        <>
          <ListCard label="題目">
            {hits.slice(0, limit).map((r) => (
              <li key={r.id}>
                <ListRow to={`/q/${encodeURIComponent(r.id)}`} title={<Title label={r.label} id={r.id} />} meta={ctx?.nodeLabel.get(r.chap)} trailing={r.has_fig ? <Badge>有圖</Badge> : undefined} />
              </li>
            ))}
          </ListCard>
          {hits.length > limit && <Button block onClick={() => setLimit((n) => n + 40)}>再顯示 40 題（還有 {(hits.length - limit).toLocaleString()} 題）</Button>}
        </>
      )}
    </Page>
  );
}

export function PatchesTemplate() {
  const demo = [
    { id: "PHY-007836", label: "特訓班2 正課班作業十四 Q5", field: "詳解", state: "pending" as const, at: "10 分鐘前・iPad" },
    { id: "KMU-115-01", label: "高醫 115 01", field: "答案（C → D）", state: "conflict" as const, at: "昨天・iPad" },
    { id: "PHY-000917", label: "高醫 109 37", field: "題幹與選項", state: "merged" as const, at: "3 天前・Mac" },
  ];
  const badge = { pending: <Badge tone="warning">待寫回</Badge>, conflict: <Badge tone="incorrect" icon="alert">衝突</Badge>, merged: <Badge tone="correct" icon="check">已合併</Badge> };
  return (
    <Page title="修訂佇列" subtitle="在網站上改過、還沒寫回 Mac 主檔的內容" back="/more">
      <TemplateNotice stage="第 3 階段" />
      <ListCard label="修訂">
        {demo.map((d) => (
          <li key={d.id}>
            <ListRow onClick={() => {}} title={<Title label={d.label} id={d.id} />} meta={`${d.field}・${d.at}`} trailing={badge[d.state]} />
          </li>
        ))}
      </ListCard>
    </Page>
  );
}

// ---------- 原卷與模擬考（第 2 階段） ----------

export function PapersTemplate() {
  const tax = useTaxonomy().data;
  const toast = useToast();
  const [subject, setSubject] = useState<SubjectId>("PHY");
  const [left, setLeft] = useState(4 * 60 + 12);
  const grid = useMemo(() => {
    const src = (tax?.sources ?? []).filter((s) => s.subject === subject && s.school && s.year && s.kind.startsWith("postmed"));
    const cells = new Map<string, number>();
    for (const s of src) cells.set(`${s.school}|${s.year}`, (cells.get(`${s.school}|${s.year}`) ?? 0) + s.count);
    return { schools: [...new Set(src.map((s) => s.school!))].sort((a, b) => a.localeCompare(b, "zh-Hant")), years: [...new Set(src.map((s) => s.year!))].sort((a, b) => b - a), cells };
  }, [tax, subject]);
  return (
    <Page title="原卷" subtitle="選一份考卷整份練習，可以計時" back="/more" width="wide">
      <TemplateNotice stage="第 2 階段">方格裡的題數是真的，得分是示範</TemplateNotice>
      {tax && <Segmented label="科目" value={subject} onChange={setSubject} options={tax.subjects.map((s) => ({ value: s.id, label: s.name }))} />}
      {!tax ? (
        <Card className="p-4"><Skeleton lines={5} /></Card>
      ) : (
        <PaperGrid
          schools={grid.schools}
          years={grid.years}
          cell={(s, y) => {
            const count = grid.cells.get(`${s}|${y}`);
            return count ? { count, score: y === grid.years[1] && s === grid.schools[0] ? 0.78 : null } : null;
          }}
          onOpen={(s, y) => toast(`${s} ${y} 年：模擬考在第 2 階段開放`)}
        />
      )}
      <section aria-labelledby="h-timer">
        <SectionTitle id="h-timer">模擬考進行中的計時列</SectionTitle>
        <div className="space-y-3">
          <ExamTimerBar remainingS={left} totalS={80 * 60} answered={31} total={45} onSubmit={() => toast("交卷後才顯示答案（第 2 階段）")} />
          <div className="flex gap-2">
            <Button onClick={() => setLeft(52 * 60 + 5)}>看正常狀態</Button>
            <Button onClick={() => setLeft(4 * 60 + 12)}>看剩不到 5 分鐘</Button>
          </div>
        </div>
      </section>
    </Page>
  );
}

// ---------- 統計與考題分析（第 2 階段） ----------

export function StatsTemplate() {
  const days = ["一", "二", "三", "四", "五", "六", "日"];
  return (
    <Page title="統計" back="/more" width="wide">
      <TemplateNotice stage="第 2 階段">數字是示範用的</TemplateNotice>
      <Card className="grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Stat value="312" label="本週題數" />
        <Stat value="74%" label="本週答對率" />
        <Stat value="46" label="錯題本" />
        <Stat value="12 天" label="連續天數" />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="每日題數" subtitle="最近 7 天">
          <ColumnChart unit="題" data={[38, 52, 0, 61, 45, 80, 36].map((value, i) => ({ label: days[i], value }))} />
        </ChartCard>
        <ChartCard title="複習負擔預測" subtitle="未來 7 天到期的題數">
          <ColumnChart unit="題" data={[24, 31, 18, 40, 22, 15, 28].map((value, i) => ({ label: `+${i + 1}`, value }))} />
        </ChartCard>
        <ChartCard title="弱點章節" subtitle="答對率最低的五章（至少做過 20 題）">
          <BarList max={100} format={(v) => `${v}%`} rows={[{ label: "Ch15 電磁感應", value: 48, note: "62 題" }, { label: "Ch08 轉動", value: 55, note: "40 題" }, { label: "Ch20 熱力學", value: 58, note: "35 題" }, { label: "Ch27 幾何光學", value: 63, note: "28 題" }, { label: "Ch12 動電學", value: 66, note: "51 題" }]} />
        </ChartCard>
        <ChartCard title="各來源答對率">
          <BarList max={100} format={(v) => `${v}%`} rows={[{ label: "後西醫", value: 71 }, { label: "轉學考", value: 64 }, { label: "補習班教材", value: 80 }, { label: "原文書", value: 77 }]} />
        </ChartCard>
      </div>
    </Page>
  );
}

export function AnalysisTemplate() {
  const tax = useTaxonomy().data;
  const [subject, setSubject] = useState<SubjectId>("PHY");
  const ctx = useFilterContext(subject).data;
  const data = useMemo(() => {
    if (!ctx || ctx.subject !== subject) return null;
    const rows = ctx.rows.filter((r) => ctx.kindGroup.get(r.kind) === "postmed" && r.year);
    const years = [...new Set(rows.map((r) => r.year!))].sort((a, b) => b - a).slice(0, 8).reverse();
    const top = (id: string) => (ctx.chain.get(id) ?? [id]).at(-1)!; // 最上層：物理是分組、生化是書
    const m = new Map<string, number>();
    for (const r of rows) m.set(`${top(r.chap)}|${r.year}`, (m.get(`${top(r.chap)}|${r.year}`) ?? 0) + 1);
    const groups = ctx.tree.map((n) => n.id);
    return { years, groups, m, total: rows.length };
  }, [ctx, subject]);
  return (
    <Page title="考題分析" subtitle="後醫各年在各單元出了幾題" back="/more" width="wide">
      <TemplateNotice stage="第 2 階段">下表已經是由題庫索引即時算出的真實數字；依學校切換、章節細項還沒接上</TemplateNotice>
      {tax && <Segmented label="科目" value={subject} onChange={setSubject} options={tax.subjects.map((s) => ({ value: s.id, label: s.name }))} />}
      {!data || !ctx ? (
        <Card className="p-4"><Skeleton lines={6} /></Card>
      ) : (
        <ChartCard title="單元 × 年份" subtitle={`後醫 ${data.total.toLocaleString()} 題；格子裡是題數，顏色越深題數越多`}>
          <HeatTable rowLabel="單元" rows={data.groups} cols={data.years} value={(r, c) => data.m.get(`${r}|${c}`) ?? 0} />
        </ChartCard>
      )}
    </Page>
  );
}

// ---------- 資料庫（第 4 階段） ----------

export function KbIndex() {
  const info = useContentInfo();
  const tax = useTaxonomy().data;
  const docs = useAsync(async () => Promise.all(((await content.info()).kb ?? []).map(async (key) => ({ key, doc: await content.kb(key) }))), []);
  return (
    <Page title="資料庫" subtitle="講義筆記">
      <TemplateNotice stage="第 4 階段">目前只有兩份示範筆記</TemplateNotice>
      {docs.error ? (
        <EmptyState tone="error" title="讀不到筆記" action={<Button onClick={docs.reload}>再試一次</Button>}>{docs.error.message}</EmptyState>
      ) : !docs.data || !info.data ? (
        <Card className="p-4"><Skeleton lines={3} /></Card>
      ) : docs.data.length === 0 ? (
        <Card><EmptyState icon="book" title="還沒有筆記">筆記在 Mac 上用 Typora 寫，發佈後會出現在這裡。</EmptyState></Card>
      ) : (
        <ListCard label="筆記">
          {docs.data.map(({ key, doc }) => (
            <li key={key}>
              <ListRow to={`/kb/${key.split("/").map(encodeURIComponent).join("/")}`} title={doc.title} meta={tax?.subjects.find((s) => s.id === doc.subject)?.name} leading={<Icon name="book" size={20} />} />
            </li>
          ))}
        </ListCard>
      )}
    </Page>
  );
}

export function KbReaderPage() {
  const { subject, doc: name } = useParams();
  const kb = useKb(subject && name ? `${subject}/${name}` : undefined);
  const nav = useNavigate();
  const toast = useToast();
  const [depth, setDepth] = useState<number>(3);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<KbBlock | null>(null);
  const doc = kb.data;
  return (
    <Page
      title={doc?.title ?? "筆記"}
      back="/kb"
      width="wide"
      actions={
        <IconButton label={editing ? "結束編輯" : "編輯區塊"} pressed={editing} onClick={() => setEditing((v) => !v)}>
          <Icon name="edit" />
        </IconButton>
      }
    >
      {kb.error ? (
        <EmptyState tone="error" title="讀不到這份筆記" action={<Button onClick={() => nav("/kb")}>回筆記目錄</Button>}>{kb.error.message}</EmptyState>
      ) : !doc ? (
        <Skeleton lines={10} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented label="展開到第幾層" value={depth} onChange={setDepth} options={[{ value: 2, label: "大標" }, { value: 3, label: "小標" }, { value: 9, label: "全部" }]} />
            <HighlightPalette onPick={() => toast("螢光筆在第 4 階段開放：選字後這排色票會浮在文字旁")} onNote={() => toast("註記在第 4 階段開放")} />
          </div>
          {editing && <Notice icon="edit">編輯模式：點區塊右邊的筆，改的是那一個區塊的 Markdown。</Notice>}
          <Card as="article" className="p-4 sm:p-6">
            <KbBlocks key={depth} doc={doc} openDepth={depth} editing={editing} onEdit={setTarget} />
          </Card>
        </>
      )}
      {target && doc && <EditPanel title="編輯區塊" initial={target.md} figs={doc.figs} role="kb" onClose={() => setTarget(null)} saveDisabledReason="儲存與寫回在第 4 階段開放" />}
    </Page>
  );
}
