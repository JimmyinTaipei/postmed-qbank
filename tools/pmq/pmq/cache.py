"""sha256 cache keyed by (path, size, mtime_ns) so unchanged files are not re-read.

Re-reading a dataless iCloud file triggers a download, so the publisher must
only open files whose stat changed (規格書 §7.2-3). Extra per-file facts
(SVG fonts, PNG size) are cached alongside, keyed by the sha256.
"""
import hashlib
import json
import os
from pathlib import Path


class HashCache:
    def __init__(self, cache_dir):
        self.dir = Path(cache_dir)
        self.path = self.dir / "hashes.json"
        self.files = {}
        self.facts = {}
        self.hits = 0
        self.misses = 0
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text("utf-8"))
                self.files = data.get("files", {})
                self.facts = data.get("facts", {})
            except (ValueError, OSError):
                pass
        self._seen = set()

    def stat_key(self, path):
        st = os.stat(path)
        return [st.st_size, st.st_mtime_ns]

    def sha256(self, path, data=None):
        path = str(path)
        key = self.stat_key(path)
        self._seen.add(path)
        hit = self.files.get(path)
        if hit and hit[0] == key[0] and hit[1] == key[1]:
            self.hits += 1
            return hit[2]
        self.misses += 1
        if data is None:
            data = Path(path).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        self.files[path] = [key[0], key[1], digest]
        return digest

    def fact(self, sha, kind, compute):
        k = kind + ":" + sha
        if k not in self.facts:
            self.facts[k] = compute()
        return self.facts[k]

    def save(self, prune=True):
        self.dir.mkdir(parents=True, exist_ok=True)
        files = {k: v for k, v in self.files.items() if k in self._seen} if prune else self.files
        live = {v[2] for v in files.values()}
        facts = {k: v for k, v in self.facts.items() if k.split(":", 1)[1] in live} if prune else self.facts
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"files": files, "facts": facts}, ensure_ascii=False, separators=(",", ":")), "utf-8")
        os.replace(tmp, self.path)
