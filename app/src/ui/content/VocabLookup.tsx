// 查單字（第 8B-2 階段，規格書 §9.11「8B（3）」）：選字框的「查單字」、題目上虛線底線的字點了都開這張卡。
//
// 三種情況：
// - 找到單字卡（用原形比對：mitigated、mitigating 都找到 mitigate）：字、詞性、字義、喇叭、狀態；可展開完整背面。
//   「我不會這個字」把卡排到今天（暫停的恢復）；「開啟卡片」。
// - 沒有單字卡：「新增單字卡」在這張卡裡展開表單，Word＝原形、Sentence＝這個字所在的那一句、Source＝來源｜ID。
// - 比對不到但其實有卡（片語、不規則變化）：「連到現有的卡」→ 搜尋單字卡 → 選一張。
//
// 位置與螢光的小框相同（畫面下緣、不擋內文、不鎖捲動）。3B 的註記卡做好後改用註記卡（規格書 §9.10）。

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  boldIn,
  cards,
  cardsFor,
  content,
  lemmasInQuestion,
  lemmasOf,
  statusOf,
  STATUS_NAME,
  statusLine,
  splitAt,
  useAllVocabMarks,
  useVocabCards,
  useVocabIndex,
  vocabDeck,
  vocabMarks,
  vocabSounds,
  wordKey,
  WHERE_NAME,
  VOCAB_DECK,
  type Card,
  type CardFields,
  type VocabMark,
} from "@/data";
import { Icon } from "../icons";
import { useToast } from "../overlays";
import { Badge, Button, IconButton, TextField, cx } from "../primitives";
import { Markdown } from "./Markdown";
import { playSound } from "./sound";
import { VocabCard } from "./VocabCard";

/** target 的科目：q:ENG-000058/ques、g:ENG-…/stem、kb:ENG/Ch01#bid → ENG */
export function subjectOfTarget(target: string): string {
  const m = /^(?:q|g|kb):([A-Za-z]+)/.exec(target);
  return m ? m[1] : "";
}

/** 一次查詢：選到的字與位置（新查的）或一筆已經記下的 vocab_mark（點虛線底線） */
export interface LookupReq {
  target: string;
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  /** 這個字所在的那一句 */
  sentence: string;
  mark?: VocabMark;
}

/** 新卡的 Source（來源｜ID）與題目 ID */
async function sourceOf(target: string): Promise<{ text: string; qid?: string }> {
  try {
    if (target.startsWith("q:")) {
      const id = target.slice(2).split("/")[0];
      const row = await content.row(id);
      return { text: row ? `${row.label}｜${id}` : id, qid: id };
    }
    if (target.startsWith("g:")) {
      const gid = target.slice(2).split("/")[0];
      const rows = await content.index(subjectOfTarget(target));
      const r = rows.find((x) => x.gid === gid);
      return r ? { text: `${r.label}｜${r.id}`, qid: r.id } : { text: gid };
    }
    if (target.startsWith("kb:")) {
      const key = target.slice(3).split("#")[0];
      const d = await content.kb(key);
      return { text: `資料庫｜${d?.title ?? key}` };
    }
  } catch {
    /* 讀不到來源：留空讓使用者自己填 */
  }
  return { text: "" };
}

