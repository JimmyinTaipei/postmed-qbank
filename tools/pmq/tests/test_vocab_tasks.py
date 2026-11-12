"""第 8B-3 階段：交給 Flash 的單字批次工作（tools/pmq/pmq/vocab_tasks.py）。用假的批次，不讀 iCloud、不連網站。

執行：PYTHONPATH=tools/pmq .venv/bin/python -m unittest tools/pmq/tests/test_vocab_tasks.py
"""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from pmq import vocab_tasks as vt

INPUT = {
    "kind": "fields", "batch": "V001", "created": "2026-11-12 18:00",
    "words": [
        {"word": "inundate", "forms": ["inundated"], "papers": 3, "questions": 4,
         "sentences": [{"text": "The whole village was inundated by the tsunami.", "source": "中國 113 01｜ENG-000949"}]},
        {"word": "implacable", "forms": [], "papers": 2, "questions": 2,
         "sentences": [{"text": "He was constantly persecuted by his implacable enemies.", "source": "中國 113 02｜ENG-000950"}]},
        {"word": "normalize", "forms": [], "papers": 2, "questions": 2, "sentences": []},
    ],
}


def good_output():
    base = {k: "" for k in vt.AI_FIELDS}
    return [
        {**base, "Word": "inundate", "Part of Speech": "v.", "Meaning and Definition": "淹沒；使應接不暇",
         "Sentence": "The whole village was inundated by the tsunami.\n整個村莊被海嘯淹沒了。",
         "Derivative": "inundation n. 洪水；氾濫"},
        {**base, "Word": "implacable", "Part of Speech": "adj.", "Meaning and Definition": "無法平息的；不能和解的",
         "Sentence": "He was constantly persecuted by his implacable enemies."},
        {**base, "Word": "normalize", "Part of Speech": "v.", "Meaning and Definition": "使正常化；使標準化"},
    ]


class Batch:
    def __init__(self, out, inp=INPUT):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name) / "V001"
        self.dir.mkdir()
        (self.dir / "輸入.json").write_text(json.dumps(inp, ensure_ascii=False), "utf-8")
        (self.dir / "任務單.md").write_text("x", "utf-8")
        self.out = self.dir / "輸出.json"
        self.out.write_text(out if isinstance(out, str) else json.dumps(out, ensure_ascii=False), "utf-8")

    def problems(self):
        return vt.check_file(self.out)[2].items


def problems(out):
    b = Batch(out)
    try:
        return b.problems()
    finally:
        b.tmp.cleanup()


