// 錯題本（規格書 §5.3）：flag.wrong = 1 的題目。可依科目篩、錯題重練、按「已掌握」移出。
// 離開規則：最後一次答錯之後，在不同日答對 2 次（猜對不算），或按「已掌握」。

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { qKey, sessions, useChapterNames, useFlagged, useRows, useTaxonomy, wrongBook, type SubjectId } from "@/data";
import { formatAgo } from "@/lib/format";
import { Icon } from "@/ui/icons";
import { useToast } from "@/ui/overlays";
import { Button, Card, EmptyState, IconButton, LinkButton, ListCard, ListRow, Segmented, Skeleton } from "@/ui/primitives";
import { Page } from "@/ui/shell";

const PAGE = 60;

export function WrongBookPage() {
  const nav = useNavigate();
  const toast = useToast();
  const tax = useTaxonomy().data;
  const list = useFlagged("wrong");
  const rows = useRows(list?.map((x) => x.id)).data;
  const chapters = useChapterNames();
  const [subject, setSubject] = useState<SubjectId | "all">("all");
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    if (!list || !tax) return undefined;
    if (subject === "all") return list;
    const re = new RegExp(tax.subjects.find((s) => s.id === subject)?.id_pattern ?? "^$");
    return list.filter((x) => re.test(x.id));
  }, [list, tax, subject]);

  async function redo() {
    if (!shown?.length || !tax) return;
    setBusy(true);
    const name = subject === "all" ? "全部" : (tax.subjects.find((s) => s.id === subject)?.name ?? subject);
    const s = await sessions.create({ mode: "wrong", filter: { label: `錯題重練・${name}` }, items: shown.map((x) => x.id) });
    nav(`/s/${s.id}`);
  }

  return (
    <Page title="錯題本" subtitle={shown ? `${shown.length} 題` : undefined} back="/more" width="narrow">
      {tax && (
        <Segmented label="科目" value={subject} onChange={(v) => { setSubject(v); setLimit(PAGE); }} options={[{ value: "all" as const, label: "全部" }, ...tax.subjects.map((s) => ({ value: s.id, label: s.name }))]} />
      )}
      {!shown ? (
        <Card className="p-4"><Skeleton lines={4} /></Card>
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState icon="check" title={list?.length ? "這一科沒有錯題" : "錯題本是空的"} action={<LinkButton to="/practice">去刷題</LinkButton>}>
            答錯的題目會自動出現在這裡；之後在不同日答對 2 次就會離開。
          </EmptyState>
        </Card>
      ) : (
        <>
          <Button variant="primary" block icon="repeat" loading={busy} onClick={redo}>
            錯題重練（{shown.length} 題）
          </Button>
          <ListCard label="錯題">
            {shown.slice(0, limit).map((x) => {
              const r = rows?.get(x.id);
              return (
                <li key={x.id} className="flex items-center">
                  <ListRow
                    className="min-w-0 flex-1"
                    to={`/q/${encodeURIComponent(x.id)}`}
                    title={<>{r?.label ?? "…"}<span className="mx-1 text-ink-muted">｜</span><span className="text-ink-muted">{x.id}</span></>}
                    meta={[r ? chapters.get(r.chap) : null, `答錯於 ${formatAgo(x.at)}`].filter(Boolean).join("・")}
                    leading={<Icon name="x" size={18} />}
                  />
                  <IconButton
                    label={`已掌握：把 ${x.id} 移出錯題本`}
                    className="mr-1"
                    onClick={() => {
                      void wrongBook.master(qKey(x.id));
                      toast("已移出錯題本", { action: { label: "復原", run: () => void wrongBook.unmaster(qKey(x.id)) } });
                    }}
                  >
                    <Icon name="check" size={20} />
                  </IconButton>
                </li>
              );
            })}
          </ListCard>
          {shown.length > limit && <Button block onClick={() => setLimit((n) => n + PAGE)}>再顯示 {PAGE} 題（還有 {shown.length - limit} 題）</Button>}
          <p className="flex items-start gap-1.5 text-meta text-ink-muted">
            <Icon name="info" size={14} className="mt-0.5 shrink-0" />
            離開錯題本：最後一次答錯之後，在不同的兩天都答對（「猜的」不算），或按右邊的 ✓「已掌握」。答錯時按「粗心錯，不追蹤」的題目不會進來。
          </p>
        </>
      )}
    </Page>
  );
}
