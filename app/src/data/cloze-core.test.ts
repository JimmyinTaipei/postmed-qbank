import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFront, expand, findInMd, MATH, maxCloze, mdPlain, tableRowOf, tapeLevel } from "./cloze-core.ts";

const DAY = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY) * DAY;

test("膠帶顏色：重來一次橘、兩次紅，不同兩天答對降一級", () => {
  const t0 = 10 * DAY;
  assert.equal(tapeLevel([], dayOf), 0);
  assert.equal(tapeLevel([{ rating: 3, reviewed_at: t0 }], dayOf), 0);
  assert.equal(tapeLevel([{ rating: 1, reviewed_at: t0 }], dayOf), 1);
  assert.equal(tapeLevel([{ rating: 1, reviewed_at: t0 }, { rating: 1, reviewed_at: t0 + 1000 }], dayOf), 2);
  assert.equal(tapeLevel([{ rating: 1, reviewed_at: t0 }, { rating: 1, reviewed_at: t0 + 1 }, { rating: 1, reviewed_at: t0 + 2 }], dayOf), 2);
  // 紅之後同一天答對兩次：不降
  const red = [{ rating: 1, reviewed_at: t0 }, { rating: 1, reviewed_at: t0 + 1 }];
  assert.equal(tapeLevel([...red, { rating: 3, reviewed_at: t0 + 2 }, { rating: 3, reviewed_at: t0 + 3 }], dayOf), 2);
  // 不同兩天答對：降成橘
  assert.equal(tapeLevel([...red, { rating: 3, reviewed_at: t0 + DAY }, { rating: 4, reviewed_at: t0 + 2 * DAY }], dayOf), 1);
  // 再不同兩天答對：降成藍
  assert.equal(tapeLevel([...red, ...[1, 2, 3, 4].map((k) => ({ rating: 3, reviewed_at: t0 + k * DAY }))], dayOf), 0);
  // 中間又錯：連續答對重新算
  assert.equal(tapeLevel([{ rating: 1, reviewed_at: t0 }, { rating: 3, reviewed_at: t0 + DAY }, { rating: 1, reviewed_at: t0 + 2 * DAY }, { rating: 3, reviewed_at: t0 + 3 * DAY }], dayOf), 2);
  // 順序亂的也照時間算
  assert.equal(tapeLevel([{ rating: 3, reviewed_at: t0 + 2 * DAY }, { rating: 3, reviewed_at: t0 + DAY }, { rating: 1, reviewed_at: t0 }], dayOf), 0);
});

test("Markdown → 看得到的字：格式記號、公式、連結、空白", () => {
  const p = mdPlain("PDH 需要 **TPP** 與 $\\ce{NAD+}$，見 [B2](x.md)。");
  assert.equal(p.text, `PDH 需要 TPP 與 ${MATH}，見 B2。`);
  // 每個字對回原文
  const i = p.text.indexOf("TPP");
  assert.equal("PDH 需要 **TPP** 與 $\\ce{NAD+}$，見 [B2](x.md)。".slice(p.at[i], p.to[i + 2]), "TPP");
});

test("找回選的字，跨格式時擴大", () => {
  const md = "Acetyl-CoA ⇒ **TCA cycle**（$2\\text{CO}_2$）";
  // 只挖粗體裡面
  assert.deepEqual(md.slice(...findInMd(md, { quote: "TCA" })!), "TCA");
  // 切過粗體的一半 → 擴大到整個粗體
  assert.equal(md.slice(...findInMd(md, { quote: "⇒ TCA" })!), "⇒ **TCA cycle**");
  // 碰到公式 → 整個公式
  assert.equal(md.slice(...findInMd(md, { quote: `（${MATH}` })!), "（$2\\text{CO}_2$");
  // 連結的字 → 整個連結
  const md2 = "看 [第二章 PDH](B2.md) 的整理";
  assert.equal(md2.slice(...findInMd(md2, { quote: "二章" })!), "[第二章 PDH](B2.md)");
  // 找不到
  assert.equal(findInMd(md, { quote: "不存在" }), null);
  assert.deepEqual(expand("a <u>bc</u> d", 3, 6), [2, 11]);
});

test("同樣的字出現兩次：用前後文挑", () => {
  const md = "Hb 有 4 個 heme；Mb 有 1 個 heme。";
  const r = findInMd(md, { quote: "heme", prefix: "Mb 有 1 個 ", suffix: "。" })!;
  assert.equal(r[0], md.lastIndexOf("heme"));
});

test("產生卡片內容：多處、同號、提示、公式", () => {
  const md = "PDH 的輔酶：TPP、Lipoate、CoA、FAD、NAD⁺；抑制 $E_1$ 的是 **arsenite**";
  const r = buildFront(md, [
    { quote: "TPP", n: 1 },
    { quote: "Lipoate", n: 2, hint: "硫" },
    { quote: "CoA", n: 2 },
    { quote: MATH, n: 3 },
    { quote: "arsenite", n: 4 },
  ]);
  assert.deepEqual(r.missing, []);
  assert.equal(r.front, "PDH 的輔酶：{{c1::TPP}}、{{c2::Lipoate::硫}}、{{c2::CoA}}、FAD、NAD⁺；抑制 {{c3::$E_1$}} 的是 **{{c4::arsenite}}**");
  assert.equal(maxCloze(r.front), 4);
  // 找不到的
  assert.deepEqual(buildFront(md, [{ quote: "TPP", n: 1 }, { quote: "pyruvate", n: 2 }]).missing, [1]);
});

test("表格：表頭＋有挖空的列", () => {
  const md = "| 酵素 | 輔酶 |\n| --- | --- |\n| PDH | TPP |\n| α-KGDH | TPP、Lipoate |";
  const r = buildFront(md, [{ quote: "Lipoate", n: 1 }]);
  assert.equal(r.front, "| 酵素 | 輔酶 |\n| --- | --- |\n| α-KGDH | TPP、{{c1::Lipoate}} |");
  assert.equal(tableRowOf(md, { quote: "Lipoate" }), 3);
  assert.equal(tableRowOf(md, { quote: "PDH" }), 2);
  assert.equal(tableRowOf("一般段落", { quote: "段" }), -1);
});
