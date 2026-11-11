# app/src/data：畫面取用資料的唯一入口

畫面（`src/pages/`、`src/ui/`）只能 `import … from "@/data"`。不得 import `./db`、不得直接 `fetch` 內容、不得直接用 `indexedDB` 或 `localStorage`。
第 1B 階段已把「只存本機」換成「本機＋同步」：只改了這個資料夾裡的實作，匯出的名稱與型別不變（另外新增了同步、登入、離線下載用的匯出）。

| 檔案 | 內容 |
|---|---|
| `types.ts` | 內容契約與個人資料表的型別（欄位照規格書 §4.3、§4.6） |
| `content.ts` | 讀內容：`info`、`taxonomy`、`index`、`row`、`question`、`kb`、`bodyIds`、`sampleCases`、`assetUrl`。讀檔順序：記憶體 → IndexedDB（`cfile`）→ 網路。manifest 存在 `kv["content.manifest"]`；伺服器的 `manifest_h` 變了才換版，而且要「開著離線下載的科目」全部下載完才換；舊檔由 `gc` 清掉。`question()` 斷線又沒下載時回 `"missing"` |
| `sync.ts` | 同步（規格書 §8）：`enqueue`／`kick`（作答後 2 秒送出）、`syncNow`、`startSync`（開 App、回到前景、恢復連線、App 開著每 30 秒）、`useSyncState`、`useSyncDetail`。push 一次 ≤ 500 列；pull 用 `kv["sync.cursor"]`，伺服器的 head 比游標小（例如 D1 被還原）時從 0 重拉 |
| `auth.ts` | `auth.login`、`logout`（先同步再登出，本機資料保留）、`devices`、`revoke`、`exportUrl` |
| `net.ts` | `fetch` 的包裝：401 → 轉登入頁；斷線、逾時、伺服器錯誤分成三種例外 |
| `db.ts` | Dexie 表定義（§4.6 全部的表＋`outbox`、`cfile`、`kv`）。只有這個資料夾可以 import |
| `personal.ts` | 寫入：`attempts`、`sessions`、`flags`、`settings`、`wipeLocal`。每個寫入和它的 `outbox` 列在同一個交易裡 |
| `prefs.ts` | 只屬於這台裝置的偏好（外觀、圖片反相、裝置名稱、各科離線下載開關），存 localStorage，不同步 |
| `hooks.ts` | React hooks：內容用 `useAsync` 系列，個人資料用 Dexie 的即時查詢 |
| `filter.ts` | 出題篩選的純函式 |
| `question.ts` | 題目判讀的純函式 |
| `srs-core.ts` | 間隔複習的純函式（ts-fsrs 包裝、評分換算、重播、錯題離開規則）；測試 `srs-core.test.ts`（`node --experimental-strip-types --test`） |
| `srs.ts` | 排程的資料操作：`applyAttempts`（封存時呼叫）、`reviewQueue`、`dueForecast`、`srs.add／remove／rebuild` |
| `search.ts`、`search.worker.ts` | 搜尋：背景執行緒直接讀 IndexedDB 的內容包，逐題比對 |

同步哪些表、用什麼規則合併，寫在 `schema/ts/sync-tables.ts`（Worker 與 App 共用）：`attempt`、`review_log` 只增不改；`session`、`srs_state`、`flag`、`setting` 以時間較新的為準。要同步新的表，在那裡加一筆，Worker 與 App 都會跟著改。

## 幾個要知道的約定

- **作答的「封存」**：`attempts.record()` 寫入的列帶 `open: 1`，代表使用者還停在那一題、信心程度（猜的／普通／很確定）還能改。換題、結束、App 進背景時畫面會呼叫 `attempts.seal()` 把 `open` 設成 0。伺服器的 `attempt` 表只增不改，所以 **只同步 `open = 0` 的列**（`seal` 時才放進 outbox）；`open` 這個欄位不送上去。上次沒正常離開而留下的未封存列，下次開 App 時 `startSync` 會封存並送出。
- **答錯**：`record()` 會同時把 `flag(wrong)` 設成 1。「粗心錯，不追蹤」是 `attempts.markCareless()`：`flag(wrong) = 0`、`srs_state.suspended = 1`。
- **排程（第 2 階段）**：在 `seal()` 之後由 `srs.applyAttempts()` 做（信心程度那時才定案）。排程的鍵是同題群組的代表題 `q:<canonical>`，用 `srsKey(id)` 取得；標記（錯題、星號）仍掛在各題自己身上。
- **模擬考**：交卷前的作答存在 `setting["exam.<場次>"]`（會同步），交卷時 `exam.submit()` 才記 `attempt`。
- **場次標題**：`session.filter.label` 是給人看的摘要（「物理・後西醫・高醫」），由 `describeFilter()` 產生；其餘欄位是原始條件。
- **設定分兩種**：`settings`（Dexie 的 `setting` 表，會同步，例如上次的出題條件 `practice.last`）與 `prefs`（localStorage，不同步）。
- **樣本**：正式內容沒有樣本模式，`bodyIds()` 回 `null`。`/dev/ui` 的「特殊情況題目」用發佈時一起產生的 `cases` 檔（`pmq publish` 呼叫 `sample.pick_cases`），不再讀 `app/fixtures/`。
- **內容網址**：`/c/…`、`/a/…` 由 Worker 從 R2 提供（要登入）。本機開發：`cd worker && pnpm dev`（需要 `worker/.dev.vars`），App 的 `pnpm dev` 會把 `/api`、`/c/`、`/a/` 轉給它（`PMQ_WORKER` 可改位址）。
