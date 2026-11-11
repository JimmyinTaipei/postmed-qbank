// 之後各階段要用的頁面（第 3 階段修訂佇列、第 4 階段資料庫）。1A 只交版面與操作手感。
// 第 2 階段的複習、錯題本、題庫瀏覽、原卷、統計、考題分析已經接上功能，各自搬到 pages/ 底下的獨立檔。
// 接功能時：保留這裡的版面，把示範資料換成 @/data 的函式。

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { content, useAsync, useContentInfo, useKb, useTaxonomy, type KbBlock } from "@/data";
import { Icon } from "@/ui/icons";
import { useToast } from "@/ui/overlays";
import { Badge, Button, Card, EmptyState, IconButton, ListCard, ListRow, Notice, Segmented, Skeleton } from "@/ui/primitives";
import { Page, TemplateNotice } from "@/ui/shell";
import { EditPanel, HighlightPalette, KbBlocks } from "@/ui/templates";

const Title = ({ label, id }: { label: string; id: string }) => (
  <>
    {label}
    <span className="mx-1 text-ink-muted">｜</span>
    <span className="text-ink-muted">{id}</span>
  </>
);

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
