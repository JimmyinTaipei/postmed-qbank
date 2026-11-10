import unittest

from pmq.labels import source_label, biochem_label, display


class Labels(unittest.TestCase):
    # Cases from physics_catalog.source_label's docstring plus the shapes in the bank.
    def test_exam(self):
        self.assertEqual(source_label({"file": "02_原卷題庫/後醫/01_高醫/115/高醫_115_01.md", "category": "後醫"}), "高醫 115 01")
        self.assertEqual(source_label({"file": "台聯大_115_12.md", "category": "轉學考"}), "台聯大 115 12")

    def test_material(self):
        self.assertEqual(source_label({"file": "特訓班2_先修作業二_05.md", "category": "其他教材"}), "特訓班2 先修作業二 Q5")
        self.assertEqual(source_label({"file": "特訓班2_正課班作業十四_05.md", "category": "其他教材"}), "特訓班2 正課班作業十四 Q5")

    def test_textbook(self):
        self.assertEqual(source_label({"file": "Giancoli_Ch02_Q_43.md", "category": "原文書題庫"}), "Giancoli Ch02 Q43")

    def test_fallback(self):
        self.assertEqual(source_label({"id": "PHY-1"}), "PHY-1")

    def test_biochem(self):
        self.assertEqual(biochem_label("高醫-115-01"), "高醫 115 01")
        self.assertEqual(biochem_label("醫學-115-1-93"), "醫學 115-1 93")
        self.assertEqual(display("高醫 115 01", "KMU-115-01"), "高醫 115 01｜KMU-115-01")


if __name__ == "__main__":
    unittest.main()
