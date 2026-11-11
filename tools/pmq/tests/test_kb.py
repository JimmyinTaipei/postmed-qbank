"""筆記轉接器（pmq/kb.py）的測試：用暫存資料夾裡的小筆記，不讀主檔。"""
import tempfile
import unittest
from pathlib import Path

from pmq.adapters.common import Report
from pmq.kb import KbBuilder, count_blocks, coverage, natural_key, walk

NOTE = """# 2-3 PDH

## 一、Pyruvate dehydrogenase

<img src="pdh.svg" alt="PDH" width="400" />

### A. Reaction

- Pyruvate → Acetyl-CoA（中興-115-42、醫學-115-1-93）
- Regulation
  - PDK 磷酸化 → 失活（營養-113-1-50）
    續行文字
  - PDP 去磷酸化
- 對不到的出處（高醫-99-01）

| Enzyme | 代號 |
| :--- | :---: |
| E1 | TPP |

```
pH < pI
  ↓
```

<div style="page-break-before: always;"></div>

1. 第一步
2. 第二步

<!-- physics-table-group:start -->

> ### Table 0
>
> | a | b |
> | --- | --- |
> | 1 | 2 |

<!-- physics-table-group:end -->

$$
E = mc^2
$$

見 [另一份](other.md)。

---
"""


class FakeAssets:
    def get(self, p, owner=None):
        return {"sha": "ab" * 32, "key": "a/" + "ab" * 32 + ".svg", "w": 100, "h": 50, "ext": "svg", "mono": True}


class FakeCfg:
    def __init__(self, root):
        self.structure_db_out = Path(root) / "sdb"
        self.structure_db_src = Path(root) / "sdbsrc"

    def rel(self, p):
        return Path(p).name


class Builder(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = Path(self.tmp.name)
        (d / "n.md").write_text(NOTE, "utf-8")
        (d / "pdh.svg").write_text("<svg/>", "utf-8")
        (d / "other.md").write_text("# other\n", "utf-8")
        self.report = Report()
        ids = {("中興", 115, None, 42): "NCHU-115-42", ("醫學", 115, "1", 93): "MED-115-1-93", ("營養", 113, "1", 50): "NUT-113-1-50"}
        kbb = KbBuilder(FakeCfg(d), FakeAssets(), self.report, ids, {str((d / "other.md").resolve()): "BCH/other"})
        self.doc = kbb.build(d / "n.md", "BCH")

    def tearDown(self):
        self.tmp.cleanup()

    def test_title_and_key(self):
        self.assertEqual(self.doc["title"], "2-3 PDH")
        self.assertEqual(self.doc["key"], "BCH/n")
        self.assertEqual(self.doc["src"], NOTE)

    def test_every_line_covered_once(self):
        self.assertEqual(coverage(self.doc), ([], []))

    def test_counts(self):
        c = count_blocks(self.doc["blocks"])
        self.assertEqual(c["heading"], 3)
        self.assertEqual(c["list_item"], 7)
        self.assertEqual(c["table"], 1)
        self.assertEqual(c["table_group"], 1)
        self.assertEqual(c["code"], 1)
        self.assertEqual(c["math"], 1)
        self.assertEqual(c["figure"], 1)
        self.assertEqual(c["rule"], 1)

    def test_nesting_and_continuation(self):
        items = [b for b, _ in walk(self.doc["blocks"]) if b["type"] == "list_item"]
        reg = next(b for b in items if b["md"] == "Regulation")
        self.assertEqual([k["md"].split("\n")[0] for k in reg["children"]], ["PDK 磷酸化 → 失活（營養-113-1-50）", "PDP 去磷酸化"])
        self.assertEqual(reg["children"][0]["md"], "PDK 磷酸化 → 失活（營養-113-1-50）\n續行文字")
        nums = [b.get("num") for b in items if b["ordered"]]
        self.assertEqual(nums, [1, 2])

    def test_refs(self):
        got = {r["text"]: r["qid"] for r in self.doc["refs"]}
        self.assertEqual(got, {"中興-115-42": "NCHU-115-42", "醫學-115-1-93": "MED-115-1-93", "營養-113-1-50": "NUT-113-1-50", "高醫-99-01": None})

    def test_figure_and_links(self):
        fig = next(b for b, _ in walk(self.doc["blocks"]) if b["type"] == "figure")
        self.assertTrue(fig["md"].startswith("![PDH](fig:K"))
        self.assertEqual(self.doc["figs"][0]["max_w"], 400)
        para = next(b for b, _ in walk(self.doc["blocks"]) if b["type"] == "paragraph" and "另一份" in b["md"])
        self.assertIn("[另一份](/kb/BCH/other)", para["md"])

    def test_bids_stable_and_unique(self):
        bids = [b["bid"] for b, _ in walk(self.doc["blocks"])]
        self.assertEqual(len(bids), len(set(bids)))

    def test_no_ids_written(self):
        self.assertEqual(Path(self.tmp.name, "n.md").read_text("utf-8"), NOTE)


class Sorting(unittest.TestCase):
    def test_natural(self):
        names = ["1-10_Lipids", "1-2_Peptides", "1-1_Amino_Acids", "00_目錄與總覽"]
        self.assertEqual(sorted(names, key=natural_key), ["00_目錄與總覽", "1-1_Amino_Acids", "1-2_Peptides", "1-10_Lipids"])


if __name__ == "__main__":
    unittest.main()