export function VocabLookup({ req, onClose }: { req: LookupReq; onClose: () => void }) {
  const subject = subjectOfTarget(req.target) || "ENG";
  const ix = useVocabIndex(subject);
  const v = useVocabCards(subject);
  const allMarks = useAllVocabMarks();
  const toast = useToast();
  const [markId, setMarkId] = useState<string | null>(req.mark?.id ?? null);
  const [mode, setMode] = useState<"view" | "new" | "link">("view");
  const [full, setFull] = useState(false);
  const [pickIdx, setPickIdx] = useState(0);

  const lemmas = useMemo(() => (ix === undefined ? null : lemmasOf(ix, req.quote)), [ix, req.quote]);
  const lemma = req.mark?.lemma ?? lemmas?.[0] ?? req.quote.toLowerCase();
  const links = useMemo(() => (allMarks ?? []).filter((m) => m.kind === "link" && m.card), [allMarks]);
  const mark = (allMarks ?? []).find((m) => m.id === markId);
  const found: Card[] = useMemo(() => {
    if (!v || !lemmas) return [];
    const own = mark?.card ? v.byId.get(mark.card) : undefined;
    const rest = cardsFor(v, [lemma, ...lemmas.filter((l) => l !== lemma)], links);
    return own ? [own, ...rest.filter((c) => c.id !== own.id)] : rest;
  }, [v, lemmas, lemma, links, mark?.card]);
  const card = found[Math.min(pickIdx, found.length - 1)];

  // 第一次打開（新查的字）：記一筆 vocab_mark，題目上就出現虛線底線
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current || req.mark || !v || !lemmas) return;
    recorded.current = true;
    void vocabMarks
      .lookup({ lemma, card: found[0]?.id ?? null, target: req.target, quote: req.quote, prefix: req.prefix, suffix: req.suffix, start: req.start, end: req.end })
      .then(setMarkId);
  }, [v, lemmas, lemma, found, req]);

  const askToday = async (c: Card) => {
    await cards.askToday([c.id]);
    if (markId && mark?.card !== c.id) await vocabMarks.setCard(markId, c.id);
    toast(`「${wordKey(c.fields?.Word) || lemma}」已排到今天的卡片複習`);
  };

  const removeMark = async () => {
    if (markId) await vocabMarks.remove(markId);
    onClose();
  };

  const loading = !v || lemmas === null;
  return createPortal(
    <div data-noswipe="always" className="fixed inset-x-0 z-30 px-3 print:hidden lg:left-60" style={{ bottom: "calc(env(safe-area-inset-bottom) + 76px)" }}>
      <section role="dialog" aria-label="查單字" className="anim-rise mx-auto max-h-[min(70vh,640px)] max-w-3xl overflow-y-auto rounded-card border border-line bg-card p-3 shadow-pop">
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-ui">
            <span className="font-semibold text-ink-strong">{req.quote}</span>
            {lemma !== req.quote.toLowerCase() && <span className="text-ink-muted">　原形 {lemma}</span>}
          </p>
          {markId && (
            <IconButton label="拿掉這個字的底線" onClick={() => void removeMark()}>
              <Icon name="trash" />
            </IconButton>
          )}
          <IconButton label="關閉" onClick={onClose}>
            <Icon name="x" />
          </IconButton>
        </div>

        {loading ? (
          <p className="py-3 text-ui text-ink-muted">查詢中…</p>
        ) : mode === "new" ? (
          <NewVocabForm
            lemma={lemma}
            sentence={req.sentence ? boldIn(req.sentence, req.quote) : ""}
            target={req.target}
            onCancel={() => setMode("view")}
            onSaved={async (id) => {
              if (markId) await vocabMarks.setCard(markId, id);
              toast(`已新增單字卡（${VOCAB_DECK.join(" › ")}）`);
              setMode("view");
              setPickIdx(0);
            }}
          />
        ) : mode === "link" ? (
          <LinkSearch
            initial={lemma}
            onCancel={() => setMode("view")}
            onPick={async (c) => {
              if (markId) await vocabMarks.link(markId, c.id);
              setMode("view");
              setPickIdx(0);
              toast(`已連到「${wordKey(c.fields?.Word)}」`);
            }}
          />
        ) : card ? (
          <div className="mt-2 space-y-3">
            {found.length > 1 && (
              <div role="tablist" aria-label="同一個字的卡片" className="flex flex-wrap gap-1">
                {found.map((c, i) => (
                  <button key={c.id} type="button" role="tab" aria-selected={c.id === card.id} onClick={() => setPickIdx(i)} className={cx("min-h-9 rounded-chip border px-2 text-meta", c.id === card.id ? "border-blue-accent bg-blue-light text-blue-ink" : "border-line text-ink-muted hover:bg-hover")}>
                    {wordKey(c.fields?.Word) || "（無字）"}・{(c.fields?.["Part of Speech"] ?? "").replace(/<[^>]+>/g, "").slice(0, 12) || "卡片"}
                  </button>
                ))}
              </div>
            )}
            {full ? (
              <VocabCard fields={card.fields ?? {}} tags={card.tags} side="back" />
            ) : (
              <CardSummary card={card} />
            )}
            <p className="text-meta text-ink-muted">
              狀態：{statusLine(v.states.get(card.id))}
              {mark?.kind === "link" && mark.card === card.id && "・手動連結"}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setFull((x) => !x)}>{full ? "收起" : "完整背面"}</Button>
              <Button variant="ghost" icon="search" onClick={() => setMode("link")}>連到別的卡</Button>
              <Link to={`/cards/c/${card.id}`} className="inline-flex min-h-(--tap) items-center px-3 text-ui text-blue-ink underline underline-offset-2">開啟卡片</Link>
              <Button variant="primary" icon="repeat" onClick={() => void askToday(card)}>我不會這個字</Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="text-ui text-ink-muted">還沒有「{lemma}」的單字卡。</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" icon="search" onClick={() => setMode("link")}>連到現有的卡</Button>
              <Button variant="primary" icon="plus" onClick={() => setMode("new")}>新增單字卡</Button>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}

/** 註記卡上的精簡版：字、詞性、喇叭、字義 */
function CardSummary({ card }: { card: Card }) {
  const f = card.fields ?? {};
  const sounds = vocabSounds(f);
  const pos = (f["Part of Speech"] ?? "").trim();
  const meaning = (f["Meaning and Definition"] ?? "").trim();
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Markdown text={f.Word ?? card.front_md} tight className="text-title font-semibold text-ink-strong" />
        {pos && <Markdown text={pos} tight className="text-meta text-ink-muted" />}
        {sounds.length > 0 && (
          <IconButton label="播放發音" className="text-blue-ink" onClick={() => void playSound(sounds[0])}>
            <Icon name="volume" />
          </IconButton>
        )}
      </div>
      {meaning ? <Markdown text={meaning} role="sol" className="vocab-meaning mt-1" /> : <p className="mt-1 text-ui text-ink-muted">（這張卡沒有填字義）</p>}
    </div>
  );
}

