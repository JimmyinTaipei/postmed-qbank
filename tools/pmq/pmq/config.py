"""Read tools/pmq/pmq.toml. Every master-file path in the project comes from here."""
import os
import tomllib
from pathlib import Path

TOML = Path(__file__).resolve().parents[1] / "pmq.toml"
PROJECT = Path(__file__).resolve().parents[3]


class Config:
    def __init__(self, path=None):
        # PMQ_CONFIG：測試用的另一份設定（例如指向暫存資料夾裡的主檔副本）；平常不設
        path = path or os.environ.get("PMQ_CONFIG") or TOML
        data = tomllib.loads(Path(path).read_text("utf-8"))
        p = data["paths"]
        exp = lambda v: Path(os.path.expanduser(v))
        self.root = exp(p["root"])
        rel = lambda v: exp(v) if v.startswith(("~", "/")) else self.root / v
        self.physics = rel(p["physics"])
        self.biochem = rel(p["biochem"])
        self.notes = rel(p["notes"])
        self.structure_db_out = rel(p["structure_db_out"])
        self.structure_db_src = rel(p["structure_db_src"])
        self.exam_pdfs = rel(p["exam_pdfs"])
        self.content_git = rel(p["content_git"])
        self.cache = exp(p["cache"])
        self.backup_dir = rel(p.get("backup_dir", "99_封存/題庫網備份"))
        self.site_url = os.environ.get("PMQ_URL") or data.get("site", {}).get("url", "")
        self.migrations = PROJECT / "worker/migrations"
        self.sample = data.get("sample", {})
        self.kb = data.get("kb", {})
        self.anki = data.get("anki", {})
        # 查單字與單字索引（第 8B-2 階段，規格書 §9.11「8B」）：開了的科目
        self.vocab_subjects = list((data.get("vocab") or {}).get("subjects", ["ENG"]))
        # 共用格式的科目（英文；之後生物、化學）：[subjects.<ID>]，規格書 §9.11「8A」
        self.shared_subjects = []
        for sid, spec in (data.get("subjects") or {}).items():
            if spec.get("format") != "shared":
                continue
            self.shared_subjects.append({"id": sid, "name": spec["name"], "path": rel(spec["path"]),
                                         "id_pattern": spec.get("id_pattern", rf"^{sid}-\d{{6}}$"),
                                         "ink": spec.get("ink", "keep"), "escape_dollar": spec.get("escape_dollar", True),
                                         # 第 8C 階段：子章節分類檔（題目 ID → 子章節；英文的文法章節），相對 path
                                         "xchap_file": spec.get("xchap_file"), "xchap_parent": spec.get("xchap_parent")})
        self.project = PROJECT
        self.reports = PROJECT / "reports"
        self.schema = PROJECT / "schema"
        self.fixtures = PROJECT / "app/fixtures"
        self.baseline = PROJECT / "docs/baseline.json"

    def rel_folder(self, path, depth=4):
        """Folder a link points to, for the link statistics (規格書 §0、回覆檢查 4)."""
        path = Path(path)
        try:
            parts = path.relative_to(self.root.resolve()).parts[:-1]
            return "/".join(parts[:depth]) or "."
        except ValueError:
            parts = path.parts[:-1]
            return "(82_考題整理 以外) " + "/".join(parts[-depth:])

    def rel(self, path):
        """Path relative to root, for reports."""
        try:
            return str(Path(path).resolve().relative_to(self.root.resolve()))
        except ValueError:
            return str(path)
