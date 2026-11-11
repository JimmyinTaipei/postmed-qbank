# app/fixtures：介面開發用樣本

由 `bin/pmq sample` 從真實主檔產生（只讀主檔）。**第 1B 階段起 App 不再讀這個資料夾**：畫面的內容一律來自 Worker（`pmq publish` 發佈到 R2 的內容包），`/dev/ui` 的特殊情況題目也改用發佈出去的 `cases` 檔。這裡的樣本只留給測試與離線開發參考。除了這份說明與 `CASES.md`，其他檔案不進版本庫；需要時重跑 `bin/pmq sample`（約 1.5 分鐘）。

## 版面（與正式內容包相同，規格書 §4.1）

```
c/manifest.json                 入口：files.taxonomy / files.index.<科> / files.packs.<科/章> / files.kb.<科/doc> / files.sample
c/taxonomy-<hash>.json          科目、章節樹（物理 30 章＋分組；生化 33 章 3 層）、來源類別、來源清單
c/index/<科>-<hash>.json        該科「全部」題目的索引列（schema/index-row.schema.json）
c/pack/<科>/<章>-<hash>.json    {pack, questions:[…]}：只有樣本題的本文（schema/question.schema.json）
c/kb/<科>/<doc>-<hash>.json     筆記區塊樹（schema/kb.schema.json；簡化版）
c/sample-<hash>.json            {ids:[樣本題 ID], cases:{情況:{desc, ids}}, kb:[…]}
a/<sha256>.<副檔名>             圖檔；題目裡寫成 ![alt](fig:<fid>)，用題目的 figs[] 找 src
```

`manifest.json` 多了 `"sample": true`。正式內容包沒有 `sample` 檔，索引裡每一題都有本文。

## 要點

- 篩選器用索引算題數，是真實數字（物理 9,302、生化 3,742）。出題時只挑 `sample.ids` 裡的題；不在樣本裡的題，畫面顯示「本文未下載」而不是壞掉。
- 題目一律顯示成「`label`｜`id`」。
- 選項：`opt` 是 `[字母, 起, 訖]`，`opt_span` 是 `[題幹結束, 選項後補充開始]`，單位是 JavaScript 字串索引（UTF-16）。`opt` 為 null 或 `answer.mode` 是 text／numeric／pending 時用自評題。修訂疊加後要重算時，用 `schema/ts/options.ts`（與 Python 同規則，有共用測試）。
- 公式：`$…$`、`$$…$$`，判定規則同 `schema/ts/options.ts` 的 `mathRanges`；KaTeX 版本必須與 `tools/mathcheck/package.json` 相同（目前 0.19.1），巨集表 `schema/katex-macros.json`。
- 圖：`figs[].role` 是 q（題幹用）或 sol（思路、詳解、老師原解用）；同一個 `fid` 可能兩種 role 各一筆（題目版 traced_q 與完整版 traced）。`mono: true` 才提供反相。`max_w` 有值時當最大寬度（px）。`fallback` 是同一張圖的 PNG；為了守住 10 MB，樣本裡少數 fallback 沒有複製（見 manifest 的 `missing_fallbacks`），畫面不應依賴 fallback 一定存在。
- 來源徽章：`answer.trust`（official 官方答案／key 答案表／teacher 老師／ai AI／pending 待定）、`sol_meta.origin`（ai AI 詳解／mixed 老師核心式＋AI 補寫／teacher 老師詳解）。`human_verified` 目前全部 false，所以畫面上不會有「✓ 已確認」。不要顯示「未確認」（規格書 §4.4）。
- `sol_meta.issues` 非空時顯示「⚠ 疑點」。`teacher[]` 顯示成詳解下方的「老師原解」折疊區。
- 題庫裡沒有 6 個以上選項的題目；`break-ui` 要的「10 個選項」請用合成資料。

各種特殊情況分別是哪一題：見 [CASES.md](CASES.md)。
