# UI 規範

這份文件是給之後接手做功能的模型看的。讀完它，再開 `/dev/ui` 看一遍，就能做出和現有畫面一致的新頁面。
規格依據：`docs/規劃/01_規格書.md` §13；本文件與規格書不一致時，以規格書為準並回報。

## 1. 三條硬性規則

1. **數值只出自 `app/src/ui/tokens.css`。** 顏色、字級、圓角、動畫時間都用代碼。Tailwind 的預設色盤、字級、圓角、陰影已經在 `base.css` 清掉，所以 `bg-red-500`、`text-sm`、`rounded-lg`、`shadow-md` 寫了不會有效果——那是刻意的，不要把它們加回來。
2. **畫面用 `app/src/ui/` 的元件組。** 不要自己刻一個長得像的按鈕、卡片、清單列。真的缺元件時：先加進 `src/ui/`、加到 `/dev/ui` 展示頁（淺色深色都要有）、在本文件補一列，再拿去用。
3. **資料只經過 `@/data`。** 見 `app/src/data/README.md`。

## 2. 設計代碼

| 用途 | Tailwind 寫法 | 說明 |
|---|---|---|
| 頁面底／卡片／側欄 | `bg-page` `bg-card` `bg-sidebar` | |
| 滑過、按下 | `bg-hover` | hover 樣式 Tailwind 會自動限定在滑鼠裝置 |
| 分隔線、卡片邊線 | `border-line` | 裝飾用 |
| 輸入框、勾選框外框 | `border-line-strong` | 與底色 ≥ 3:1 |
| 題幹、標題 | `text-ink-strong` | |
| 一般文字 | `text-ink` | |
| 輔助字 | `text-ink-muted` | 只放在 page／card／sidebar／hover 上 |
| 連結、文字按鈕 | `text-blue-deep` | |
| 主要按鈕 | `bg-blue-deep text-on-deep` | 白字只能放在 blue-deep 上 |
| 選中、徽章 | `bg-blue-light text-blue-ink` | 淺藍底上只放 blue-ink（或 blue-deep） |
| 進度條、圖表 | `bg-blue-accent` | 只放在 card 或 page 上 |
| 答對／答錯／警示 | `bg-correct-bg text-correct-ink` 等三組 | 只用在這三種意思；一定搭配圖示或文字，不只靠顏色 |
| 圖片紙卡 | `bg-paper` | 深淺色都是白 |
| 字級 | `text-meta`(13) `text-ui`(15) `text-base`(16) `text-body`(17) `text-title`(20) `text-display`(24) | 輸入框一律 `text-base`（低於 16px iOS 會放大頁面） |
| 字重 | `font-normal` `font-medium` `font-semibold` | 只有這三種 |
| 圓角 | `rounded-card`(12) `rounded-btn`(8) `rounded-chip`(6) `rounded-full` | |
| 可點區域 | `min-h-(--tap)` `size-(--tap)` | 44px，觸控裝置 48px |
| 選項列、清單列 | `min-h-(--option-h)` | 56px，觸控裝置 60px |
| 內文欄寬 | `max-w-(--measure)` | 40rem |
| 動畫時間 | `duration-(--dur-fast)`(150) `duration-(--dur)`(200) `duration-(--dur-slow)`(300) `ease-out` | 系統開「減少動態效果」時自動變 0 |
| 安全區 | `pt-safe` `pb-safe` `px-safe` | 固定在上下緣的列都要加 |

間距用 Tailwind 的 4px 級距（`gap-2`、`p-4`、`space-y-6`…）。卡片內距 `p-4`／`p-5`，頁面區塊之間 `space-y-6`（`<Page>` 已經加了）。

改顏色的流程：改 `tokens.css`（深色有兩處要一起改）→ 開 `/dev/ui` 的「色彩」區，確認「對比 N 組全部合格」→ 更新規格書 §13.1 的表。

## 3. 元件（`app/src/ui/`）

