// /dev/ui：每個元件的每種狀態，淺色與深色並排（規格書 §13.4）。
// 改了 src/ui/ 的任何東西，來這裡看結果；新增元件時，先加到這裡再拿去用。

import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseOptions } from "@schema/ts/options.ts";
import { content, useAsync, type Attempt, type Question, type SyncState } from "@/data";
import { QuestionView, useAnswerFlow } from "@/ui/content/QuestionView";
import { Markdown } from "@/ui/content/Markdown";
import { SourceBadges } from "@/ui/content/SourceBadges";
import { Icon, ICON_NAMES } from "@/ui/icons";
import { Dialog, Menu, Sheet, useToast } from "@/ui/overlays";
import {
  Badge, Button, Card, Checkbox, Chip, EmptyState, FilterGroup, IconButton, LinkButton, ListCard, ListRow, Notice, OptionRow, ProgressBar,
  SectionTitle, Segmented, Skeleton, Select, Spinner, Stat, Switch, Tabs, TextField, type OptionState,
} from "@/ui/primitives";
import { Page, SyncStatus } from "@/ui/shell";
import { BarList, ChartCard, ColumnChart, EditPanel, ExamTimerBar, HighlightPalette, ReviewCard, SearchBar } from "@/ui/templates";

// ---------- 淺色／深色並排 ----------