function NewVocabForm({ lemma, sentence, target, onCancel, onSaved }: { lemma: string; sentence: string; target: string; onCancel: () => void; onSaved: (id: string) => void | Promise<void> }) {
  const [f, setF] = useState<CardFields>({ Word: lemma, Sentence: sentence });
  const [qid, setQid] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void sourceOf(target).then((s) => {
      setQid(s.qid);
      setF((x) => (x.Source ? x : { ...x, Source: s.text }));
    });
  }, [target]);
  const set = (k: keyof CardFields) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!(f.Word ?? "").trim()) return;
    setBusy(true);
    try {
      const deck = await vocabDeck();
      const id = await cards.create({ deck_id: deck, kind: "vocab", front: "", back: "", fields: f, tags: [], origin: qid ? { from: "q", id: qid } : { from: "site" } });
      if (id) await onSaved(id);
    } finally {
      setBusy(false);
    }
  };
  const area = "block w-full resize-y rounded-btn border border-line-strong bg-card px-3 py-2 text-base text-ink-strong placeholder:text-ink-muted focus:border-blue-accent focus:outline-none";
  return (
    <form
      className="mt-2 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="單字（Word）" value={f.Word ?? ""} onChange={set("Word")} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <TextField label="詞性（Part of Speech）" value={f["Part of Speech"] ?? ""} onChange={set("Part of Speech")} placeholder="v.、n.、adj.…" autoCapitalize="off" />
      </div>
      <label className="block">
        <span className="mb-1.5 block text-ui font-medium text-ink-strong">字義（Meaning and Definition）</span>
        <textarea rows={2} value={f["Meaning and Definition"] ?? ""} onChange={set("Meaning and Definition")} placeholder="自己填，例如：減輕、緩和" className={area} autoFocus />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-ui font-medium text-ink-strong">例句（Sentence）</span>
        <textarea rows={3} value={f.Sentence ?? ""} onChange={set("Sentence")} className={area} />
      </label>
      <TextField label="出處（Source）" value={f.Source ?? ""} onChange={set("Source")} />
      <p className="text-meta text-ink-muted">存到牌組 {VOCAB_DECK.join(" › ")}；其他欄位之後在卡片頁編輯。</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>取消</Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!(f.Word ?? "").trim()}>存成單字卡</Button>
      </div>
    </form>
  );
}