class CheckFieldsTest(unittest.TestCase):
    def test_good(self):
        self.assertEqual(problems(good_output()), [])

    def test_extra_word(self):
        out = good_output() + [{**good_output()[1], "Word": "persecute"}]
        p = problems(out)
        self.assertTrue(any("第 4 筆（persecute）" in x and "不在這一批的清單上" in x for x in p), p)

    def test_missing_word(self):
        p = problems(good_output()[:2])
        self.assertTrue(any("少了 1 個字" in x and "normalize" in x for x in p), p)

    def test_duplicate_word(self):
        p = problems(good_output() + [good_output()[0]])
        self.assertTrue(any("inundate" in x and "出現 2 次" in x for x in p), p)

    def test_sentence_not_original(self):
        out = good_output()
        out[0]["Sentence"] = "The village was inundated by the tsunami."
        p = problems(out)
        self.assertTrue(any("第 1 筆（inundate）" in x and "不是輸入裡給的原句" in x for x in p), p)

    def test_sentence_invented_when_none_given(self):
        out = good_output()
        out[2]["Sentence"] = "We need to normalize relations."
        p = problems(out)
        self.assertTrue(any("第 3 筆（normalize）" in x and "Sentence 要留空" in x for x in p), p)

    def test_sentence_and_translation_on_one_line(self):
        out = good_output()
        out[0]["Sentence"] = "The whole village was inundated by the tsunami. 整個村莊被淹沒了。"
        p = problems(out)
        self.assertTrue(any("分成兩行" in x for x in p), p)

    def test_curly_quotes_and_bold_still_match(self):
        inp = copy.deepcopy(INPUT)
        inp["words"][0]["sentences"][0]["text"] = "The village’s fields were inundated by the tsunami."
        out = good_output()
        out[0]["Sentence"] = "The village's fields were inundated by the tsunami."
        b = Batch(out, inp)
        self.assertEqual(b.problems(), [])
        b.tmp.cleanup()

    def test_simplified(self):
        out = good_output()
        out[1]["Meaning and Definition"] = "无法平息的；不能和解的"
        p = problems(out)
        self.assertTrue(any("第 2 筆（implacable）" in x and "簡體字" in x and "无" in x for x in p), p)

    def test_traditional_not_flagged(self):
        self.assertEqual(vt.simplified_in("後來著重於臺灣的發展；裡面；才幹；系統"), "")
        self.assertEqual(vt.simplified_in("们这发着"), "们这发着")

    def test_bad_pos(self):
        for bad in ("verb", "v", "n., v.", "n. v.", "n.；n.", "noun；v."):
            out = good_output()
            out[0]["Part of Speech"] = bad
            p = problems(out)
            self.assertTrue(any("第 1 筆（inundate）" in x and "詞性" in x for x in p), (bad, p))
        out = good_output()
        out[0]["Part of Speech"] = "n.；v."
        self.assertEqual(problems(out), [])

    def test_missing_and_extra_keys(self):
        out = good_output()
        del out[0]["Antonyms"]
        out[1]["Source"] = "中國 113 02｜ENG-000950"
        p = problems(out)
        self.assertTrue(any("第 1 筆" in x and "少了欄位" in x for x in p), p)
        self.assertTrue(any("第 2 筆" in x and "多了不該有的欄位" in x for x in p), p)

    def test_required_and_chinese(self):
        out = good_output()
        out[0]["Meaning and Definition"] = "to flood"
        out[1]["Part of Speech"] = ""
        p = problems(out)
        self.assertTrue(any("第 1 筆" in x and "繁體中文" in x for x in p), p)
        self.assertTrue(any("第 2 筆" in x and "Part of Speech 不能空白" in x for x in p), p)

    def test_html_and_bold(self):
        out = good_output()
        out[0]["Derivative"] = "<b>inundation</b> n. 洪水"
        out[1]["Sentence"] = "He was constantly persecuted by his **implacable** enemies."
        p = problems(out)
        self.assertTrue(any("第 1 筆" in x and "HTML" in x for x in p), p)
        self.assertTrue(any("第 2 筆" in x and "粗體" in x for x in p), p)

    def test_not_json_and_code_fence(self):
        self.assertTrue(any("不是合法的 JSON" in x for x in problems("[{\"Word\": ")))
        self.assertTrue(any("```" in x for x in problems("```json\n[]\n```")))

    def test_extra_files_in_batch(self):
        b = Batch(good_output())
        (b.dir / "草稿.json").write_text("[]", "utf-8")
        p = b.problems()
        self.assertTrue(any("草稿.json" in x for x in p), p)
        b.tmp.cleanup()

    def test_run_check_writes_report(self):
        b = Batch(good_output()[:1])
        self.assertEqual(vt.run_check(b.out, log=lambda *_: None), 1)
        rep = (b.dir / "檢查結果.md").read_text("utf-8")
        self.assertIn("少了 2 個字", rep)
        b.out.write_text(json.dumps(good_output(), ensure_ascii=False), "utf-8")
        self.assertEqual(vt.run_check(b.out, log=lambda *_: None), 0)
        b.tmp.cleanup()


class CheckPhrasesTest(unittest.TestCase):
    INP = {"kind": "phrases", "batch": "P001", "paper": "ENG-X", "label": "X",
           "items": [{"id": "ENG-000001", "text": "These factors gave rise to a crisis in terms of cost."},
                     {"id": "g:ENG-000002", "text": "He took her help for granted."}]}

    def run_p(self, out):
        b = Batch(out, self.INP)
        try:
            return b.problems()
        finally:
            b.tmp.cleanup()

    def test_good(self):
        out = [{"id": "ENG-000001", "phrases": [{"phrase": "give rise to", "text": "gave rise to"}, {"phrase": "in terms of", "text": "in terms of"}]},
               {"id": "g:ENG-000002", "phrases": [{"phrase": "take sth for granted", "text": "took her help for granted"}]}]
        self.assertEqual(self.run_p(out), [])

    def test_bad(self):
        out = [{"id": "ENG-000001", "phrases": [{"phrase": "give rise to", "text": "give rise to"}, {"phrase": "crisis", "text": "crisis"},
                                                 {"phrase": "引起", "text": "gave rise to"}]},
               {"id": "ENG-000099", "phrases": []}]
        p = self.run_p(out)
        self.assertTrue(any("找不到" in x and "give rise to" in x for x in p), p)
        self.assertTrue(any("「crisis」不是 2–6 個英文字" in x for x in p), p)
        self.assertTrue(any("只能是英文" in x for x in p), p)
        self.assertTrue(any("ENG-000099" in x and "不在輸入裡" in x for x in p), p)
        self.assertTrue(any("少了 1 題" in x for x in p), p)