function Pair({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {(["light", "dark"] as const).map((t) => (
        <div key={t} data-theme={t} className="min-w-0 rounded-card border border-line bg-page p-4 text-ink">
          <div className="mb-3 text-meta text-ink-muted">{t === "light" ? "淺色" : "深色"}</div>
          <div className="space-y-3">{children}</div>
        </div>
      ))}
    </div>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`g-${title}`} className="scroll-mt-4">
      <h2 id={`g-${title}`} className="text-title font-semibold text-ink-strong">{title}</h2>
      {note && <p className="mt-1 mb-3 max-w-(--measure) text-ui break-words text-ink-muted [overflow-wrap:anywhere]">{note}</p>}
      <div className={note ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

// ---------- 色彩與對比 ----------

const SWATCHES = ["page", "card", "sidebar", "hover", "border", "border-strong", "text-strong", "text", "text-muted", "blue-light", "blue-mid", "blue-accent", "blue-deep", "blue-ink", "on-deep", "correct", "correct-bg", "correct-ink", "incorrect", "incorrect-bg", "incorrect-ink", "warning", "warning-bg", "warning-ink", "hl-yellow", "hl-green", "hl-pink", "hl-blue"];

// [前景, 背景, 最低對比, 用途]
const PAIRS: [string, string, number, string][] = [
  ["text-strong", "page", 4.5, "題幹在頁面底"], ["text-strong", "card", 4.5, "題幹在卡片"], ["text", "card", 4.5, "一般文字"], ["text", "sidebar", 4.5, "側欄文字"],
  ["text-muted", "page", 4.5, "輔助字在頁面底"], ["text-muted", "card", 4.5, "輔助字在卡片"], ["text-muted", "sidebar", 4.5, "輔助字在側欄"], ["text-muted", "hover", 4.5, "輔助字在滑過的列"],
  ["blue-deep", "card", 4.5, "連結"], ["blue-deep", "page", 4.5, "連結在頁面底"], ["blue-deep", "hover", 4.5, "文字按鈕滑過"], ["blue-deep", "blue-light", 4.5, "選中分頁"],
  ["blue-ink", "blue-light", 4.5, "徽章、選中項"], ["blue-ink", "blue-mid", 4.5, "次要按鈕滑過"], ["on-deep", "blue-deep", 4.5, "主要按鈕"],
  ["blue-accent", "card", 3, "進度條、圖示"], ["blue-accent", "page", 3, "進度條在頁面底"], ["border-strong", "card", 3, "輸入框外框"], ["border-strong", "page", 3, "勾選框外框"], ["focus", "card", 3, "焦點框"], ["focus", "page", 3, "焦點框在頁面底"],
  ["correct-ink", "correct-bg", 4.5, "答對文字"], ["correct", "correct-bg", 3, "答對邊線"], ["correct", "card", 3, "正解邊線"],
  ["incorrect-ink", "incorrect-bg", 4.5, "答錯文字"], ["incorrect", "incorrect-bg", 3, "答錯邊線"], ["incorrect", "card", 3, "錯誤外框"],
  ["warning-ink", "warning-bg", 4.5, "疑點、待寫回"], ["paper-ink", "paper", 4.5, "圖片紙卡"],
  ["text-strong", "hl-yellow", 4.5, "黃色螢光"], ["text-strong", "hl-green", 4.5, "綠色螢光"], ["text-strong", "hl-pink", 4.5, "粉色螢光"], ["text-strong", "hl-blue", 4.5, "藍色螢光"],
];

function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: number[], b: number[]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function Colors() {
  const ref = useRef<HTMLDivElement>(null);
  const [vals, setVals] = useState<Record<string, number[]>>({});
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const probe = document.createElement("span");
    el.appendChild(probe);
    const out: Record<string, number[]> = {};
    for (const name of new Set([...SWATCHES, ...PAIRS.flatMap((p) => [p[0], p[1]])])) {
      probe.style.color = `var(--${name})`;
      out[name] = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    }
    probe.remove();
    setVals(out);
  }, []);
  const hex = (v?: number[]) => (v?.length === 3 ? "#" + v.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("").toUpperCase() : "");
  const rows = PAIRS.map(([fg, bg, need, use]) => ({ fg, bg, need, use, ratio: vals[fg] && vals[bg] ? contrast(vals[fg], vals[bg]) : 0 }));
  const failed = rows.filter((r) => r.ratio && r.ratio < r.need).length;
  return (
    <div ref={ref} className="space-y-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SWATCHES.map((s) => (
          <li key={s} className="flex items-center gap-2 text-meta">
            <span className="size-8 shrink-0 rounded-chip border border-line-strong" style={{ background: `var(--${s})` }} />
            <span className="min-w-0"><span className="block truncate text-ink-strong">--{s}</span><span className="text-ink-muted">{hex(vals[s])}</span></span>
          </li>
        ))}
      </ul>
      <p className="text-ui font-semibold" data-contrast-failed={failed}>
        {failed ? <span className="text-incorrect-ink">對比不合格 {failed} 組</span> : <span className="text-correct-ink">對比 {rows.length} 組全部合格</span>}
      </p>
      <div className="overflow-x-auto" data-noswipe>
        <table className="w-full text-left text-meta">
          <thead><tr className="text-ink-muted"><th className="py-1 pr-3 font-medium">用途</th><th className="py-1 pr-3 font-medium">前景 / 背景</th><th className="py-1 pr-3 font-medium">對比</th><th className="py-1 font-medium">需要</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.fg + r.bg} className="border-t border-line">
                <td className="py-1 pr-3 text-ink-strong">{r.use}</td>
                <td className="py-1 pr-3 whitespace-nowrap">
                  <span className="inline-block rounded-chip border border-line px-1.5" style={{ color: `var(--${r.fg})`, background: `var(--${r.bg})` }}>{r.fg}</span> / {r.bg}
                </td>
                <td className="py-1 pr-3 tabular-nums">{r.ratio ? r.ratio.toFixed(2) : "…"}{r.ratio ? (r.ratio >= r.need ? " ✓" : " ✗") : ""}</td>
                <td className="py-1 tabular-nums">{r.need}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- 壓力測試用的合成題目（break-ui） ----------

