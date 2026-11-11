"""pmq anki inspect（pmq/anki.py）的測試：在暫存資料夾做一個舊封裝的小 .apkg，不讀使用者的檔。"""
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from pmq.anki import img_refs, inspect, pb_fields, pb_get


def make_apkg(dirp: Path) -> Path:
    db_path = dirp / "c.anki2"
    db = sqlite3.connect(db_path)
    db.executescript("""
      create table col (id integer primary key, decks text, models text);
      create table notes (id integer primary key, guid text, mid integer, tags text, flds text);
      create table cards (id integer primary key, nid integer, did integer, odid integer, ord integer, type integer,
                          queue integer, ivl integer, reps integer, lapses integer, data text);
      create table revlog (id integer primary key, cid integer);
    """)
    decks = {"1": {"name": "Default"}, "10": {"name": "英文"}, "11": {"name": "英文::GRE"}}
    models = {"100": {"name": "基本", "type": 0, "flds": [{"name": "Front"}, {"name": "Back"}], "tmpls": [{"name": "Card 1"}]},
              "200": {"name": "克漏字", "type": 1, "flds": [{"name": "Text"}], "tmpls": [{"name": "Cloze"}]}}
    db.execute("insert into col values (1, ?, ?)", (json.dumps(decks), json.dumps(models)))
    db.execute("insert into notes values (1, 'g1', 100, ' 英文::GRE ', 'abate\x1f<img src=\"a b.png\"> [sound:abate.mp3]')")
    db.execute("insert into notes values (2, 'g2', 200, '', '{{c1::x}} {{c2::y}} \\(x\\)')")
    db.execute("insert into cards values (1, 1, 11, 0, 0, 2, 2, 10, 3, 0, '{\"s\":5.1,\"d\":4.2}')")
    db.execute("insert into cards values (2, 2, 10, 0, 0, 0, 0, 0, 0, 0, '')")
    db.execute("insert into cards values (3, 2, 10, 0, 1, 0, -1, 0, 0, 0, '')")
    db.executemany("insert into revlog values (?, 1)", [(1700000000000,), (1700000100000,)])
    db.commit()
    db.close()
    out = dirp / "t.apkg"
    with zipfile.ZipFile(out, "w") as z:
        z.write(db_path, "collection.anki2")
        z.writestr("media", json.dumps({"0": "a b.png", "1": "abate.mp3", "2": "unused.jpg"}))
        z.writestr("0", b"\x89PNG" + b"0" * 100)
        z.writestr("1", b"ID3" + b"0" * 50)
        z.writestr("2", b"x")
    db_path.unlink()
    return out


class TestAnki(unittest.TestCase):
    def test_protobuf(self):
        # 欄位 1 varint 1；欄位 3 字串 "hi"
        b = bytes([0x08, 0x01, 0x1A, 0x02]) + b"hi"
        self.assertEqual(pb_fields(b), [(1, 0, 1), (3, 2, b"hi")])
        self.assertEqual(pb_get(b, 3), b"hi")
        self.assertIsNone(pb_get(b, 9))
        self.assertEqual(pb_get(bytes([0x08]), 1), None)   # 截斷的資料不會丟例外

    def test_img_refs(self):
        self.assertEqual(img_refs('<img src="Golgi Apparatus.jpeg"><IMG SRC=x.png><img alt="" src=\'R&amp;D.png\'>'),
                         {"Golgi Apparatus.jpeg", "x.png", "R&D.png"})
        self.assertIn("a b.png", img_refs('<img src="a%20b.png">'))

    def test_inspect_legacy(self):
        with tempfile.TemporaryDirectory() as d:
            p = make_apkg(Path(d))
            before = sorted(Path(d).iterdir())
            r = inspect(p)
            self.assertEqual(sorted(Path(d).iterdir()), before)   # 沒有解壓殘留
        self.assertEqual((r["notes"], r["cards"], r["revlog"], r["fsrs_cards"]), (2, 3, 2, 1))
        rows = {x["deck"]: x for x in r["decks"]}
        self.assertNotIn("Default", rows)
        self.assertEqual(rows["英文"]["total"]["卡片"], 3)
        self.assertEqual(rows["英文"]["own"]["卡片"], 2)
        self.assertEqual(rows["英文::GRE"]["total"]["複習紀錄"], 2)
        self.assertEqual(rows["英文"]["total"]["暫停"], 1)
        nts = {n["name"]: n for n in r["notetypes"]}
        self.assertTrue(nts["克漏字"]["cloze"])
        self.assertFalse(nts["基本"]["cloze"])
        self.assertEqual(r["media"]["圖片"]["files"], 2)    # a b.png＋沒人引用的 unused.jpg
        self.assertEqual(r["media"]["聲音"]["files"], 1)
        self.assertEqual(r["media_missing"]["圖片數"], 0)
        self.assertEqual(r["media_unused"]["files"], 1)
        self.assertEqual(r["tags"], [("英文::GRE", 1)])


if __name__ == "__main__":
    unittest.main()
