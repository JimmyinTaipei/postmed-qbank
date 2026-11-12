// 卡片（第 5 階段，規格書 §9.5）：牌組目錄、牌組、單張卡、新增與編輯、複習。
// 卡片的內容是 Markdown（公式、圖、聲音和題目共用顯示元件）；克漏字 {{c1::…}} 由 cardFaces 遮蓋。

import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  cardFaces,
  cardQueue,
  cards,
  clozeNumbers,
  decks,
  flattenDecks,
  prefs,
  ratingPreview,
  tsv,
  useCard,
  useCardAutoplay,
  useCardQueue,
  useDeck,
  useDeckCards,
  useDeckTree,
  useQuestion,
  VOCAB_FIELDS,
  VOCAB_FORM_LABEL,
  type CardFields,
  type CardKind,
  type CardOrigin,
  type DeckNode,
  type Fig,
} from "@/data";
import { htmlToMarkdown } from "@/ui/content/paste";
import { Markdown } from "@/ui/content/Markdown";
import { playSound, preloadSounds, soundsIn } from "@/ui/content/sound";
import { Icon } from "@/ui/icons";
import { Dialog, Menu, Sheet, useToast, type MenuItem } from "@/ui/overlays";
import { Badge, Button, Card, EmptyState, IconButton, LinkButton, ListCard, ListRow, Notice, ProgressBar, SectionTitle, Segmented, Select, Skeleton, Stat, TextField, cx } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { ReviewCard, SearchBar, type Rating } from "@/ui/templates";
import { RichEditor } from "@/ui/RichEditorLazy";
import { InkScope } from "@/ui/ink/FigInk";
import { VocabCard } from "@/ui/content/VocabCard";
import { Frame } from "./SessionPlayer";

