# postmed-qbank

後醫私人題庫網。規格與分階段計畫在 [docs/規劃/](docs/規劃/)——這是唯一的一份（iCloud 裡原本的 `04_題庫網規劃/` 已刪除）。

進度：

- **第 0 階段**（資料契約、轉接器、驗證報告、樣本）完成。[驗收紀錄](docs/第0階段驗收紀錄.md)
- **第 1A 階段**（介面與 UI 系統）程式寫完、建置通過，**尚未在瀏覽器實測**。[驗收紀錄與交接清單](docs/第1A階段驗收紀錄.md)

題庫與筆記的主檔不在這個專案裡，在 iCloud 的 `82_考題整理/`；路徑只寫在 `tools/pmq/pmq.toml`。

```
app/fixtures/   介面開發用樣本（bin/pmq sample 產生；說明見 README、對照表見 CASES.md）
app/            前端（Vite＋React＋TypeScript＋Tailwind）；UI 規範見 docs/UI規範.md、資料介面見 app/src/data/README.md
worker/         Worker 與 D1 migrations（第 1B 階段）
tools/pmq/      Mac 端指令（Python）；主檔路徑只寫在 tools/pmq/pmq.toml
tools/mathcheck Node＋KaTeX 公式檢查器（KaTeX 版本＝前端要用的版本）
schema/         內容契約 JSON Schema、選項解析共用測試案例、KaTeX 巨集表、TypeScript 版選項解析
docs/           規劃文件、UI 規範、基準數字、驗收紀錄與驗證報告、公式待修清單
bin/            pmq、cgit
```

## 指令

```sh
bin/pmq check            # 讀全部主檔→內容契約→驗證；報告寫到 reports/驗證報告.md 與 reports/check.json
bin/pmq check math       # 只跑公式排版檢查（結果 reports/math.json）
bin/pmq check answers    # 生化答案抽查：挑 20 題、擷取 PDF 片段到 reports/answer_excerpts.md
bin/pmq sample           # 產生 app/fixtures/
bin/cgit status          # 內容 git（.git 在 ~/Projects/postmed-content.git，工作區是 82_考題整理）
```

`check` 與 `sample` 只讀主檔，不寫入 `82_考題整理/`。剩餘磁碟 < 2 GB 時拒絕執行。雜湊與公式結果快取在 `~/Library/Caches/postmed-qbank/`。

## 前端

```sh
cd app
nvm use        # Node 22（這台機器預設的 node 20 跑不動 Vite 8）
pnpm install
pnpm dev       # http://localhost:5183 ；iPad 在同一個 Wi-Fi 下開終端機印出的 Network 網址
pnpm build     # 型別檢查＋建置到 app/dist/
```

dev 伺服器把 `app/fixtures/` 當成內容包，掛在和正式站相同的 `/c/…`、`/a/…`。元件與色彩對比表在 `/dev/ui`。

## 測試

```sh
(cd tools/pmq && ../../.venv/bin/python -m unittest discover -s tests -p "test_*.py")
node --experimental-strip-types --test schema/ts/options.test.ts
PYTHONPATH=tools/pmq .venv/bin/python tools/pmq/tests/parity.py   # 全庫 Python/TS 選項解析一致性
```

## 環境

- Python 3.14 venv：`.venv`（`pip install -r tools/pmq/requirements.txt`）。`pdftotext`（poppler）用於答案抽查。
- Node 22（`.nvmrc`）：`tools/mathcheck` 與 `app` 都用 `pnpm install`。兩邊的 `katex` 版本必須相同（目前 0.19.1）。
