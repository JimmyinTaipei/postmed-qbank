"""pmq patches 的純函式測試（不讀主檔）。整合測試（真的寫檔、commit、衝突）見 docs/第3階段驗收紀錄.md。"""
import json
import re
import unittest

from pmq.adapters.common import MD_LINK, sub_spans
from pmq.patches import Refuse, canon, child_block, keep_edges, top_block, unrewrite

RAW = "\n題幹 $a_1$ 看圖：\n\n![原題圖1](../../assets/原題圖/X/PHY-1_1.png)\n\n見 [講義](../a.pdf#page=3) 第二段。\n"


def rewrite(raw):
    def fn(m):
        if m.group(1) == "!":
            return f"![{m.group(2)}](fig:F0123456789)"
        return m.group(2) + " p.3"
    return sub_spans(MD_LINK, fn, raw)


class Unrewrite(unittest.TestCase):
    def setUp(self):
        self.R, self.spans = rewrite(RAW)

    def back(self, V):
        return unrewrite(RAW, self.spans, self.R, V, "PHY")

    def test_unchanged(self):
        self.assertEqual(self.back(self.R), RAW)

    def test_edit_text_keeps_links(self):
        V = self.R.replace("題幹", "題目")
        self.assertEqual(self.back(V), RAW.replace("題幹", "題目"))

    def test_edit_alt_keeps_path(self):
        V = self.R.replace("![原題圖1]", "![圖一]")
        self.assertEqual(self.back(V), RAW.replace("![原題圖1]", "![圖一]"))

    def test_moved_image(self):
        V = self.R.replace("![原題圖1](fig:F0123456789)\n\n", "") + "\n![原題圖1](fig:F0123456789)\n"
        out = self.back(V)
        self.assertIn("](../../assets/原題圖/X/PHY-1_1.png)", out)
        self.assertNotIn("fig:", out)

    def test_unknown_fig_refused(self):
        with self.assertRaises(Refuse):
            self.back(self.R + "![x](fig:Fdeadbeef00)")

    def test_pdf_link_kept_when_untouched(self):
        V = self.R.replace("第二段", "第三段")
        self.assertIn("[講義](../a.pdf#page=3)", self.back(V))

    def test_mismatch_refused(self):
        with self.assertRaises(Refuse):
            unrewrite(RAW + "x", self.spans, self.R, self.R, "PHY")


class FrontMatter(unittest.TestCase):
    LINES = ["ID: PHY-000001", "chap: Ch10", "tag:", "  topic:", "  - 電位", "ans:", "  value:", "  - D", "  mode: single",
             "  provenance:", "  - kind: annotated", "    note: x", "status:", "  answer: 需確認"]

    def test_blocks(self):
        self.assertEqual(top_block(self.LINES, "chap"), (1, 2))
        self.assertEqual(top_block(self.LINES, "tag"), (2, 5))
        a, b = top_block(self.LINES, "ans")
        self.assertEqual((a, b), (5, 12))
        self.assertEqual(child_block(self.LINES, a, b, "value"), (6, 8))
        self.assertEqual(child_block(self.LINES, a, b, "mode"), (8, 9))
        self.assertIsNone(top_block(self.LINES, "human_review"))

    def test_keep_edges(self):
        self.assertEqual(keep_edges("\nabc\n\n", "xyz"), "\nxyz\n\n")
        self.assertEqual(keep_edges("abc", "  xyz \n"), "xyz")


class Hash(unittest.TestCase):
    def test_canon_matches_js(self):
        # App 的 JSON.stringify({mode, keys, text}) 長這樣
        self.assertEqual(canon({"mode": "single", "keys": ["C"], "text": None}), '{"mode":"single","keys":["C"],"text":null}')
        self.assertEqual(canon({"t": "中文\n\"引號\""}), json.dumps({"t": "中文\n\"引號\""}, ensure_ascii=False, separators=(",", ":")))
        self.assertTrue(re.fullmatch(r"\{.*\}", canon({})))


if __name__ == "__main__":
    unittest.main()
