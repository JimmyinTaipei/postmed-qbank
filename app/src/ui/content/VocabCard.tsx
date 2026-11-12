// 單字卡樣板（第 8B-1 階段，規格書 §9.11）：照使用者 Anki「0_後醫單字基本型」的版面與行為，
// 顏色與字體用網站自己的（不搬背景圖、漸層、陰影；§13.2）。
//
// 正面：單字（大字）、喇叭（有聲音才有）、「提示／例句」（有例句才有；例句裡的中文先遮住，點那一段才顯示）、「標籤」（有標籤才有）。
// 背面：單字＋詞性／分隔線／字義（大字、深藍）／例句／衍生字／辨析（左邊紅線）／同義字／反義字／字根字首／圖／出處／標籤。
// 空的欄位整塊不顯示。

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { maskChinese, stripSounds, VOCAB_LABEL, vocabSounds, type CardFields, type Fig, type VocabField } from "@/data";
import { Icon } from "../icons";
import { Badge, Button, IconButton, cx } from "../primitives";
import { Markdown } from "./Markdown";
import { playSound } from "./sound";
import { VocabOccurrences } from "./VocabLookup";

interface Props {
  fields: CardFields;
  tags?: string[] | null;
  side: "front" | "back";
  figs?: Fig[];
  /** 換卡時把「提示」「標籤」收回去 */
  resetKey?: string;
  /** AI 產生、還沒改過的欄位（card.origin.ai）：背面在那一格標「AI」 */
  ai?: readonly string[] | null;
}

/** AI 產生的欄位標示（第 8B-3 階段）。改過那一格就不再標。 */
function AiMark() {
  return (
    <Badge tone="warning" className="ml-1.5 px-1.5 py-0 align-middle text-[11px]">
      <span title="AI 產生，還沒改過">AI</span>
      <span className="sr-only">產生，還沒改過</span>
    </Badge>
  );
}

const SECTIONS: VocabField[] = ["Sentence", "Derivative", "Memo & Confusable", "Synonyms", "Antonyms", "Prefix & Roots"];

function Speaker({ sounds }: { sounds: string[] }) {
  if (!sounds.length) return null;
  return (
    <IconButton label="播放發音" className="text-blue-ink" onClick={() => void playSound(sounds[0])}>
      <Icon name="volume" />
    </IconButton>
  );
}

function Tags({ tags }: { tags: string[] }) {
  return (
    <ul className="flex flex-wrap justify-center gap-1.5" aria-label="標籤">
      {tags.map((t) => (
        <li key={t}>
          <Badge className="max-w-full whitespace-normal [overflow-wrap:anywhere]">{t}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** 例句：中文遮住，點那一段才顯示；「顯示全部中文」給鍵盤與一次看完用。 */
function Hint({ md, figs }: { md: string; figs?: Fig[] }) {
  const [all, setAll] = useState(false);
  const masked = useMemo(() => maskChinese(md), [md]);
  const hasZh = masked !== md;
  const onClick = (e: MouseEvent) => {
    const s = (e.target as HTMLElement).closest?.(".spoiler");
    if (s) s.classList.toggle("revealed");
  };
  return (
    <div className="vocab-hint mt-3 rounded-btn border-l-4 border-warning bg-warning-bg px-4 py-3 text-left">
      {/* 點一段中文顯示那一段；鍵盤用下方的「顯示全部中文」 */}
      <div onClick={onClick} className={cx(all && "spoilers-open")}>
        <Markdown text={masked} figs={figs} role="sol" />
      </div>
      {hasZh && (
        <button type="button" className="mt-1 min-h-9 text-meta text-warning-ink underline underline-offset-2" aria-pressed={all} onClick={() => setAll((v) => !v)}>
          {all ? "遮住中文" : "顯示全部中文"}
        </button>
      )}
    </div>
  );
}

export function VocabCard({ fields, tags, side, figs, resetKey, ai }: Props) {
  const isAi = (k: VocabField) => !!ai?.includes(k);
  const [hint, setHint] = useState(false);
  const [showTags, setShowTags] = useState(false);
  useEffect(() => {
    setHint(false);
    setShowTags(false);
  }, [resetKey]);
  const sounds = useMemo(() => vocabSounds(fields), [fields]);
  const word = fields.Word ?? "";
  const tagList = tags ?? [];
  const sentence = (fields.Sentence ?? "").trim();

  if (side === "front")
    return (
      <div className="vocab text-center">
        <div className="flex items-center justify-center gap-1">
          <Markdown text={word} figs={figs} role="q" tight className="vocab-word" />
          <Speaker sounds={sounds} />
        </div>
        {(sentence || tagList.length > 0) && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {sentence && (
              <Button variant="ghost" icon="bulb" aria-expanded={hint} onClick={() => setHint((v) => !v)}>
                {hint ? "收起例句" : "提示／例句"}
              </Button>
            )}
            {tagList.length > 0 && (
              <Button variant="ghost" icon="tag" aria-expanded={showTags} onClick={() => setShowTags((v) => !v)}>
                {showTags ? "收起標籤" : "標籤"}
              </Button>
            )}
          </div>
        )}
        {hint && sentence && <Hint md={sentence} figs={figs} />}
        {showTags && tagList.length > 0 && <div className="mt-3"><Tags tags={tagList} /></div>}
      </div>
    );

  const pos = (fields["Part of Speech"] ?? "").trim();
  const meaning = (fields["Meaning and Definition"] ?? "").trim();
  const image = stripSounds(fields.Image ?? "");
  const source = (fields.Source ?? "").trim();
  return (
    <div className="vocab">
      <div className="text-center">
        <div className="flex items-center justify-center gap-1">
          <Markdown text={word} figs={figs} role="q" tight className="vocab-word" />
          <Speaker sounds={sounds} />
        </div>
        {pos && (
          <div className="mt-1 flex items-center justify-center">
            <Markdown text={pos} tight className="vocab-pos" />
            {isAi("Part of Speech") && <AiMark />}
          </div>
        )}
      </div>
      <hr className="my-5 border-line" />
      {meaning && (
        <div className="text-center">
          <Markdown text={meaning} figs={figs} role="sol" className="vocab-meaning inline-block" />
          {isAi("Meaning and Definition") && <AiMark />}
        </div>
      )}
      {SECTIONS.map((k) => {
        const md = (fields[k] ?? "").trim();
        if (!md) return null;
        const confusable = k === "Memo & Confusable";
        return (
          <section key={k} className={cx("mt-4 rounded-btn bg-page px-4 py-3", confusable && "border-l-4 border-incorrect")}>
            <h3 className="mb-1 text-meta font-semibold text-ink-muted">
              {confusable ? "辨析與易混淆" : VOCAB_LABEL[k]}
              {isAi(k) && <AiMark />}
            </h3>
            <Markdown text={md} figs={figs} role="sol" />
          </section>
        );
      })}
      {image && <Markdown text={image} figs={figs} role="sol" className="mt-4 text-center" />}
      {source && (
        <div className="mt-4 flex gap-1 text-meta text-ink-muted">
          <span className="shrink-0">出處：</span>
          <Markdown text={source} tight className="vocab-source min-w-0" />
        </div>
      )}
      <VocabOccurrences word={word} />
      {tagList.length > 0 && <div className="mt-4 border-t border-line pt-4"><Tags tags={tagList} /></div>}
    </div>
  );
}
