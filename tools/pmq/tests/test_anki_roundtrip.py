"""anki_html、anki_export 與 anki_import 的測試：HTML ↔ Markdown，以及網站資料 → .apkg → 讀回來一致。"""
import hashlib
import tempfile
import time
import unittest
from pathlib import Path

from pmq.anki_export import build_apkg, guid_for, md_to_html, vocab_model
from pmq.anki_html import html_to_md
from pmq.anki_import import Importer

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64
SHA = hashlib.sha256(PNG).hexdigest()
DAY = 86400_000


class HtmlTest(unittest.TestCase):
    def test_math_bold_br(self):
        md = html_to_md("<b>力</b>：\\(F=ma\\)<br>單位 \\[N\\]")
        self.assertIn("**力**", md)
        self.assertIn("$F=ma$", md)
        self.assertIn("$$N$$", md)
        self.assertIn("\n", md)

    def test_bold_space_outside(self):
        self.assertEqual(html_to_md("a<b>bold </b>c"), "a**bold** c")

    def test_media_mapping(self):
        md = html_to_md('<img src="a b.png"> [sound:x.mp3]', {"a b.png": f"m/{SHA}.png", "x.mp3": "m/" + "1" * 64 + ".mp3"})
        self.assertIn(f"![](m/{SHA}.png)", md)
        self.assertIn("[sound:m/" + "1" * 64 + ".mp3]", md)

    def test_escapes(self):
        self.assertEqual(html_to_md("2*3*4"), "2\\*3\\*4")

    def test_export_html(self):
        h = md_to_html(f"**粗** $x^2$\n- 一\n![](m/{SHA}.png)")
        self.assertIn("<b>粗</b>", h)
        self.assertIn("\\(x^2\\)", h)
        self.assertIn(f'<img src="{SHA}.png">', h)
        self.assertIn("<br>", h)

    def test_guid_stable(self):
        self.assertEqual(guid_for("abc"), guid_for("abc"))
        self.assertNotEqual(guid_for("abc"), guid_for("abd"))


def site_data(now_ms):
    decks = [{"id": "d1", "name": "物理", "parent": None}, {"id": "d2", "name": "力學", "parent": "d1"}, {"id": "d3", "name": "英文", "parent": None}]
    cards = [
        {"id": "c1", "deck_id": "d2", "kind": "basic", "front_md": "牛頓第二定律", "back_md": f"$F=ma$\n![](m/{SHA}.png)", "tags": ["力"], "origin": None},
        {"id": "n1-0", "deck_id": "d2", "kind": "cloze", "front_md": "{{c1::動量}}守恆、{{c2::能量}}守恆", "back_md": "", "tags": [], "origin": {"note": "n1", "ord": 0}},
        {"id": "n1-1", "deck_id": "d2", "kind": "cloze", "front_md": "{{c1::動量}}守恆、{{c2::能量}}守恆", "back_md": "", "tags": [], "origin": {"note": "n1", "ord": 1}},
        {"id": "e1", "deck_id": "d3", "kind": "basic", "front_md": "abate", "back_md": "減輕", "tags": [], "origin": None},
    ]
    srs = [
        {"item": "card:c1", "state": 2, "due": now_ms + 5 * DAY, "last_review": now_ms - 3 * DAY, "stability": 8.2, "difficulty": 5.1,
         "reps": 4, "lapses": 1, "suspended": 0},
        {"item": "card:n1-0", "state": 0, "due": now_ms, "suspended": 0},
        {"item": "card:n1-1", "state": 0, "due": now_ms, "suspended": 1},
        {"item": "card:e1", "state": 0, "due": now_ms, "suspended": 0},
    ]
    logs = [{"item": "card:c1", "reviewed_at": now_ms - 3 * DAY, "rating": 3, "state_before": 2, "scheduled_days": 3, "elapsed_days": 2, "duration_ms": 4000}]
    return {"decks": decks, "cards": cards, "srs_state": srs, "review_log": logs}


class RoundTripTest(unittest.TestCase):
    def test_export_then_import(self):
        now_ms = int(time.time() * 1000)
        pkg, stats = build_apkg(site_data(now_ms), ["物理"], lambda key: PNG, now_ms)
        self.assertEqual((stats["decks"], stats["notes"], stats["cards"], stats["revlog"], stats["media"]), (2, 2, 3, 1, 1))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.apkg"
            p.write_bytes(pkg)
            imp = Importer({}, ["物理"])
            imp.read(p)
        self.assertEqual(len(imp.cards), 3)
        self.assertEqual({r["name"] for r in imp.deck_rows.values()}, {"物理", "力學"})
        by_front = {c["front_md"]: c for c in imp.cards.values()}
        c1 = by_front["牛頓第二定律"]
        self.assertIn("$F=ma$", c1["back_md"])
        self.assertIn(f"m/{SHA}.png", c1["back_md"])
        self.assertIn(f"m/{SHA}.png", imp.media)
        s1 = imp.srs["card:" + c1["id"]]
        self.assertEqual(s1["state"], 2)
        self.assertAlmostEqual(s1["stability"], 8.2, places=2)
        # 到期日以天為單位：誤差在一天內
        self.assertLess(abs(s1["due"] - (now_ms + 5 * DAY)), DAY)
        cloze = [c for c in imp.cards.values() if c["kind"] == "cloze"]
        self.assertEqual(sorted(c["origin"]["ord"] for c in cloze), [0, 1])
        self.assertEqual(sum(1 for s in imp.srs.values() if s["suspended"]), 1)
        self.assertEqual(len(imp.logs), 1)


