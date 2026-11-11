// 修訂佇列（規格書 §9.1 /patches、§7.3）：在網站上改過、還沒寫回 Mac 主檔的內容。
// 衝突的修訂在這裡並排顯示兩個版本，選要留哪一個。

import { useMemo, useState } from "react";
import { draftName, FIELD_NAME, fieldValue, isWritten, patches, patchNote, useKb, useKbCatalog, useOpenPatchCount, usePatches, useQuestion, useRows, type ContentPatch, type KbBlock, type PatchField, type Question } from "@/data";
import { formatAgo } from "@/lib/format";
import { Markdown } from "@/ui/content/Markdown";
import { Sheet, useToast } from "@/ui/overlays";
import { Badge, Button, Card, EmptyState, LinkButton, ListCard, ListRow, Notice, SectionTitle, Skeleton } from "@/ui/primitives";
import { Page } from "@/ui/shell";

type Group = "conflict" | "pending" | "written" | "done";

function groupOf(p: ContentPatch): Group {
  if (p.status === "conflict") return "conflict";
  if (p.status === "pending") return isWritten(p) ? "written" : "pending";
  return "done";
}

const GROUP_TITLE: Record<Group, string> = {
  conflict: "衝突：要你決定",
  pending: "待寫回（Mac 上執行 pmq patches pull）",
  written: "已寫回主檔、待發佈（Mac 上執行 pmq publish）",
  done: "已合併或已放棄（最近 30 筆）",
};

function StateBadge({ p }: { p: ContentPatch }) {
  const g = groupOf(p);
  if (g === "conflict") return <Badge tone="incorrect" icon="alert">衝突</Badge>;
  if (g === "pending") return <Badge tone="warning">待寫回</Badge>;
  if (g === "written") return <Badge tone="blue">待發佈</Badge>;
  return p.status === "merged" ? <Badge tone="correct" icon="check">已合併</Badge> : <Badge>已放棄</Badge>;
}

const qid = (p: ContentPatch) => (p.target.startsWith("q:") ? p.target.slice(2) : p.target);
const isKb = (p: ContentPatch) => p.target.startsWith("kb:") || p.target.startsWith("kbnew:");
/** "kb:BCH/2-3_PDH#bid" → ["BCH/2-3_PDH", "bid"] */
const kbParts = (p: ContentPatch) => {
  const t = p.target.slice(3);
  const i = t.lastIndexOf("#");
  return [t.slice(0, i), t.slice(i + 1)] as const;
};
const kbUrl = (key: string, bid?: string) => `/kb/${key.split("/").map(encodeURIComponent).join("/")}${bid ? `#b-${bid}` : ""}`;

export function PatchesPage() {
  const all = usePatches();
  const open = useOpenPatchCount();
  const ids = useMemo(() => [...new Set((all ?? []).filter((p) => !isKb(p)).map(qid))], [all]);
  const rows = useRows(ids).data;
  const cat = useKbCatalog().data;
  const kbTitle = useMemo(() => new Map((cat?.subjects ?? []).flatMap((s) => s.groups.flatMap((g) => g.docs.map((d) => [d.key, d.title] as const)))), [cat]);
  const titleOf = (p: ContentPatch) =>
    p.target.startsWith("kbnew:") ? (
      <>新筆記<span className="mx-1 text-ink-muted">｜</span>{draftName(p).name}</>
    ) : (
      <>筆記<span className="mx-1 text-ink-muted">｜</span>{kbTitle.get(kbParts(p)[0]) ?? kbParts(p)[0]}</>
    );
  const [sel, setSel] = useState<ContentPatch | null>(null);
  const groups = useMemo(() => {
    const g: Record<Group, ContentPatch[]> = { conflict: [], pending: [], written: [], done: [] };
    for (const p of all ?? []) g[groupOf(p)].push(p);
    g.done = g.done.slice(0, 30);
    return g;
  }, [all]);

  return (
    <Page title="修訂佇列" subtitle="在網站上改過、還沒寫回 Mac 主檔的內容" back="/more" width="wide">
      {!all ? (
        <Card className="p-4"><Skeleton lines={4} /></Card>
      ) : all.length === 0 ? (
        <Card>
          <EmptyState icon="edit" title="還沒有任何修訂">
            在題目右上角的 ⋯ 選「編輯這一題」改錯字或詳解，存檔後會出現在這裡；之後在 Mac 上執行 pmq patches pull 寫回主檔。
          </EmptyState>
        </Card>
      ) : (
        <>
          {open === 0 && <Notice icon="check">沒有待處理的修訂。</Notice>}
          {(Object.keys(GROUP_TITLE) as Group[]).map((g) =>
            groups[g].length ? (
              <section key={g} aria-labelledby={`pg-${g}`}>
                <SectionTitle id={`pg-${g}`}>{GROUP_TITLE[g]}</SectionTitle>
                <ListCard label={GROUP_TITLE[g]}>
                  {groups[g].map((p) => {
                    const r = rows?.get(qid(p));
                    return (
                      <li key={p.id}>
                        <ListRow
                          onClick={() => setSel(p)}
                          title={
                            isKb(p) ? titleOf(p) : <>
                              {r?.label ?? qid(p)}
                              <span className="mx-1 text-ink-muted">｜</span>
                              <span className="text-ink-muted">{qid(p)}</span>
                            </>
                          }
                          meta={`${FIELD_NAME[p.field] ?? p.field}・${formatAgo(p.updated_at)}・${p.device}`}
                          trailing={<StateBadge p={p} />}
                        />
                      </li>
                    );
                  })}
                </ListCard>
              </section>
            ) : null,
          )}
        </>
      )}
      {sel && (isKb(sel) ? <KbPatchSheet p={(all ?? []).find((x) => x.id === sel.id) ?? sel} onClose={() => setSel(null)} /> : <PatchSheet p={(all ?? []).find((x) => x.id === sel.id) ?? sel} onClose={() => setSel(null)} />)}
    </Page>
  );
}

