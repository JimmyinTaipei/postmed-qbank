// 資料庫（講義筆記，規格書 §9.4、第 4 階段）：目錄、閱讀頁（收合、螢光與註記、區塊筆記、目錄跳轉、匯出 .md、列印）、
// 區塊編輯（改內容、插入列點、刪除區塊；走修訂佇列，Mac 上 pmq patches pull 寫回 .md）、新增一份筆記（寫回 _收件匣/）。

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  applyKbPatches,
  draftName,
  isNewBid,
  isWritten,
  KB_BAD_NAME,
  KB_DELETABLE,
  KB_EDITABLE,
  kbPatches,
  notes,
  patches,
  patchNote,
  useKb,
  useKbCatalog,
  useKbDraft,
  useKbDrafts,
  useKbHighlights,
  useKbNotes,
  useKbPatches,
  type ContentPatch,
  type KbBlock,
  type KbCatalog,
  type KbDoc,
} from "@/data";
import { KbHighlightLayer } from "@/ui/content/Highlights";
import { Markdown } from "@/ui/content/Markdown";
import { Icon } from "@/ui/icons";
import { Dialog, Menu, Sheet, useToast, type MenuItem } from "@/ui/overlays";
import { Badge, Button, Card, EmptyState, IconButton, LinkButton, ListCard, ListRow, Notice, SectionTitle, Segmented, Select, Skeleton, TextField } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { KbBlocks, MarkdownEditor } from "@/ui/templates";
import { RichEditor, type EditResult } from "@/ui/RichEditorLazy";
import { InkScope } from "@/ui/ink/FigInk";
import { LostMarks } from "@/ui/ink/LostMarks";
import { createPortal } from "react-dom";
import { useKbPosition } from "./useKbPosition";
import { ContinueReading } from "./ContinueReading";

const SAVED = "已存成修訂；在 Mac 上執行 pmq patches pull 寫回筆記檔";
const CONFLICT = "這個區塊有衝突，請先到修訂佇列處理";

export const docUrl = (key: string, bid?: string) => `/kb/${key.split("/").map(encodeURIComponent).join("/")}${bid ? `#b-${bid}` : ""}`;

function countText(c: KbCatalog["subjects"][number]["groups"][number]["docs"][number]["counts"]): string {
  const parts = [];
  const h = (c.heading ?? 0) - 1;
  if (h > 0) parts.push(`${h} 個標題`);
  if (c.list_item) parts.push(`${c.list_item} 列點`);
  const t = (c.table ?? 0) + (c.table_group ?? 0);
  if (t) parts.push(`${t} 表`);
  if (c.figure) parts.push(`${c.figure} 圖`);
  return parts.join("・");
}