| 元件 | 檔案 | 用在 |
|---|---|---|
| `Page` | shell.tsx | **每一頁最外層**。給標題、返回、右上動作；`width="narrow"`（單題閱讀、表單）或 `"wide"`（清單、方格、圖表，以及資料庫筆記閱讀頁——筆記多寬表格與多層列點，使用者要求加寬） |
| `AppShell` | shell.tsx | 導覽外殼。新頁面加在 `App.tsx` 的 `<Route element={<AppShell />}>` 底下；全螢幕頁（刷題、登入）放外面 |
| `Button` `LinkButton` | primitives.tsx | `primary` 一個畫面只有一顆；`secondary` 一般動作；`ghost` 次要或取消；`danger` 刪除類。跳頁用 `LinkButton`，動作用 `Button` |
| `IconButton` | primitives.tsx | 只有圖示的按鈕，`label` 必填。切換型（星號）用 `pressed` |
| `Badge` | primitives.tsx | 短詞標示：來源、狀態、階段 |
| `Card` | primitives.tsx | 白底＋細邊線。不加陰影、不卡片套卡片 |
| `ListCard` + `ListRow` | primitives.tsx | 清單。`to` 是連結、`onClick` 是按鈕、都不給是純顯示 |
| `OptionRow` | primitives.tsx | 題目選項：idle／selected／correct／incorrect／missed／dimmed |
| `Segmented` | primitives.tsx | 2–5 個互斥選項 |
| `Tabs` | primitives.tsx | 同一頁內切換並列的檢視 |
| `Checkbox` `Switch` `Chip` | primitives.tsx | 勾選（可帶題數、可部分選取）、開關、可複選的小選項 |
| `FilterGroup` | primitives.tsx | 一組可收合的篩選條件，右邊顯示已選摘要 |
| `TextField` | primitives.tsx | 文字輸入，`label` 必填（要隱藏用 `hideLabel`），錯誤用 `error` |
| `Select` | primitives.tsx | 下拉選單（選項太多、不適合 `Segmented` 時，例如章節）。外觀同 `TextField` |
| `ProgressBar` `Spinner` `Skeleton` | primitives.tsx | 進度；按鈕內的等待；內容形狀已知時的載入 |
| `EmptyState` | primitives.tsx | 空白、錯誤（`tone="error"`）、尚未開放 |
| `Notice` | primitives.tsx | 頁面內的提示條（說明、警示、錯誤） |
| `Stat` `SectionTitle` | primitives.tsx | 大數字；區塊小標 |
| `Dialog` | overlays.tsx | 需要使用者決定才能繼續（捨棄、清除、改答案確認） |
| `Sheet` | overlays.tsx | 面板：窄螢幕從底部、寬螢幕從右側 |
| `Menu` | overlays.tsx | ⋯ 選單。還沒開放的項目用 `disabledReason` |
| `useToast` | overlays.tsx | 短暫的結果回報，可帶「復原」 |
| `SyncStatus` | shell.tsx | 同步狀態六種 |
| `Icon` | icons.tsx | 全站圖示。要新圖示就加在這個檔，不引入圖示庫 |
| `Markdown` | content/Markdown.tsx | **所有題目、詳解、筆記的內容顯示**（公式、表格、題圖都在裡面）。短內容加 `tight` |
| `QuestionView` + `useAnswerFlow` | content/QuestionView.tsx | 一題的顯示與作答流程。刷題畫面與單題頁共用 |
| `SourceBadges` | content/SourceBadges.tsx | 答案與詳解的來源。不顯示「未確認」 |
| `FigureViewerProvider` | content/FigureViewer.tsx | 全螢幕圖片檢視器；`Markdown` 裡的圖點了會自動開 |
| `HighlightableMarkdown` | content/Highlights.tsx | 可以畫螢光、加註的 `Markdown`（題幹、思路、詳解）。給 `target`（`q:<ID>/sol`） |
| `MarkdownEditor` | templates.tsx | Markdown 原始碼＋即時預覽；貼上 AI 回覆自動轉 Markdown（`content/paste.ts`）。所有可編輯的 Markdown 都用它 |

## 4. 頁面樣板（`app/src/ui/templates.tsx`、`app/src/pages/Templates.tsx`）