function describe(field: ContentPatch["field"], v: string): string | null {
  if (field === "answer") {
    try {
      const a = JSON.parse(v) as Question["answer"];
      return a.keys.length ? a.keys.map((k) => `(${k})`).join(a.mode === "any" ? " 或 " : "") + (a.mode === "all" ? "（複選）" : "") : a.text || "（待定）";
    } catch {
      return v;
    }
  }
  if (field === "tags") {
    try {
      return Object.values(JSON.parse(v) as Record<string, string[]>).flat().join("、") || "（無）";
    } catch {
      return v;
    }
  }
  if (field === "chap") return v || "（未分類）";
  if (field === "human_verified") return "標為已確認";
  return null; // Markdown
}

function Version({ title, field, value, q }: { title: string; field: ContentPatch["field"]; value: string; q: Question | null }) {
  const text = describe(field, value);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-meta font-medium text-ink-muted">{title}</div>
      <div className="rounded-btn border border-line p-3">{text !== null ? <p className="text-body text-ink-strong">{text}</p> : <Markdown text={value} figs={q?.figs} role={field === "ques" ? "q" : "sol"} />}</div>
    </div>
  );
}

function PatchSheet({ p, onClose }: { p: ContentPatch; onClose: () => void }) {
  const toast = useToast();
  const id = qid(p);
  const qq = useQuestion(id).data;
  const q = qq && typeof qq === "object" ? qq : null;
  const base = q?.patch?.base ?? q;
  const n = patchNote(p);
  const g = groupOf(p);
  const current = base && p.field !== "human_verified" ? fieldValue(base, p.field as PatchField) : null;

  const act = async (fn: () => Promise<void>, msg: string) => {
    await fn();
    toast(msg);
    onClose();
  };

  return (
    <Sheet
      title={`${FIELD_NAME[p.field] ?? p.field}｜${q?.label ?? id}｜${id}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <LinkButton to={`/q/${encodeURIComponent(id)}`} variant="ghost">開啟題目</LinkButton>
          {g === "conflict" && n.conflict ? (
            <>
              <Button variant="secondary" onClick={() => void act(() => patches.discard(p.id), "已放棄網站上的修訂，改用 Mac 的版本")}>用 Mac 的版本</Button>
              <Button variant="primary" onClick={() => void act(() => patches.keepMine(p.id), "已改成保留你的版本；下次 pmq patches pull 會寫回")}>保留我的版本</Button>
            </>
          ) : g === "conflict" || g === "pending" ? (
            <Button variant="danger" onClick={() => void act(() => patches.discard(p.id), "已放棄這筆修訂")}>放棄這筆修訂</Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2 text-meta text-ink-muted">
          <StateBadge p={p} />
          <span>建立 {new Date(p.created_at).toLocaleString("zh-TW")}・{p.device}</span>
          {n.written && n.written.length < 20 && <span>主檔 commit {n.written}</span>}
        </div>
        {g === "conflict" && n.conflict && <Notice tone="incorrect" icon="alert">Mac 上的主檔在你修訂之後也改過這一段。選一個版本留下：「保留我的版本」會在下次 pull 時蓋過主檔。</Notice>}
        {g === "conflict" && !n.conflict && n.reason && <Notice tone="incorrect" icon="alert">沒有寫回：{n.reason}。可以放棄這筆修訂，或在 Mac 上手動改。</Notice>}
        {g === "pending" && <Notice icon="info">在 Mac 上執行 bin/pmq patches pull，會把這筆寫回主檔並產生一個 commit。</Notice>}
        {g === "written" && <Notice icon="info">已寫回主檔；在 Mac 上執行 bin/pmq publish 之後，這筆會變成「已合併」。</Notice>}
        {p.field === "human_verified" ? (
          <p className="text-body text-ink-strong">把這題標為「✓ 已確認」。</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {g === "conflict" && n.conflict ? (
              <Version title="Mac 上主檔目前的版本" field={p.field} value={n.conflict.theirs} q={q} />
            ) : (
              current !== null && <Version title="題庫目前的版本" field={p.field} value={current} q={q} />
            )}
            <Version title="你的修訂" field={p.field} value={p.value} q={q} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

function findBlock(blocks: KbBlock[], bid: string): KbBlock | undefined {
  for (const b of blocks) {
    if (b.bid === bid) return b;
    const k = findBlock(b.children, bid);
    if (k) return k;
  }
}

function KbVersion({ title, value, figs }: { title: string; value: string; figs?: Question["figs"] }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-meta font-medium text-ink-muted">{title}</div>
      <div className="rounded-btn border border-line p-3">{value.trim() ? <Markdown text={value} figs={figs} role="kb" /> : <p className="text-ui text-ink-muted">（空的）</p>}</div>
    </div>
  );
}

/** 筆記的修訂：改區塊、插入列點、刪除區塊、新增筆記。 */
function KbPatchSheet({ p, onClose }: { p: ContentPatch; onClose: () => void }) {
  const toast = useToast();
  const isNew = p.target.startsWith("kbnew:");
  const [key, bid] = isNew ? [undefined, undefined] : kbParts(p);
  const doc = useKb(key).data;
  const block = doc && bid ? findBlock(doc.blocks, bid) : undefined;
  const n = patchNote(p);
  const g = groupOf(p);
  const act = async (fn: () => Promise<void>, msg: string) => {
    await fn();
    toast(msg);
    onClose();
  };
  const name = isNew ? draftName(p).name : (doc?.title ?? key);
  return (
    <Sheet
      title={`${FIELD_NAME[p.field] ?? p.field}｜${name}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <LinkButton to={isNew ? `/kb/new/${p.id}` : kbUrl(key!, block ? bid : undefined)} variant="ghost">{isNew ? "開啟新筆記" : "開啟筆記"}</LinkButton>
          {g === "conflict" && n.conflict ? (
            <>
              <Button variant="secondary" onClick={() => void act(() => patches.discard(p.id), "已放棄網站上的修訂，改用 Mac 的版本")}>用 Mac 的版本</Button>
              <Button variant="primary" onClick={() => void act(() => patches.keepMine(p.id), "已改成保留你的版本；下次 pmq patches pull 會寫回")}>保留我的版本</Button>
            </>
          ) : g === "conflict" || g === "pending" ? (
            <Button variant="danger" onClick={() => void act(() => patches.discard(p.id), "已放棄這筆修訂")}>放棄這筆修訂</Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2 text-meta text-ink-muted">
          <StateBadge p={p} />
          <span>建立 {new Date(p.created_at).toLocaleString("zh-TW")}・{p.device}</span>
          {n.written && n.written.length < 20 && <span>主檔 commit {n.written}</span>}
        </div>
        {g === "conflict" && n.conflict && <Notice tone="incorrect" icon="alert">Mac 上的筆記在你修訂之後也改過這個區塊。選一個版本留下：「保留我的版本」會在下次 pull 時蓋過 Mac 上的版本。</Notice>}
        {g === "conflict" && !n.conflict && n.reason && <Notice tone="incorrect" icon="alert">沒有寫回：{n.reason}。可以放棄這筆修訂，或在 Mac 上用 Typora 手動改。</Notice>}
        {g === "pending" && <Notice icon="info">在 Mac 上執行 bin/pmq patches pull，會把這筆寫回筆記檔並產生一個 commit。</Notice>}
        {g === "written" && <Notice icon="info">已寫回筆記檔；在 Mac 上執行 bin/pmq publish 之後，這筆會變成「已合併」。</Notice>}
        {!isNew && doc && !block && g !== "done" && <Notice tone="warning" icon="alert">目前的內容包裡找不到這個區塊（Mac 上改過這份筆記，或已經寫回並發佈）。</Notice>}
        {isNew ? (
          <KbVersion title="新筆記的內容" value={p.value} />
        ) : p.field === "delete" ? (
          <KbVersion title="要刪掉的區塊（連同底下的子項）" value={block?.md ?? ""} figs={doc?.figs} />
        ) : p.field === "md" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {g === "conflict" && n.conflict ? <KbVersion title="Mac 上目前的版本" value={n.conflict.theirs} figs={doc?.figs} /> : block && <KbVersion title="筆記目前的版本" value={block.md} figs={doc?.figs} />}
            <KbVersion title="你的修訂" value={p.value} figs={doc?.figs} />
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {block && <KbVersion title={p.field === "insert_child" ? "插在這個列點底下" : "插在這個列點後面"} value={block.md} figs={doc?.figs} />}
            <KbVersion title="新的列點" value={p.value} figs={doc?.figs} />
          </div>
        )}
      </div>
    </Sheet>
  );
}
