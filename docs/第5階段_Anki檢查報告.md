# 第 5 階段開工前：Anki 匯出檔檢查（pmq anki inspect）

2026-11-11 由 Opus 執行。檔案：專案資料夾的 `Anki file/` 五個 `.apkg`（共約 700 MB；已加進 `.gitignore`，不進 git）。
指令：`bin/pmq anki inspect "Anki file"`（只讀；全程在記憶體裡讀，執行前後 `Anki file/` 與暫存資料夾的檔案都沒變；五個檔共不到 1 秒）。完整報告每次重跑會寫到 `reports/anki_inspect.md`，下面附的是這次的結果。

## 重點

- 五個都是 Anki 新封裝（`collection.anki21b`，zstd 壓縮）。卡片 30,018 張（生物 8,446、生化 3,523、物理 1,016、化學 3,146、英文 13,887）。
- **有用 FSRS**：卡片資料裡有穩定度／難度的共 1,342 張（英文 1,029、物理 89）；其餘大多是新卡。匯入時有 FSRS 狀態的直接讀，沒有的才用複習紀錄重播（規格書 §9.5）。
- 複習紀錄：英文 1,847 筆（2026-03-11～09-14）、物理 208 筆。匯出時有勾「包含排程資訊」。
- 媒體：英文只有聲音 7,436 個（33.4 MB）；物理只有圖片 470 個（22.2 MB）。所有卡片引用的圖與聲音都在檔裡（缺 0）。
- 英文只有一種筆記類型「0_後醫單字基本型」（11 個欄位：Word、Part of Speech、Meaning and Definition、Sentence…），佔 13,877 則；另有 6 則基本型、1 則克漏字。
- 物理有 5 種筆記類型，克漏字為主（MileDown 克漏字 516 張、0_後醫克漏字 373 張），421 張含 MathJax 公式（`\(...\)`）。
- 暫停的卡很多：物理 345 張（大多在 Other Resources 的 MCAT 牌組）、英文 710 張（高中 level 1 有 476 張）。
- **一個檔不等於一副牌**：Anki 匯出某副牌時，會把同一則筆記放在別副牌的卡一起帶出來（例如生化的檔裡有 22 張生物牌組的卡）。匯入要以「牌組」為單位選，不是以檔為單位；跨檔重複的筆記 15 則，匯入時用 guid 去重。
- 生物、化學有 Image Occlusion Enhanced（遮圖）卡共 1,277 張，英文與物理沒有；之後搬生物、化學時要另外處理。

## 待使用者決定（規格書 §14-3 與匯入範圍）

2026-11-11 使用者決定：

1. **§14-3 以牌組為單位搬家：接受。** 搬到網站的牌組就在網站複習，Anki 裡同一副牌不再用；要搬回 Anki 時匯成新牌（或先刪舊牌再匯入）。
2. **先搬英文**，子牌組：`05_English::1_高中核心6000單`（含 level 1–6）、`05_English::2_補習班講義`、`05_English::3_GRE紅寶書`、`05_English::4_TOEIC`（含 01–31）。共 13,621 張。
   不搬（之後再說）：`5_廣讀與學科單字`、`6_Grammar`、`9_字根字首`。
3. **英文的聲音要一起搬**（7,436 個、33 MB；放 R2、播放時才下載）。
4. **其次物理**，子牌組：自己的章節 `03_Physics::Ch0 …`～`Ch30 量子物理`（343 張）、`03_Physics::Other Resources::公式整理`（133 張）。
   不搬：Other Resources 底下的 MCAT Physics and Math、MCAT Essential Equations、Calculus Identities。
5. 生物、生化、化學：之後慢慢來，到時再問要哪些牌組（含 Image Occlusion 遮圖卡怎麼處理）。

還沒問、實作時用預設、使用者可改：暫停的卡照樣匯入並保持暫停（和 Anki 一致，之後可在網站取消暫停）。

---

產生時間：2026-11-11 16:01。只讀：沒有解壓到磁碟、沒有改任何檔。

## 總覽

| 檔案 | 大小 | 封裝 | 筆記 | 卡片 | 有 FSRS 狀態 | 複習紀錄 | 紀錄期間 | 圖片 | 聲音 |
|---|---:|---|---:|---:|---:|---:|---|---:|---:|
| 01_Biology.apkg | 316.1 MB | 新（anki21b） | 7,263 | 8,446 | 14 | 15 | 2026-02-28～2026-09-02 | 2,789（332.2 MB） | 0（0.0 MB） |
| 02_Biochemistry.apkg | 197.6 MB | 新（anki21b） | 2,361 | 3,523 | 156 | 754 | 2022-03-03～2026-07-30 | 1,502（207.6 MB） | 0（0.0 MB） |
| 03_Physics.apkg | 20.8 MB | 新（anki21b） | 794 | 1,016 | 89 | 208 | 2026-03-15～2026-09-02 | 470（22.2 MB） | 0（0.0 MB） |
| 04_Chemistry.apkg | 143.3 MB | 新（anki21b） | 2,134 | 3,146 | 54 | 91 | 2026-03-25～2026-08-31 | 2,591（149.1 MB） | 0（0.0 MB） |
| 05_English.apkg | 31.5 MB | 新（anki21b） | 13,884 | 13,887 | 1,029 | 1,847 | 2026-03-11～2026-09-14 | 0（0.0 MB） | 7,436（33.4 MB） |

跨檔重複的筆記（同一個 guid 出現在兩個以上的檔）：15 則。

## 01_Biology.apkg

### 牌組

「本身」是直接放在這副牌的卡；「含子牌組」是連同底下所有子牌組。