function stressQuestion(): Question {
  const ques =
    "這是一題合成的壓力測試題，用來看版面在最壞的資料下會不會破：很長的來源名稱、很長的不可斷字串 Supercalifragilisticexpialidocious_pneumonoultramicroscopicsilicovolcanoconiosis_0123456789、八個選項、寬表格與超長公式。\n\n" +
    "$$\\oint_{\\partial\\Sigma}\\vec B\\cdot d\\vec \\ell=\\mu_0\\iint_\\Sigma\\vec J\\cdot d\\vec S+\\mu_0\\varepsilon_0\\frac{d}{dt}\\iint_\\Sigma\\vec E\\cdot d\\vec S=\\mu_0 I_{enc}+\\mu_0\\varepsilon_0\\frac{d\\Phi_E}{dt}=\\frac{4\\pi G\\rho}{3}\\left(\\vec r_1-\\vec r_2\\right)+\\sum_{n=1}^{\\infty}\\frac{(-1)^{n}}{n^{2}}\\cos\\left(\\frac{2\\pi n x}{\\lambda}\\right)+\\int_{0}^{\\infty}e^{-\\alpha t^{2}}\\,dt$$\n\n" +
    "| 項目 | 第一欄很長的標題文字 | 第二欄 | 第三欄 | 第四欄 | 第五欄 | 第六欄 | 第七欄 |\n|---|---|---|---|---|---|---|---|\n| 甲 | $\\dfrac{mv^2}{2}$ | 1.088×10² Pa | 2 | 3 | 4 | 5 | 6 |\n| 乙 | CO₂、NAD⁺ | 一段比較長的儲存格內容，應該在格子裡換行 | 2 | 3 | 4 | 5 | 6 |\n\n" +
    "(A) 很短\n\n(B) 選項文字很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長很長，要能換行而且不擠到右邊的對錯標記\n\n" +
    "(C) $\\dfrac{Q}{4\\pi\\varepsilon_0 r^2}\\left(1-\\dfrac{r^3}{R^3}\\right)+\\dfrac{Q}{4\\pi\\varepsilon_0 R^2}\\left(\\dfrac{R}{r}\\right)^{2}\\left(1+\\dfrac{a}{b}+\\dfrac{c}{d}+\\dfrac{e}{f}\\right)$\n\n(D) AnUnbreakableOptionTokenWithoutAnySpacesOrHyphensThatGoesOnAndOnAndOnAndOnAndOn\n\n(E) 以上皆是\n\n(F) (A) 與 (B)\n\n(G) 排不出來的公式會顯示原始碼：$\\frac{1}{2$\n\n(H) 以上皆非\n\n選項後面的補充說明也要顯示在選項下方。";
  const parsed = parseOptions(ques);
  return {
    id: "TEST-000000", subject: "PHY", label: "一個名稱非常非常非常長的來源 第一百二十三回 正課班作業三十九之補充講義 Q128",
    source: { sid: "x", kind: "self", school: null, year: null, paper: null, book: null, unit: null, qno: "128" },
    alt_sources: [{ id: "PHY-000917", label: "高醫 109 37", relation: "same" }, { id: "PHY-000949", label: "高醫 108 09", relation: "adapted" }],
    canonical: "TEST-000000", chap: "PHY:Ch15", xchap: [], tags: {}, qtype: "single", group: null, ques, opt: parsed?.opt ?? null, opt_span: parsed?.span ?? null,
    answer: { mode: "single", keys: ["C"], text: null, trust: "key", ai_agree: true, note: "" }, source_answer: { value: ["B"], mode: "single", kind: null, note: "教材原答與現行答案不同" },
    idea: "", sol: "", teacher: [],
    sol_meta: { origin: "ai", model: null, human_verified: true, verified_at: null, issues: ["這是第一個疑點，文字也可以很長很長很長很長很長很長很長很長很長很長很長很長。", "第二個疑點。"] },
    figs: [], h: { ques: "", idea: "", sol: "" },
  };
}

function QuestionDemo({ q }: { q: Question }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const flow = useAnswerFlow(q, attempt, (chosen, correct) =>
    setAttempt({ id: "demo", item: `q:${q.id}`, session_id: null, mode: "practice", chosen, correct: correct ? 1 : 0, confidence: 2, elapsed_ms: 0, content_h: "", device: "demo", created_at: Date.now(), open: 0 }),
  );
  return (
    <Card className="p-4 sm:p-6">
      <QuestionView q={q} flow={flow} attempt={attempt} chapter="Ch15　電磁感應" />
      <div className="mt-4 flex gap-2">
        {flow.phase === "self" && <Button variant="primary" onClick={flow.reveal}>顯示答案</Button>}
        {flow.phase === "multi" && <Button variant="primary" disabled={!flow.canSubmit} onClick={flow.submit}>送出</Button>}
        {attempt && <Button onClick={() => setAttempt(null)}>重來</Button>}
      </div>
    </Card>
  );
}