/** 清單用的一行純文字：克漏字顯示答案、去掉公式符號與 HTML、圖與聲音換成記號。 */
export function cardPlain(md: string): string {
  return md
    .replace(/\{\{c\d+::((?:(?!\}\}|::)[\s\S])*)(?:::(?:(?!\}\})[\s\S])*)?\}\}/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "［圖］")
    .replace(/\[sound:[^\]]*\]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\$\$?/g, "")
    .replace(/\\([*_`$#>\\])/g, "$1")
    .replace(/[*_]{1,2}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 由題目做成的卡片：題圖在題目的內容包裡，顯示時借用。 */
function useCardFigs(origin: CardOrigin | null | undefined): Fig[] | undefined {
  const q = useQuestion(origin?.from === "q" ? origin.id : undefined).data;
  return q && typeof q === "object" ? q.figs : undefined;
}

/** 單字卡在清單上的一行：詞性＋字義。 */
function vocabMeta(f: CardFields | null | undefined): string | null {
  if (!f) return null;
  return [f["Part of Speech"], f["Meaning and Definition"]].map((x) => cardPlain(x ?? "")).filter(Boolean).join(" ").slice(0, 80) || null;
}

const KINDS: { value: CardKind; label: string }[] = [
  { value: "basic", label: "問答" },
  { value: "reverse", label: "正反兩張" },
  { value: "cloze", label: "克漏字" },
  { value: "vocab", label: "單字" },
];

function deckMeta(n: Pick<DeckNode, "total" | "due" | "fresh" | "suspended">): string {
  const parts = [`${n.total.toLocaleString()} 張`];
  if (n.due) parts.push(`到期 ${n.due.toLocaleString()}`);
  if (n.fresh) parts.push(`新卡 ${n.fresh.toLocaleString()}`);
  if (n.suspended) parts.push(`暫停 ${n.suspended.toLocaleString()}`);
  return parts.join("・");
}

// ---------- 目錄 ----------

export function CardsIndex() {
  const tree = useDeckTree();
  const q = useCardQueue(null);
  const [newDeck, setNewDeck] = useState<{ parent: string | null } | null>(null);
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const menu: MenuItem[] = [
    { label: "新增牌組", icon: "plus", onSelect: () => setNewDeck({ parent: null }) },
    { label: "匯入純文字（TSV）", icon: "download", onSelect: () => setImporting(true), disabledReason: tree && !tree.length ? "先新增一個牌組" : undefined },
  ];

  const rows: { n: DeckNode; shown: boolean }[] = [];
  const walk = (ns: DeckNode[], shown: boolean) => {
    for (const n of ns) {
      rows.push({ n, shown });
      walk(n.children, shown && (n.depth === 0 ? !open.has(n.deck.id + ":closed") : open.has(n.deck.id)));
    }
  };
  if (tree) walk(tree, true);

  return (
    <Page
      title="卡片"
      subtitle="Anki 搬來的牌組與自己做的卡片"
      actions={
        <Menu label="更多動作" items={menu}>
          <Icon name="dots" />
        </Menu>
      }
    >
      {!q || !tree ? (
        <Card className="p-5"><Skeleton lines={3} /></Card>
      ) : (
        <>
          <Card className="grid grid-cols-3 gap-4 p-5">
            <Stat value={q.dueShown} label="今天要複習" hint={q.dueTotal > q.dueShown ? `另有 ${q.dueTotal - q.dueShown} 張明天再出` : undefined} />
            <Stat value={q.newShown} label="今天的新卡" hint={q.newTotal > q.newShown ? `共 ${q.newTotal.toLocaleString()} 張等著開始` : undefined} />
            <Stat value={q.doneToday.reviews + q.doneToday.news} label="今天已複習" />
          </Card>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.items.length > 0 ? (
              <LinkButton to="/cards/review" variant="primary" block icon="repeat">開始複習（{q.items.length} 張）</LinkButton>
            ) : (
              <Button block disabled icon="check">今天的卡片複習完了</Button>
            )}
            <LinkButton to="/cards/new" block icon="plus">新增卡片</LinkButton>
          </div>
        </>
      )}

      <section aria-labelledby="h-decks">
        <SectionTitle id="h-decks">牌組</SectionTitle>
        {!tree ? (
          <Card className="p-4"><Skeleton lines={4} /></Card>
        ) : tree.length === 0 ? (
          <Card>
            <EmptyState icon="list" title="還沒有牌組" action={<Button variant="primary" icon="plus" onClick={() => setNewDeck({ parent: null })}>新增牌組</Button>}>
              Anki 的牌組在 Mac 上用 <code>pmq anki import</code> 搬進來；也可以自己新增牌組、從題目或筆記「做成卡片」。
            </EmptyState>
          </Card>
        ) : (
          <ListCard label="牌組">
            {rows
              .filter((r) => r.shown)
              .map(({ n }) => {
                const hasKids = n.children.length > 0;
                const expanded = n.depth === 0 ? !open.has(n.deck.id + ":closed") : open.has(n.deck.id);
                return (
                  <li key={n.deck.id} className="flex items-center" style={{ paddingLeft: `${n.depth * 1.25}rem` }}>
                    {hasKids ? (
                      <IconButton label={expanded ? `收合「${n.deck.name}」` : `展開「${n.deck.name}」`} className="ml-1 shrink-0" onClick={() => toggle(n.depth === 0 ? n.deck.id + ":closed" : n.deck.id)}>
                        <Icon name={expanded ? "chevronDown" : "chevronRight"} size={18} />
                      </IconButton>
                    ) : (
                      <span className="ml-1 w-11 shrink-0" aria-hidden />
                    )}
                    <ListRow className="min-w-0 flex-1 pl-1" to={`/cards/d/${n.deck.id}`} title={n.deck.name} meta={deckMeta(n)} trailing={n.due + n.fresh > 0 ? <Badge tone="blue">{n.due + Math.min(n.fresh, 20)}</Badge> : undefined} />
                  </li>
                );
              })}
          </ListCard>
        )}
      </section>

      <p className="flex items-start gap-1.5 text-meta text-ink-muted">
        <Icon name="info" size={14} className="mt-0.5 shrink-0" />
        搬到網站的牌組就在網站複習，Anki 裡同一副牌先不要再用（兩邊的進度無法合併）。要搬回 Anki 時在 Mac 上用 <code>pmq anki export</code> 匯成新牌組。
      </p>

      {newDeck && <DeckNameSheet title="新增牌組" parent={newDeck.parent} onClose={() => setNewDeck(null)} />}
      {importing && tree && <TsvImportSheet tree={tree} onClose={() => setImporting(false)} />}
    </Page>
  );
}

function DeckNameSheet({ title, parent, deckId, initial = "", onClose }: { title: string; parent: string | null; deckId?: string; initial?: string; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const nav = useNavigate();
  const save = async () => {
    if (!name.trim()) return;
    if (deckId) await decks.rename(deckId, name);
    else nav(`/cards/d/${await decks.create(name, parent)}`);
    onClose();
  };
  return (
    <Sheet title={title} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" disabled={!name.trim()} onClick={save}>{deckId ? "儲存" : "新增"}</Button></>}>
      <form className="p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <TextField label="牌組名稱" data-autofocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      </form>
    </Sheet>
  );
}

function deckOptions(tree: DeckNode[]) {
  return flattenDecks(tree).map((n) => ({ value: n.deck.id, label: "　".repeat(n.depth) + n.deck.name }));
}

function TsvImportSheet({ tree, deckId, onClose }: { tree: DeckNode[]; deckId?: string; onClose: () => void }) {
  const toast = useToast();
  const [deck, setDeck] = useState(deckId ?? flattenDecks(tree)[0]?.deck.id ?? "");
  const [rows, setRows] = useState<ReturnType<typeof tsv.parse> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    try {
      const r = tsv.parse(await f.text(), htmlToMarkdown);
      if (!r.length) setErr("這個檔裡沒有讀到卡片。要用 tab 分隔：第一欄正面、第二欄背面、第三欄標籤（可省略）。");
      setRows(r);
    } catch (e) {
      setErr(`讀不懂這個檔：${(e as Error).message}`);
    }
  };
  const run = async () => {
    if (!rows?.length || !deck) return;
    setBusy(true);
    const n = await tsv.import(rows, deck);
    setBusy(false);
    toast(`已匯入 ${n} 則筆記`);
    onClose();
  };
  return (
    <Sheet title="匯入純文字（TSV）" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" loading={busy} disabled={!rows?.length || !deck} onClick={run}>匯入{rows?.length ? ` ${rows.length} 則` : ""}</Button></>}>
      <div className="space-y-4 p-4">
        <p className="text-ui text-ink">Anki 的「匯出 → 純文字的筆記（.txt）」或自己用試算表存的 TSV：第一欄正面、第二欄背面、第三欄標籤。正面有 {"{{c1::…}}"} 的會變成克漏字卡。進度不會帶過來（要帶進度請在 Mac 上用 pmq anki import）。</p>
        <Select label="放進哪個牌組" value={deck} onChange={setDeck} options={deckOptions(tree)} />
        <label className="block">
          <span className="mb-1.5 block text-ui font-medium text-ink-strong">選擇檔案</span>
          <input type="file" accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values" onChange={(e) => void read(e.target.files?.[0])} className="block w-full text-ui" />
        </label>
        {err && <Notice tone="warning" icon="alert">{err}</Notice>}
        {rows && rows.length > 0 && (
          <Card className="p-3">
            <div className="mb-2 text-meta text-ink-muted">前 3 則預覽（共 {rows.length} 則）</div>
            <ul className="space-y-2">
              {rows.slice(0, 3).map((r, i) => (
                <li key={i} className="text-ui"><span className="font-semibold text-ink-strong">{cardPlain(r.front).slice(0, 60)}</span><span className="text-ink-muted"> ／ {cardPlain(r.back).slice(0, 60)}</span></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </Sheet>
  );
}

// ---------- 牌組 ----------

const PAGE = 100;

export function DeckPage() {
  const { deckId } = useParams();
  const deck = useDeck(deckId);
  const tree = useDeckTree();
  const node = useMemo(() => (tree ? flattenDecks(tree).find((n) => n.deck.id === deckId) : undefined), [tree, deckId]);
  const q = useCardQueue(deckId ?? null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const list = useDeckCards(deckId, query);
  const [sheet, setSheet] = useState<null | "rename" | "sub" | "import">(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const nav = useNavigate();
  const toast = useToast();

  if (deck === null || (deck && deck.deleted)) return <Navigate to="/cards" replace />;
  const exportTsv = async () => {
    if (!deckId || !deck) return;
    const { text, count } = await tsv.export(deckId);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/tab-separated-values;charset=utf-8" }));
    a.download = `${deck.name}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`已匯出 ${count} 則筆記（不含進度）`);
  };
  const menu: MenuItem[] = [
    { label: "改名", icon: "edit", onSelect: () => setSheet("rename") },
    { label: "新增子牌組", icon: "plus", onSelect: () => setSheet("sub") },
    { label: "匯入純文字（TSV）", icon: "download", onSelect: () => setSheet("import") },
    { label: "匯出純文字（TSV）", icon: "download", onSelect: () => void exportTsv() },
    { label: "刪除這個牌組", icon: "trash", danger: true, onSelect: () => setConfirmDel(true) },
  ];

  return (
    <Page
      title={deck?.name ?? "牌組"}
      subtitle={node?.path.includes("›") ? node.path : undefined}
      back="/cards"
      actions={
        <Menu label="牌組的更多動作" items={menu}>
          <Icon name="dots" />
        </Menu>
      }
    >
      {!q || !node ? (
        <Card className="p-5"><Skeleton lines={3} /></Card>
      ) : (
        <>
          <Card className="grid grid-cols-3 gap-4 p-5">
            <Stat value={node.total.toLocaleString()} label="卡片" hint={node.suspended ? `暫停 ${node.suspended}` : undefined} />
            <Stat value={q.dueShown} label="今天要複習" />
            <Stat value={q.newShown} label="今天的新卡" hint={node.fresh > q.newShown ? `共 ${node.fresh.toLocaleString()} 張` : undefined} />
          </Card>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.items.length > 0 ? (
              <LinkButton to={`/cards/review?deck=${deckId}`} variant="primary" block icon="repeat">複習這個牌組（{q.items.length} 張）</LinkButton>
            ) : (
              <Button block disabled icon="check">這個牌組今天複習完了</Button>
            )}
            <LinkButton to={`/cards/new?deck=${deckId}`} block icon="plus">新增卡片</LinkButton>
          </div>
        </>
      )}

      {node && node.children.length > 0 && (
        <section aria-labelledby="h-sub">
          <SectionTitle id="h-sub">子牌組</SectionTitle>
          <ListCard label="子牌組">
            {node.children.map((c) => (
              <li key={c.deck.id}><ListRow to={`/cards/d/${c.deck.id}`} title={c.deck.name} meta={deckMeta(c)} /></li>
            ))}
          </ListCard>
        </section>
      )}

      <section aria-labelledby="h-cards" className="space-y-3">
        <SectionTitle id="h-cards">卡片{list ? `（${list.length.toLocaleString()}）` : ""}</SectionTitle>
        <SearchBar value={query} onChange={(v) => { setQuery(v); setLimit(PAGE); }} placeholder="搜尋正面、背面或標籤" label="搜尋卡片" />
        {!list ? (
          <Card className="p-4"><Skeleton lines={5} /></Card>
        ) : list.length === 0 ? (
          <Card><EmptyState icon="search" title={query ? "沒有符合的卡片" : "這個牌組還沒有卡片"}>{query ? "換個關鍵字試試。" : "按「新增卡片」，或從題目、筆記的 ⋯ 選單「做成卡片」。"}</EmptyState></Card>
        ) : (
          <>
            <ListCard label="卡片">
              {list.slice(0, limit).map(({ card, srs }) => (
                <li key={card.id}>
                  <ListRow
                    to={`/cards/c/${card.id}`}
                    title={cardPlain(card.front_md) || "（空白）"}
                    meta={[card.kind === "cloze" ? `克漏字 c${(card.origin?.ord ?? 0) + 1}` : null, card.kind === "vocab" ? vocabMeta(card.fields) : cardPlain(card.back_md).slice(0, 80) || null].filter(Boolean).join("・")}
                    trailing={srs?.suspended ? <Badge>暫停</Badge> : srs?.state === 0 ? <Badge tone="blue">新</Badge> : undefined}
                  />
                </li>
              ))}
            </ListCard>
            {list.length > limit && <Button block onClick={() => setLimit((l) => l + PAGE * 5)}>再顯示 {Math.min(PAGE * 5, list.length - limit)} 張</Button>}
          </>
        )}
      </section>

      {sheet === "rename" && deck && <DeckNameSheet title="改牌組名稱" parent={deck.parent} deckId={deck.id} initial={deck.name} onClose={() => setSheet(null)} />}
      {sheet === "sub" && deck && <DeckNameSheet title={`在「${deck.name}」底下新增牌組`} parent={deck.id} onClose={() => setSheet(null)} />}
      {sheet === "import" && tree && <TsvImportSheet tree={tree} deckId={deckId} onClose={() => setSheet(null)} />}
      {confirmDel && deck && (
        <Dialog
          title={`刪除「${deck.name}」？`}
          onClose={() => setConfirmDel(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirmDel(false)}>保留</Button>
              <Button variant="danger" onClick={async () => { const n = await decks.remove(deck.id); setConfirmDel(false); toast(`已刪除牌組與 ${n} 張卡片`); nav("/cards"); }}>刪除</Button>
            </>
          }
        >
          連同子牌組與裡面的 {node?.total.toLocaleString() ?? ""} 張卡片一起刪除。複習紀錄會保留。
        </Dialog>
      )}
    </Page>
  );
}

