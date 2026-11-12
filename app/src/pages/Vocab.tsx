// /vocab 常考單字（第 8B-2 階段，規格書 §9.11「8B（4）」）。
//
// 一列一個原形：出現在幾份考卷／幾題、當過選項與答案的次數、我的狀態、查過幾次。預設照常考度排。
// 「常考而我不會」＝出現在 2 份以上考卷，而且（沒有卡片、還沒背、答錯過、或查過）。
// 勾選多列後：有卡的「排到今天」、沒卡的「建立卡片」（Word＝原形、Sentence＝考古題裡的原句、Source＝來源｜ID）。
// 資料全在裝置上算（索引是內容包、卡片與作答紀錄在 IndexedDB），不需要網路。

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  boldIn,
  cards,
  content,
  isWeakCommon,
  sentenceAt,
  splitAt,
  STATUS_NAME,
  useAllAttempts,
  useAllVocabMarks,
  useVocabCards,
  useVocabIndex,
  useVocabSubjects,
  useTaxonomy,
  vocabDeck,
  vocabRows,
  VOCAB_DECK,
  wordKey,
  type VocabIndex,
  type VocabRow,
} from "@/data";
import { Icon } from "@/ui/icons";
import { useToast } from "@/ui/overlays";
import { Badge, Button, EmptyState, Segmented, Select, Skeleton, TextField, cx } from "@/ui/primitives";
import { Page } from "@/ui/shell";
import { VocabOccurrences } from "@/ui/content/VocabLookup";

type Filter = "all" | "weak";
type Sort = "score" | "papers" | "alpha" | "looked";
const PAGE = 100;

const TONE: Record<VocabRow["status"], "neutral" | "blue" | "correct" | "incorrect" | "warning"> = {
  none: "neutral",
  new: "warning",
  learning: "blue",
  review: "blue",
  known: "correct",
  lapsed: "incorrect",
  suspended: "neutral",
};

