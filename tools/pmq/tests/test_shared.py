"""第 8A 階段：共用格式轉接器（英文）。用一份假的主檔（暫存資料夾），不讀 iCloud。

執行：PYTHONPATH=tools/pmq .venv/bin/python -m unittest tools/pmq/tests/test_shared.py
"""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from pmq.adapters.common import Assets, Report
from pmq.adapters.shared import SharedAdapter
from pmq.textutil import parse_options


def sec(kind, sid, meta, subs):
    body = "\n\n".join(f"### {k}\n\n{v}" for k, v in subs.items())
    return f"## {kind} {sid}\n\n```json\n{json.dumps(meta, ensure_ascii=False, indent=2)}\n```\n\n{body}\n"


def q(qid, num, chapter, opts, accepted, passages=(), **extra):
    meta = {"id": qid, "source_number": num, "source_section": extra.pop("section", "vocabulary"), "type": extra.pop("type", "single_choice"),
            "chapter": chapter, "passage_ids": list(passages), "answer": {"status": "school_key", "accepted": accepted, "original": accepted}, "issues": [], **extra}
    subs = {"stem": extra.get("stem", f"Question {num} costs $3 billion _____.")}
    subs.update({f"option {l}": t for l, t in opts.items()})
    subs["solution"] = ""
    return sec("question", qid, meta, subs)


FRONT = {"schema_version": "1.0", "id": "ENG-PVT-115", "title": "115私醫聯招英文", "subject": "英文", "source_kind": "exam",
         "school": "私醫聯招", "exam_category": "私醫聯招", "year_roc": 115, "book": None, "expected_count": 4,
         "chapter_catalog": {"EN01": "字彙與片語", "EN03": "克漏字", "EN06": "寫作"}, "source_issues": [{"source_number": 22, "note": "原卷印刷模糊"}]}

DOC = ("---\n" + json.dumps(FRONT, ensure_ascii=False, indent=2) + "\n---\n\n# 115\n\n"
       + sec("passage", "ENG-PVT-115-CLOZE-1", {"id": "ENG-PVT-115-CLOZE-1", "blank_numbers": [21, 22]},
             {"content": "Scientists can  21  new DNA.\nThis _____22_____ the cost."})
       + q("ENG-000001", 1, "EN01", {"A": "a", "B": "b", "C": "c", "D": "d"}, ["D"])
       + q("ENG-000021", 21, "EN03", {"A": "x", "B": "y"}, ["A", "B"], passages=["ENG-PVT-115-CLOZE-1"], section="cloze")
       + q("ENG-000022", 22, "EN03", {"A": "x", "B": "y"}, ["A"], passages=["ENG-PVT-115-CLOZE-1"], section="cloze")
       + sec("question", "ENG-000099", {"id": "ENG-000099", "source_number": "Essay", "source_section": "essay_writing", "type": "short_answer",
                                        "chapter": "EN06", "passage_ids": [], "response_format": "essay", "minimum_words": 200,
                                        "answer": {"status": "missing", "accepted": []}, "issues": []},
             {"stem": "Write an essay.", "solution": ""}))


class Cache:
    def sha256(self, path, data=None):
        return "0" * 64

    def fact(self, sha, kind, compute):
        return compute()


class SharedAdapterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        bank = root / "英文/02_原卷題庫/私醫聯招"
        bank.mkdir(parents=True)
        (bank / "115_私醫聯招_英文.md").write_text(DOC, "utf-8")
        cfg = SimpleNamespace(rel=lambda p: str(Path(p).relative_to(root)), rel_folder=lambda p: "")
        self.rep = Report()
        spec = {"id": "ENG", "name": "英文", "path": root / "英文", "id_pattern": r"^ENG-\d{6}$", "ink": "keep", "escape_dollar": True}
        self.a = SharedAdapter(cfg, Cache(), self.rep, Assets(Cache(), self.rep), spec)
        self.chapters = self.a.chapters()
        self.qs = {x["id"]: x for x in self.a.load()}

    def tearDown(self):
        self.tmp.cleanup()

    def test_counts_and_chapters(self):
        self.assertEqual(len(self.qs), 4)
        self.assertEqual([c["id"] for c in self.chapters], ["ENG:EN01", "ENG:EN03", "ENG:EN06"])
        self.assertEqual(self.rep.errors, [])
        self.assertEqual(self.qs["ENG-000001"]["chap"], "ENG:EN01")
        self.assertEqual(self.qs["ENG-000001"]["label"], "私醫聯招 115 01")
        self.assertEqual(self.qs["ENG-000001"]["source"]["kind"], "private_med")

    def test_options_match_parser_and_dollar_escaped(self):
        x = self.qs["ENG-000001"]
        self.assertEqual(parse_options(x["ques"])["opt"], x["opt"])
        self.assertIn("\\$3 billion", x["ques"])
        self.assertEqual([x["ques"][a:b] for _l, a, b in x["opt"]], ["a", "b", "c", "d"])

    def test_group(self):
        g = self.qs["ENG-000021"]["group"]
        self.assertEqual(g["gid"], "ENG-PVT-115-CLOZE-1")
        self.assertEqual(g["members"], ["ENG-000021", "ENG-000022"])
        self.assertEqual(g["order"], 21)
        self.assertIn('<span class="cloze-blank">21</span>', g["stem"])
        self.assertIn('<span class="cloze-blank">22</span>', g["stem"])
        self.assertIsNone(self.qs["ENG-000001"]["group"])

    def test_answers(self):
        self.assertEqual(self.qs["ENG-000001"]["answer"]["mode"], "single")
        self.assertEqual(self.qs["ENG-000021"]["answer"]["mode"], "any")
        self.assertEqual(self.qs["ENG-000021"]["answer"]["keys"], ["A", "B"])
        e = self.qs["ENG-000099"]
        self.assertEqual((e["qtype"], e["answer"]["mode"]), ("text", "text"))
        self.assertIn("作文", e["answer"]["note"])
        self.assertEqual(e["label"], "私醫聯招 115 作文")

    def test_issues_from_front_matter(self):
        self.assertIn("原卷：原卷印刷模糊", self.qs["ENG-000022"]["sol_meta"]["issues"])
        self.assertEqual(self.qs["ENG-000021"]["sol_meta"]["issues"], [])


if __name__ == "__main__":
    unittest.main()