| 牌組 | 本身 | 含子牌組 | 新卡 | 學習中 | 複習中 | 暫停 | 有 FSRS | 含圖片 | 含聲音 | 含公式 | 複習紀錄 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 01_Biology | 0 | 8,425 | 8,411 | 9 | 5 | 4,050 | 14 | 3,185 | 0 | 65 | 15 |
| 　Ch01 生命的研究 | 73 | 73 | 71 | 1 | 1 | 1 | 2 | 0 | 0 | 0 | 2 |
| 　Ch02 生命化學 | 140 | 140 | 140 | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 0 |
| 　Ch04 細胞學 | 11 | 11 | 10 | 1 | 0 | 0 | 1 | 0 | 0 | 2 | 1 |
| 　Ch05 生物能量學 | 49 | 49 | 39 | 7 | 3 | 0 | 10 | 0 | 0 | 4 | 10 |
| 　Other Resources | 0 | 8,152 | 8,151 | 0 | 1 | 4,049 | 1 | 3,185 | 0 | 44 | 2 |
| 　　Campbell Biology | 0 | 2,481 | 2,481 | 0 | 0 | 2,481 | 0 | 112 | 0 | 44 | 0 |
| 　　Campbell Biology Testbank | 0 | 1,542 | 1,541 | 0 | 1 | 1,542 | 1 | 115 | 0 | 0 | 2 |
| 　　　Chapter 26 | 66 | 66 | 65 | 0 | 1 | 66 | 1 | 2 | 0 | 0 | 2 |
| 　　　Chapter 27 | 75 | 75 | 75 | 0 | 0 | 75 | 0 | 1 | 0 | 0 | 0 |
| 　　　Chapter 28 | 92 | 92 | 92 | 0 | 0 | 92 | 0 | 0 | 0 | 0 | 0 |
| 　　　Chapter 30 | 112 | 112 | 112 | 0 | 0 | 112 | 0 | 0 | 0 | 0 | 0 |
| 　　　Chapter 31 | 108 | 108 | 108 | 0 | 0 | 108 | 0 | 16 | 0 | 0 | 0 |
| 　　　Chapter 33 | 113 | 113 | 113 | 0 | 0 | 113 | 0 | 15 | 0 | 0 | 0 |
| 　　　Chapter 34 | 161 | 161 | 161 | 0 | 0 | 161 | 0 | 19 | 0 | 0 | 0 |
| 　　　Chapter 35 | 87 | 87 | 87 | 0 | 0 | 87 | 0 | 5 | 0 | 0 | 0 |
| 　　　Chapter 38 | 105 | 105 | 105 | 0 | 0 | 105 | 0 | 3 | 0 | 0 | 0 |
| 　　　Chapter 39 | 128 | 128 | 128 | 0 | 0 | 128 | 0 | 4 | 0 | 0 | 0 |
| 　　　Chapter 40 | 97 | 97 | 97 | 0 | 0 | 97 | 0 | 2 | 0 | 0 | 0 |
| 　　　Chapter 47 | 112 | 112 | 112 | 0 | 0 | 112 | 0 | 3 | 0 | 0 | 0 |
| 　　　Chapter 52 | 93 | 93 | 93 | 0 | 0 | 93 | 0 | 13 | 0 | 0 | 0 |
| 　　　Chapter 53 | 96 | 96 | 96 | 0 | 0 | 96 | 0 | 23 | 0 | 0 | 0 |
| 　　　Chapter 54 | 97 | 97 | 97 | 0 | 0 | 97 | 0 | 9 | 0 | 0 | 0 |
| 　　　06 Plants | 0 | 499 | 499 | 0 | 0 | 499 | 0 | 0 | 0 | 44 | 0 |
| 　　　　Ch35 Vascular Plant Structure, Growth, and Development | 140 | 140 | 140 | 0 | 0 | 140 | 0 | 0 | 0 | 0 | 0 |
| 　　　　Ch36 Resource Acquuisition and Transport in Vascular Plants | 93 | 93 | 93 | 0 | 0 | 93 | 0 | 0 | 0 | 19 | 0 |
| 　　　　Ch37 Soil and Plant Nutrition | 103 | 103 | 103 | 0 | 0 | 103 | 0 | 0 | 0 | 20 | 0 |
| 　　　　Ch38 Angiosperm Reproduction and Biotechnology | 76 | 76 | 76 | 0 | 0 | 76 | 0 | 0 | 0 | 0 | 0 |
| 　　　　Ch39 Plant Responases to Internal and External Signals | 87 | 87 | 87 | 0 | 0 | 87 | 0 | 0 | 0 | 5 | 0 |
| 　　　Glossary | 1,982 | 1,982 | 1,982 | 0 | 0 | 1,982 | 0 | 112 | 0 | 0 | 0 |
| 　　MCAT Biology | 1,039 | 1,039 | 1,039 | 0 | 0 | 0 | 0 | 1,039 | 0 | 0 | 0 |
| 　　普生 | 306 | 3,090 | 3,090 | 0 | 0 | 26 | 0 | 1,919 | 0 | 0 | 0 |
| 　　　DAT Bootcamp - Plants | 215 | 215 | 215 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| 　　　chap 06 神經系統 | 113 | 113 | 113 | 0 | 0 | 0 | 0 | 86 | 0 | 0 | 0 |
| 　　　chap 07 感覺系統 | 60 | 60 | 60 | 0 | 0 | 0 | 0 | 26 | 0 | 0 | 0 |
| 　　　chap 08 骨骼肌肉系統 | 46 | 46 | 46 | 0 | 0 | 0 | 0 | 35 | 0 | 0 | 0 |
| 　　　chap 09 呼吸系統 | 86 | 86 | 86 | 0 | 0 | 0 | 0 | 59 | 0 | 0 | 0 |
| 　　　chap 10 內分泌系統 | 109 | 109 | 109 | 0 | 0 | 0 | 0 | 64 | 0 | 0 | 0 |
| 　　　chap 11 消化系統 | 60 | 60 | 60 | 0 | 0 | 0 | 0 | 59 | 0 | 0 | 0 |
| 　　　chap 12 泌尿系統 | 95 | 95 | 95 | 0 | 0 | 0 | 0 | 81 | 0 | 0 | 0 |
| 　　　chap 13 生殖系統 | 57 | 57 | 57 | 0 | 0 | 0 | 0 | 41 | 0 | 0 | 0 |
| 　　　chap 14 胚胎學 | 35 | 35 | 35 | 0 | 0 | 0 | 0 | 32 | 0 | 0 | 0 |
| 　　　chap 15 | 59 | 59 | 59 | 0 | 0 | 0 | 0 | 45 | 0 | 0 | 0 |
| 　　　chap 16 | 90 | 90 | 90 | 0 | 0 | 0 | 0 | 79 | 0 | 0 | 0 |
| 　　　chap 17 | 52 | 52 | 52 | 0 | 0 | 0 | 0 | 39 | 0 | 0 | 0 |
| 　　　chap 18 | 17 | 17 | 17 | 0 | 0 | 0 | 0 | 11 | 0 | 0 | 0 |
| 　　　chap 19 | 25 | 25 | 25 | 0 | 0 | 0 | 0 | 8 | 0 | 0 | 0 |
| 　　　chap 20 | 41 | 41 | 41 | 0 | 0 | 0 | 0 | 35 | 0 | 0 | 0 |
| 　　　chap 21 | 55 | 55 | 55 | 0 | 0 | 0 | 0 | 33 | 0 | 0 | 0 |
| 　　　chap 22 | 93 | 93 | 93 | 0 | 0 | 0 | 0 | 78 | 0 | 0 | 0 |
| 　　　chap 23 | 95 | 95 | 95 | 0 | 0 | 0 | 0 | 60 | 0 | 0 | 0 |
| 　　　chap 24 | 91 | 91 | 91 | 0 | 0 | 0 | 0 | 73 | 0 | 0 | 0 |
| 　　　chap 25 | 59 | 59 | 59 | 0 | 0 | 0 | 0 | 43 | 0 | 0 | 0 |
| 　　　chap 26 | 120 | 120 | 120 | 0 | 0 | 0 | 0 | 56 | 0 | 0 | 0 |
| 　　　chap 27 | 232 | 232 | 232 | 0 | 0 | 0 | 0 | 76 | 0 | 0 | 0 |
| 　　　chap 28 | 210 | 210 | 210 | 0 | 0 | 0 | 0 | 165 | 0 | 0 | 0 |
| 　　　chap 29 | 240 | 240 | 240 | 0 | 0 | 0 | 0 | 198 | 0 | 0 | 0 |
| 　　　chap 30 | 113 | 113 | 113 | 0 | 0 | 0 | 0 | 94 | 0 | 0 | 0 |
| 　　　chap 31 | 34 | 34 | 34 | 0 | 0 | 0 | 0 | 14 | 0 | 0 | 0 |
| 　　　chap 32 | 49 | 49 | 49 | 0 | 0 | 0 | 0 | 21 | 0 | 0 | 0 |
| 　　　chap 33 | 45 | 45 | 45 | 0 | 0 | 0 | 0 | 21 | 0 | 0 | 0 |
| 　　　chap 34 | 65 | 65 | 65 | 0 | 0 | 0 | 0 | 45 | 0 | 0 | 0 |
| 　　　chap 35 | 38 | 38 | 38 | 0 | 0 | 0 | 0 | 17 | 0 | 0 | 0 |
| 　　　chap 36 | 33 | 33 | 33 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 |
| 　　　chap 37 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| 　　　chap 38 | 49 | 49 | 49 | 0 | 0 | 0 | 0 | 16 | 0 | 0 | 0 |
| 02_Biochemistry | 0 | 10 | 10 | 0 | 0 | 10 | 0 | 10 | 0 | 0 | 0 |
| 　Other Resources | 0 | 10 | 10 | 0 | 0 | 10 | 0 | 10 | 0 | 0 | 0 |
| 　　MCAT Biochemistry | 10 | 10 | 10 | 0 | 0 | 10 | 0 | 10 | 0 | 0 | 0 |
| 04_Chemistry | 0 | 10 | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 |
| 　Other Resource | 0 | 10 | 10 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 0 |
| 　　MCAT Organic Chemistry | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 0 |
| 　　普化 | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 6 | 0 | 0 | 0 |
| 自己都不相信你別人怎麼會 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 |
| 　MileDown's MCAT Decks | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 |

