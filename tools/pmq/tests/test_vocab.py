"""第 8B-2 階段：英文單字索引（tools/pmq/pmq/vocab.py）。用假的題目，不讀 iCloud。

執行：PYTHONPATH=tools/pmq .venv/bin/python -m unittest tools/pmq/tests/test_vocab.py
"""
import unittest

from pmq.build import SOURCE_KINDS
from pmq.vocab import build_vocab_index


def q(qid, ques, opts=(), keys=(), sid="ENG-A", kind="postmed_w", group=None, school="中國", year=113):
    text = ques
    spans = []
    for letter, o in opts:
        text += f"\n({letter}) "
        a = len(text)
        text += o
        spans.append([letter, a, len(text)])
    return {"id": qid, "subject": "ENG", "label": qid, "ques": text, "opt": spans, "answer": {"keys": list(keys)},
            "group": group, "source": {"sid": sid, "kind": kind, "school": school, "year": year}}


class VocabIndexTest(unittest.TestCase):
    def setUp(self):
        self.qs = [
            q("ENG-000001", "Efforts to _____ the damage failed.", [("A", "mitigate"), ("B", "aggravate")], keys=["A"]),
            q("ENG-000002", "The drug mitigated her symptoms in London.", sid="ENG-B"),
            q("ENG-000003", "Mitigating factors were ignored.", sid="ENG-H", kind="cram"),      # 講義：不算考卷
            q("ENG-000004", "Read the passage.", group={"gid": "G1", "stem": "Doctors <u>mitigate</u> pain. The children ran.", "members": ["ENG-000004", "ENG-000005"]}, sid="ENG-B"),
            q("ENG-000005", "Q2", group={"gid": "G1", "stem": "Doctors <u>mitigate</u> pain. The children ran.", "members": ["ENG-000004", "ENG-000005"]}, sid="ENG-B"),
            {**q("PHY-000001", "mitigate"), "subject": "PHY"},
        ]
        self.ix = build_vocab_index(self.qs, "ENG", SOURCE_KINDS)

    def test_lemma_counts(self):
        p, n, o, a, at = self.ix["lemmas"]["mitigate"]
        self.assertEqual(p, 2)                      # ENG-A、ENG-B；講義不算
        self.assertEqual(n, 4)                      # 1、2、3、4（文章記在第一小題）
        self.assertEqual((o, a), (1, 1))            # 當過一次選項、一次答案
        self.assertIn("ENG-000001a", at)
        self.assertIn("ENG-000004g", at)
        self.assertNotIn("ENG-000005g", at)         # 同一篇文章只記一次

    def test_forms_and_options(self):
        self.assertEqual(self.ix["forms"]["mitigated"][0], "mitigate")
        self.assertEqual(self.ix["forms"]["mitigating"][0], "mitigate")
        self.assertEqual(self.ix["lemmas"]["aggravate"][2:4], [1, 0])

    def test_basic_and_proper_nouns_dropped(self):
        for w in ("the", "read", "passage", "child", "london"):
            self.assertNotIn(w, self.ix["lemmas"], w)
        self.assertIn("damage", self.ix["lemmas"])
        self.assertNotIn("PHY-000001s", sum((v[4] for v in self.ix["lemmas"].values()), []))

    def test_papers(self):
        self.assertEqual(set(self.ix["papers"]), {"ENG-A", "ENG-B"})


if __name__ == "__main__":
    unittest.main()
