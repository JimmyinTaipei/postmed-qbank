"""Shared pieces for adapters: YAML loading, asset registry, report collector, link scanning."""
import collections
import re
from pathlib import Path
from urllib.parse import unquote

import yaml

from .. import figs

MD_LINK = re.compile(r"(!?)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+['\"][^\n]*?['\"])?\s*\)")
HTML_IMG = re.compile(r"<img\b[^>]*>", re.I)
HTML_ATTR = lambda name: re.compile(r"\b" + name + r"\s*=\s*(\"[^\"]*\"|'[^']*')", re.I)
SRC_ATTR = HTML_ATTR("src")
WIDTH_ATTR = HTML_ATTR("width")
ALT_ATTR = HTML_ATTR("alt")


class UniqueKeyLoader(yaml.CSafeLoader if hasattr(yaml, "CSafeLoader") else yaml.SafeLoader):
    """Reject duplicated keys (same rule as scripts/物理/question_bank.py)."""


def _unique_mapping(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise ValueError("YAML 欄位重複：" + str(key))
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _unique_mapping)


def load_yaml(text):
    return yaml.load(text, Loader=UniqueKeyLoader)


def sub_spans(regex, fn, text):
    """Like regex.sub(fn, text), but also returns [(start, end, replacement)] for every match that changed
    (positions in the input). pmq patches pull uses it to map edited web text back to the master's bytes."""
    out, spans, last = [], [], 0
    for m in regex.finditer(text):
        rep = fn(m)
        out.append(text[last:m.start()])
        out.append(rep)
        if rep != m.group(0):
            spans.append((m.start(), m.end(), rep))
        last = m.end()
    out.append(text[last:])
    return "".join(out), spans


def attr(regex, tag):
    m = regex.search(tag)
    return m.group(1)[1:-1] if m else None


def link_target(m):
    return unquote(m.group(3) or m.group(4))


class Report:
    """Collects findings; `check` turns it into 驗證報告."""

    def __init__(self):
        self.errors = []          # block publishing
        self.warnings = collections.defaultdict(list)   # kind -> [ {id, ...} ]
        self.counts = collections.defaultdict(collections.Counter)
        self.notes = []

    def error(self, kind, **kw):
        self.errors.append(dict(kind=kind, **kw))

    def warn(self, kind, **kw):
        self.warnings[kind].append(kw)

    def count(self, table, key, n=1):
        self.counts[table][key] += n


class Assets:
    """Every file the content references, keyed by absolute path -> published key a/<sha>.<ext>."""

    def __init__(self, cache, report):
        self.cache = cache
        self.report = report
        self.by_path = {}

    def get(self, path, owner=None):
        path = Path(path)
        key = str(path)
        if key in self.by_path:
            return self.by_path[key]
        if not path.is_file():
            self.report.error("圖檔讀不到", id=owner, path=str(path))
            self.by_path[key] = None
            return None
        data = None
        sha = self.cache.sha256(path)
        ext = path.suffix.lower().lstrip(".") or "bin"

        def compute():
            nonlocal data
            data = data if data is not None else path.read_bytes()
            if ext == "svg":
                return figs.svg_facts(data)
            size = figs.raster_size(data)
            return {"w": size[0] if size else None, "h": size[1] if size else None, "bytes": len(data), "mono": False}

        facts = self.cache.fact(sha, "img", compute)
        info = dict(facts, sha=sha, ext=ext, key=f"a/{sha}.{ext}", path=str(path))
        self.by_path[key] = info
        return info

    def published(self):
        return {v["key"]: v for v in self.by_path.values() if v}