export function KbIndex() {
  const cat = useKbCatalog();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const subjects = cat.data?.subjects ?? [];
  const sid = params.get("s") && subjects.some((s) => s.id === params.get("s")) ? params.get("s")! : subjects[0]?.id;
  const subj = subjects.find((s) => s.id === sid);
  const drafts = useKbDrafts();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const myDrafts = (drafts ?? []).filter((p) => draftName(p).subject === sid);
  return (
    <Page
      title="資料庫"
      subtitle="講義筆記"
      width="wide"
      actions={<Button icon="plus" onClick={() => setCreating(true)} disabled={!cat.data}>新增筆記</Button>}
    >
      {cat.error ? (
        <EmptyState tone="error" title="讀不到筆記目錄" action={<Button onClick={cat.reload}>再試一次</Button>}>{cat.error.message}</EmptyState>
      ) : !cat.data ? (
        <Card className="p-4"><Skeleton lines={4} /></Card>
      ) : subjects.length === 0 ? (
        <Card><EmptyState icon="book" title="還沒有筆記">筆記在 Mac 上用 Typora 寫，pmq publish 之後會出現在這裡。</EmptyState></Card>
      ) : (
        <>
          <ContinueReading limit={5} />
          <Segmented label="科目" value={sid!} onChange={(v) => setParams({ s: v }, { replace: true })} options={subjects.map((s) => ({ value: s.id, label: s.name }))} />
          {subj && !subj.imported && <Notice>{subj.name}目前只有章節目錄，筆記內容之後再匯入。</Notice>}
          {myDrafts.length > 0 && (
            <section aria-labelledby="g-drafts">
              <SectionTitle id="g-drafts">網站上新增、還沒發佈的筆記</SectionTitle>
              <ListCard>
                {myDrafts.map((p) => (
                  <li key={p.id}>
                    <ListRow to={`/kb/new/${p.id}`} title={draftName(p).name} meta={`寫回到 Mac 的 _收件匣/・${p.device}`} leading={<Icon name="note" size={20} />} trailing={<DraftBadge p={p} />} />
                  </li>
                ))}
              </ListCard>
            </section>
          )}
          {subj?.groups.length === 0 && <Card><EmptyState icon="book" title={`${subj.name}還沒有章節`}>Mac 上 {subj.name} 的資料夾裡還沒有任何章節。</EmptyState></Card>}
          {subj?.groups.map((g) => (
            <section key={g.id} aria-labelledby={`g-${g.id}`}>
              <SectionTitle id={`g-${g.id}`}>{g.title}</SectionTitle>
              {!subj.imported ? (
                <ListCard>
                  <li><ListRow to={docUrl(`${subj.id}/${g.id}`)} title={g.title} meta="尚無內容" leading={<Icon name="book" size={20} />} /></li>
                </ListCard>
              ) : g.docs.length === 0 ? (
                <Card><p className="p-4 text-ui text-ink-muted">這個單元還沒有筆記。</p></Card>
              ) : (
                <ListCard>
                  {g.docs.map((d) => (
                    <li key={d.key}>
                      <ListRow to={docUrl(d.key)} title={d.title} meta={countText(d.counts) || undefined} leading={<Icon name="book" size={20} />} />
                    </li>
                  ))}
                </ListCard>
              )}
            </section>
          ))}
        </>
      )}
      {creating && cat.data && (
        <NewDocSheet
          catalog={cat.data}
          subject={sid}
          drafts={drafts ?? []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            toast("已新增筆記；寫好之後在 Mac 上執行 pmq patches pull 寫回");
            nav(`/kb/new/${id}`);
          }}
        />
      )}
    </Page>
  );
}

function DraftBadge({ p }: { p: ContentPatch }) {
  if (p.status === "conflict") return <Badge tone="incorrect" icon="alert">沒有寫回</Badge>;
  return isWritten(p) ? <Badge tone="blue">已寫回・待發佈</Badge> : <Badge tone="warning">待寫回</Badge>;
}

/** 新增一份筆記：選科目、取檔名。寫回時放 Mac 上那一科筆記資料夾的 _收件匣/（規格書 §14-2）。 */
function NewDocSheet({ catalog, subject, drafts, onClose, onCreated }: { catalog: KbCatalog; subject?: string; drafts: ContentPatch[]; onClose: () => void; onCreated: (id: string) => void }) {
  const choices = catalog.subjects.filter((s) => s.imported);
  const [subj, setSubj] = useState(choices.some((s) => s.id === subject) ? subject! : (choices[0]?.id ?? ""));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const n = name.trim();
  const stems = new Set(choices.find((s) => s.id === subj)?.groups.flatMap((g) => g.docs.map((d) => d.file.split("/").pop()!.replace(/\.md$/, ""))) ?? []);
  const error = !n
    ? undefined
    : KB_BAD_NAME.test(n) || n.startsWith(".")
      ? "檔名不能有 / \\ : * ? \" < > |，也不能以 . 開頭"
      : n.length > 80
        ? "最多 80 個字"
        : stems.has(n)
          ? "這一科已經有同名的筆記"
          : drafts.some((p) => p.target === `kbnew:${subj}/${n}`)
            ? "已經有一份同名、還沒寫回的新筆記"
            : undefined;
  const create = async () => {
    setBusy(true);
    const id = await kbPatches.create(subj, n, `# ${n}\n\n`);
    setBusy(false);
    if (id) onCreated(id);
  };
  return (
    <Sheet
      title="新增筆記"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!n || !!error || !subj} loading={busy} onClick={() => void create()}>新增</Button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        {choices.length === 0 ? (
          <Notice tone="warning" icon="alert">目前沒有已匯入筆記的科目。</Notice>
        ) : (
          <>
            <Select label="科目" value={subj} onChange={setSubj} options={choices.map((s) => ({ value: s.id, label: s.name }))} />
            <TextField label="檔名（也是筆記標題）" value={name} onChange={(e) => setName(e.target.value)} error={error} hint="寫回時存成 Mac 上這一科筆記資料夾裡的 _收件匣/檔名.md；之後可以在 Mac 上搬到正式的資料夾" autoFocus />
          </>
        )}
      </div>
    </Sheet>
  );
}