接功能時保留版面，把示範資料換成 `@/data` 的函式；做完把該頁的 `<TemplateNotice>` 拿掉。

| 樣板 | 元件 | 示範頁 | 接功能的階段 |
|---|---|---|---|
| 清單頁＋搜尋列 | `SearchBar`、`ListCard`、`ListRow` | `/wrong` `/browse` `/patches`（已接） | 2、3（完成） |
| 複習卡片 | `ReviewCard`（翻面、四顆評分鈕） | `/dev/ui`（題目的複習改用刷題畫面；卡片在第 5 階段用） | 5 |
| 原卷方格、模擬考計時列 | `PaperGrid`、`ExamTimerBar`（`remainingS = null` 時是不計時、顯示已用時間） | `/papers`、模擬考畫面 | 2（完成） |
| 圖表卡 | `ChartCard`、`BarList`、`ColumnChart`、`HeatTable`（`rowName` 給列的顯示名稱） | `/stats` `/analysis` | 2（完成） |
| 資料庫閱讀頁 | `KbBlocks`（收合、編輯鈕）、`HighlightPalette` | `/kb` `/kb/:subject/:doc` | 4 |
| 編輯面板 | `EditPanel`／`MarkdownEditor`（原始碼＋即時預覽＋貼上轉換） | 題目編輯（`pages/EditQuestion.tsx`，已接）、閱讀頁的編輯模式 | 3（完成）、4 |
| 個人筆記區、手寫區外框 | `QuestionView` 最下面兩個收合區 | 任何一題作答後 | 3（筆記完成）、6 |
| 各種狀態 | `EmptyState`、`Skeleton`、`Notice`、`SyncStatus` | `/dev/ui`「狀態」 | — |

## 5. 新畫面怎麼組

```tsx
export function WrongBook() {
  const list = useFlagged("wrong");            // 資料只從 @/data 來
  return (
    <Page title="錯題本" back="/more">        {/* 最外層一定是 Page */}
      {!list ? <Card className="p-4"><Skeleton lines={4} /></Card>            // 載入
       : list.length === 0 ? <Card><EmptyState title="錯題本是空的" … /></Card> // 空白
       : <ListCard>…<ListRow … />…</ListCard>}                               {/* 內容 */}
    </Page>
  );
}
```

每個畫面都要處理四種狀態：載入中、空白、錯誤（說明原因與下一步）、有內容。
然後在 `App.tsx` 加路由；要進主導覽就改 `shell.tsx` 的 `NAV`（最多五項），否則加到 `pages/More.tsx`。

## 6. 文字

- 繁體中文。題目一律寫成「來源｜ID」（`高醫 115 01｜PHY-000001`）。
- 按鈕用動詞：「開始刷題」「顯示答案」「再試一次」。不用「確定」「OK」。
- 錯誤訊息說發生什麼事＋接下來怎麼辦：「讀不到題庫索引。請確認網路，或稍後再試。」不寫「發生錯誤」。
- 還沒做的功能要看得到、但說清楚何時開放：「第 3 階段開放」。
- 不顯示「未確認」（規格書 §4.4）。

## 7. 什麼不准做

- 不寫色碼、px 字級、任意圓角；不用 Tailwind 預設色盤。
- 不用漸層、插圖、裝飾圖案、陰影堆疊。陰影只有浮層（`shadow-pop`）。
- 不替科目各配一個顏色；綠、紅、橘只代表答對、答錯、警示。
- 一個畫面不放兩顆 `primary`。
- 可點的東西不小於 44×44px；不用 `<div onClick>`（用 `button` 或連結）。
- 不做只有電腦或只有 iPad 才有的功能（規格書 §2.5）。版面差異只靠寬度（`lg:` = 1024px 以上是側欄）與 `pointer: coarse`。
- 不用 `100vh`（用 `dvh`）；不關閉縮放；hover 樣式不寫在 media query 外面（Tailwind 的 `hover:` 已處理）。
- 圖不用 CSS `transform: scale` 放大（Safari 會糊）；用 `FigureViewer`。
- 不下載網頁字型。
- 動畫只用在換題、面板開合、作答回饋，150–300ms。