// ---------- 單張卡 ----------

export function CardPage() {
  const { cardId } = useParams();
  const row = useCard(cardId);
  const tree = useDeckTree();
  const nav = useNavigate();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const figs = useCardFigs(row?.card.origin);
  if (row === null)
    return (
      <Page title="卡片" back="/cards">
        <EmptyState title="找不到這張卡" action={<LinkButton to="/cards">回到卡片</LinkButton>}>它可能已經刪除；若是在另一台裝置上剛建立的，等幾秒同步完成後再開一次。</EmptyState>
      </Page>
    );
  if (!row) return <Page title="卡片" back="/cards"><Card className="p-5"><Skeleton lines={5} /></Card></Page>;
  const { card, srs } = row;
  const faces = cardFaces(card);
  const deckNode = tree ? flattenDecks(tree).find((n) => n.deck.id === card.deck_id) : undefined;
  const o = card.origin;
  const menu: MenuItem[] = [
    { label: "編輯", icon: "edit", onSelect: () => nav(`/cards/c/${card.id}/edit`) },
    { label: "移到其他牌組", icon: "list", onSelect: () => setMoving(true) },
    srs?.suspended
      ? { label: "恢復（放回複習）", icon: "undo", onSelect: () => { void cards.suspend(card.id, false); toast("已恢復"); } }
      : { label: "暫停（先不複習）", icon: "clock", onSelect: () => { void cards.suspend(card.id, true); toast("已暫停；之後可以在這裡恢復"); } },
    { label: "刪除這張卡", icon: "trash", danger: true, onSelect: () => setConfirmDel(true) },
  ];
  return (
    <Page title={card.kind === "cloze" ? `克漏字 c${(o?.ord ?? 0) + 1}` : card.kind === "vocab" ? "單字卡" : "卡片"} subtitle={deckNode?.path} back={`/cards/d/${card.deck_id}`} actions={<Menu label="卡片的更多動作" items={menu}><Icon name="dots" /></Menu>}>
      <InkScope value={{ base: `card:${card.id}` }}>
      {card.kind === "vocab" && card.fields ? (
        <>
          <Card as="article" className="p-5 sm:p-6" aria-label="正面">
            <div className="mb-2 text-meta font-semibold text-ink-muted">正面</div>
            <VocabCard fields={card.fields} tags={card.tags} side="front" figs={figs} resetKey={card.id} />
          </Card>
          <Card as="article" className="p-5 sm:p-6" aria-label="背面">
            <div className="mb-2 text-meta font-semibold text-ink-muted">背面</div>
            <VocabCard fields={card.fields} tags={card.tags} side="back" figs={figs} ai={card.origin?.ai} />
          </Card>
        </>
      ) : (
      <Card as="article" className="p-5 sm:p-6">
        <div className="mb-2 text-meta font-semibold text-ink-muted">正面</div>
        <Markdown text={faces.front} figs={figs} />
        <div className="mt-5 border-t border-line pt-5">
          <div className="mb-2 text-meta font-semibold text-ink-muted">答案</div>
          {card.kind === "cloze" && <Markdown text={faces.reveal} figs={figs} />}
          <Markdown text={faces.back} figs={figs} role="sol" className={card.kind === "cloze" ? "mt-4" : undefined} />
        </div>
      </Card>
      )}
      </InkScope>
      <Card className="space-y-2 p-4 text-ui">
        <div className="flex items-center gap-2"><Icon name="repeat" size={16} className="text-ink-muted" />{cards.describe(srs ?? undefined)}</div>
        {card.tags?.length && card.kind !== "vocab" ? <div className="flex flex-wrap gap-1.5">{card.tags.map((t) => <Badge key={t} className="max-w-full whitespace-normal [overflow-wrap:anywhere]">{t}</Badge>)}</div> : null}
        {o?.from === "anki" && <div className="text-meta text-ink-muted">從 Anki 搬來：{o.deck}（{o.model}）</div>}
        {o?.from === "ai" && <div className="text-meta text-ink-muted">AI 產生（批次 {o.batch}）{o.ai?.length ? "；標「AI」的欄位還沒改過" : "；全部欄位都改過了"}</div>}
        {o?.from === "q" && o.id && <div className="text-meta text-ink-muted">由題目做成：<a href={`/q/${o.id}`} onClick={(e) => { e.preventDefault(); nav(`/q/${o.id}`); }}>{o.id}</a></div>}
        {o?.from === "kb" && o.doc && <div className="text-meta text-ink-muted">由筆記做成：<a href={`/kb/${o.doc}${o.bid ? `#b-${o.bid}` : ""}`} onClick={(e) => { e.preventDefault(); nav(`/kb/${o.doc}${o.bid ? `#b-${o.bid}` : ""}`); }}>{o.doc.split("/").pop()}</a></div>}
      </Card>
      {moving && tree && <MoveSheet tree={tree} current={card.deck_id} onClose={() => setMoving(false)} onMove={async (d) => { await cards.move([card.id], d); setMoving(false); toast("已移動"); }} />}
      {confirmDel && (
        <Dialog title="刪除這張卡？" onClose={() => setConfirmDel(false)} actions={<><Button variant="ghost" onClick={() => setConfirmDel(false)}>保留</Button><Button variant="danger" onClick={async () => { await cards.remove(card.id); toast("已刪除"); nav(`/cards/d/${card.deck_id}`, { replace: true }); }}>刪除</Button></>}>
          {card.kind === "cloze" ? "只刪這一張（這個編號）；同一則筆記的其他克漏字卡不受影響。" : "複習紀錄會保留。"}
        </Dialog>
      )}
    </Page>
  );
}

function MoveSheet({ tree, current, onClose, onMove }: { tree: DeckNode[]; current: string; onClose: () => void; onMove: (deck: string) => void }) {
  const [deck, setDeck] = useState(current);
  return (
    <Sheet title="移到其他牌組" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>取消</Button><Button variant="primary" disabled={deck === current} onClick={() => onMove(deck)}>移動</Button></>}>
      <div className="p-4"><Select label="牌組" value={deck} onChange={setDeck} options={deckOptions(tree)} /></div>
    </Sheet>
  );
}

// ---------- 新增與編輯 ----------

/** 從題目或筆記「做成卡片」時帶進來的內容（router state）。 */
export interface CardDraft {
  kind?: CardKind;
  front?: string;
  back?: string;
  origin?: Omit<CardOrigin, "note" | "ord">;
  tags?: string[];
  /** 單字卡：預先填好的欄位（8B-2 做題時新增單字卡用） */
  fields?: CardFields;
}

/** 卡片的一格（第 3B 階段：所見即所得的編輯器）。ver 變了就用新的 value 重新開（載入、新增後清空）。 */
function FieldArea({ label, value, onChange, hint, ver = 0, figs, role = "sol", big, onKey }: { label: string; value: string; onChange: (v: string) => void; hint?: string; ver?: number; figs?: Fig[]; role?: Fig["role"]; big?: boolean; onKey?: Parameters<typeof RichEditor>[0]["onKey"] }) {
  const id = `vf-${label}`;
  return (
    <div>
      <div id={id} className="mb-1.5 block text-ui font-medium text-ink-strong">{label}</div>
      <div aria-describedby={hint ? `${id}-hint` : undefined} className={cx("rounded-btn border border-line-strong bg-card px-3 py-2 focus-within:border-blue-accent", big && "min-h-32")}>
        <RichEditor key={ver} initial={value} placement="card" label={label} figs={figs} role={role} actions={false} noFocus onChange={onChange} onDone={() => undefined} onCancel={() => undefined} onKey={onKey} />
      </div>
      {hint && <p id={`${id}-hint`} className="mt-1.5 text-meta text-ink-muted">{hint}</p>}
    </div>
  );
}

const VOCAB_ROWS: Partial<Record<(typeof VOCAB_FIELDS)[number], number>> = { Sentence: 4, "Memo & Confusable": 3, "Prefix & Roots": 4, Derivative: 2, Synonyms: 2, Antonyms: 2 };
const VOCAB_HINT: Partial<Record<(typeof VOCAB_FIELDS)[number], string>> = {
  Sentence: "英文一行、中文一行；正面按「提示／例句」時中文會先遮住",
  Image: "發音是 [sound:…]，從 Anki 搬來的卡已經有；不用改",
  Source: "例如：高醫 115｜ENG-000058",
};

/** 單字卡的 11 格。 */
function VocabForm({ value, onChange, ver }: { value: CardFields; onChange: (v: CardFields) => void; ver: number }) {
  const latest = useRef(value);
  latest.current = value;
  const set = (k: (typeof VOCAB_FIELDS)[number]) => (v: string) => onChange({ ...latest.current, [k]: v });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <TextField label={VOCAB_FORM_LABEL.Word} data-autofocus value={value.Word ?? ""} onChange={(e) => set("Word")(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <TextField label={VOCAB_FORM_LABEL["Part of Speech"]} hint="例如：v.、n.、adj." value={value["Part of Speech"] ?? ""} onChange={(e) => set("Part of Speech")(e.target.value)} autoCapitalize="none" autoCorrect="off" />
      </div>
      {VOCAB_FIELDS.filter((k) => k !== "Word" && k !== "Part of Speech").map((k) => (
        <FieldArea key={k} ver={ver} label={VOCAB_FORM_LABEL[k]} value={value[k] ?? ""} onChange={set(k)} big={(VOCAB_ROWS[k] ?? 1) >= 3} hint={VOCAB_HINT[k]} />
      ))}
    </div>
  );
}

export function CardEditPage() {
  const { cardId } = useParams();
  const editing = !!cardId;
  const row = useCard(cardId);
  const [params] = useSearchParams();
  const draft = (useLocation().state ?? null) as CardDraft | null;
  const tree = useDeckTree();
  const nav = useNavigate();
  const toast = useToast();
  const [kind, setKind] = useState<CardKind>(draft?.kind ?? "basic");
  const [deck, setDeck] = useState(params.get("deck") ?? prefs.lastDeck() ?? "");
  const [front, setFront] = useState(draft?.front ?? "");
  const [back, setBack] = useState(draft?.back ?? "");
  const [tags, setTags] = useState((draft?.tags ?? []).join(" "));
  const [fields, setFields] = useState<CardFields>(draft?.fields ?? {});
  const [newDeckName, setNewDeckName] = useState("我的卡片");
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  /** 編輯器重新開的版本（載入那一則筆記、新增後清空時換一個） */
  const [ver, setVer] = useState(0);
  const figs = useCardFigs(draft?.origin ?? row?.card.origin);

  // 編輯：載入那一則筆記
  useEffect(() => {
    if (!editing || !row || loaded.current) return;
    loaded.current = true;
    void cards.noteOf(row.card.id).then((n) => {
      if (!n) return;
      setFront(n.front);
      setBack(n.back);
      if (n.fields) setFields(n.fields);
      setVer((v) => v + 1);
    });
    setKind(row.card.kind);
    setDeck(row.card.deck_id);
    setTags((row.card.tags ?? []).join(" "));
  }, [editing, row]);
  // 預設牌組不存在（被刪了、第一次用）就選第一個
  useEffect(() => {
    if (!tree || editing) return;
    const all = flattenDecks(tree);
    if (all.length && !all.some((n) => n.deck.id === deck)) setDeck(all[0].deck.id);
  }, [tree, deck, editing]);

  if (editing && row === null) return <Navigate to="/cards" replace />;
  const noDecks = tree && tree.length === 0;
  const clozeN = kind === "cloze" ? clozeNumbers(front).length : 0;
  const problem = kind === "vocab" ? (!(fields.Word ?? "").trim() ? "單字還是空的" : null) : !front.trim() ? "正面還是空的" : kind === "cloze" && !clozeN ? "克漏字要有 {{c1::答案}}" : kind !== "cloze" && !back.trim() ? "背面還是空的" : null;
  const tagList = tags.split(/\s+/).filter(Boolean);

  const save = async () => {
    if (problem) return;
    setBusy(true);
    let target = deck;
    if (noDecks) target = await decks.create(newDeckName || "我的卡片", null);
    if (editing && row) {
      await cards.edit(row.card.id, front, back, tagList.length ? tagList : null, target, kind === "vocab" ? fields : undefined);
      setBusy(false);
      toast("已儲存");
      nav(`/cards/c/${row.card.id}`, { replace: true });
      return;
    }
    const id = await cards.create({ deck_id: target, kind, front, back, fields: kind === "vocab" ? fields : undefined, tags: tagList, origin: draft?.origin });
    prefs.setLastDeck(target);
    setBusy(false);
    if (!id) return;
    const count = kind === "reverse" ? 2 : kind === "cloze" ? clozeN : 1;
    toast(`已新增 ${count} 張卡片`, { action: { label: "看卡片", run: () => nav(`/cards/c/${id}`) } });
    if (draft?.origin) nav(-1);
    else {
      setFront("");
      setBack("");
      setFields({});
      setVer((v) => v + 1);
    }
  };

  return (
    <Page title={editing ? "編輯卡片" : "新增卡片"} back={editing && row ? `/cards/c/${row.card.id}` : true} width="wide">
      {!tree || (editing && !row) ? (
        <Card className="p-5"><Skeleton lines={6} /></Card>
      ) : (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid gap-4 sm:grid-cols-2">
            {editing ? (
              <div>
                <div className="mb-1.5 text-ui font-medium text-ink-strong">種類</div>
                <p className="text-ui text-ink">{KINDS.find((k) => k.value === kind)?.label}（建立後不能改種類）</p>
              </div>
            ) : (
              <Segmented label="種類" value={kind} onChange={setKind} options={KINDS} />
            )}
            {noDecks ? (
              <TextField label="新牌組名稱" hint="還沒有牌組，存檔時會建立這個牌組" value={newDeckName} onChange={(e) => setNewDeckName(e.target.value)} />
            ) : (
              <Select label="牌組" value={deck} onChange={setDeck} options={deckOptions(tree)} />
            )}
          </div>
          {kind === "cloze" && (
            <Notice icon="info">用 <code>{"{{c1::答案}}"}</code> 挖空、<code>{"{{c1::答案::提示}}"}</code> 加提示。同一個編號一起遮；不同編號各做一張卡{clozeN ? `（目前 ${clozeN} 張）` : ""}。公式裡也可以挖空，例如 <code>{"$E = {{c1::mc^2}}$"}</code>。</Notice>
          )}
          {kind === "vocab" ? (
            <VocabForm value={fields} onChange={setFields} ver={ver} />
          ) : (
          <>
          <FieldArea ver={ver} label={kind === "cloze" ? "內文" : "正面"} value={front} onChange={setFront} figs={figs} role="q" big />
          <FieldArea ver={ver} label={kind === "cloze" ? "補充（翻面後顯示，可留空）" : "背面"} value={back} onChange={setBack} figs={figs} role="sol" big />
          </>
          )}
          <TextField label="標籤" hint="用空白分隔，例如：GRE 易混淆" value={tags} onChange={(e) => setTags(e.target.value)} autoCapitalize="none" autoCorrect="off" />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {problem && <span className="mr-auto text-meta text-ink-muted">{problem}</span>}
            <Button variant="ghost" onClick={() => nav(-1)}>取消</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!!problem}>{editing ? "儲存" : "新增"}</Button>
          </div>
        </form>
      )}
    </Page>
  );
}

// ---------- 複習 ----------

const RATING_LABEL = { 1: "重來", 2: "困難", 3: "良好", 4: "簡單" } as const;

export function CardReviewPage() {
  const [params] = useSearchParams();
  const deck = params.get("deck");
  const nav = useNavigate();
  const toast = useToast();
  const autoplay = useCardAutoplay();
  const [queue, setQueue] = useState<string[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [preview, setPreview] = useState<Record<1 | 2 | 3 | 4, string> | null>(null);
  const [done, setDone] = useState({ n: 0, again: 0 });
  const shownAt = useRef(Date.now());
  const id = queue?.[idx];
  const reviewScope = useMemo(() => (id ? { base: `card:${id}` } : null), [id]);
  const live = useCard(id);
  // 換卡時 live 還是上一張的結果：只用這一張的
  const row = live === null ? null : live && live.card.id === id ? live : undefined;
  const figs = useCardFigs(row?.card.origin);
  const exit = deck ? `/cards/d/${deck}` : "/cards";

  // 開始時固定這一輪的卡（中途新到期的不插進來）
  useEffect(() => {
    void cardQueue(deck).then((q) => setQueue(q.items));
  }, [deck]);

  const faces = row ? cardFaces(row.card) : null;
  useEffect(() => {
    if (!id) return;
    setFlipped(false);
    setPreview(null);
    shownAt.current = Date.now();
    void ratingPreview(id).then(setPreview);
  }, [id, idx]);
  // 預先下載背面的聲音；正面有聲音就直接播
  useEffect(() => {
    if (!faces) return;
    preloadSounds(faces.back + faces.reveal);
    if (autoplay) {
      const s = soundsIn(faces.front)[0];
      if (s) void playSound(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.card.id]);

  const flip = () => {
    if (flipped || !faces) return;
    setFlipped(true);
    if (autoplay) {
      const s = soundsIn(faces.back)[0] ?? soundsIn(faces.reveal).find((x) => !soundsIn(faces.front).includes(x));
      if (s) void playSound(s);
    }
  };
  const rate = async (v: 1 | 2 | 3 | 4) => {
    if (!id || !flipped) return;
    await cards.rate(id, v, Date.now() - shownAt.current);
    setDone((d) => ({ n: d.n + 1, again: d.again + (v === 1 ? 1 : 0) }));
    // 「重來」的卡這一輪最後再出一次
    if (v === 1 && queue) setQueue([...queue, id]);
    setIdx((i) => i + 1);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]") || document.querySelector("[aria-modal='true'], [role='menu']")) return;
      if ((e.key === " " || e.key === "Enter") && !flipped) flip();
      else if (flipped && ["1", "2", "3", "4"].includes(e.key)) void rate(Number(e.key) as 1 | 2 | 3 | 4);
      else if (flipped && e.key === " ") void rate(3);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const total = queue?.length ?? 0;
  const menu: MenuItem[] = [
    { label: "編輯這張", icon: "edit", onSelect: () => id && nav(`/cards/c/${id}/edit`) },
    { label: "暫停這張（先不複習）", icon: "clock", onSelect: async () => { if (!id) return; await cards.suspend(id, true); toast("已暫停"); setIdx((i) => i + 1); } },
    { label: "翻面時自動播放聲音", icon: "repeat", checked: autoplay, onSelect: () => prefs.setCardAutoplay(!autoplay) },
  ];
  const top = (
    <header className="pt-safe sticky top-0 z-20 border-b border-line bg-card">
      <div className="px-safe mx-auto flex h-14 max-w-3xl items-center gap-1 lg:px-8">
        <IconButton label="離開" className="-ml-2" onClick={() => nav(exit)}><Icon name="arrowLeft" /></IconButton>
        <h1 className="shrink-0 text-ui font-semibold tabular-nums text-ink-strong">
          {Math.min(idx + 1, total)} <span className="font-normal text-ink-muted">/ {total}</span>
        </h1>
        <ProgressBar className="mx-3 min-w-0 flex-1" value={Math.min(idx, total)} max={Math.max(total, 1)} label="這一輪的進度" />
        <Menu label="更多動作" items={menu}><Icon name="dots" /></Menu>
      </div>
    </header>
  );

  if (!queue) return <Frame top={top}><Skeleton lines={6} className="mt-6" /></Frame>;
  if (idx >= queue.length)
    return (
      <Frame top={top}>
        <Card className="mt-6">
          <EmptyState icon="check" title={queue.length ? "這一輪複習完了" : "現在沒有要複習的卡片"} action={<LinkButton to={exit} variant="primary">回到{deck ? "牌組" : "卡片"}</LinkButton>}>
            {queue.length ? `複習了 ${done.n} 次，其中「重來」${done.again} 次。` : "到期的卡片和今天的新卡都做完了；超過每日上限的明天再出。"}
          </EmptyState>
        </Card>
      </Frame>
    );
  if (row === null && live === null) {
    // 卡片在這一輪中被刪了：跳過
    setTimeout(() => setIdx((i) => (queue[i] === id ? i + 1 : i)));
    return <Frame top={top}><Skeleton lines={6} className="mt-6" /></Frame>;
  }
  const ratings: Rating[] = ([1, 2, 3, 4] as const).map((v) => ({ value: v, label: RATING_LABEL[v], next: preview?.[v] ?? "" }));
  return (
    <Frame top={top}>
      {!faces ? (
        <Skeleton lines={6} className="mt-6" />
      ) : (
        <div className={cx("mt-2", row?.srs?.state === 0 && "")}>
          {row?.srs?.state === 0 && <div className="mb-2"><Badge tone="blue">新卡</Badge></div>}
          <InkScope value={reviewScope}>
          <ReviewCard
            body={row?.card.kind === "vocab" && row.card.fields ? <VocabCard key={row.card.id} fields={row.card.fields} tags={row.card.tags} side={flipped ? "back" : "front"} figs={figs} resetKey={row.card.id} ai={row.card.origin?.ai} /> : undefined}
            bigFront={row?.card.kind !== "cloze" && !faces.front.includes("\n") && cardPlain(faces.front).length <= 40} front={flipped ? faces.reveal : faces.front} back={faces.back} figs={figs} flipped={flipped} onFlip={flip} ratings={ratings} onRate={(v) => void rate(v)} />
          </InkScope>
          <p className="mt-3 hidden text-center text-meta text-ink-muted lg:block">空白鍵翻面；1 重來、2 困難、3 良好、4 簡單</p>
        </div>
      )}
    </Frame>
  );
}
