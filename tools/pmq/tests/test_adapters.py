import unittest
from pathlib import Path

from pmq.adapters.biochem import BiochemAdapter
from pmq.adapters.common import Report
from pmq.adapters.physics import classify, ANSWER_STATE, SOLUTION_STATE
from pmq.kb import REF

TEXT = """ID: KMU-1-01
source: 高醫-1-01
chap: A1-1-1
xchap: B1-1
ques: Which?
Absorbance: 0.5 at 280 nm
(A) one
(B) two
ans: B
sol:
1. because

ID: KMU-1-02
source: 高醫-1-02
chap: A1
xchap:
ques: Pick all
(A) a
(B) b
(C) c
ans: C, A
sol: x
"""


class _Cfg:
    root = Path("/")
    biochem = Path("/")

    def rel(self, p):
        return str(p)

    def rel_folder(self, p):
        return "x"


class Biochem(unittest.TestCase):
    def setUp(self):
        self.rep = Report()
        self.a = BiochemAdapter(_Cfg(), None, self.rep, None)

    def test_blocks_and_unknown_key_line_stays_in_ques(self):
        blocks = self.a._blocks(TEXT)
        self.assertEqual(len(blocks), 2)
        self.assertIn("Absorbance: 0.5", blocks[0]["fields"]["ques"])
        self.assertEqual(blocks[0]["fields"]["ans"], "B")
        self.assertEqual(blocks[0]["line"], 1)
        self.assertEqual(blocks[1]["line"], 13)

    def test_question_mapping(self):
        b = self.a._blocks(TEXT)
        q1 = self.a._question("01_後西醫", Path("/x/高醫_1_生化.md"), b[0])
        self.assertEqual(q1["label"], "高醫 1 01")
        self.assertEqual(q1["answer"]["keys"], ["B"])
        self.assertEqual([o[0] for o in q1["opt"]], ["A", "B"])
        self.assertEqual(q1["xchap"], ["BCH:B1-1"])
        self.assertEqual(q1["answer"]["trust"], "official")
        q2 = self.a._question("01_後西醫", Path("/x/高醫_1_生化.md"), b[1])
        self.assertEqual(q2["answer"]["mode"], "all")
        self.assertEqual(q2["answer"]["keys"], ["C", "A"])
        self.assertEqual(q2["qtype"], "multi")
        self.assertEqual(q2["xchap"], [])


class Status(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(classify(ANSWER_STATE, "書附答案與AI盲解一致"), "key_ai_agree")
        self.assertEqual(classify(ANSWER_STATE, "計算值已AI複核，原選項無正解"), "ai_reviewed")
        self.assertEqual(classify(SOLUTION_STATE, "AI生成待人工抽查"), "ai_unreviewed")
        self.assertIsNone(classify(ANSWER_STATE, "全新的說法"))


class KbRefs(unittest.TestCase):
    def test_exam_refs(self):
        refs = [m.group(0) for m in REF.finditer("（中興-115-42、醫學-115-1-93、高醫-114-84）")]
        self.assertEqual(refs, ["中興-115-42", "醫學-115-1-93", "高醫-114-84"])


if __name__ == "__main__":
    unittest.main()