/** 網站上新增、還沒發佈的筆記：整份用 Markdown 寫。 */
export function KbDraftPage() {
  const { id } = useParams();
  const p = useKbDraft(id);
  const cat = useKbCatalog();
  const toast = useToast();
  const nav = useNavigate();
  const [text, setText] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (p === undefined) return <Page title="新增的筆記" back="/kb"><Card className="p-4"><Skeleton lines={6} /></Card></Page>;
  if (!p || p.field !== "create")
    return (
      <Page title="新增的筆記" back="/kb">
        <Card><EmptyState title="找不到這份新筆記" action={<Button onClick={() => nav("/kb")}>回資料庫</Button>}>可能已經放棄，或在另一台裝置上刪掉了。</EmptyState></Card>
      </Page>
    );
  const { subject, name } = draftName(p);
  const value = text ?? p.value;
  const written = isWritten(p);
  const live = cat.data?.subjects.find((s) => s.id === subject)?.groups.flatMap((g) => g.docs).find((d) => d.file.split("/").pop() === `${name}.md`);
  const n = patchNote(p);
  const closed = p.status !== "pending" && p.status !== "conflict";
  return (
    <Page
      title={name}
      subtitle={`${cat.data?.subjects.find((s) => s.id === subject)?.name ?? subject}・網站上新增的筆記`}
      back={`/kb?s=${subject}`}
      width="wide"
      actions={
        !closed && (
          <Button variant="primary" disabled={value === p.value} onClick={() => void kbPatches.saveDraft(p, value).then(() => toast(written ? "已存檔；下次 pmq patches pull 會更新 Mac 上的檔" : "已存檔"))}>
            儲存
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <DraftBadge p={p} />
        <span className="text-meta text-ink-muted">寫回到 Mac：{cat.data?.subjects.find((s) => s.id === subject)?.name ?? subject}筆記資料夾的 _收件匣/{name}.md</span>
      </div>
      {live && <Notice icon="check" action={<LinkButton to={docUrl(live.key)} variant="secondary">開啟</LinkButton>}>這份筆記已經發佈到資料庫。之後請在閱讀頁用「編輯區塊」修改。</Notice>}
      {p.status === "conflict" && <Notice tone="incorrect" icon="alert">沒有寫回：{n.reason ?? "請到修訂佇列看原因"}。可以改檔名重新新增，或放棄這份。</Notice>}
      {!written && p.status === "pending" && <Notice icon="info">寫好之後在 Mac 上執行 bin/pmq patches pull 寫回，再 bin/pmq publish，這份筆記就會出現在資料庫目錄裡。圖請寫回之後在 Mac 上用 Typora 加。</Notice>}
      <Card className="p-4">
        <MarkdownEditor value={value} onChange={setText} role="kb" label="筆記內容（Markdown）" />
      </Card>
      {!closed && (
        <div className="flex justify-end">
          {written ? (
            <span className="text-meta text-ink-muted">已寫回 Mac；要刪掉請在 Mac 上刪檔。</span>
          ) : (
            <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>放棄這份筆記</Button>
          )}
        </div>
      )}
      {confirm && (
        <Dialog
          title="放棄這份新筆記？"
          onClose={() => setConfirm(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>取消</Button>
              <Button variant="danger" onClick={() => void patches.discard(p.id).then(() => { toast("已放棄"); nav(`/kb?s=${subject}`); })}>放棄</Button>
            </>
          }
        >
          還沒寫回 Mac，放棄之後內容就不見了。
        </Dialog>
      )}
    </Page>
  );
}

/** 找某個區塊的祖先：展開它們、捲過去、閃一下。 */
function reveal(root: HTMLElement, bid: string): boolean {
  const el = root.querySelector<HTMLElement>(`#b-${CSS.escape(bid)}`);
  if (!el) return false;
  for (let p: HTMLElement | null = el; p && p !== root; p = p.parentElement) {
    if (p instanceof HTMLDetailsElement) p.open = true;
    if (p.hidden) p.hidden = false;
  }
  el.scrollIntoView({ block: "center" });
  el.classList.add("kb-flash");
  window.setTimeout(() => el.classList.remove("kb-flash"), 1600);
  return true;
}

function headings(blocks: KbBlock[], out: { b: KbBlock; level: number; text: string }[] = []) {
  for (const b of blocks) {
    if (b.type === "heading" && (b.level ?? 1) >= 2 && (b.level ?? 1) <= 4) out.push({ b, level: b.level!, text: b.md.replace(/^#+\s*/, "") });
    headings(b.children, out);
  }
  return out;
}

function findBlock(blocks: KbBlock[], bid: string): KbBlock | null {
  for (const b of blocks) {
    if (b.bid === bid) return b;
    const c = findBlock(b.children, bid);
    if (c) return c;
  }
  return null;
}

function allBids(blocks: KbBlock[], out = new Set<string>()) {
  for (const b of blocks) {
    out.add(b.bid);
    allBids(b.children, out);
  }
  return out;
}

function exportMd(doc: KbDoc) {
  const blob = new Blob([doc.src ?? ""], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${doc.doc}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function KbReaderPage() {
  const { subject, doc: name } = useParams();
  const key = subject && name ? `${subject}/${name}` : undefined;
  const kb = useKb(key);
  const cat = useKbCatalog();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [depth, setDepth] = useState<number>(3);
  const [printing, setPrinting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [noteMode, setNoteMode] = useState(false);
  const [toc, setToc] = useState(false);
  const [inline, setInline] = useState<InlineTarget | null>(null);
  const [deleting, setDeleting] = useState<KbBlock | null>(null);
  const [noteFor, setNoteFor] = useState<KbBlock | null>(null);
  const article = useRef<HTMLElement>(null);
  const hls = useKbHighlights(key);
  const blockNotes = useKbNotes(key);
  const rows = useKbPatches(key);
  // 套上還沒寫回（或已寫回、待發佈）的修訂
  const ov = useMemo(() => (kb.data && rows ? applyKbPatches(kb.data, rows) : null), [kb.data, rows]);
  const doc = ov?.doc ?? kb.data;
  const uiMarks = ov?.marks;
  // 筆記載入、套上修訂、換展開層數或列印 → 區塊重新畫過，螢光要重新包上去
  const version = useMemo(() => ({ depth, printing, doc }), [depth, printing, doc]);
  // 圖上標記（第 6B 階段）：掛在這份筆記；列印時不顯示
  const inkScope = useMemo(() => (key && !printing ? { base: `kb:${key}` } : null), [key, printing]);

  const save = async (fn: () => Promise<"ok" | "conflict" | void>) => {
    const r = await fn();
    toast(r === "conflict" ? CONFLICT : SAVED);
  };

  /** 這個列點下面已經有一個還沒寫回的新列點（同一個位置一次只能有一個，見 kb-core 的 applyKbPatches） */
  const pendingInsert = (b: KbBlock, child: boolean) =>
    !!key && !!rows?.some((p) => p.target === `kb:${key}#${b.bid}` && p.field === (child ? "insert_child" : "insert_after") && (p.status === "pending" || p.status === "conflict"));

  const startInline = (t: InlineTarget) => {
    if (t.insert && t.base && pendingInsert(t.base, t.insert === "child")) {
      toast(t.insert === "child" ? "這個列點底下已經有一個還沒寫回的新子列點；請改那一個" : "這個列點下面已經有一個還沒寫回的新列點；請改那一個");
      return;
    }
    setInline(t);
  };

  // 就地編輯存檔：有改才存成修訂；跳出「已存成修訂」與「復原」
  const saveInline = async (t: InlineTarget, r: EditResult) => {
    setInline(null);
    if (!key || !r.changed) return;
    if (t.patch) {
      const before = t.patch.value;
      await kbPatches.editInserted(t.patch, r.md);
      toast(SAVED, { action: { label: "復原", run: () => void kbPatches.editInserted({ ...t.patch!, value: r.md, updated_at: Date.now() }, before) } });
      return;
    }
    const base = t.base!;
    const res: ("ok" | "conflict")[] = [];
    const undo: (() => Promise<unknown>)[] = [];
    if (r.md !== t.b.md) {
      res.push(await kbPatches.edit(key, base, r.md));
      const before = t.b.md;
      undo.push(() => kbPatches.edit(key, base, before));
    }
    if (r.insert) {
      const child = r.insert.child;
      if (pendingInsert(base, child)) toast("這個列點下面已經有一個還沒寫回的新列點，這次新增的沒有存；請改原本那一個");
      else {
        res.push(await kbPatches.insert(key, base, child, r.insert.md));
        undo.push(() => kbPatches.insert(key, base, child, ""));
      }
    }
    if (res.includes("conflict")) toast(CONFLICT);
    else if (res.length) toast(SAVED, { action: { label: "復原", run: () => void Promise.all(undo.map((f) => f())).then(() => toast("已復原")) } });
  };

  // 選字框的「編輯」：直接就地編輯這個區塊（和區塊選單的「編輯內容」同一套規則）
  const editBlock = (bid: string) => {
    const b = doc && findBlock(doc.blocks, bid);
    if (!b) return;
    const item = menu(b)[0];
    if (item?.onSelect) item.onSelect();
    else toast(item?.disabledReason ?? "這個區塊不能在網站上編輯");
  };

  const menu = (b: KbBlock): MenuItem[] => {
    const ms = uiMarks?.get(b.bid) ?? [];
    const conflict = ms.some((m) => m.state === "conflict");
    if (isNewBid(b.bid)) {
      const p = ms[0]?.patch;
      if (!p) return [];
      return [
        { label: "編輯新列點", icon: "edit", onSelect: () => startInline({ b, patch: p }) },
        isWritten(p)
          ? { label: "取消新增", icon: "trash", disabledReason: "已寫回 Mac；要刪掉請在 Mac 上改" }
          : { label: "取消新增", icon: "trash", danger: true, onSelect: () => void patches.discard(p.id).then(() => toast("已取消新增")) },
      ];
    }
    const base = ov?.base.get(b.bid) ?? b;
    const del = ms.find((m) => m.kind === "delete" && m.state !== "conflict");
    const items: MenuItem[] = [
      KB_EDITABLE.has(b.type)
        ? { label: "編輯內容", icon: "edit", onSelect: () => (conflict ? toast(CONFLICT) : startInline({ b, base })) }
        : { label: "編輯內容", icon: "edit", disabledReason: "圖、程式碼、表格群組請在 Mac 上用 Typora 改" },
    ];
    if (b.type === "list_item") {
      items.push({ label: "在下面插入列點", icon: "plus", onSelect: () => (conflict ? toast(CONFLICT) : startInline({ b, base, insert: "after" })) });
      items.push({ label: "插入子列點", icon: "plus", onSelect: () => (conflict ? toast(CONFLICT) : startInline({ b, base, insert: "child" })) });
    }
    if (del) items.push({ label: "復原（不刪了）", icon: "undo", onSelect: () => void patches.discard(del.patch.id).then(() => toast("已復原")) });
    else if (KB_DELETABLE.has(b.type)) items.push({ label: "刪除這個區塊", icon: "trash", danger: true, onSelect: () => setDeleting(base) });
    else items.push({ label: "刪除這個區塊", icon: "trash", disabledReason: "標題不能在網站上刪（會連整節一起刪）" });
    if (conflict) items.push({ label: "到修訂佇列處理衝突", icon: "alert", onSelect: () => nav("/patches") });
    if (b.md.trim() && b.type !== "html" && b.type !== "code")
      items.push({ label: "做成卡片", icon: "list", onSelect: () => nav("/cards/new", { state: { kind: "cloze", front: b.md, back: "", origin: { from: "kb", doc: key, bid: b.bid } } }) });
    return items;
  };

  const subj = cat.data?.subjects.find((s) => s.id === subject);
  const group = subj?.groups.find((g) => g.docs.some((d) => d.key === key) || `${subj.id}/${g.id}` === key);

  // 從題目的「相關筆記」連過來（#b-<bid>）：展開並捲到那個區塊
  useEffect(() => {
    const m = /^#b-([0-9a-f]{12})$/.exec(loc.hash);
    if (!doc || !m || !article.current) return;
    const t = window.setTimeout(() => article.current && reveal(article.current, m[1]), 50);
    return () => window.clearTimeout(t);
  }, [doc, loc.hash]);

  // 記住上次讀到哪裡（第 4B 階段）
  const pos = useKbPosition({ docKey: key, doc, root: article, depth, setDepth, linked: /^#b-/.test(loc.hash), paused: printing });
  useEffect(() => {
    if (!pos.restored) return;
    const t = window.setTimeout(pos.dismiss, 8000);
    return () => window.clearTimeout(t);
  }, [pos.restored, pos.dismiss]);

  // 列印：全部展開後再叫出列印對話框
  useEffect(() => {
    if (!printing) return;
    const root = article.current;
    root?.querySelectorAll("details").forEach((d) => (d.open = true));
    const t = window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 300);
    return () => window.clearTimeout(t);
  }, [printing]);

  const orphanNotes = useMemo(() => {
    if (!doc || !blockNotes) return [];
    const ids = allBids(doc.blocks);
    return [...blockNotes.entries()].filter(([bid]) => !ids.has(bid));
  }, [doc, blockNotes]);

  if (kb.data === null) {
    // 不在內容包裡：可能是只有章節目錄的科目
    const empty = subj && !subj.imported && group;
    return (
      <Page title={group?.title ?? "筆記"} subtitle={subj?.name} back={subj ? `/kb?s=${subj.id}` : "/kb"}>
        <Card>
          {empty ? (
            <EmptyState icon="book" title="這一章還沒有筆記內容">{subj.name}目前只建了章節目錄。之後匯入筆記時，內容會出現在這裡。</EmptyState>
          ) : (
            <EmptyState title="找不到這份筆記" action={<Button onClick={() => nav("/kb")}>回資料庫</Button>}>可能已經在 Mac 上改名或搬走。回資料庫目錄重新找一次。</EmptyState>
          )}
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title={doc?.title ?? "筆記"}
      subtitle={[subj?.name, group?.title].filter(Boolean).join("・") || undefined}
      back={subject ? `/kb?s=${subject}` : "/kb"}
      width="wide"
      floatingActions
      actions={
        doc && (
          <>
            <IconButton label="目錄" onClick={() => setToc(true)}>
              <Icon name="list" />
            </IconButton>
            <IconButton label={noteMode ? "結束寫筆記" : "在區塊上寫筆記"} pressed={noteMode} onClick={() => { setNoteMode((v) => !v); setEditing(false); }}>
              <Icon name="note" />
            </IconButton>
            <Menu
              label="更多動作"
              items={[
                { label: "下載 .md", icon: "download", onSelect: () => exportMd(doc) },
                { label: "列印或存成 PDF", icon: "printer", onSelect: () => setPrinting(true) },
                { label: editing ? "結束編輯區塊" : "編輯區塊", icon: "edit", checked: editing, onSelect: () => { setEditing((v) => !v); setNoteMode(false); } },
              ]}
            >
              <Icon name="dots" />
            </Menu>
          </>
        )
      }
    >
      {kb.error ? (
        <EmptyState tone="error" title="讀不到這份筆記" action={<Button onClick={kb.reload}>再試一次</Button>}>{kb.error.message}</EmptyState>
      ) : !doc ? (
        <Card className="p-4"><Skeleton lines={10} /></Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <Segmented label="展開到第幾層" value={depth} onChange={setDepth} options={[{ value: 2, label: "大標" }, { value: 3, label: "小標" }, { value: 9, label: "全部" }]} />
            <p className="text-meta text-ink-muted">選字可以畫螢光、加註</p>
          </div>
          {editing && (
            <Notice icon="edit">
              編輯模式：點區塊右邊的筆，可以改內容、在列點下面插入新列點、刪除區塊（電腦上也可以在區塊上按兩下直接改；列點裡按 Enter 是在下面新增一個列點）。存檔後進修訂佇列，在 Mac 上執行 bin/pmq patches pull 寫回筆記檔。圖、程式碼請在 Mac 上用 Typora 改。
            </Notice>
          )}
          {ov && ov.unanchored.length > 0 && (
            <Notice tone="warning" icon="alert" action={<LinkButton to="/patches" variant="secondary">修訂佇列</LinkButton>}>
              有 {ov.unanchored.length} 筆修訂對不到區塊（Mac 上改過這份筆記）。到修訂佇列看內容，決定要不要放棄。
            </Notice>
          )}
          {noteMode && <Notice icon="note">筆記模式：點區塊右邊的對話框，在那個區塊下面寫自己的筆記（會同步，不會改到 Mac 上的筆記檔）。</Notice>}
          <KbHighlightLayer docKey={key!} root={article} list={hls} figs={doc.figs} version={version} onEdit={editBlock} />
          {orphanNotes.length > 0 && (
            <details className="rounded-btn border border-line bg-card print:hidden">
              <summary className="flex min-h-(--tap) items-center gap-2 px-3 text-meta text-ink-muted">
                <Icon name="alert" size={16} />
                失聯的筆記（{orphanNotes.length}）：原本的區塊在 Mac 上改過，找不到了
              </summary>
              <ul className="space-y-2 px-3 pb-3">
                {orphanNotes.map(([bid, n]) => (
                  <li key={bid} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 text-ui"><Markdown text={n.body_md} figs={doc.figs} role="kb" tight /></div>
                    <Button variant="ghost" icon="trash" onClick={() => void notes.remove(`kb:${key}#${bid}`)}>刪除</Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <InkScope value={inkScope}>
            <Card as="article" className="kb-article p-4 sm:p-6" aria-label={doc.title}>
              <section ref={article}>
                <KbBlocks
                  key={printing ? "print" : depth}
                  doc={doc}
                  openDepth={printing ? 9 : depth}
                  editing={editing}
                  editMenu={menu}
                  marks={uiMarks}
                  notes={blockNotes}
                  noteMode={noteMode}
                  onNote={setNoteFor}
                  onOpen={(b, at) => {
                    if (!KB_EDITABLE.has(b.type)) return;
                    const ms = uiMarks?.get(b.bid) ?? [];
                    if (ms.some((m) => m.state === "conflict")) return toast(CONFLICT);
                    if (isNewBid(b.bid)) {
                      if (ms[0]) startInline({ b, patch: ms[0].patch, at });
                    } else startInline({ b, base: ov?.base.get(b.bid) ?? b, at });
                  }}
                  inline={
                    inline && {
                      bid: inline.b.bid,
                      node: (
                        <RichEditor
                          key={inline.b.bid + (inline.insert ?? "")}
                          initial={inline.patch ? inline.patch.value : inline.b.md}
                          mode={inline.b.type === "heading" ? "heading" : inline.b.type === "list_item" ? "list_item" : "doc"}
                          ordered={inline.b.ordered}
                          num={inline.b.num}
                          startInsert={inline.insert}
                          allowInsert={!inline.patch}
                          at={inline.at}
                          figs={doc.figs}
                          role="kb"
                          label={inline.b.type === "heading" ? "編輯標題" : "編輯這個區塊"}
                          onNotice={(t) => toast(t)}
                          onCancel={() => setInline(null)}
                          onDone={(r) => void saveInline(inline, r)}
                        />
                      ),
                    }
                  }
                />
              </section>
            </Card>
          </InkScope>
          {key && <LostMarks base={`kb:${key}`} figs={doc.figs} />}
          <p className="text-meta text-ink-muted print:hidden">
            來源：{doc.file}
            {doc.refs.some((r) => !r.qid) && <> ・ <Badge>{doc.refs.filter((r) => !r.qid).length} 個出處對不到題目</Badge></>}
          </p>
        </>
      )}
      {toc && doc && (
        <Sheet title="目錄" onClose={() => setToc(false)}>
          <ul className="p-2">
            {headings(doc.blocks).map(({ b, level, text }) => (
              <li key={b.bid}>
                <button
                  type="button"
                  className="flex min-h-(--tap) w-full items-center rounded-btn px-2 text-left text-ui text-ink hover:bg-hover"
                  style={{ paddingLeft: `${(level - 2) * 1.25 + 0.5}rem` }}
                  onClick={() => {
                    setToc(false);
                    window.setTimeout(() => article.current && reveal(article.current, b.bid), 50);
                  }}
                >
                  <span className={level === 2 ? "font-semibold text-ink-strong" : undefined}><Markdown text={text} tight /></span>
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      {pos.restored &&
        createPortal(
          <div className="fixed inset-x-0 z-30 px-3 print:hidden lg:left-60" style={{ bottom: "calc(env(safe-area-inset-bottom) + 76px)" }}>
            <div role="status" className="anim-rise mx-auto flex max-w-xl items-center gap-2 rounded-card border border-line bg-card py-1 pr-1 pl-4 shadow-pop">
              <Icon name="book" size={18} className="shrink-0 text-ink-muted" />
              <p className="min-w-0 flex-1 truncate text-ui text-ink-strong">
                回到上次讀到的地方{pos.restored.heading ? `：${pos.restored.heading}` : ""}
              </p>
              <Button
                variant="ghost"
                onClick={() => {
                  window.scrollTo({ top: 0 });
                  pos.dismiss();
                }}
              >
                從頭讀
              </Button>
              <IconButton label="關閉提示" onClick={pos.dismiss}>
                <Icon name="x" size={18} />
              </IconButton>
            </div>
          </div>,
          document.body,
        )}
      {noteFor && key && <BlockNoteSheet docKey={key} b={noteFor} doc={doc!} initial={blockNotes?.get(noteFor.bid)?.body_md ?? ""} onClose={() => setNoteFor(null)} onSaved={(msg) => toast(msg)} />}
      {deleting && key && (
        <Dialog
          title="刪除這個區塊？"
          onClose={() => setDeleting(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>取消</Button>
              <Button variant="danger" onClick={() => { const b = deleting; setDeleting(null); void save(() => kbPatches.remove(key, b)); }}>刪除</Button>
            </>
          }
        >
          {deleting.children.length ? `連同底下 ${countAll(deleting.children)} 個子項一起刪。` : ""}先標成「刪除・待寫回」，在 Mac 上 pmq patches pull 時才真的從筆記檔刪掉；寫回之前都可以從 ✎ 選單復原。
        </Dialog>
      )}
    </Page>
  );
}

/** 就地編輯的區塊（第 3B 階段）。base＝內容包裡原本的區塊；patch＝網站上新增、還沒寫回的列點；insert＝一開始就在下面新增一個列點 */
type InlineTarget = { b: KbBlock; base?: KbBlock; patch?: ContentPatch; insert?: "after" | "child"; at?: { x: number; y: number } };

const countAll = (bs: KbBlock[]): number => bs.reduce((n, b) => n + 1 + countAll(b.children), 0);

function BlockNoteSheet({ docKey, b, doc, initial, onClose, onSaved }: { docKey: string; b: KbBlock; doc: KbDoc; initial: string; onClose: () => void; onSaved: (msg: string) => void }) {
  const [text, setText] = useState(initial);
  const target = `kb:${docKey}#${b.bid}`;
  return (
    <Sheet
      title="區塊筆記"
      size="wide"
      onClose={onClose}
      footer={
        <>
          {initial && <Button variant="danger" icon="trash" className="mr-auto" onClick={() => { void notes.remove(target); onSaved("已刪除筆記"); onClose(); }}>刪除</Button>}
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={text === initial} onClick={() => { void notes.save(target, text); onSaved(text.trim() ? "已儲存筆記" : "已刪除筆記"); onClose(); }}>儲存筆記</Button>
        </>
      }
    >
      <div className="space-y-4 p-4">
        <blockquote className="rounded-btn border border-line px-3 py-2 text-ui text-ink-muted">
          <Markdown text={b.type === "heading" ? b.md.replace(/^#+\s*/, "") : b.md} figs={doc.figs} role="kb" tight />
        </blockquote>
        <MarkdownEditor value={text} onChange={setText} figs={doc.figs} role="kb" label="我的筆記（Markdown，可寫公式與表格）" />
      </div>
    </Sheet>
  );
}