const MD_SAMPLE = "題幹文字 17px、行高 1.6。行內公式 $E=mc^2$、化學式 $\\ce{H2SO4 + 2NaOH -> Na2SO4 + 2H2O}$、Unicode 上下標 CO₂、NAD⁺，還有 ==螢光標記==、**粗體**、<u>底線</u>。\n\n$$\\vec F = q\\left(\\vec E + \\vec v\\times\\vec B\\right)$$\n\n| 量 | 符號 | 單位 |\n|:--|:-:|--:|\n| 電阻率 | $\\rho$ | Ω·m |\n| 電導率 | $\\sigma$ | S/m |\n\n> 引言：相同幾何形狀下 $RC=\\rho\\epsilon$。\n\n1. 第一點\n2. 第二點\n   - 巢狀列點\n\n排不出來的公式：$\\frac{1}{2$";

const OPTION_STATES: [OptionState, string][] = [["idle", "未選"], ["selected", "已選（複選送出前）"], ["correct", "選了、答對"], ["incorrect", "選了、答錯"], ["missed", "沒選到的正解"], ["dimmed", "作答後的其他選項"]];
const SYNC_STATES: SyncState[] = [{ kind: "local" }, { kind: "synced", at: 0 }, { kind: "pending", count: 12 }, { kind: "syncing" }, { kind: "offline", count: 3 }, { kind: "error", message: "伺服器回 500" }];

