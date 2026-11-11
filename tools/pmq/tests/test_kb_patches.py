"""筆記修訂寫回 .md（pmq/kb_patches.py）的測試：暫存資料夾＋暫存 git，不讀主檔。"""
import subprocess
import tempfile
import unittest
from pathlib import Path

from pmq.cache import HashCache
from pmq.kb import walk
from pmq.kb_patches import Conflict, KbWriter, merged_ok, process
from pmq.patches import ContentGit, Refuse
from pmq.textutil import sha1

NOTE = """# 2-3 PDH

## 一、Pyruvate dehydrogenase

<img src="../assets/pdh.svg" alt="PDH" width="400" />

### A. Reaction

- Pyruvate → Acetyl-CoA（中興-115-42）
- Regulation
  - PDK 磷酸化 → 失活⎵
    續行文字
  - PDP 去磷酸化
- 最後一點

1. 第一步
2. 第二步

見 [另一份](other.md) 的說明，圖 <img src="../assets/pdh.svg" width="20" /> 在這裡。

| Enzyme | 代號 |
| :--- | :---: |
| E1 | TPP |
""".replace("⎵", "  ")   # 行尾兩個空白（Markdown 換行）；直接寫在字串裡會被編輯器吃掉


class FakeCfg:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.notes = self.root / "02_學習筆記"
        self.kb = {"BCH": ["02_生化"], "exclude": []}
        self.structure_db_out = self.root / "sdb"
        self.structure_db_src = self.root / "sdbsrc"
        self.content_git = self.root / "content.git"
        self.cache = self.root / "cache"

    def rel(self, p):
        return str(Path(p).relative_to(self.root))


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.cfg = FakeCfg(root)
        d = self.cfg.notes / "02_生化" / "B2_代謝篇"
        d.mkdir(parents=True)
        (self.cfg.notes / "02_生化" / "assets").mkdir()
        (self.cfg.notes / "02_生化" / "assets" / "pdh.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', "utf-8")
        self.path = d / "2-3_PDH.md"
        self.path.write_text(NOTE, "utf-8")
        (d / "other.md").write_text("# other\n", "utf-8")
        subprocess.run(["git", "init", "-q", "--bare", str(self.cfg.content_git)], check=True)
        self.git = ContentGit(self.cfg)
        self.git.run("config", "user.email", "t@t")
        self.git.run("config", "user.name", "t")
        self.git.run("add", "02_學習筆記")
        self.git.run("commit", "-q", "-m", "init")
        self.kw = KbWriter(self.cfg, self.git, HashCache(self.cfg.cache))
        self.key = "BCH/2-3_PDH"
        self.doc, _ = self.kw.parse(self.key, self.path, NOTE)

    def tearDown(self):
        self.tmp.cleanup()

    def block(self, md_start):
        return next(b for b, _ in walk(self.doc["blocks"]) if b["md"].startswith(md_start))

    def patch(self, b, field, value, note=None):
        p = {"id": "01TESTPATCH00000000000000", "target": f"kb:{self.key}#{b['bid']}", "field": field,
             "base_h": sha1(b["md"]), "value": value, "device": "iPad"}
        return p

    def run_one(self, p, note=None):
        upd, res = process(self.kw, p, note or {}, False, lambda *_: None)
        return upd, self.path.read_text("utf-8")

    def changed_lines(self, new):
        import difflib
        return [l for l in difflib.unified_diff(NOTE.split("\n"), new.split("\n"), lineterm="", n=0) if l[:1] in "+-" and l[:3] not in ("+++", "---")]


class Edit(Base):
    def test_edit_list_item_only_that_line(self):
        b = self.block("Pyruvate")
        upd, new = self.run_one(self.patch(b, "md", b["md"].replace("Acetyl-CoA", "乙醯輔酶 A")))
        self.assertEqual(self.changed_lines(new), ["-- Pyruvate → Acetyl-CoA（中興-115-42）", "+- Pyruvate → 乙醯輔酶 A（中興-115-42）"])
        self.assertEqual(upd["status"], "pending")
        self.assertTrue(upd["note"]["written"])
        self.assertNotIn("<!--", new)

    def test_continuation_kept_verbatim(self):
        b = self.block("PDK")
        self.assertEqual(b["md"], "PDK 磷酸化 → 失活  \n續行文字")
        _, new = self.run_one(self.patch(b, "md", "PDK 磷酸化 → 失去活性  \n續行文字"))
        self.assertEqual(self.changed_lines(new), ["-  - PDK 磷酸化 → 失活  ", "+  - PDK 磷酸化 → 失去活性  "])

    def test_add_continuation_line_uses_content_indent(self):
        b = self.block("PDP")
        _, new = self.run_one(self.patch(b, "md", "PDP 去磷酸化\n補一行"))
        self.assertIn("  - PDP 去磷酸化\n    補一行\n", new)

    def test_paragraph_keeps_links_and_images(self):
        b = self.block("見 ")
        self.assertIn("(/kb/BCH/other)", b["md"])
        self.assertIn("fig:K", b["md"])
        _, new = self.run_one(self.patch(b, "md", b["md"].replace("說明", "詳細說明")))
        self.assertIn('見 [另一份](other.md) 的詳細說明，圖 <img src="../assets/pdh.svg" width="20" /> 在這裡。', new)
        self.assertEqual(len(self.changed_lines(new)), 2)

    def test_changing_link_text_refused(self):
        b = self.block("見 ")
        with self.assertRaises(Refuse):
            process(self.kw, self.patch(b, "md", b["md"].replace("另一份", "另一篇")), {}, False, print)
        self.assertEqual(self.path.read_text("utf-8"), NOTE)

    def test_table(self):
        b = self.block("| Enzyme")
        _, new = self.run_one(self.patch(b, "md", b["md"].replace("TPP", "TPP（B1）")))
        self.assertEqual(self.changed_lines(new), ["-| E1 | TPP |", "+| E1 | TPP（B1） |"])

    def test_heading_level_change_refused(self):
        b = self.block("### A.")
        with self.assertRaises(Refuse):
            process(self.kw, self.patch(b, "md", "## A. Reaction"), {}, False, print)
        _, new = self.run_one(self.patch(b, "md", "### A. 反應"))
        self.assertEqual(self.changed_lines(new), ["-### A. Reaction", "+### A. 反應"])

    def test_new_block_inside_edit_refused(self):
        b = self.block("最後一點")
        with self.assertRaises(Refuse):
            process(self.kw, self.patch(b, "md", "最後一點\n\n# 新標題"), {}, False, print)
        self.assertEqual(self.path.read_text("utf-8"), NOTE)

    def test_figure_block_not_editable(self):
        b = self.block("![PDH]")
        with self.assertRaises(Refuse):
            process(self.kw, self.patch(b, "md", "![圖](fig:x)"), {}, False, print)

    def test_conflict_when_mac_changed(self):
        b = self.block("PDP")
        p = self.patch(b, "md", "PDP 去磷酸化 → 活化")
        self.path.write_text(NOTE.replace("PDP 去磷酸化", "PDP 去磷酸化（Mac 改的）"), "utf-8")
        self.git.run("commit", "-q", "-am", "mac")
        with self.assertRaises(Conflict):
            process(self.kw, p, {}, False, print)
        self.assertIn("（Mac 改的）", self.path.read_text("utf-8"))
        # 開頭的字也改了（bid 對不到）→ 只有原因、沒有 Mac 的版本（網站顯示原因）
        b2 = self.block("最後一點")
        p2 = self.patch(b2, "md", "最後一點！")
        self.path.write_text(self.path.read_text("utf-8").replace("- 最後一點", "- 最後一點（Mac）"), "utf-8")
        self.git.run("commit", "-q", "-am", "mac2")
        with self.assertRaises(Conflict) as cm:
            process(self.kw, p2, {}, False, print)
        self.assertEqual(cm.exception.theirs, "")

    def test_commit_only_that_file(self):
        b = self.block("最後一點")
        self.run_one(self.patch(b, "md", "最後一點（改）"))
        files = self.git.run("show", "--name-only", "--format=", "HEAD").stdout.split()
        self.assertEqual(files, ["02_學習筆記/02_生化/B2_代謝篇/2-3_PDH.md"])

    def test_second_edit_after_written(self):
        b = self.block("最後一點")
        upd, _ = self.run_one(self.patch(b, "md", "最後一點（改）"))
        p2 = self.patch(b, "md", "最後一點（再改）")
        _, new = self.run_one(p2, upd["note"])
        self.assertIn("\n- 最後一點（再改）\n", new)


class Insert(Base):
    def test_insert_after_item_with_children(self):
        b = self.block("Regulation")
        _, new = self.run_one(self.patch(b, "insert_after", "新的一點"))
        self.assertEqual(self.changed_lines(new), ["+- 新的一點"])
        self.assertIn("  - PDP 去磷酸化\n- 新的一點\n- 最後一點\n", new)

    def test_insert_child_without_children(self):
        b = self.block("最後一點")
        _, new = self.run_one(self.patch(b, "insert_child", "子項"))
        self.assertIn("- 最後一點\n  - 子項\n", new)
        self.assertEqual(len(self.changed_lines(new)), 1)

    def test_insert_child_with_children_uses_their_style(self):
        b = self.block("Regulation")
        _, new = self.run_one(self.patch(b, "insert_child", "第一個子項"))
        self.assertIn("- Regulation\n  - 第一個子項\n  - PDK", new)

    def test_insert_after_ordered(self):
        b = self.block("第一步")
        _, new = self.run_one(self.patch(b, "insert_after", "中間一步"))
        self.assertIn("1. 第一步\n2. 中間一步\n2. 第二步\n", new)

    def test_insert_child_under_ordered(self):
        b = self.block("第二步")
        _, new = self.run_one(self.patch(b, "insert_child", "細節"))
        self.assertIn("2. 第二步\n   - 細節\n", new)

    def test_insert_that_would_become_heading_refused(self):
        b = self.block("最後一點")
        with self.assertRaises(Refuse):
            process(self.kw, self.patch(b, "insert_after", "一點\n\n另一段"), {}, False, print)

    def test_edit_inserted_item_again(self):
        b = self.block("最後一點")
        upd, _ = self.run_one(self.patch(b, "insert_after", "新的"))
        _, new = self.run_one(self.patch(b, "insert_after", "新的（改）"), upd["note"])
        self.assertIn("- 最後一點\n- 新的（改）\n\n1.", new)
        self.assertNotIn("- 新的\n", new)


    def test_edit_then_insert_child_same_item(self):
        b = self.block("最後一點")
        edit = self.patch(b, "md", "最後一點（改）")
        edit["status"] = "pending"
        ins = self.patch(b, "insert_child", "子項")
        self.kw.note_own([edit])
        self.run_one(edit)
        _, new = self.run_one(ins)
        self.assertIn("- 最後一點（改）\n  - 子項\n", new)


class Delete(Base):
    def test_delete_item_with_children(self):
        b = self.block("Regulation")
        _, new = self.run_one(self.patch(b, "delete", "1"))
        self.assertIn("- Pyruvate → Acetyl-CoA（中興-115-42）\n- 最後一點\n", new)
        self.assertEqual(len(self.changed_lines(new)), 4)

    def test_delete_paragraph_removes_one_blank(self):
        b = self.block("見 ")
        _, new = self.run_one(self.patch(b, "delete", "1"))
        self.assertIn("2. 第二步\n\n| Enzyme", new)

    def test_heading_not_deletable(self):
        b = self.block("### A.")
        with self.assertRaises(Refuse):
            process(self.kw, self.patch(b, "delete", "1"), {}, False, print)


class Create(Base):
    def new(self, name, md="# 新筆記\n\n- 第一點\n"):
        return {"id": "01TESTNEW0000000000000000", "target": f"kbnew:BCH/{name}", "field": "create", "base_h": "-", "value": md, "device": "Mac"}

    def test_create_in_inbox(self):
        upd, res = process(self.kw, self.new("我的筆記"), {}, False, print)
        p = self.cfg.notes / "02_生化" / "_收件匣" / "我的筆記.md"
        self.assertEqual(p.read_text("utf-8"), "# 新筆記\n\n- 第一點\n")
        self.assertEqual(self.git.run("show", "--name-only", "--format=", "HEAD").stdout.split(), ["02_學習筆記/02_生化/_收件匣/我的筆記.md"])
        # 再改一次（Mac 上沒動）→ 可以蓋過
        p2 = dict(self.new("我的筆記", "# 新筆記\n\n- 第一點\n- 第二點\n"))
        upd2, _ = process(self.kw, p2, upd["note"], False, print)
        self.assertIn("第二點", p.read_text("utf-8"))

    def test_existing_file_refused(self):
        p = self.cfg.notes / "02_生化" / "_收件匣"
        p.mkdir()
        (p / "x.md").write_text("# Mac 上的\n", "utf-8")
        with self.assertRaises(Refuse):
            process(self.kw, self.new("x"), {}, False, print)
        self.assertEqual((p / "x.md").read_text("utf-8"), "# Mac 上的\n")

    def test_same_name_as_existing_doc_refused(self):
        with self.assertRaises(Refuse):
            process(self.kw, self.new("2-3_PDH"), {}, False, print)

    def test_bad_name_refused(self):
        for name in ("../x", "a/b", ".hidden", 'a"b'):
            with self.assertRaises(Refuse):
                process(self.kw, self.new(name), {}, False, print)


class Merged(Base):
    def test_merged_after_publish(self):
        b = self.block("最後一點")
        p = self.patch(b, "md", "最後一點（改）")
        upd, new = self.run_one(p)
        self.assertFalse(merged_ok(p, upd["note"], {self.key: dict(self.doc)}))      # 線上還是舊版
        nd, _ = self.kw.parse(self.key, self.path, new)
        self.assertTrue(merged_ok(p, upd["note"], {self.key: nd}))


if __name__ == "__main__":
    unittest.main()