class CheckSensesTest(unittest.TestCase):
    INP = {"kind": "senses", "batch": "S001", "words": [
        {"word": "address", "senses": ["1. 地址", "2. 演說", "3. 處理"], "places": [{"at": "ENG-000204s", "sentence": "x"}, {"at": "ENG-000300g", "sentence": "y"}]}]}

    def test(self):
        b = Batch([{"word": "address", "at": "ENG-000204s", "sense": 3}, {"word": "address", "at": "ENG-000300g", "sense": 1}], self.INP)
        self.assertEqual(b.problems(), [])
        b.out.write_text(json.dumps([{"word": "address", "at": "ENG-000204s", "sense": 4}, {"word": "address", "at": "ENG-000300g", "sense": "1"}]), "utf-8")
        p = b.problems()
        self.assertEqual(sum("1 到 3 的整數" in x for x in p), 2, p)
        b.tmp.cleanup()


class ImportRowsTest(unittest.TestCase):
    def test_rows(self):
        dump = {"decks": [{"id": "anki-eng", "name": "05_English", "parent": None, "deleted": 0}],
                "cards": [{"id": "x", "kind": "vocab", "deleted": 0, "fields": {"Word": "implacable"}, "front_md": "implacable"}]}
        decks, cards, srs, skipped = vt.build_rows(INPUT, good_output(), dump, t0=1000)
        # 05_English 已有 → 只建「考古題單字」，掛在它底下
        self.assertEqual([(d["name"], d["parent"]) for d in decks], [("考古題單字", "anki-eng")])
        self.assertEqual(skipped, ["implacable"])            # 已經有卡的字不重建
        self.assertEqual([c["fields"]["Word"] for c in cards], ["inundate", "normalize"])
        c = cards[0]
        self.assertEqual(c["kind"], "vocab")
        self.assertEqual(c["tags"], ["AI"])
        self.assertEqual(c["deck_id"], decks[0]["id"])
        self.assertEqual(c["origin"]["from"], "ai")
        self.assertEqual(c["origin"]["ai"], ["Part of Speech", "Meaning and Definition", "Sentence", "Derivative"])
        self.assertEqual(c["fields"]["Sentence"], "The whole village was **inundated** by the tsunami.\n整個村莊被海嘯淹沒了。")
        self.assertEqual(c["fields"]["Source"], "中國 113 01｜ENG-000949")
        self.assertNotIn("Image", c["fields"])
        self.assertEqual(c["front_md"], "inundate")
        self.assertTrue(c["back_md"].startswith("v.\n\n淹沒；使應接不暇\n\n<div class=\"card-label\">例句</div>"))
        self.assertEqual(srs[0], {"item": f"card:{c['id']}", "due": 1000, "stability": None, "difficulty": None, "reps": 0, "lapses": 0,
                                  "state": 0, "last_review": None, "suspended": 0, "updated_at": 1000})
        # 同一個檔再算一次：卡片 ID 相同（insert 模式下不會重複）
        again = vt.build_rows(INPUT, good_output(), dump, t0=2000)[1]
        self.assertEqual([x["id"] for x in again], [x["id"] for x in cards])
        # 沒有原句的字：Source 空
        self.assertNotIn("Source", cards[1]["fields"])

    def test_creates_both_decks(self):
        decks = vt.build_rows(INPUT, good_output(), {"decks": [], "cards": []}, t0=1)[0]
        self.assertEqual([d["name"] for d in decks], ["05_English", "考古題單字"])
        self.assertEqual(decks[1]["parent"], decks[0]["id"])
        self.assertEqual(decks[0]["subject"], "ENG")


class SentenceTest(unittest.TestCase):
    def test_split(self):
        text = 'Doctors often\nmitigate pain. The <span class="cloze-blank">26</span> was big. Which of the following is TRUE?\n\nNew para here now.'
        s = vt.sentences_of(text)
        self.assertEqual(s[0], "Doctors often mitigate pain.")
        self.assertNotIn("The _____ was big.", s)
        self.assertIn("New para here now.", s)
        self.assertEqual(vt.rank_sentences([{"text": "Which of the following is TRUE?"}, {"text": "Doctors mitigate pain."}])[0]["text"], "Doctors mitigate pain.")

    def test_error_id_skipped(self):
        self.assertEqual(vt.sentences_of("Since (A) the beginning of (B) history, man fought oppression."), [])


if __name__ == "__main__":
    unittest.main()
