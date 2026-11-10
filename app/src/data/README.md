# app/src/data：畫面取用資料的唯一入口

畫面（`src/pages/`、`src/ui/`）只能 `import … from "@/data"`。不得 import `./db`、不得直接 `fetch` 內容、不得直接用 `indexedDB` 或 `localStorage`。
第 1B 階段把「只存本機」換成「本機＋同步」時，只改這個資料夾裡的實作，匯出的名稱與型別不變，畫面不用改。

| 檔案 | 內容 | 1B 要做的事 |
|---|---|---|
| `types.ts` | 內容契約與個人資料表的型別（欄位照規格書 §4.3、§4.6） | 新增表時補型別 |
| `content.ts` | 讀內容包：`info`、`taxonomy`、`index`、`row`、`question`、`kb`、`bodyIds`、`assetUrl` | 改成下載到 IndexedDB、離線可讀；`question()` 對「還沒下載」回 `"missing"` 的行為保留 |
| `db.ts` | Dexie 表定義（§4.6 全部的表都已建好，另有 `outbox`） | 只有這個資料夾可以 import |
| `personal.ts` | 寫入：`attempts`、`sessions`、`flags`、`settings`、`wipeLocal` | 每個寫入後把列放進 `outbox` 並觸發同步 |
| `prefs.ts` | 只屬於這台裝置的偏好（外觀、圖片反相、裝置代號），存 localStorage | 裝置名稱可改 |
| `hooks.ts` | React hooks：內容用 `useAsync` 系列，個人資料用 Dexie 的即時查詢 | `useSyncState()` 換成真的狀態 |
| `filter.ts` | 出題篩選的純函式（條件比對、各選項題數、章節樹勾選、排題） | 第 2 階段加狀態條件（沒做過、做錯過…） |
| `question.ts` | 題目判讀的純函式（是否選擇題、切選項、判對錯） | — |

## 幾個要知道的約定

- **作答的「封存」**：`attempts.record()` 寫入的列帶 `open: 1`，代表使用者還停在那一題、信心程度（猜的／普通／很確定）還能改。換題、結束、App 進背景時畫面會呼叫 `attempts.seal()` 把 `open` 設成 0。伺服器的 `attempt` 表只增不改，所以 **1B 只能同步 `open = 0` 的列**；`open` 這個欄位不送上去。
- **答錯**：`record()` 會同時把 `flag(wrong)` 設成 1。「粗心錯，不追蹤」是 `attempts.markCareless()`：`flag(wrong) = 0`、`srs_state.suspended = 1`。第 2 階段的 FSRS 排程接在 `record()` 裡。
- **場次標題**：`session.filter.label` 是給人看的摘要（「物理・後西醫・高醫」），由 `describeFilter()` 產生；其餘欄位是原始條件。
- **設定分兩種**：`settings`（Dexie 的 `setting` 表，之後會同步，例如上次的出題條件 `practice.last`）與 `prefs`（localStorage，不同步）。
- **樣本模式**：`content.info().sample` 為 true 時只有部分題目有本文，`content.bodyIds()` 回傳那些題的 ID；正式內容包回 `null`（全部都有）。1B 移除對 `app/fixtures/` 的依賴後，這個機制可以沿用來表示「這一科還沒下載」。
- **內容網址**：1A 的 dev／preview 伺服器把 `app/fixtures/` 掛在 `/c/…`、`/a/…`（`vite.config.ts` 的 `contentFromFixtures`），與正式站 Worker 要提供的路徑相同。