function LinkSearch({ initial, onCancel, onPick }: { initial: string; onCancel: () => void; onPick: (c: Card) => void }) {
  const v = useVocabCards();
  const [q, setQ] = useState(initial);
  const hits = useMemo(() => {
    if (!v) return [];
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const exact: Card[] = [];
    const starts: Card[] = [];
    const inner: Card[] = [];
    for (const c of v.byId.values()) {
      const w = wordKey(c.fields?.Word ?? c.front_md);
      if (w === s) exact.push(c);
      else if (w.startsWith(s)) starts.push(c);
      else if (w.includes(s) || (s.length >= 3 && s.startsWith(w) && w.length >= 3)) inner.push(c);
      if (exact.length + starts.length > 40) break;
    }
    return [...exact, ...starts, ...inner].slice(0, 20);
  }, [v, q]);
  return (
    <div className="mt-2 space-y-2">
      <TextField label="搜尋單字卡" value={q} onChange={(e) => setQ(e.target.value)} leading={<Icon name="search" size={18} />} autoFocus autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="搜尋結果">
        {hits.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onPick(c)} className="flex min-h-(--tap) w-full items-baseline gap-2 rounded-btn px-2 text-left hover:bg-hover">
              <span className="font-medium text-ink-strong">{wordKey(c.fields?.Word ?? c.front_md)}</span>
              <span className="min-w-0 flex-1 truncate text-meta text-ink-muted">{(c.fields?.["Meaning and Definition"] ?? "").replace(/<[^>]+>/g, " ")}</span>
            </button>
          </li>
        ))}
        {q.trim() && v && !hits.length && <li className="px-2 py-2 text-meta text-ink-muted">找不到。</li>}
      </ul>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onCancel}>取消</Button>
      </div>
    </div>
  );
}

