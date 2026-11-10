# 樣本情況對照表

由 `bin/pmq sample` 產生（2026-11-10T15:38:08）。樣本 262 題、總量 9.98 MB。
索引（`c/index/`）是兩科完整的，篩選器顯示的是真實題數；本文（`c/pack/`）只有下表與各來源類別隨機抽的題目。
樣本題的 ID 清單在 `c/sample-*.json` 的 `ids`；某題不在樣本裡時，畫面應顯示「本文未下載」而不是壞掉。

| 情況 | 科目 | 題目 | 說明 |
|---|---|---|---|
| `longest_ques` | PHY | 中興 115 50｜PHY-000141 | 最長的題幹 |
| `longest_ques` | BCH | 中山 115 28｜NSYSU-115-28 | 最長的題幹 |
| `longest_formula` | PHY | Serway Ch30 29｜PHY-004606 | 最長的公式（題幹或詳解） |
| `longest_formula` | BCH | 高醫 95 09｜KMU-95-09 | 最長的公式（題幹或詳解） |
| `longest_sol` | PHY | Giancoli Ch20 Q21｜PHY-006282 | 最長的詳解 |
| `longest_sol` | BCH | 高醫 114 18｜KMU-114-18 | 最長的詳解 |
| `table` | PHY | 台聯大 111 04｜PHY-001540 | 題幹含表格 |
| `table` | BCH | 高醫 95 48｜KMU-95-48 | 題幹含表格 |
| `table_in_sol` | PHY | 學習精要 Ch20 範例 Q16｜PHY-008608 | 詳解含寬表格 |
| `fig_svg` | PHY | 高醫 110 08｜PHY-000858 | 題圖是 SVG |
| `fig_svg` | PHY | 特訓班2 正課班作業二十一 Q6｜PHY-008203 | 題圖是 SVG |
| `fig_svg_mono` | PHY | 經典題型解析 Ch06 題型 Q21｜PHY-007680 | SVG 只用黑白灰（可反相） |
| `fig_svg_mono` | PHY | 經典題型解析 Ch30 題型 Q29｜PHY-009243 | SVG 只用黑白灰（可反相） |
| `fig_svg_color` | PHY | 清華 114 52｜PHY-000332 | 彩色 SVG（不可反相） |
| `fig_svg_color` | PHY | 高醫 112 60｜PHY-000555 | 彩色 SVG（不可反相） |
| `fig_png` | PHY | 中興 114 43｜PHY-000012 | 題圖是 PNG |
| `fig_png` | PHY | 學習精要 Ch01 範例 Q15｜PHY-007175 | 題圖是 PNG |
| `fig_png` | BCH | 亞大 112 32｜AU-112-32 | 題圖是 PNG |
| `fig_png` | BCH | 醫檢 113-2 51｜MLS-113-2-51 | 題圖是 PNG |
| `fig_png_max_w` | BCH | 亞大 108 60｜AU-108-60 | PNG 有最大寬度（生化 width=…cm） |
| `fig_png_max_w` | BCH | 慈濟 112 18｜TCU-112-18 | PNG 有最大寬度（生化 width=…cm） |
| `fig_q_and_sol` | PHY | 台綜大 105B2 02｜PHY-002076 | 題目版與解答版兩張圖（traced_q／traced） |
| `fig_q_and_sol` | PHY | 台綜大 105C2 02｜PHY-002091 | 題目版與解答版兩張圖（traced_q／traced） |
| `fig_many` | BCH | 中山 113 63｜NSYSU-113-63 | 一題多張圖 |
| `options_one_line` | PHY | 特訓班2 正課班作業十一 Q6｜PHY-008719 | 選項擠在同一行 |
| `options_one_line` | PHY | 學習精要 Ch10 範例 Q16｜PHY-007959 | 選項擠在同一行 |
| `options_image` | BCH | 高醫 111 72｜KMU-111-72 | 選項是圖 |
| `options_image` | BCH | 營養 115-1 50｜NUT-115-1-50 | 選項是圖 |
| `options_math` | PHY | 台綜大 114A 14｜PHY-001310 | 選項是公式 |
| `options_math` | PHY | 台綜大 108B1 07｜PHY-001800 | 選項是公式 |
| `options_long` | PHY | Serway Ch02 62｜PHY-002260 | 選項文字很長 |
| `options_long` | BCH | 中山 115 33｜NSYSU-115-33 | 選項文字很長 |
| `options_tail` | PHY | 特訓班2 正課班作業二十一 Q6｜PHY-008203 | 選項後還有補充文字或圖 |
| `options_tail` | PHY | 經典題型解析 Ch03 題型 Q8｜PHY-007308 | 選項後還有補充文字或圖 |
| `non_choice_text` | PHY | 台綜大 107A1 06｜PHY-001877 | 非選擇題（文字答案，自評） |
| `non_choice_text` | PHY | 學習精要 Ch08 範例 Q11｜PHY-007794 | 非選擇題（文字答案，自評） |
| `non_choice_numeric` | PHY | Giancoli Ch21 Q82｜PHY-006434 | 非選擇題（數值答案，自評） |
| `non_choice_numeric` | PHY | Giancoli Ch03 Q34｜PHY-004897 | 非選擇題（數值答案，自評） |
| `multi_answer` | PHY | 台聯大 108 24｜PHY-001764 | 複選題（answer.mode = all） |
| `multi_answer` | PHY | 台綜大 107B2 03｜PHY-001905 | 複選題（answer.mode = all） |
| `multi_answer` | BCH | 中興 113 55｜NCHU-113-55 | 複選題（answer.mode = all） |
| `multi_answer` | BCH | 中興 113 57｜NCHU-113-57 | 複選題（answer.mode = all） |
| `any_answer` | PHY | 中興 114 43｜PHY-000012 | 多個答案皆可／送分（mode = any） |
| `any_answer` | PHY | Serway Ch25 32｜PHY-004215 | 多個答案皆可／送分（mode = any） |
| `any_answer` | BCH | 中國 113 44｜CMU-113-44 | 多個答案皆可／送分（mode = any） |
| `any_answer` | BCH | 高醫 104 50｜KMU-104-50 | 多個答案皆可／送分（mode = any） |
| `pending_answer` | PHY | Serway Ch10 79｜PHY-002997 | 答案待定（mode = pending） |
| `pending_answer` | PHY | Serway Ch30 58｜PHY-004635 | 答案待定（mode = pending） |
| `group_shared` | PHY | 台聯大 108 09｜PHY-001749 | 題組：共用前提（group.gid） |
| `group_shared` | PHY | 台綜大 112B1 08｜PHY-001496 | 題組：共用前提（group.gid） |
| `group_parts` | PHY | 台大 112 06｜PHY-001532 | 一題多小題（group.parts） |
| `group_parts` | PHY | 台大 107 02｜PHY-001924 | 一題多小題（group.parts） |
| `opt_parse_failed` | PHY | 中興 112 38｜PHY-000638 | 選擇題但選項解析失敗（自評顯示） |
| `opt_parse_failed` | PHY | 經典題型解析 Ch09 題型 Q12｜PHY-007912 | 選擇題但選項解析失敗（自評顯示） |
| `issues` | PHY | Giancoli Ch27 Q02｜PHY-006843 | 有疑點（sol_meta.issues） |
| `no_sol` | PHY | Serway Ch21 79｜PHY-003905 | 沒有詳解 |
| `no_sol` | PHY | Serway Ch30 66｜PHY-004643 | 沒有詳解 |
| `no_idea` | PHY | Serway Ch22 54｜PHY-003984 | 沒有思路（生化全部沒有） |
| `no_idea` | PHY | Serway Ch30 64｜PHY-004641 | 沒有思路（生化全部沒有） |
| `no_idea` | BCH | 醫學 113-2 76｜MED-113-2-76 | 沒有思路（生化全部沒有） |
| `no_idea` | BCH | 營養 110-1 30｜NUT-110-1-30 | 沒有思路（生化全部沒有） |
| `teacher` | PHY | 學習精要 Ch07 範例 Q4｜PHY-007751 | 有老師原解（折疊區） |
| `teacher` | PHY | 特訓班1 正課班練習二十一 Q4｜PHY-008294 | 有老師原解（折疊區） |
| `source_answer` | PHY | 學習精要 Ch14 範例 Q10｜PHY-008248 | 教材原答與現行答案不同 |
| `source_answer` | PHY | Giancoli Ch15 Q32｜PHY-005877 | 教材原答與現行答案不同 |
| `alt_same` | PHY | 經典題型解析 Ch09 題型 Q13｜PHY-007913 | 有同題出處（alt_sources same） |
| `alt_same` | PHY | 學習精要 Ch26 範例 Q21｜PHY-008948 | 有同題出處（alt_sources same） |
| `canonical_other` | PHY | 高醫 107 40｜PHY-001010 | 同題群組的非代表題（canonical ≠ 自己） |
| `canonical_other` | PHY | 中興 111 36｜PHY-000806 | 同題群組的非代表題（canonical ≠ 自己） |
| `trust_official` | PHY | 中興 114 25｜PHY-000286 | 官方答案 |
| `trust_official` | PHY | 清華 115 42｜PHY-000153 | 官方答案 |
| `trust_official` | BCH | 營養 113-2 34｜NUT-113-2-34 | 官方答案 |
| `trust_official` | BCH | 高醫 109 89｜KMU-109-89 | 官方答案 |
| `trust_key` | PHY | Giancoli Ch28 C 22｜PHY-006899 | 答案表 |
| `trust_key` | PHY | Serway Ch28 16｜PHY-004442 | 答案表 |
| `trust_teacher` | PHY | 經典題型解析 Ch10 題型 Q22｜PHY-008000 | 老師答案 |
| `trust_teacher` | PHY | 經典題型解析 Ch12 題型 Q13｜PHY-008158 | 老師答案 |
| `trust_ai` | PHY | 台大 104 16｜PHY-002153 | AI 答案 |
| `trust_ai` | PHY | 學習精要 Ch05 範例 Q25｜PHY-007506 | AI 答案 |
| `long_label` | PHY | Giancoli Ch01 C 01｜PHY-004673 | 最長的來源名稱 |
| `long_label` | BCH | 醫學 110-1 100｜MED-110-1-100 | 最長的來源名稱 |
| `unicode_subsup` | PHY | 經典題型解析 Ch19 題型 Q3｜PHY-008566 | Unicode 上下標（CO₂、NAD⁺） |
| `unicode_subsup` | PHY | 經典題型解析 Ch20 題型 Q31｜PHY-008655 | Unicode 上下標（CO₂、NAD⁺） |
| `unicode_subsup` | BCH | 義守 114 34｜ISU-114-34 | Unicode 上下標（CO₂、NAD⁺） |
| `unicode_subsup` | BCH | 高醫 106 67｜KMU-106-67 | Unicode 上下標（CO₂、NAD⁺） |

## 各來源類別隨機題

| 科目 | 類別 | 題數 |
|---|---|---|
| BCH | 醫事國考 | 20 |
| BCH | 後中醫 | 20 |
| BCH | 後獸醫 | 20 |
| BCH | 後西醫 | 20 |
| BCH | 私醫 | 20 |
| PHY | 補習班教材 | 20 |
| PHY | 後西醫 | 20 |
| PHY | 原文書 | 20 |
| PHY | 轉學考 | 20 |

## 筆記區塊樹

- `BCH/2-3_PDH_TCA_and_Glyoxylate_Cycle`（02_學習筆記/02_生化/B2_代謝篇/2-3_PDH_TCA_and_Glyoxylate_Cycle.md）：{"heading": 25, "figure": 22, "list_item": 195, "table": 19, "paragraph": 27, "html": 3}；圖 22；考古題出處 88
- `PHY/Ch12動電學`（02_學習筆記/03_物理/2_電磁學/Ch12動電學.md）：{"heading": 1, "table_group": 10, "rule": 9, "quote": 3, "paragraph": 1}；圖 0；考古題出處 0