MP3 = b"ID3" + b"1" * 64
MSHA = hashlib.sha256(MP3).hexdigest()
VOCAB_CFG = {"vocab_models": ["0_後醫單字基本型"], "labels": {"Source": "出處", "Image": ""},
             "models": {"0_後醫單字基本型": {"front": ["Word"], "back": ["Part of Speech", "Meaning and Definition", "Sentence", "Derivative", "Memo & Confusable",
                                                                       "Synonyms", "Antonyms", "Prefix & Roots", "Image", "Source"],
                                            "labels": {"Part of Speech": "", "Meaning and Definition": "", "Sentence": "例句", "Memo & Confusable": "辨析"}}}}


class VocabTest(unittest.TestCase):
    """第 8B-1 階段：單字卡 → 0_後醫單字基本型 → 讀回來，11 個欄位與進度一致。"""

    def test_vocab_roundtrip(self):
        now_ms = int(time.time() * 1000)
        fields = {"Word": "abate", "Part of Speech": "v.", "Meaning and Definition": "減輕；減少",
                  "Sentence": "abate a tax\n減稅", "Memo & Confusable": "【辨別】bash 打", "Image": f"[sound:m/{MSHA}.mp3]", "Source": "GRE"}
        data = {"decks": [{"id": "d", "name": "05_English", "parent": None}],
                "cards": [{"id": "v1", "deck_id": "d", "kind": "vocab", "front_md": "abate", "back_md": "v.\n\n減輕；減少", "fields": fields,
                           "tags": ["05_English::RedBook"], "origin": {"from": "anki", "guid": "g1", "ord": 0, "mid": 1774097454204}}],
                "srs_state": [{"item": "card:v1", "state": 2, "due": now_ms + 9 * DAY, "last_review": now_ms - 2 * DAY, "stability": 11.0,
                               "difficulty": 4.0, "reps": 3, "lapses": 0, "suspended": 0}],
                "review_log": []}
        pkg, stats = build_apkg(data, None, lambda key: MP3, now_ms)
        self.assertEqual((stats["notes"], stats["cards"], stats["media"], stats.get("vocab")), (1, 1, 1, 1))
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "v.apkg"
            p.write_bytes(pkg)
            import sqlite3, zipfile
            z = zipfile.ZipFile(p)
            Path(d, "c.anki2").write_bytes(z.read("collection.anki2"))
            db = sqlite3.connect(Path(d, "c.anki2"))
            import json as _j
            models = _j.loads(db.execute("select models from col").fetchone()[0])
            vm = vocab_model()
            m = models[str(vm["id"])]
            self.assertEqual(m["name"], "0_後醫單字基本型")
            self.assertEqual([f["name"] for f in m["flds"]], vm["fields"])
            self.assertIn("toggleHint", m["tmpls"][0]["qfmt"])
            db.close()
            imp = Importer(VOCAB_CFG, ["05_English"])
            imp.read(p)
        (c,) = imp.cards.values()
        self.assertEqual(c["kind"], "vocab")
        self.assertEqual(c["tags"], ["05_English::RedBook"])
        for k, v in fields.items():
            self.assertEqual(c["fields"][k], v, k)
        self.assertEqual(len(c["fields"]), 11)
        self.assertEqual(c["front_md"], "abate")
        self.assertIn('<div class="card-label">例句</div>', c["back_md"])
        self.assertIn('<div class="card-label">辨析</div>', c["back_md"])
        self.assertLess(c["back_md"].index("例句"), c["back_md"].index("辨析"))
        s = imp.srs["card:" + c["id"]]
        self.assertLess(abs(s["due"] - (now_ms + 9 * DAY)), DAY)
        self.assertAlmostEqual(s["stability"], 11.0, places=2)

    def test_other_models_stay_basic(self):
        now_ms = int(time.time() * 1000)
        pkg, _ = build_apkg(site_data(now_ms), ["英文"], lambda key: PNG, now_ms)
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.apkg"
            p.write_bytes(pkg)
            imp = Importer(VOCAB_CFG, ["英文"])
            imp.read(p)
        (c,) = imp.cards.values()
        self.assertEqual(c["kind"], "basic")
        self.assertIsNone(c["fields"])


if __name__ == "__main__":
    unittest.main()