/** 單字卡背面的「出現在」：這個字在哪些考卷的哪幾題出現過（點了開那一題），當過幾次選項、答案。 */
export function VocabOccurrences({ word, subject = "ENG" }: { word: string | undefined; subject?: string }) {
  const ix = useVocabIndex(subject);
  const [all, setAll] = useState(false);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const w = wordKey(word);
  const lemma = ix ? (ix.lemmas[w] ? w : lemmasOf(ix, w).find((l) => ix.lemmas[l])) : undefined;
  const row = lemma && ix ? ix.lemmas[lemma] : undefined;
  useEffect(() => {
    if (!row) return;
    let alive = true;
    void content.index(subject).then((rows) => {
      if (alive) setLabels(new Map(rows.map((r) => [r.id, r.label])));
    }).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [row, subject]);
  if (!ix || !row) return null;
  const [papers, qs, opts, ans, at] = row;
  // 同一題的幾個位置併成一列
  const byQ = new Map<string, string[]>();
  for (const a of at) {
    const [qid, c] = splitAt(a);
    byQ.set(qid, [...(byQ.get(qid) ?? []), WHERE_NAME[c] ?? c]);
  }
  const list = [...byQ.entries()];
  const shown = all ? list : list.slice(0, 8);
  return (
    <section className="mt-4 rounded-btn border border-line px-4 py-3" aria-label="出現在">
      <h3 className="mb-1 flex flex-wrap items-center gap-2 text-meta font-semibold text-ink-muted">
        出現在
        <Badge tone="blue">{papers} 份考卷・{qs} 題</Badge>
        {opts > 0 && <Badge>當過 {opts} 次選項、{ans} 次答案</Badge>}
        {lemma !== w && <span className="font-normal">（原形 {lemma}）</span>}
      </h3>
      <ul className="space-y-0.5 text-ui">
        {shown.map(([qid, where]) => (
          <li key={qid}>
            <Link to={`/q/${qid}`} className="text-blue-ink underline-offset-2 hover:underline">{labels.get(qid) ?? qid}</Link>
            <span className="text-meta text-ink-muted">　{[...new Set(where)].join("、")}</span>
          </li>
        ))}
      </ul>
      {list.length > 8 && (
        <button type="button" className="mt-1 min-h-9 text-meta text-blue-ink underline underline-offset-2" onClick={() => setAll((x) => !x)}>
          {all ? "收起" : `全部 ${list.length} 題`}
        </button>
      )}
    </section>
  );
}

/**
 * 題目作答後的「這一題的單字」：這題出現、而且有單字卡的字，依「還沒背、常錯、查過」排在前面。
 * 預設勾選還沒背、常錯、在這題查過的；「把勾選的排到今天」。
 */
export function QuestionWords({ qid, subject }: { qid: string; subject: string }) {
  const ix = useVocabIndex(subject);
  const v = useVocabCards(subject);
  const marks = useAllVocabMarks();
  const toast = useToast();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    if (!ix || !v) return null;
    const looked = new Set((marks ?? []).filter((m) => m.target.startsWith(`q:${qid}/`)).map((m) => m.lemma));
    const out: { lemma: string; card: Card; rank: number; looked: boolean }[] = [];
    for (const lm of lemmasInQuestion(ix, [qid])) {
      const c = cardsFor(v, [lm])[0];
      if (!c) continue;
      const st = statusOf(v.states.get(c.id));
      const rank = st === "lapsed" ? 0 : looked.has(lm) ? 1 : st === "new" ? 2 : st === "learning" || st === "suspended" ? 3 : st === "review" ? 4 : 5;
      out.push({ lemma: lm, card: c, rank, looked: looked.has(lm) });
    }
    return out.sort((a, b) => a.rank - b.rank || a.lemma.localeCompare(b.lemma));
  }, [ix, v, marks, qid]);
  const sel = picked ?? new Set((rows ?? []).filter((r) => r.rank <= 2).map((r) => r.card.id));
  if (!rows?.length) return null;
  const shown = all ? rows : rows.slice(0, 10);
  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPicked(n);
  };
  return (
    <section className="border-t border-line pt-4" aria-label="這一題的單字">
      <h3 className="mb-2 flex items-center gap-1.5 text-ui font-semibold text-ink-muted">
        <Icon name="book" size={16} />
        這一題的單字（{rows.length}）
      </h3>
      <ul className="space-y-0.5">
        {shown.map((r) => {
          const st = statusOf(v!.states.get(r.card.id));
          return (
            <li key={r.card.id}>
              <label className="flex min-h-(--tap) items-center gap-2 rounded-btn px-2 hover:bg-hover">
                <input type="checkbox" className="size-5 shrink-0 accent-(--blue-deep)" checked={sel.has(r.card.id)} onChange={() => toggle(r.card.id)} />
                <Link to={`/cards/c/${r.card.id}`} className="shrink-0 font-medium text-blue-deep" onClick={(e) => e.stopPropagation()}>{wordKey(r.card.fields?.Word) || r.lemma}</Link>
                <span className="min-w-0 flex-1 truncate text-meta text-ink-muted">{(r.card.fields?.["Meaning and Definition"] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")}</span>
                <Badge tone={st === "lapsed" ? "incorrect" : st === "new" ? "warning" : st === "known" ? "correct" : "neutral"}>{STATUS_NAME[st]}</Badge>
                {r.looked && <Badge tone="blue">查過</Badge>}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {rows.length > 10 ? (
          <button type="button" className="min-h-9 text-meta text-blue-ink underline underline-offset-2" onClick={() => setAll((x) => !x)}>{all ? "收起" : `全部 ${rows.length} 個`}</button>
        ) : <span />}
        <Button
          variant="secondary"
          icon="repeat"
          disabled={!sel.size}
          onClick={async () => {
            const n = await cards.askToday([...sel]);
            toast(`${n} 張單字卡已排到今天`);
          }}
        >
          把勾選的排到今天（{sel.size}）
        </Button>
      </div>
    </section>
  );
}