export default function UiGallery() {
  const toast = useToast();
  const [seg, setSeg] = useState("b");
  const [tab, setTab] = useState("one");
  const [checks, setChecks] = useState<Record<string, boolean>>({ a: true });
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [edit, setEdit] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [search, setSearch] = useState("");
  const cases = useAsync(() => content.sampleCases(), []).data;
  const stress = useRef(stressQuestion()).current;

  return (
    <Page title="UI 展示" subtitle="元件、狀態、色彩對比；改了 src/ui/ 就來這裡看" back="/more" width="wide">
      <nav aria-label="本頁區塊" className="flex flex-wrap gap-2">
        {["色彩", "字級", "按鈕", "徽章與提示", "選項列", "切換與勾選", "清單與卡片", "浮層", "狀態", "內容顯示", "樣板", "壓力測試", "特殊情況題目"].map((t) => (
          <a key={t} href={`#g-${t}`} className="inline-flex min-h-(--tap) items-center rounded-btn border border-line bg-card px-3 text-ui no-underline hover:bg-hover">{t}</a>
        ))}
      </nav>

      <Group title="色彩" note="數值來自 tokens.css。對比由這一頁即時計算：內文需 ≥ 4.5、圖示與外框需 ≥ 3。--border 與 --warning 是裝飾用，不單獨傳達資訊，所以不在表裡。">
        <Pair><Colors /></Pair>
      </Group>

      <Group title="字級" note="只用系統字（離線不缺字）。六級：13 來源與徽章、15 介面、16 輸入框、17 題幹與詳解、20 區塊標題、24 頁面標題。字重只有 400、500、600。">
        <Pair>
          <div className="space-y-1">
            <div className="text-display font-semibold text-ink-strong">24 頁面標題 text-display</div>
            <div className="text-title font-semibold text-ink-strong">20 區塊標題 text-title</div>
            <div className="text-body text-ink-strong">17 題幹與詳解 text-body：一質點作簡諧運動</div>
            <div className="text-base text-ink-strong">16 輸入框 text-base</div>
            <div className="text-ui text-ink">15 介面文字 text-ui</div>
            <div className="text-meta text-ink-muted">13 來源、頁碼、徽章 text-meta</div>
          </div>
        </Pair>
      </Group>

      <Group title="按鈕" note="primary 一個畫面只有一顆；secondary 是一般動作；ghost 是次要或取消；danger 是刪除類。高度一律 ≥ 44px（觸控 48px）。">
        <Pair>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary">主要</Button><Button>次要</Button><Button variant="ghost">文字</Button><Button variant="danger">刪除</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon="pencil">有圖示</Button><Button iconEnd="arrowRight">下一題</Button><Button variant="primary" disabled>停用</Button><Button disabled>停用</Button><Button variant="primary" loading>處理中</Button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <IconButton label="加星號"><Icon name="star" /></IconButton>
            <IconButton label="取消星號" pressed><Icon name="starFilled" /></IconButton>
            <IconButton label="停用" disabled><Icon name="edit" /></IconButton>
            <LinkButton to="/dev/ui">連結按鈕</LinkButton>
            <Spinner label="載入中" />
          </div>
          <details>
            <summary className="inline-flex min-h-(--tap) items-center rounded-btn px-2 text-ui text-blue-deep hover:bg-hover">全部圖示（{ICON_NAMES.length}）</summary>
            <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {ICON_NAMES.map((n) => <li key={n} className="flex flex-col items-center gap-1 text-meta text-ink-muted"><Icon name={n} className="text-ink-strong" /><span className="max-w-full truncate">{n}</span></li>)}
            </ul>
          </details>
        </Pair>
      </Group>

      <Group title="徽章與提示" note="徽章只放短詞。綠、紅、橘只用在答對、答錯、警示；其他一律中性或藍。">
        <Pair>
          <div className="flex flex-wrap gap-1.5">
            <Badge>答案表</Badge><Badge>AI 詳解</Badge><Badge tone="blue" icon="check">已確認</Badge><Badge tone="correct" icon="check">答對</Badge><Badge tone="incorrect" icon="x">答錯</Badge><Badge tone="warning">待寫回</Badge>
          </div>
          <Notice>一般說明：目前是樣本資料。</Notice>
          <Notice tone="warning" icon="alert">警示：這題的答案還沒定案。</Notice>
          <Notice tone="incorrect" icon="alert">錯誤：存檔失敗，請再試一次。</Notice>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => toast("已加星號")}>提示訊息</Button>
            <Button onClick={() => toast("已標為粗心錯", { action: { label: "復原", run: () => {} } })}>可復原的提示</Button>
            <Button onClick={() => toast("同步失敗，稍後會自動重試", { tone: "error" })}>錯誤提示</Button>
          </div>
        </Pair>
      </Group>

      <Group title="選項列" note="整列可點、高度 ≥ 56px。對錯除了顏色，還有圖示與文字。單選是圓形字母、複選是方形。">
        <Pair>
          <div className="space-y-2">
            {OPTION_STATES.map(([s, name], i) => (
              <OptionRow key={s} letter={"ABCDEF"[i]} state={s} locked={s !== "idle" && s !== "selected"}><span className="text-body text-ink-strong">{name}　$1.088\times10^2$ Pa</span></OptionRow>
            ))}
            <OptionRow letter="A" state="selected" multi><span className="text-body text-ink-strong">複選：已選</span></OptionRow>
            <OptionRow letter="B" state="idle" multi><span className="text-body text-ink-strong">複選：未選</span></OptionRow>
          </div>
        </Pair>
      </Group>

      <Group title="切換與勾選">
        <Pair>
          <Segmented label="示範" value={seg} onChange={setSeg} options={[{ value: "a", label: "10" }, { value: "b", label: "20" }, { value: "c", label: "50" }, { value: "d", label: "全部" }]} />
          <Tabs label="示範分頁" value={tab} onChange={setTab} tabs={[{ value: "one", label: "題目" }, { value: "two", label: "詳解" }, { value: "three", label: "筆記" }]} />
          <div className="rounded-card border border-line bg-card p-2">
            <Checkbox checked={!!checks.a} onChange={(v) => setChecks((c) => ({ ...c, a: v }))} label="後西醫" count={1188} />
            <Checkbox checked={!!checks.b} onChange={(v) => setChecks((c) => ({ ...c, b: v }))} label="轉學考" count={1010} />
            <Checkbox checked="partial" onChange={() => {}} label="部分選取（章節樹的上層）" count={420} />
            <Checkbox checked={false} onChange={() => {}} label="停用" disabled />
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip selected onToggle={() => {}} count={186}>高醫</Chip><Chip selected={false} onToggle={() => {}} count={120}>中興</Chip><Chip selected={false} onToggle={() => {}}>115</Chip>
          </div>
          <div className="overflow-hidden rounded-card border border-line bg-card">
            <Switch checked={!!checks.sw} onChange={(v) => setChecks((c) => ({ ...c, sw: v }))} label="開關" hint="說明文字放在標題下面" />
            <FilterGroup title="篩選群組" summary="高醫、中興" defaultOpen onClear={() => {}}>
              <p className="text-ui text-ink-muted">標題列可收合，右邊是已選摘要。</p>
            </FilterGroup>
            <FilterGroup title="沒選的群組"><p className="text-ui text-ink-muted">沒選時摘要顯示「不限」。</p></FilterGroup>
          </div>
          <TextField label="文字欄位" hint="輸入框字級 16px，iOS 聚焦時不會放大頁面" placeholder="請輸入" />
          <TextField label="有錯誤的欄位" defaultValue="abc" error="密碼不對，還可以再試 3 次" />
          <Select label="下拉選單（章節等選項多的時候）" value="PHY:Ch10" onChange={() => {}} options={[{ value: "PHY:Ch09", label: "Ch09　靜電學" }, { value: "PHY:Ch10", label: "Ch10　電位能與電位" }]} hint="外觀與文字欄位相同" />
          <SearchBar value={search} onChange={setSearch} placeholder="題號或來源" />
        </Pair>
      </Group>

      <Group title="清單與卡片" note="卡片是白底加一條細邊線，不加陰影、不疊卡片。清單列高度 ≥ 56px。">
        <Pair>
          <ListCard>
            <li><ListRow to="/dev/ui" title="連結列" meta="第二行是輔助資訊" leading={<Icon name="book" size={20} />} /></li>
            <li><ListRow onClick={() => {}} title={<>高醫 115 01<span className="mx-1 text-ink-muted">｜</span><span className="text-ink-muted">PHY-000001</span></>} trailing={<Badge tone="incorrect" icon="x">答錯</Badge>} /></li>
            <li><ListRow title="純顯示列（不能點）" trailing="dev-ab12cd" chevron={false} /></li>
            <li><ListRow to="/dev/ui" title="一個名稱非常非常非常非常非常非常非常非常非常非常非常非常長的列會被截斷" meta="輔助資訊也一樣會被截斷輔助資訊也一樣會被截斷輔助資訊也一樣會被截斷輔助資訊也一樣" trailing={<Badge>第 2 階段</Badge>} /></li>
          </ListCard>
          <Card className="grid grid-cols-3 gap-4 p-5"><Stat value="38" label="今天做的題數" /><Stat value="74%" label="答對率" /><Stat value="12" label="錯題本" /></Card>
          <SectionTitle action={<Button variant="ghost">全部</Button>}>區塊標題</SectionTitle>
          <ProgressBar value={7} max={20} label="進度示範" />
        </Pair>
      </Group>

      <Group title="浮層" note="對話框：需要使用者決定才能繼續。面板：窄螢幕從底部升起，寬螢幕從右側滑入。選單：窄螢幕從底部、寬螢幕貼著按鈕。都可以用 Esc 或點背景關閉。">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setDialog(true)}>對話框</Button>
          <Button onClick={() => setSheet(true)}>面板</Button>
          <Button onClick={() => setEdit(true)}>編輯面板</Button>
          <Menu label="選單示範" items={[{ label: "存疑", icon: "flag", checked: true }, { label: "編輯這一題", icon: "edit", disabledReason: "第 3 階段開放" }, { label: "結束這個題組", icon: "x", danger: true }]}><Icon name="dots" /></Menu>
        </div>
        {dialog && <Dialog title="捨棄這個題組？" onClose={() => setDialog(false)} actions={<><Button variant="ghost" onClick={() => setDialog(false)}>保留</Button><Button variant="danger" onClick={() => setDialog(false)}>捨棄</Button></>}>已經作答的紀錄會留著。</Dialog>}
        {sheet && <Sheet title="面板標題" onClose={() => setSheet(false)} footer={<Button variant="primary" onClick={() => setSheet(false)}>完成</Button>}><div className="space-y-3 p-4">{Array.from({ length: 12 }, (_, i) => <p key={i} className="text-ui">面板內容自己捲動，不帶動背後的頁面。第 {i + 1} 段。</p>)}</div></Sheet>}
        {edit && <EditPanel title="編輯詳解（展示）" initial={MD_SAMPLE} onClose={() => setEdit(false)} saveDisabledReason="展示頁不會存檔；貼上 AI 回覆可測試自動轉換" />}
      </Group>

      <Group title="狀態" note="載入用骨架（形狀已知）或轉圈（按鈕內）；空白與錯誤都要說明發生什麼事、接下來能做什麼。">
        <Pair>
          <Card className="p-4"><Skeleton lines={4} /></Card>
          <Card><EmptyState icon="pencil" title="沒有做到一半的題組" action={<Button>去刷題</Button>}>開始刷題後，中途離開的題組會出現在這裡。</EmptyState></Card>
          <Card><EmptyState tone="error" title="讀不到題庫內容" action={<Button>再試一次</Button>}>讀不到內容檔 c/manifest.json（503）。請確認網路，或稍後再試。</EmptyState></Card>
          <Card><EmptyState icon="cloudOff" title="本文未下載">這一題的本文不在這台裝置上。</EmptyState></Card>
          <div className="flex flex-wrap gap-x-4 rounded-card border border-line bg-card p-3">
            {SYNC_STATES.map((s) => <SyncStatus key={s.kind} state={s} />)}
          </div>
        </Pair>
      </Group>

      <Group title="內容顯示" note="題目、詳解、筆記一律用 <Markdown>。寬表格與長公式自己橫向捲動；圖放在白色紙卡上，點一下開全螢幕檢視器。">
        <Pair>
          <Card className="p-4"><Markdown text={MD_SAMPLE} /></Card>
          <div className="flex flex-wrap items-center gap-2"><SourceBadges q={stress} /></div>
          <HighlightPalette onPick={() => {}} onNote={() => {}} />
        </Pair>
      </Group>

      <Group title="樣板" note="第 2 階段以後的頁面從這些版面開始接功能。完整頁面：/review、/wrong、/browse、/patches、/papers、/stats、/analysis、/kb。">
        <div className="mb-3 flex flex-wrap gap-2">
          {[["/review", "複習卡片"], ["/wrong", "錯題本"], ["/browse", "題庫瀏覽"], ["/patches", "修訂佇列"], ["/papers", "原卷與計時列"], ["/stats", "統計"], ["/analysis", "考題分析"], ["/kb", "資料庫"], ["/login", "登入頁"]].map(([to, label]) => <LinkButton key={to} to={to}>{label}</LinkButton>)}
        </div>
        <Pair>
          <ReviewCard front="PDH complex 的五個輔酶是哪些？" back="**TPP、Lipoamide、CoA、FAD、NAD⁺**" flipped={flipped} onFlip={() => setFlipped(true)} onRate={() => setFlipped(false)} ratings={[{ value: 1, label: "重來", next: "10 分鐘" }, { value: 2, label: "困難", next: "1 天" }, { value: 3, label: "良好", next: "3 天" }, { value: 4, label: "簡單", next: "7 天" }]} />
          <ExamTimerBar remainingS={52 * 60 + 5} totalS={80 * 60} answered={12} total={45} onSubmit={() => {}} />
          <ExamTimerBar remainingS={4 * 60 + 12} totalS={80 * 60} answered={41} total={45} onSubmit={() => {}} />
          <ExamTimerBar remainingS={null} totalS={null} elapsedS={23 * 60 + 8} answered={20} total={45} onSubmit={() => {}} />
          <ChartCard title="弱點章節" subtitle="答對率最低的三章"><BarList max={100} format={(v) => `${v}%`} rows={[{ label: "Ch15 電磁感應", value: 48 }, { label: "Ch08 轉動", value: 55 }, { label: "一個名稱很長很長很長的章節", value: 91 }]} /></ChartCard>
          <ChartCard title="每日題數"><ColumnChart unit="題" data={[38, 52, 0, 61, 45, 80, 36].map((value, i) => ({ label: "一二三四五六日"[i], value }))} /></ChartCard>
        </Pair>
      </Group>

      <Group title="壓力測試" note="合成的最壞情況：超長來源名稱、不可斷的長字串、超長公式、寬表格、八個選項（選項解析上限是 A–H）、選項是長公式、排不出來的公式、疑點、教材原答、同題出處。版面不應該被撐破或重疊。">
        <div className="mx-auto max-w-3xl"><QuestionDemo q={stress} /></div>
      </Group>

      <Group title="特殊情況題目" note="樣本裡每一種特殊情況各是哪一題（app/fixtures/CASES.md）。點進去看實際顯示。">
        {!cases ? <Skeleton lines={4} /> : Object.keys(cases).length === 0 ? <p className="text-ui text-ink-muted">正式內容包沒有這份對照表。</p> : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {Object.entries(cases).map(([k, c]) => (
              <li key={k} className="rounded-card border border-line bg-card p-3">
                <div className="text-ui font-medium text-ink-strong">{c.desc}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {c.ids.map((id) => <LinkButton key={id} to={`/q/${encodeURIComponent(id)}`} className="px-2.5">{id}</LinkButton>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </Page>
  );
}