### 筆記類型（卡片樣板）

| 類型 | 克漏字 | 欄位 | 卡片樣板 | 筆記 | 卡片 | 範例（第一個欄位） |
|---|---|---|---|---:|---:|---|
| Basic+ | 否 | Front、Back | Card 1 | 3,540 | 3,540 | 5′ cap<br>ABC hypothesis |
| 1Cloze | 是 | Text、Extra | Cloze | 1,015 | 1,457 | {{c1:: Atrophy萎縮 }}is the partial or complete&nbsp; wasting &nbsp;away of a part<br>桿狀細胞對{{c1::510}}nm波長的光最敏感 |
| Cloze-MileDown-b279e | 是 | Text、Extra | Cloze | 619 | 1,137 | The {{c2:: nucleoid類核 }} &nbsp;region is found in {{c1::prokaryotes::eukaryotes <br>The nucleolus makes {{c1::ribosomes}} |
| 0_後醫基本型 | 否 | Front、Back、Extra、Image、Source | 卡片 1 | 669 | 669 | In plants, a tissue is defined as a group of cells consisting of one or more cel<br>An organ in a plant consists of several types of _** that together carry out par |
| Image Occlusion Enhanced | 否 | ID (hidden)、Header、Image、Question Mask、Footer、Remarks、Sources、Extra 1、Extra 2、Answer Mask、Original Mask | IO Card | 578 | 578 | 8f5745abfe664d4599731e686f0dcc9d-ao-1<br>8f5745abfe664d4599731e686f0dcc9d-ao-2 |
| Cloze-MCAT from AnKing | 是 | Text、YouTube Link(s)、Extra、Related Missed Questions (On Exams, Practice, etc.)、Article Link(s)、Outline Link(s)、More Explanation/Images、Practice Discrete Questions For This Topic - Link(s)、Lecture Notes | Cloze | 261 | 368 | 在細胞中，有{{c1::DNA}}就是{{c2::雙}}層結構 包括{{c1::細胞核}}、{{c1::粒線體}}、{{c1::葉綠體}}<br>細胞核平均直徑約{{c1::5μm}} |
| 1Cloze-有機 | 是 | Text、original、Extra | Cloze | 235 | 317 | Alkaptonuria尿黑酸尿症無法代謝{{c1::tyrosine}}&amp;{{c1::phenylalanine::胺基酸}}<br>原核生物轉錄轉譯都在cytosol {{c1::沒有::有無}}RNA processing |
| Basic Quizlet-d7210 | 否 | Front、Back、Add Reverse | Normal、Reverse | 215 | 215 | what are the 3 main components of a seed?<br>the _____ is a hard outer layer that covers and protects the seed from various e |
| 0_後醫克漏字 | 是 | Text、Extra、Image、Source | 克漏字 | 75 | 103 | 元素 (element) 是指無法由{{c1::化學反應}}分解成其他物質的物質。<br>{{c1::化合物 (compound)}} 係由二種或以上不同的元素以固定的比例組成的物質。 |
| 1Basic | 否 | Front、Back | Card 1 | 31 | 31 | 風盒作用 windkessel effect<br>互利適應 |
| Cloze-AnKingMaster | 是 | Text、Extra、Lecture Notes、Missed Questions、Pathoma、Boards and Beyond、First Aid、Sketchy、Physeo、Additional Resources | Cloze | 8 | 14 | most plant and animal cells are {{c1::100 μm::size}} ~&nbsp;{{c1::10μm}}<br>nucleus, most bacteria and motochondion are {{c1::10 μm::size}} ~&nbsp;{{c1::1μm |
| Image Occlusion Enhanced+ | 否 | ID (hidden)、Header、Image、Question Mask、Footer、Remarks、Sources、Extra 1、Extra 2、Answer Mask、Original Mask | IO Card | 13 | 13 | 2b3b0a97e2d64b4aab2d4f43063fbee1-ao-1<br>2b3b0a97e2d64b4aab2d4f43063fbee1-ao-2 |
| 基本 | 否 | 前面、後面 | 卡片 1 | 3 | 3 | 血液組成 血液分哪兩部分?各佔幾趴? @血漿是啥、主要組成*6、功能 @血中的細胞從哪裡來、分幾種(大概各佔幾趴) -為什麼需要紅血球攜氧、紅血球特點*2(形狀<br>血管的種類 動脈的定義、動脈一定帶攜氧血嗎 @動脈結構? -what has most elastic fiber?&nbsp; where can you f |
| Cloze | 是 | Text、Extra | Cloze | 1 | 1 | 群體感應是因為碰撞機會增加而形成 {{c1:: N ::YN?}} |

### 媒體

| 種類 | 檔數 | 大小 | 在 .apkg 裡 |
|---|---:|---:|---:|
| 圖片 | 2,789 | 332.2 MB | 314.3 MB |

- 卡片引用了但檔案不在 .apkg 裡：圖片 0、聲音 0
- 在 .apkg 裡但沒有卡片引用：1 個（0.1 MB）

### 標籤（共 123 種，列出最常用的 15 個）

01_Biology::Campbell（1,542）、01_Biology::Campbell_TestBank（1,542）、01_Biology::Campbell::Ch35（140）、01_Biology::講義AI::Ch2（128）、01_Biology::Campbell::Ch37（103）、01_Biology::Campbell::Ch36（93）、MileDown::Behavioral::Biology_and_Behavior::Brain（88）、MileDown::Biology::Endocrine（87）、01_Biology::Campbell::Ch39（87）、01_Biology::Campbell::Ch38（76）、Abdullah::#Kaplan::Biology::10-Homeostasis（73）、01_Biology::講義AI::Ch1（73）、Abdullah::#Kaplan::Biology::11-The_Musculoskeletal_System（71）、Abdullah::#Kaplan::Biology::07-The_Cardiovascular_System（69）、MileDown::Biology::Cardiovascular_System（69）

## 02_Biochemistry.apkg

### 牌組

「本身」是直接放在這副牌的卡；「含子牌組」是連同底下所有子牌組。

| 牌組 | 本身 | 含子牌組 | 新卡 | 學習中 | 複習中 | 暫停 | 有 FSRS | 含圖片 | 含聲音 | 含公式 | 複習紀錄 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 01_Biology | 0 | 22 | 22 | 0 | 0 | 11 | 0 | 22 | 0 | 0 | 0 |
| 　Other Resources | 0 | 22 | 22 | 0 | 0 | 11 | 0 | 22 | 0 | 0 | 0 |
| 　　普生 | 16 | 22 | 22 | 0 | 0 | 11 | 0 | 22 | 0 | 0 | 0 |
| 　　　chap 10 內分泌系統 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| 　　　chap 11 消化系統 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| 　　　chap 12 泌尿系統 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| 　　　chap 15 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 |
| 02_Biochemistry | 0 | 3,500 | 3,344 | 11 | 145 | 3,315 | 156 | 3,402 | 0 | 5 | 754 |
| 　01 Proteins | 0 | 8 | 3 | 2 | 3 | 0 | 5 | 1 | 0 | 1 | 14 |
| 　　01 Amino Acids | 5 | 5 | 0 | 2 | 3 | 0 | 5 | 1 | 0 | 1 | 14 |
| 　　06 Amino Acid Biosynthesis | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 　02 Enzymes | 1 | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1 |
| 　03 Carbohydrates | 0 | 3 | 2 | 0 | 1 | 2 | 1 | 1 | 0 | 2 | 4 |
| 　　02 Metabolism Introduction | 2 | 2 | 1 | 0 | 1 | 1 | 1 | 1 | 0 | 1 | 4 |
| 　　03 Glycolysis | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| 　Other Resources | 0 | 3,488 | 3,339 | 8 | 141 | 3,313 | 149 | 3,400 | 0 | 2 | 735 |
| 　　Amino Acids | 107 | 107 | 0 | 0 | 107 | 0 | 107 | 107 | 0 | 0 | 548 |
| 　　Amino Acids+ | 49 | 49 | 49 | 0 | 0 | 49 | 0 | 10 | 0 | 0 | 0 |
| 　　Functional groups | 44 | 44 | 14 | 3 | 27 | 0 | 30 | 44 | 0 | 0 | 155 |
| 　　MCAT Biochemistry | 855 | 855 | 854 | 0 | 1 | 855 | 1 | 855 | 0 | 2 | 2 |
| 　　Organic Chemistry Mechanisms | 54 | 54 | 54 | 0 | 0 | 54 | 0 | 54 | 0 | 0 | 0 |
| 　　Zanki Biochemistry | 0 | 2,355 | 2,348 | 5 | 2 | 2,355 | 7 | 2,313 | 0 | 0 | 13 |
| 　　　Metabolism | 1,266 | 1,266 | 1,262 | 2 | 2 | 1,266 | 4 | 1,253 | 0 | 0 | 10 |
| 　　　Molecular, Cellular, Genetics | 777 | 777 | 777 | 0 | 0 | 777 | 0 | 752 | 0 | 0 | 0 |
| 　　　Vitamins | 312 | 312 | 309 | 3 | 0 | 312 | 3 | 308 | 0 | 0 | 3 |
| 　　生化 | 24 | 24 | 20 | 0 | 4 | 0 | 4 | 17 | 0 | 0 | 17 |
| 自己都不相信你別人怎麼會 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 |
| 　MileDown's MCAT Decks | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | 0 |

### 筆記類型（卡片樣板）

| 類型 | 克漏字 | 欄位 | 卡片樣板 | 筆記 | 卡片 | 範例（第一個欄位） |
|---|---|---|---|---:|---:|---|
| Cloze-AnKingMaster | 是 | Text、Extra、Lecture Notes、Missed Questions、Pathoma、Boards and Beyond、First Aid、Sketchy、Physeo、Additional Resources | Cloze | 1,717 | 2,355 | {{c1::Hereditary Spherocytosis}} is an autosomal dominant hematological disorder<br>{{c1::Patau Syndrome (Trisomy 13)}} is an autosomal trisomy that is associated w |
| Cloze-MileDown-b279e | 是 | Text、Extra | Cloze | 515 | 893 | A {{c1::positive::positive or negative}} sense RNA strand is itself an mRNA and <br>{{c2:: }} This amino acid is {{c1::Glycine::Full Name}}, {{c1::GLY::3 Letter Nam |
| Molecular Compound | 否 | FullName、ThreeLetter、OneLetter、Image、ChemicalType、Notes、R-Group-pKa | Structure、FullName、ThreeLetter、OneLetter、ChemicalType、R Group pKa | 20 | 107 | alanine<br>arginine |
| Basic (and reversed card)+ | 否 | Front、Back、Extra | Card 1、Card 2 | 51 | 102 | <br> |
| 0_後醫克漏字 | 是 | Text、Extra、Image、Source | 克漏字 | 44 | 50 | Cysteine forms a {{c1::disulfide bridge}} in a {{c2::oxidizing}} environment.<br>The amino acid {{c1::cysteine}} has a sulfhydrl group |
| 0_後醫基本型 | 否 | Front、Back、Extra、Image、Source | 卡片 1 | 11 | 11 | 代謝心法（從甲基到\(\ce{CO_2}\)）<br>Metabolism 章節架構 |
| 1Cloze | 是 | Text、Extra | Cloze | 2 | 4 | {{c1::tyrosine}}&nbsp;is the precursor to&nbsp;{{c2::catecholamines}}<br>{{c2::肝細胞}}中含大量{{c1::過氧化小體}}，有助於酒精代謝形成醛 |
| 克漏題 | 是 | 文字、附加 | 克漏題 | 1 | 1 | All chiral amino acids except {{c1::cysteine}} have (S) configuration |

### 媒體

| 種類 | 檔數 | 大小 | 在 .apkg 裡 |
|---|---:|---:|---:|
| 圖片 | 1,502 | 207.6 MB | 196.8 MB |

- 卡片引用了但檔案不在 .apkg 裡：圖片 0、聲音 0
- 在 .apkg 裡但沒有卡片引用：1 個（0.1 MB）

### 標籤（共 506 種，列出最常用的 15 個）

AK_Step1::Biochem::metabolism::carbs（299）、AK_Step1::Biochem::Molecular（275）、AK_Step1::Biochem::metabolism::fat（254）、AK_Step1::^EXPN::BGedit（217）、AK_Step1::^FA_Updates::FA2018（201）、AK_Step1::Biochem::vitamins（192）、AK_Step1::Biochem::metabolism::protein（190）、Abdullah::#Kaplan::Biochemistry::09_to_12-Metabolism（171）、AK_Step1::Biochem::genetics（141）、AK_Step1::^EXPN::Uworld（126）、AK_Step1::$AnKingUpdates::#Zanki::NotDoing（125）、AK_Step1::Biochem::BGadds（102）、AK_Step1::Biochem::CellBio（98）、AK_Step1::^EXPN::BGadd（96）、AK_Step1::#B&B::Biochemistry::04_Vitamins::03_Other_vitamins（87）

## 03_Physics.apkg

### 牌組

「本身」是直接放在這副牌的卡；「含子牌組」是連同底下所有子牌組。

| 牌組 | 本身 | 含子牌組 | 新卡 | 學習中 | 複習中 | 暫停 | 有 FSRS | 含圖片 | 含聲音 | 含公式 | 複習紀錄 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 03_Physics | 0 | 1,016 | 926 | 36 | 54 | 345 | 89 | 552 | 0 | 421 | 208 |
| 　Ch0 Math, Constants & Units | 15 | 163 | 121 | 12 | 30 | 36 | 41 | 0 | 0 | 108 | 117 |
| 　　Constants & Units | 58 | 58 | 49 | 3 | 6 | 14 | 8 | 0 | 0 | 9 | 17 |
| 　　Math | 0 | 90 | 58 | 9 | 23 | 13 | 32 | 0 | 0 | 84 | 99 |
| 　　　Algebra | 15 | 15 | 0 | 4 | 11 | 0 | 15 | 0 | 0 | 15 | 32 |
| 　　　Calculus | 1 | 35 | 23 | 5 | 7 | 9 | 12 | 0 | 0 | 35 | 54 |
| 　　　　Differential | 19 | 19 | 10 | 4 | 5 | 6 | 9 | 0 | 0 | 19 | 39 |
| 　　　　Integrals | 15 | 15 | 13 | 1 | 1 | 3 | 2 | 0 | 0 | 15 | 10 |
| 　　　Trigonometric | 22 | 22 | 17 | 0 | 5 | 0 | 5 | 0 | 0 | 22 | 13 |
| 　　　Values that needs to remember | 14 | 14 | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |
| 　　　Vector | 4 | 4 | 4 | 0 | 0 | 4 | 0 | 0 | 0 | 4 | 0 |
| 　Ch01 一維運動 | 28 | 28 | 25 | 2 | 1 | 1 | 3 | 0 | 0 | 25 | 17 |
| 　Ch02 二維運動 | 9 | 9 | 3 | 2 | 4 | 0 | 6 | 0 | 0 | 9 | 6 |
| 　Ch03 牛頓三定律之應用 | 9 | 9 | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 0 |
| 　Ch04 功與能 | 9 | 9 | 9 | 0 | 0 | 1 | 0 | 0 | 0 | 8 | 0 |
| 　Ch05 質心運動及動量守恆 | 12 | 12 | 11 | 1 | 0 | 0 | 1 | 0 | 0 | 12 | 1 |
| 　Ch06 轉動與滾動 | 33 | 33 | 14 | 3 | 16 | 6 | 19 | 10 | 0 | 32 | 44 |
| 　Ch07 震盪 | 13 | 13 | 9 | 4 | 0 | 2 | 4 | 0 | 0 | 13 | 4 |
| 　Ch08 重力場及重力位能 | 11 | 11 | 5 | 6 | 0 | 3 | 6 | 4 | 0 | 11 | 6 |
| 　Ch09 電場 | 12 | 12 | 7 | 5 | 0 | 1 | 5 | 0 | 0 | 12 | 5 |
| 　Ch10 電位能與電位 | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| 　Ch11 電容器與電容 | 11 | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 11 | 0 |
| 　Ch12 動電學 | 11 | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 11 | 0 |
| 　Ch13 磁場 | 8 | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |
| 　Ch14 載流導線四周建立磁場 | 8 | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |
| 　Ch29 特殊相對論 | 3 | 3 | 2 | 1 | 0 | 1 | 1 | 0 | 0 | 2 | 1 |
| 　Ch30 量子物理 | 1 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| 　Other Resources | 0 | 673 | 670 | 0 | 3 | 293 | 3 | 538 | 0 | 140 | 7 |
| 　　Calculus Identities (Derivatives, Integrals, Trig) | 24 | 24 | 24 | 0 | 0 | 24 | 0 | 24 | 0 | 0 | 0 |
| 　　MCAT Essential Equations | 88 | 88 | 87 | 0 | 1 | 52 | 1 | 88 | 0 | 0 | 2 |
| 　　MCAT Physics and Math | 428 | 428 | 426 | 0 | 2 | 217 | 2 | 426 | 0 | 7 | 5 |
| 　　公式整理 | 133 | 133 | 133 | 0 | 0 | 0 | 0 | 0 | 0 | 133 | 0 |

### 筆記類型（卡片樣板）

| 類型 | 克漏字 | 欄位 | 卡片樣板 | 筆記 | 卡片 | 範例（第一個欄位） |
|---|---|---|---|---:|---:|---|
| Cloze-MileDown-b279e | 是 | Text、Extra | Cloze | 314 | 516 | {{c1::Vectors}} are physical quantities that have {{c2::both&nbsp; magnitude &nb<br>{{c1::Scalars}} are quantities that have {{c2::only a magnitude }}. |
| 0_後醫克漏字 | 是 | Text、Extra、Image、Source | 克漏字 | 353 | 373 | \(A \cdot A =\) {{c1::\(\| A \|^{2}\)}} (dot product)<br>\(A \times A =\) {{c1::\(0\)}} (cross product) |
| 0_後醫基本型 | 否 | Front、Back、Extra、Image、Source | 卡片 1 | 117 | 117 | SI Base Units - Length(L)<br>SI Base Units -&nbsp;Mass |
| Cloze | 是 | Text、Extra | Cloze | 9 | 9 | The value of Planck's Constant (\(h\)) is {{c1::\(6.626 \times 10^{-34} J \space<br>The value of Rydberg's Constant (\(R\)) is {{c1::\(1.097 \times 10^{7} \space m^ |
| Basic+ | 否 | Front、Back | Card 1 | 1 | 1 | Simplify \(\cfrac{1}{(r-a)^2} - \cfrac{1}{(r+a)^2}\) |

### 媒體

| 種類 | 檔數 | 大小 | 在 .apkg 裡 |
|---|---:|---:|---:|
| 圖片 | 470 | 22.2 MB | 20.6 MB |

- 卡片引用了但檔案不在 .apkg 裡：圖片 0、聲音 0
- 在 .apkg 裡但沒有卡片引用：0 個（0.0 MB）

### 標籤（共 94 種，列出最常用的 15 個）

03_Physics::Formula（239）、Abdullah::OrthoUpdated::Equations（89）、Abdullah::OrthoUpdated::Misc._Topics::Equations（89）、MileDown::All_MCAT_Equations（89）、09_Integrated::Values&Units（73）、MileDown::All_MCAT_Equations::Physics（65）、MileDown::Physics::Equations（65）、Contributor::github.com/Raagaception（33）、03_Physics::Math::Differential（33）、MileDown::Physics::Light（31）、03_Physics::Math（29）、MileDown::Physics::Fluids（25）、MileDown::Physics::Electrostatics::Equations（24）、MileDown::Physics::Nuclear_Phenomena（24）、MileDown::Physics::Circuits（21）

## 04_Chemistry.apkg

### 牌組

「本身」是直接放在這副牌的卡；「含子牌組」是連同底下所有子牌組。

| 牌組 | 本身 | 含子牌組 | 新卡 | 學習中 | 複習中 | 暫停 | 有 FSRS | 含圖片 | 含聲音 | 含公式 | 複習紀錄 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 01_Biology | 0 | 6 | 6 | 0 | 0 | 1 | 0 | 6 | 0 | 0 | 0 |
| 　Other Resources | 0 | 6 | 6 | 0 | 0 | 1 | 0 | 6 | 0 | 0 | 0 |
| 　　MCAT Biology | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| 　　普生 | 5 | 5 | 5 | 0 | 0 | 1 | 0 | 5 | 0 | 0 | 0 |
| 04_Chemistry | 0 | 3,140 | 3,085 | 30 | 25 | 224 | 54 | 2,208 | 0 | 107 | 91 |
| 　Ch0 入門知識 | 66 | 66 | 63 | 2 | 1 | 5 | 3 | 26 | 0 | 4 | 3 |
| 　Ch0-0 元素週期表 | 389 | 389 | 357 | 17 | 15 | 72 | 32 | 0 | 0 | 3 | 56 |
| 　Ch01 原子結構和週期表 | 97 | 97 | 91 | 1 | 5 | 5 | 6 | 6 | 0 | 18 | 12 |
| 　Ch02 化學鍵理論和分子形狀 | 2 | 2 | 2 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| 　Ch03 基礎有機 | 16 | 16 | 16 | 0 | 0 | 1 | 0 | 10 | 0 | 0 | 0 |
| 　Ch04 化學物質的命名 | 194 | 194 | 181 | 9 | 4 | 5 | 13 | 178 | 0 | 0 | 19 |
| 　Ch05 化學物質的結構資訊 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 　Ch08 液體和固體 | 3 | 3 | 2 | 1 | 0 | 0 | 0 | 3 | 0 | 0 | 1 |
| 　Ch14 化學動力學 | 41 | 41 | 41 | 0 | 0 | 0 | 0 | 33 | 0 | 0 | 0 |
| 　Other Resource | 0 | 2,331 | 2,331 | 0 | 0 | 134 | 0 | 1,952 | 0 | 82 | 0 |
| 　　MCAT General Chemistry | 442 | 442 | 442 | 0 | 0 | 0 | 0 | 442 | 0 | 3 | 0 |
| 　　MCAT Organic Chemistry | 523 | 523 | 523 | 0 | 0 | 0 | 0 | 521 | 0 | 8 | 0 |
| 　　Nomenclature | 0 | 134 | 134 | 0 | 0 | 134 | 0 | 63 | 0 | 71 | 0 |
| 　　　Inorganic IUPAC Nomenclature | 49 | 49 | 49 | 0 | 0 | 49 | 0 | 0 | 0 | 49 | 0 |
| 　　　Organic IUPAC Nomenclature | 85 | 85 | 85 | 0 | 0 | 85 | 0 | 63 | 0 | 22 | 0 |
| 　　普化 | 346 | 1,232 | 1,232 | 0 | 0 | 0 | 0 | 926 | 0 | 0 | 0 |
| 　　　chap 01 原子結構和週期表 | 133 | 133 | 133 | 0 | 0 | 0 | 0 | 93 | 0 | 0 | 0 |
| 　　　chap 02 化學鍵理論和分子形狀 | 99 | 99 | 99 | 0 | 0 | 0 | 0 | 82 | 0 | 0 | 0 |
| 　　　chap 06 溶液中的化學反應 | 289 | 289 | 289 | 0 | 0 | 0 | 0 | 237 | 0 | 0 | 0 |
| 　　　chap 07 氣體 | 44 | 44 | 44 | 0 | 0 | 0 | 0 | 36 | 0 | 0 | 0 |
| 　　　chap 08 液體和固體 | 99 | 99 | 99 | 0 | 0 | 0 | 0 | 69 | 0 | 0 | 0 |
| 　　　chap 09 | 63 | 63 | 63 | 0 | 0 | 0 | 0 | 43 | 0 | 0 | 0 |
| 　　　chap 10 | 29 | 29 | 29 | 0 | 0 | 0 | 0 | 5 | 0 | 0 | 0 |
| 　　　chap 11 | 21 | 21 | 21 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| 　　　chap 12 | 20 | 20 | 20 | 0 | 0 | 0 | 0 | 13 | 0 | 0 | 0 |
| 　　　chap 13 | 52 | 52 | 52 | 0 | 0 | 0 | 0 | 37 | 0 | 0 | 0 |
| 　　　chap 15 | 37 | 37 | 37 | 0 | 0 | 0 | 0 | 24 | 0 | 0 | 0 |

### 筆記類型（卡片樣板）

| 類型 | 克漏字 | 欄位 | 卡片樣板 | 筆記 | 卡片 | 範例（第一個欄位） |
|---|---|---|---|---:|---:|---|
| Cloze-MileDown-b279e | 是 | Text、Extra | Cloze | 537 | 987 | In element notation, A is the &nbsp; {{c1::Mass number}}<br>In element notation,&nbsp;Z is the {{c1::atomic number}} |
| Image Occlusion Enhanced | 否 | ID (hidden)、Header、Image、Question Mask、Footer、Remarks、Sources、Extra 1、Extra 2、Answer Mask、Original Mask | IO Card | 681 | 681 | 2e2bb3fb73914f1da7e2c432a99643ff-ao-1<br>2e2bb3fb73914f1da7e2c432a99643ff-ao-2 |
| 1Cloze | 是 | Text、Extra | Cloze | 304 | 447 | {{c1::道爾吞Dalton}}提出{{c2::原子假說}} 認為{{c3::原子為組成元素的最小且不可分割單位}}<br>{{c1::湯姆生Thomson}}提出{{c2::布丁葡萄乾模型}} 他{{c3::透過陰極射線實驗發現有電子::透過什麼實驗發現啥}} |
| 1_元素週期表 | 否 | 元素符號、原子序、中文名稱、英文名稱 | 卡片 1、卡片 2、卡片 3、卡片 4、卡片 5 | 70 | 349 | H<br>He |
| 0_後醫克漏字 | 是 | Text、Extra、Image、Source | 克漏字 | 131 | 176 | {{c1::密利根}}透過{{c2::油滴}}實驗 發現{{c3::電子的電量(電賀)1eV=1.6X10 -19 J 並推算出電子重量9.11X10 -31 <br>{{c1::莫色勒}}透過{{c3::X射線光譜}}實驗 證實{{c2::原子序的物理意義是原子中質子數量}} |
| Cloze | 是 | Text、Extra | Cloze | 71 | 133 | The formula of {{c1::Barium Azide}} is {{c2::\(\ce{Ba(N3)2}\)}}<br>The formula of {{c1::Diaminomethanal}} is {{c2::\(\ce{NH2CONH2}\)}}. It is also  |
| 0_後醫基本型 | 否 | Front、Back、Extra、Image、Source | 卡片 1 | 104 | 104 | 黑體<br> |
| 1Basic | 否 | Front、Back | Card 1 | 88 | 88 | 原子序1~30<br> |
| 1Cloze-有機 | 是 | Text、original、Extra | Cloze | 66 | 83 | 這是{{c1::離子}}異構物<br>這是{{c1::鍵聯}}異構物 |
| Cloze-MCAT from AnKing | 是 | Text、YouTube Link(s)、Extra、Related Missed Questions (On Exams, Practice, etc.)、Article Link(s)、Outline Link(s)、More Explanation/Images、Practice Discrete Questions For This Topic - Link(s)、Lecture Notes | Cloze | 54 | 70 | 動物細胞ECM 相當於植物細胞的{{c1::細胞壁}} 植物細胞壁共有{{c2::cellulose}}、{{c2::hemicellulose}}、{{c2:<br>{{c1::proteoglycans}} 會連接到 {{c2::polysaccharide}} 上形成ECM |
| Basic+ | 否 | Front、Back | Card 1 | 11 | 11 | Identify the compound.<br>特別強的化學鍵&nbsp; 好像可以當離去基？（查閱用） |
| 2Basic-with extra | 否 | name、front、back、extra | Card 1 | 11 | 11 | 酸性鹽<br> |
| Image Occlusion Enhanced+ | 否 | ID (hidden)、Header、Image、Question Mask、Footer、Remarks、Sources、Extra 1、Extra 2、Answer Mask、Original Mask | IO Card | 5 | 5 | dc22ec6bad5d4a90a8236e8091040ed8-oa-1<br>dc22ec6bad5d4a90a8236e8091040ed8-oa-2 |
| 基本 | 否 | 前面、後面 | 卡片 1 | 1 | 1 | 2021/3/7 Molecular orbital theory, explain. |

### 媒體

| 種類 | 檔數 | 大小 | 在 .apkg 裡 |
|---|---:|---:|---:|
| 圖片 | 2,591 | 149.1 MB | 142.6 MB |

- 卡片引用了但檔案不在 .apkg 裡：圖片 0、聲音 0
- 在 .apkg 裡但沒有卡片引用：0 個（0.0 MB）

### 標籤（共 277 種，列出最常用的 15 個）

04_Chemistry::Periodic_Table（109）、Abdullah::#Kaplan::General_Chemistry::04-Compounds_&_Stoichiometry（86）、Contributor::github.com/Raagaception（72）、Abdullah::#Kaplan::General_Chemistry::02-Periodic_Table（56）、Abdullah::#Kaplan::General_Chemistry::10-Acids_&_Bases（48）、MileDown::General_Chemistry::Periodic_Table（47）、MileDown::OChem::Separations（46）、MileDown::OChem::Reactions（45）、Abdullah::#Kaplan::Organic_Chemistry::12-Separations_&_Purifications（44）、04_Chemistry::Ch01_原子結構與週期表::AI（44）、MileDown::OChem::Aldehydes_and_Ketones（38）、04_Chemistry::有效數字（37）、MileDown::OChem::Nomenclature（36）、MileDown::General_Chemistry::Bonding（35）、Abdullah::#Kaplan::General_Chemistry::07-Thermochemistry（35）

## 05_English.apkg

### 牌組

「本身」是直接放在這副牌的卡；「含子牌組」是連同底下所有子牌組。

| 牌組 | 本身 | 含子牌組 | 新卡 | 學習中 | 複習中 | 暫停 | 有 FSRS | 含圖片 | 含聲音 | 含公式 | 複習紀錄 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 05_English | 0 | 13,887 | 12,858 | 347 | 682 | 710 | 1,029 | 0 | 7,423 | 0 | 1,847 |
| 　1_高中核心6000單 | 0 | 5,424 | 4,972 | 52 | 400 | 553 | 452 | 0 | 1,976 | 0 | 1,059 |
| 　　level 1 | 925 | 925 | 649 | 20 | 256 | 476 | 276 | 0 | 87 | 0 | 737 |
| 　　level 2 | 890 | 890 | 819 | 17 | 54 | 52 | 71 | 0 | 216 | 0 | 76 |
| 　　level 3 | 972 | 972 | 910 | 7 | 55 | 21 | 62 | 0 | 299 | 0 | 117 |
| 　　level 4 | 926 | 926 | 907 | 5 | 14 | 4 | 19 | 0 | 454 | 0 | 34 |
| 　　level 5 | 894 | 894 | 889 | 0 | 5 | 0 | 5 | 0 | 521 | 0 | 12 |
| 　　level 6 | 817 | 817 | 798 | 3 | 16 | 0 | 19 | 0 | 399 | 0 | 83 |
| 　2_補習班講義 | 836 | 836 | 833 | 1 | 2 | 0 | 3 | 0 | 426 | 0 | 9 |
| 　3_GRE紅寶書 | 4,755 | 4,755 | 4,739 | 9 | 7 | 1 | 16 | 0 | 4,755 | 0 | 42 |
| 　4_TOEIC | 0 | 2,606 | 2,055 | 282 | 269 | 152 | 551 | 0 | 265 | 0 | 722 |
| 　　01_雇用 | 88 | 88 | 13 | 33 | 42 | 21 | 75 | 0 | 19 | 0 | 132 |
| 　　02_規則、法律 | 66 | 66 | 13 | 27 | 26 | 13 | 53 | 0 | 11 | 0 | 60 |
| 　　03_一般工作1 | 102 | 102 | 7 | 54 | 41 | 7 | 95 | 0 | 21 | 0 | 101 |
| 　　04_一般工作2 | 95 | 95 | 15 | 45 | 35 | 15 | 80 | 0 | 14 | 0 | 105 |
| 　　05_一般工作3 | 87 | 87 | 13 | 32 | 42 | 13 | 74 | 0 | 12 | 0 | 74 |
| 　　06_休閒、社交 | 79 | 79 | 79 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |
| 　　07_行銷1 | 90 | 90 | 90 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 |
| 　　08_行銷2 | 78 | 78 | 78 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 |
| 　　09_經濟 | 77 | 77 | 77 | 0 | 0 | 0 | 0 | 0 | 5 | 0 | 0 |
| 　　10_購物 | 78 | 78 | 49 | 17 | 12 | 7 | 29 | 0 | 8 | 0 | 37 |
| 　　11_產品開發 | 80 | 80 | 80 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |
| 　　12_生產 | 93 | 93 | 93 | 0 | 0 | 0 | 0 | 0 | 12 | 0 | 0 |
| 　　13_顧客服務 | 86 | 86 | 86 | 0 | 0 | 0 | 0 | 0 | 8 | 0 | 0 |
| 　　14_旅遊、機場 | 73 | 73 | 19 | 34 | 20 | 19 | 54 | 0 | 7 | 0 | 55 |
| 　　15_契約 | 76 | 76 | 76 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 |
| 　　16_商業 | 90 | 90 | 90 | 0 | 0 | 0 | 0 | 0 | 10 | 0 | 0 |
| 　　17_貿易、貨運 | 88 | 88 | 88 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 0 |
| 　　18_住宿、餐廳 | 77 | 77 | 77 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 0 |
| 　　19_收益 | 81 | 81 | 81 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 |
| 　　20_會計 | 88 | 88 | 88 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 0 |
| 　　21_公司動向 | 64 | 64 | 64 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 |
| 　　22_會議 | 94 | 94 | 94 | 0 | 0 | 0 | 0 | 0 | 6 | 0 | 0 |
| 　　23_員工福利 | 86 | 86 | 86 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 |
| 　　24_人事異動 | 76 | 76 | 76 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 0 |
| 　　25_交通 | 93 | 93 | 93 | 0 | 0 | 0 | 0 | 0 | 9 | 0 | 0 |
| 　　26_銀行 | 99 | 99 | 98 | 1 | 0 | 0 | 1 | 0 | 14 | 0 | 6 |
| 　　27_投資 | 85 | 85 | 81 | 3 | 1 | 2 | 4 | 0 | 9 | 0 | 4 |
| 　　28_建築、住宅 | 89 | 89 | 89 | 0 | 0 | 0 | 0 | 0 | 14 | 0 | 0 |
| 　　29_環境 | 65 | 65 | 13 | 32 | 20 | 15 | 52 | 0 | 6 | 0 | 61 |
| 　　30_健康 | 64 | 64 | 30 | 4 | 30 | 40 | 34 | 0 | 4 | 0 | 87 |
| 　　31_慣用語 | 119 | 119 | 119 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 　5_廣讀與學科單字 | 9 | 9 | 4 | 2 | 3 | 0 | 5 | 0 | 1 | 0 | 13 |
| 　6_Grammar | 7 | 10 | 10 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| 　　單句 | 3 | 3 | 3 | 0 | 0 | 2 | 0 | 0 | 0 | 0 | 0 |
| 　9_字根字首 | 247 | 247 | 245 | 1 | 1 | 2 | 2 | 0 | 0 | 0 | 2 |

### 筆記類型（卡片樣板）

| 類型 | 克漏字 | 欄位 | 卡片樣板 | 筆記 | 卡片 | 範例（第一個欄位） |
|---|---|---|---|---:|---:|---|
| 0_後醫單字基本型 | 否 | Word、Part of Speech、Meaning and Definition、Sentence、Memo & Confusable、Derivative、Synonyms、Antonyms、Prefix & Roots、Image、Source | 卡片 1 | 13,877 | 13,877 | abash<br>abate |
| 0_後醫基本型 | 否 | Front、Back、Extra、Image、Source | 卡片 1 | 6 | 6 | 不完全動詞<br>補語類型 |
| 0_後醫克漏字 | 是 | Text、Extra、Image、Source | 克漏字 | 1 | 4 | {{c4::be composed of}} = {{c1::be made up of}} = {{c2::consist of}} = {{c3::comp |

### 媒體

| 種類 | 檔數 | 大小 | 在 .apkg 裡 |
|---|---:|---:|---:|
| 聲音 | 7,436 | 33.4 MB | 26.9 MB |

- 卡片引用了但檔案不在 .apkg 裡：圖片 0、聲音 0
- 在 .apkg 裡但沒有卡片引用：0 個（0.0 MB）

### 標籤（共 388 種，列出最常用的 15 個）

05_English::RedBook（6,591）、05_English::Handouts_Vocab（1,216）、05_english::高中::Level_1（975）、05_english::高中::Level_3（972）、05_english::高中::Level_4（927）、05_english::高中::Level_5（894）、05_english::高中::Level_2（890）、05_english::高中::Level_6（817）、05_English::#Prefix::in-il-im-ir-（612）、05_English::#Prefix::con-com-col-cor-co-（456）、05_English::#Prefix::re-（394）、05_English::Handouts_Vocab::TOEFL（327）、05_English::#Prefix::ex-e-ec-ef-（319）、05_English::#Prefix::ad-ac-af-ag-al-ap-ar-as-at-（311）、05_English::#Prefix::de-（252）

