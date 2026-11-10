"""Assemble the content contract from all adapters (no I/O besides reading masters)."""
import collections
import json
import re

from .adapters.biochem import BiochemAdapter
from .adapters.common import Assets, Report
from .adapters.physics import PhysicsAdapter
from .cache import HashCache

SUBJECTS = [
    {"id": "PHY", "name": "物理", "id_pattern": r"^PHY-\d{6}$", "ink": "per_attempt"},
    {"id": "BCH", "name": "生化", "id_pattern": r"^[A-Z]+-[0-9A-Za-z-]+$", "ink": "keep"},
]
SOURCE_KINDS = [
    {"id": "postmed_w", "name": "後西醫", "group": "postmed"},
    {"id": "postmed_c", "name": "後中醫", "group": "postmed"},
    {"id": "postmed_v", "name": "後獸醫", "group": "postmed"},
    {"id": "private_med", "name": "私醫", "group": "exam"},
    {"id": "transfer", "name": "轉學考", "group": "exam"},
    {"id": "national", "name": "醫事國考", "group": "exam"},
    {"id": "textbook", "name": "原文書", "group": "material"},
    {"id": "cram", "name": "補習班教材", "group": "material"},
    {"id": "ai", "name": "AI 生成", "group": "ai"},
    {"id": "self", "name": "自編", "group": "self"},
]
ADAPTERS = [PhysicsAdapter, BiochemAdapter]


class Contract:
    def __init__(self, cfg):
        self.cfg = cfg
        self.cache = HashCache(cfg.cache)
        self.report = Report()
        self.assets = Assets(self.cache, self.report)
        self.questions = []
        self.chapters = []
        self.adapters = [A(cfg, self.cache, self.report, self.assets) for A in ADAPTERS]

    def run(self):
        for a in self.adapters:
            self.chapters += a.chapters()
            qs = a.load()
            for q in qs:
                q["pack"] = pack_of(q)
            self.questions += qs
        self.sources = build_sources(self.questions)
        self.taxonomy = {"subjects": SUBJECTS, "chapters": self.chapters, "source_kinds": SOURCE_KINDS,
                         "sources": self.sources}
        return self

    def public(self, q):
        """Question as published (private keys starting with _ and the pack field removed)."""
        return {k: v for k, v in q.items() if not k.startswith("_") and k != "pack"}

    def index_row(self, q):
        tags = []
        for v in q["tags"].values():
            for t in v:
                if t not in tags:
                    tags.append(t)
        s = q["source"]
        return {"id": q["id"], "label": q["label"], "sid": s["sid"], "kind": s["kind"], "school": s["school"],
                "year": s["year"], "unit": s["unit"], "chap": q["chap"], "xchap": q["xchap"], "tags": tags,
                "qtype": q["qtype"], "has_fig": bool(q["figs"]), "trust": q["answer"]["trust"],
                "human_verified": q["sol_meta"]["human_verified"], "pack": q["pack"], "canonical": q["canonical"]}

    def index(self, subject):
        return [self.index_row(q) for q in self.questions if q["subject"] == subject]


def pack_of(q):
    chap = q.get("chap") or ""
    code = chap.split(":", 1)[1] if ":" in chap else "_unsorted"
    if q["subject"] == "BCH":
        code = code.split("-")[0]
    return f"{q['subject']}/{code}"


def build_sources(questions):
    by = collections.OrderedDict()
    for q in questions:
        s = q["source"]
        sid = s["sid"]
        if sid not in by:
            by[sid] = {"sid": sid, "subject": q["subject"], "kind": s["kind"], "school": s["school"], "year": s["year"],
                       "paper": s["paper"], "book": s["book"], "unit": None, "count": 0}
        by[sid]["count"] += 1
    return sorted(by.values(), key=lambda x: (x["subject"], x["kind"] or "", x["school"] or "", -(x["year"] or 0), x["paper"] or "", x["book"] or "", x["sid"]))


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
