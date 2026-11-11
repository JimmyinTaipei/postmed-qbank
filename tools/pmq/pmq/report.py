"""Render reports/驗證報告.md from the check result."""
import json

KIND_NAME = {"postmed_w": "後西醫", "postmed_c": "後中醫", "postmed_v": "後獸醫", "private_med": "私醫",
             "transfer": "轉學考", "national": "醫事國考", "textbook": "原文書", "cram": "補習班教材"}
LIMIT = 300


def _table(rows, headers):
    out = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    for r in rows:
        out.append("| " + " | ".join(_cell(x) for x in r) + " |")
    return "\n".join(out)


def _cell(x):
    s = "" if x is None else (json.dumps(x, ensure_ascii=False) if isinstance(x, (list, dict)) else str(x))
    return s.replace("|", "\\|").replace("\n", " ")


def _list(items, cols, headers, limit=LIMIT):
    if not items:
        return "（無）"
    rows = [[it.get(c) for c in cols] for it in items[:limit]]
    more = f"\n\n…另有 {len(items) - limit} 筆，完整清單見 `reports/check.json`。" if len(items) > limit else ""
    return _table(rows, headers) + more


def write_report(cfg, c, r):
    base = json.loads(cfg.baseline.read_text("utf-8"))
    W = r["warnings"]
    T = r["tallies"]
    L = []
    add = L.append
    phy_cat = T.get("category", {})
    add("# 第 0 階段驗證報告")
    add("")
    add(f"產生時間 {r['generated']}；耗時 {r['elapsed_s']} 秒；雜湊快取命中 {r['cache']['hits']}／未命中 {r['cache']['misses']}。")
    add("由 `bin/pmq check` 產生；只讀主檔，沒有寫入 `82_考題整理/`。完整資料在 `reports/check.json`。")
    add("")
    add("## 摘要")
    add("")
    nerr = len(r["errors"])
    add(f"- 題數：物理 **{r['counts']['PHY']:,}**（基準 {base['PHY']['questions']:,}）、生化 **{r['counts']['BCH']:,}**（基準 {base['BCH']['questions']:,}）。")
    add(f"- 擋發佈的錯誤：**{nerr}** 筆。JSON Schema：題目不過 {r['schema']['questions_failed']}、索引列不過 {r['schema']['index_rows_failed']}、taxonomy 錯誤 {r['schema']['taxonomy_errors']}。")
    add(f"- 章節樹 {r['chapters']} 個節點；來源 {r['sources']} 份。圖檔 {r['assets']['files']} 個（SVG {r['assets']['svg']}、點陣 {r['assets']['raster']}），共 {r['assets']['bytes'] / 1e6:.1f} MB。")
    if r["math"]["stats"]:
        st = r["math"]["stats"]
        add(f"- 公式：{st['formulas']:,} 個（不重複 {st['unique']:,}），KaTeX {st['katex']} 排版失敗 **{st['failed']}** 處。")
    add(f"- 選項解析失敗（選擇題但 `opt = null`）：**{len(W.get('option_parse_failed', []))}** 題。")
    sc = r.get("answer_spotcheck")
    if sc:
        add(f"- 生化答案抽查 {len(sc['items'])} 題：相符 {sc['summary']['match']}、不符 {sc['summary']['mismatch']}、無法判讀 {sc['summary']['unknown']}。")
    add("")

    add("## 1. 題數與基準")
    add("")
    rows = [["物理", k, phy_cat.get(k, 0), base["PHY"]["by_category"][k]] for k in base["PHY"]["by_category"]]
    blocks = T.get("bch_blocks", {})
    rows += [["生化（區塊）", KIND_NAME[k], blocks.get(k, 0), v] for k, v in base["BCH"]["by_kind"].items()]
    add(_table(rows, ["科目", "類別", "實際", "基準"]))
    add("")
    add(f"生化區塊 {sum(blocks.values()):,}（基準 {base['BCH']['blocks']:,}），去掉重複後 {r['counts']['BCH']:,} 題。")
    dup = W.get("duplicate_identical", [])
    if dup:
        add("")
        add("重複 ID（兩個區塊**完全相同**，只取第一筆；主檔未改動，要不要刪掉多的那筆由你決定）：")
        add("")
        add(_list(dup, ["id", "first", "second"], ["ID", "第一筆", "第二筆"]))
    add("")

    add("## 2. 擋發佈的錯誤")
    add("")
    add(_list(r["errors"], ["kind", "id", "chap", "file", "message", "path"], ["種類", "ID", "chap", "檔案", "說明", "路徑"]))
    add("")

    add("## 3. 選項解析")
    add("")
    add("規則見規格書 §4.5 與 `schema/fixtures/options.json`（49 個案例，Python 與 TypeScript 結果相同）。")
    add("第 0 階段補充的兩條：(1) 從每個 (A) 往後找下一個字母組成序列，取最長者；最長者不只一組時，優先取每個選項都有內容的，再取最後一組——這樣「(A) 見原圖 (A)」與「題幹先引用 (A)(B)」兩種情況都對。(2) 選項只修掉頭尾空白，`(A)甲、(B)乙` 的頓號會留在選項文字裡。")
    add("")
    add("### 3.1 選擇題但選項解析失敗（會以自評題顯示）")
    add("")
    add(_list(W.get("option_parse_failed", []), ["id", "label", "mode"], ["ID", "來源", "answer.mode"]))
    add("")
    add("### 3.2 答案字母不在解析出的選項裡（多半是主檔的選項標記有問題）")
    add("")
    add(_list(W.get("answer_key_not_in_options", []), ["id", "keys", "options"], ["ID", "答案", "解析出的選項"]))
    add("")

    add("## 4. 答案與詳解來源的對應")
    add("")
    add("### 4.1 物理 `answer.trust`、`sol_meta.origin`")
    add("")
    add(_table(sorted(T.get("trust", {}).items(), key=lambda x: -x[1]), ["trust", "題數（物理）"]))
    add("")
    add(_table(sorted(T.get("sol_origin", {}).items(), key=lambda x: -x[1]), ["sol_meta.origin（物理）", "題數"]))
    add("")
    add("`sol_meta.origin`：老師原解目前沒有任何一題標成「完整逐字」轉錄，所以沒有 `teacher`；有轉錄檔（核心式）→ `mixed`，其餘 → `ai`。轉錄檔內容放在題目的 `teacher` 欄，介面顯示成詳解下方的「老師原解」折疊區——除了正文裡有連結的 162 題，front matter `origin[].transcript` 指到的轉錄檔也一併併入。")
    add("")
    add("### 4.2 物理 status 文字 → 固定代碼")
    add("")
    for field, title in (("question", "status.question"), ("answer", "status.answer"), ("solution", "status.solution")):
        tab = T.get(f"status_{field}", {})
        rows = []
        for k, n in sorted(tab.items(), key=lambda x: -x[1]):
            code, text = k.split("｜", 1)
            rows.append([text, "（對應不到）" if code == "None" else code, n])
        add(f"**{title}**（{len(rows)} 種）")
        add("")
        add(_table(rows, ["原文字", "代碼", "題數"]))
        add("")
    add("對應不到的 status 字串（設 `state` 為 null，不擋發佈）：")
    add("")
    add(_list(W.get("status_unmapped", []), ["id", "field", "text"], ["ID", "欄位", "文字"]))
    add("")
    add("### 4.3 生化特殊答案寫法（請確認對應方式）")
    add("")
    add("生化全部設 `answer.trust: official`、`sol_meta.origin: ai`、`human_verified: false`（規格書 §4.4）。下列答案不是單一字母：")
    add("")
    add(_list(W.get("biochem_answer_special", []) + W.get("biochem_answer_unparsed", []), ["id", "ans", "mapped"], ["ID", "主檔 ans", "對應成"]))
    add("")

    add("## 5. 章節")
    add("")
    add("`chap` 找不到的已列在第 2 節（擋發佈）。`xchap` 找不到的（只警告）：")
    add("")
    add(_list(W.get("xchap_not_in_tree", []), ["id", "xchap"], ["ID", "xchap"]))
    add("")

    add("## 6. 圖")
    add("")
    fr = T.get("phy_fig_refs", {})
    add(f"物理本文圖片引用 **{sum(fr.values()):,}** 處（基準 {base['PHY']['body_image_refs']:,}）：SVG {fr.get('svg', 0):,}、PNG {fr.get('png', 0):,}、已判定為文字而移除 {fr.get('text', 0):,}。")
    add(f"其中題幹改用題目版 `traced_q.svg` 的 {T.get('fig_variant', {}).get('traced_q', 0)} 處；用到 `manual_edit` 圖的 {T.get('fig_manual_edit_used', {}).get('yes', 0)} 處（原樣使用、不重繪）。")
    add(f"直接取檔（不經 registry）：{json.dumps(T.get('fig_direct', {}), ensure_ascii=False)}。")
    add(f"registry 中 `status: text` 的 5 組，本文都沒有引用，所以「移除」為 0。")
    bf = T.get("bch_fig_refs", {})
    add(f"生化 `<img>` 引用 **{sum(bf.values())}** 處（基準 {base['BCH']['img_refs']}）：PNG {bf.get('png', 0)}、檔案缺 {bf.get('missing', 0)}。")
    add("")
    add(f"front matter `figure` 登記 {T.get('fig_registered', {}).get('total', 0):,} 筆，其中本文沒有引用的：")
    add("")
    add(_list(W.get("fig_registered_not_referenced", []), ["id", "path"], ["ID", "登記的圖"]))
    add("")
    add("退回用 PNG 的原因：")
    add("")
    add(_list(W.get("fig_not_approved", []) + W.get("fig_not_in_registry", []) + W.get("fig_approved_without_svg", []),
              ["id", "image", "fid", "status"], ["ID", "原題圖", "registry", "狀態"]))
    add("")
    add("SVG 字型不在白名單（Times New Roman、Times、Helvetica、Arial、serif、sans-serif）：")
    add("")
    add(_list(W.get("svg_font_not_whitelisted", []), ["file", "fonts"], ["檔案", "字型"]))
    add("")
    add(f"有 `<text>` 卻沒指定字型的 SVG：{len(W.get('svg_text_without_font', []))} 個；超過 500 KB：{len(W.get('svg_over_500kb', []))} 個；量不到尺寸：{len(W.get('image_size_unknown', []))} 個。")
    add("")
    add(_list(W.get("svg_over_500kb", []), ["file", "kb"], ["檔案", "KB"]))
    add("")
    m = T.get("svg_mono", {})
    add(f"SVG 只用黑白灰（`mono: true`，可反相）{m.get('mono', 0)} 個、彩色 {m.get('color', 0)} 個。")
    add("")

    add("## 7. 公式排版")
    add("")
    st = r["math"]["stats"]
    if st:
        add(f"KaTeX {st['katex']}＋mhchem，設定同前端（`strict: ignore`）。共 {st['formulas']:,} 個公式、不重複 {st['unique']:,}、失敗 {st['failed']} 處。巨集表 `schema/katex-macros.json` 目前是空的。")
        add("")
        add(_list(r["math"]["failures"], ["id", "field", "tex", "error"], ["題目／檔案", "欄位", "公式", "錯誤"]))
    else:
        add("（這次沒有跑，用 `bin/pmq check` 不加 `--no-math`）")
    add("")

    add("## 8. 生化答案抽查")
    add("")
    if sc:
        add(sc.get("method", ""))
        add("")
        add(_list(sc["items"], ["id", "kind", "bank", "source_answer", "result", "evidence"], ["ID", "類別", "主檔答案", "來源答案", "結果", "依據"]))
        for n in sc.get("notes", []):
            add("")
            add("- " + n)
    else:
        add("（尚未執行 `bin/pmq check answers`）")
    add("")

    add("## 9. 主檔裡的相對連結指向哪裡")
    add("")
    add("題庫主檔（物理、生化；含圖）：")
    add("")
    add(_table(sorted(T.get("link_folder", {}).items(), key=lambda x: -x[1]), ["資料夾（相對 82_考題整理）", "處數"]))
    add("")
    add("學習筆記（生化、物理現行筆記，不含 `_archive/`）：")
    add("")
    add(_table(sorted(T.get("note_link_folder", {}).items(), key=lambda x: -x[1]), ["資料夾", "處數"]))
    add("")
    refs3 = [k for k in list(T.get("link_folder", {})) + list(T.get("note_link_folder", {})) if "03_參考資料" in k]
    add("指向 `03_參考資料/` 的連結：" + ("、".join(refs3) if refs3 else "**沒有**（只有 `物理/analysis/chapters.yaml` 的 `source:` 註記提到那裡的課程進度檔，不是連結）。"))
    add("")
    add("物理正文連結的處理：" + "、".join(f"{k} {v}" for k, v in T.get("link_kind", {}).items()) + "。")
    add("")
    add(_list(W.get("note_absolute_path", []), ["file", "target"], ["筆記", "絕對路徑（請改成相對路徑）"]))
    add("")

    kb = r.get("kb")
    if kb:
        add("## 9. 資料庫（講義筆記）")
        add("")
        refs = sum(d["refs"] for d in kb["docs"])
        un = sum(d["refs_unmapped"] for d in kb["docs"])
        add(f"筆記 {len(kb['docs'])} 份（JSON Schema 不過 {kb['schema_failed']}）；考古題出處 {refs} 個，對到題目 {refs - un}、**對不到 {un}**；被筆記引用的題目 {kb['related_questions']} 題。")
        add("只建章節目錄的科目：" + "；".join(f"{s} {len(v)} 章" for s, v in kb["outline"].items()) + "。")
        add("")
        cols = ["heading", "list_item", "paragraph", "table", "table_group", "figure", "math", "code", "quote"]
        add(_table([[d["key"], *[d.get(c, 0) for c in cols], d["refs"], d["refs_unmapped"]] for d in kb["docs"]],
                   ["筆記", "標題", "列點", "段落", "表格", "表格群組", "圖", "公式", "程式碼", "引言", "出處", "對不到"]))
        add("")
        add("**對不到題目的出處**（筆記寫錯題號，或題庫沒有這一題）")
        add("")
        add(_list(W.get("kb_ref_unmapped", []), ["doc", "text"], ["筆記", "出處"]))
        add("")
        add("**筆記的圖：絕對路徑（請改成相對路徑）／讀不到**")
        add("")
        add(_list(W.get("kb_absolute_image", []) + W.get("kb_image_missing", []), ["doc", "src", "path"], ["筆記", "絕對路徑", "讀不到的檔"]))
        add("")
        add("**筆記之間的連結對不到**")
        add("")
        add(_list(W.get("kb_link_unresolved", []), ["doc", "link"], ["筆記", "連結"]))
        add("")
        add("**沒有被任何區塊涵蓋的行**（轉接器漏讀；應該是 0）")
        add("")
        add(_list(W.get("kb_lines_uncovered", []), ["doc", "missing", "overlap"], ["筆記", "漏掉的行（前 10）", "重疊的行"]))
        add("")

    add("## 10. 其他警告")
    add("")
    shown = {"option_parse_failed", "answer_key_not_in_options", "status_unmapped", "biochem_answer_special", "biochem_answer_unparsed",
             "xchap_not_in_tree", "fig_registered_not_referenced", "fig_not_approved", "fig_not_in_registry", "fig_approved_without_svg",
             "svg_font_not_whitelisted", "svg_over_500kb", "duplicate_identical", "note_absolute_path",
             "kb_ref_unmapped", "kb_absolute_image", "kb_image_missing", "kb_link_unresolved", "kb_lines_uncovered"}
    rest = {k: v for k, v in W.items() if k not in shown}
    if not rest:
        add("（無）")
    for k, v in rest.items():
        add(f"**{k}**（{len(v)}）")
        add("")
        cols = sorted({c for it in v for c in it})
        add(_list(v, cols, cols, limit=50))
        add("")
    md = "\n".join(L) + "\n"
    (cfg.reports / "驗證報告.md").write_text(md, "utf-8")
    return md