/** 去掉 HTML、Markdown、克漏字空格的標記，留下看得到的字 */
const plain = (md: string) => md.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, " ").replace(/[*_`]/g, "").replace(/’/g, "'");

/** 原形在考古題裡的第一個原句（建立卡片用） */
async function exampleOf(ix: VocabIndex, lemma: string): Promise<{ sentence: string; source: string; qid: string } | null> {
  const at = ix.lemmas[lemma]?.[4] ?? [];
  const order = [...at].sort((a, b) => "sgoa".indexOf(a.slice(-1)) - "sgoa".indexOf(b.slice(-1)));
  for (const a of order.slice(0, 6)) {
    const [qid, where] = splitAt(a);
    const q = await content.question(qid).catch(() => null);
    if (!q || q === "missing") continue;
    const text = plain(where === "g" ? (q.group?.stem ?? "") : q.ques);
    for (const m of text.matchAll(/[A-Za-z]+(?:'[A-Za-z]+)?/g)) {
      const w = m[0].toLowerCase();
      if (w === lemma || ix.forms[w]?.[0] === lemma) {
        const s = sentenceAt(text, m.index, m.index + m[0].length);
        return { sentence: boldIn(s, m[0]), source: `${q.label}｜${q.id}`, qid };
      }
    }
  }
  return null;
}

export function VocabPage() {
  const subs = useVocabSubjects();
  const tax = useTaxonomy().data;
  const [subject, setSubject] = useState<string | null>(null);
  const subj = subject ?? subs?.[0] ?? "ENG";
  const ix = useVocabIndex(subj);
  const v = useVocabCards(subj);
  const marks = useAllVocabMarks();
  const atts = useAllAttempts();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("weak");
  const [sort, setSort] = useState<Sort>("score");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wrongQs = useMemo(() => new Set((atts ?? []).filter((a) => !a.correct && a.item.startsWith("q:")).map((a) => a.item.slice(2))), [atts]);
  const all = useMemo(() => (ix && v && marks ? vocabRows(ix, v, marks, wrongQs) : null), [ix, v, marks, wrongQs]);
  const rows = useMemo(() => {
    if (!all) return null;
    const q = query.trim().toLowerCase();
    let r = all.filter((x) => (filter === "all" || isWeakCommon(x)) && (!q || x.lemma.includes(q)));
    if (sort === "papers") r = [...r].sort((a, b) => b.papers - a.papers || b.score - a.score);
    else if (sort === "alpha") r = [...r].sort((a, b) => a.lemma.localeCompare(b.lemma));
    else if (sort === "looked") r = [...r].sort((a, b) => b.looked - a.looked || b.score - a.score);
    return r;
  }, [all, filter, sort, query]);

  const selected = (rows ?? []).filter((r) => sel.has(r.lemma));
  const withCard = selected.filter((r) => r.card);
  const noCard = selected.filter((r) => !r.card);
  const toggle = (lemma: string) => {
    const n = new Set(sel);
    if (n.has(lemma)) n.delete(lemma);
    else n.add(lemma);
    setSel(n);
  };

  const askToday = async () => {
    const n = await cards.askToday(withCard.map((r) => r.card!.id));
    toast(`${n} 張單字卡已排到今天`);
    setSel(new Set());
  };
  const create = async () => {
    if (!ix) return;
    setBusy(true);
    try {
      const deck = await vocabDeck();
      let n = 0;
      for (const r of noCard) {
        const ex = await exampleOf(ix, r.lemma);
        const id = await cards.create({
          deck_id: deck,
          kind: "vocab",
          front: "",
          back: "",
          fields: { Word: r.lemma, Sentence: ex?.sentence ?? "", Source: ex?.source ?? "" },
          tags: [],
          origin: ex ? { from: "q", id: ex.qid } : { from: "site" },
        });
        if (id) n++;
      }
      toast(`已建立 ${n} 張單字卡（${VOCAB_DECK.join(" › ")}；字義還沒填）`);
      setSel(new Set());
    } finally {
      setBusy(false);
    }
  };

  const subjectName = (s: string) => tax?.subjects.find((x) => x.id === s)?.name ?? s;
  const papers = ix ? Object.keys(ix.papers).length : 0;

  return (
    <Page title="常考單字" subtitle={ix ? `${subjectName(subj)}考古題 ${papers} 份考卷・${Object.keys(ix.lemmas).length.toLocaleString()} 個字` : undefined} back="/more" width="wide">
      {subs && subs.length === 0 ? (
        <EmptyState icon="book" title="還沒有單字索引">在 Mac 上發佈（pmq publish）之後，這裡會列出考古題裡的單字。</EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            {subs && subs.length > 1 && (
              <Select label="科目" value={subj} onChange={(s) => { setSubject(s); setSel(new Set()); }} options={subs.map((s) => ({ value: s, label: subjectName(s) }))} />
            )}
            <Segmented<Filter> label="篩選" value={filter} onChange={(f) => { setFilter(f); setLimit(PAGE); }} options={[{ value: "weak", label: "常考而我不會" }, { value: "all", label: "全部" }]} />
            <Select label="排序" value={sort} onChange={(s) => setSort(s as Sort)} options={[{ value: "score", label: "常考度" }, { value: "papers", label: "考卷數" }, { value: "looked", label: "查過次數" }, { value: "alpha", label: "字母" }]} />
            <TextField label="找單字" hideLabel placeholder="找單字…" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} leading={<Icon name="search" size={18} />} className="min-w-48 flex-1" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </div>
          {filter === "weak" && (
            <p className="text-meta text-ink-muted">常考而我不會：出現在 2 份以上考卷，而且沒有卡片、還沒背、答錯過或查過。常考度＝考卷數×3＋當答案×4＋當選項×2＋題數。</p>
          )}

          {!rows ? (
            <Skeleton lines={8} />
          ) : !rows.length ? (
            <EmptyState icon="check" title="沒有符合的單字" />
          ) : (
            <>
              <div className="overflow-x-auto rounded-card border border-line bg-card">
                <table className="w-full min-w-[640px] text-ui">
                  <thead>
                    <tr className="border-b border-line text-left text-meta text-ink-muted">
                      <th className="w-10 px-2 py-2"><span className="sr-only">勾選</span></th>
                      <th className="px-2 py-2">單字</th>
                      <th className="px-2 py-2 text-right">考卷</th>
                      <th className="px-2 py-2 text-right">題數</th>
                      <th className="px-2 py-2 text-right">選項／答案</th>
                      <th className="px-2 py-2">我的狀態</th>
                      <th className="px-2 py-2 text-right">查過</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, limit).map((r) => (
                      <Row key={r.lemma} r={r} checked={sel.has(r.lemma)} onToggle={() => toggle(r.lemma)} open={open === r.lemma} onOpen={() => setOpen(open === r.lemma ? null : r.lemma)} subject={subj} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-meta text-ink-muted">顯示 {Math.min(limit, rows.length).toLocaleString()} / {rows.length.toLocaleString()} 個</span>
                {rows.length > limit && <Button variant="ghost" onClick={() => setLimit((x) => x + PAGE * 3)}>顯示更多</Button>}
              </div>
            </>
          )}
        </div>
      )}
      {selected.length > 0 && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+84px)] z-20 mt-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-card p-3 shadow-pop lg:bottom-4">
          <span className="mr-auto text-ui">已勾選 {selected.length} 個</span>
          <Button variant="ghost" onClick={() => setSel(new Set())}>取消勾選</Button>
          <Button variant="secondary" icon="repeat" disabled={!withCard.length} onClick={() => void askToday()}>排到今天（{withCard.length}）</Button>
          <Button variant="primary" icon="plus" disabled={!noCard.length} loading={busy} onClick={() => void create()}>建立卡片（{noCard.length}）</Button>
        </div>
      )}
    </Page>
  );
}

function Row({ r, checked, onToggle, open, onOpen, subject }: { r: VocabRow; checked: boolean; onToggle: () => void; open: boolean; onOpen: () => void; subject: string }) {
  return (
    <>
      <tr className={cx("border-b border-line last:border-b-0", checked && "bg-blue-light/40")}>
        <td className="px-2">
          <input type="checkbox" aria-label={`勾選 ${r.lemma}`} className="size-5 accent-(--blue-deep)" checked={checked} onChange={onToggle} />
        </td>
        <td className="px-2 py-1">
          <button type="button" aria-expanded={open} onClick={onOpen} className="flex min-h-(--tap) items-center gap-1 text-left font-medium text-blue-deep">
            <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
            {r.lemma}
          </button>
        </td>
        <td className="px-2 text-right tabular-nums">{r.papers}</td>
        <td className="px-2 text-right tabular-nums">{r.questions}</td>
        <td className="px-2 text-right tabular-nums">{r.options || r.answers ? `${r.options}／${r.answers}` : "—"}</td>
        <td className="px-2">
          <span className="flex flex-wrap gap-1">
            <Badge tone={TONE[r.status]}>{STATUS_NAME[r.status]}</Badge>
            {r.wrong && <Badge tone="incorrect">答錯過</Badge>}
          </span>
        </td>
        <td className="px-2 text-right tabular-nums">{r.looked || ""}</td>
      </tr>
      {open && (
        <tr className="border-b border-line bg-page">
          <td />
          <td colSpan={6} className="px-2 pb-3">
            {r.card ? (
              <p className="pt-2 text-ui">
                <Link to={`/cards/c/${r.card.id}`} className="text-blue-deep">{wordKey(r.card.fields?.Word) || r.lemma}</Link>
                <span className="text-ink-muted">　{(r.card.fields?.["Meaning and Definition"] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 80)}</span>
              </p>
            ) : (
              <p className="pt-2 text-ui text-ink-muted">還沒有卡片。</p>
            )}
            <VocabOccurrences word={r.lemma} subject={subject} />
          </td>
        </tr>
      )}
    </>
  );
}
