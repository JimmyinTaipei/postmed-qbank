"""pmq check math (規格書 §6.1): typeset every formula with the app's KaTeX version.

Formulas are found with textutil.math_ranges — the same rule the app uses.
Results are cached by formula hash so a re-run only sends new formulas to Node.
"""
import hashlib
import json
import subprocess
from pathlib import Path

from .textutil import math_ranges

CHECKER = Path(__file__).resolve().parents[2] / "mathcheck/check.mjs"


def formulas(text):
    for a, b, display in math_ranges(text):
        inner = text[a + 2:b - 2] if display else text[a + 1:b - 1]
        if inner.strip():
            yield inner, display


def _version():
    pkg = CHECKER.parent / "node_modules/katex/package.json"
    return json.loads(pkg.read_text())["version"] if pkg.exists() else "missing"


def run(items, cfg):
    """items: iterable of (owner, field, text). Returns (failures, stats)."""
    macros = (cfg.schema / "katex-macros.json").read_bytes()
    salt = hashlib.sha1(macros + _version().encode()).hexdigest()[:8]
    cache_path = cfg.cache / "math.json"
    try:
        cache = json.loads(cache_path.read_text("utf-8"))
        if cache.get("salt") != salt:
            cache = {}
    except (OSError, ValueError):
        cache = {}
    ok = set(cache.get("ok", []))
    bad = dict(cache.get("bad", {}))
    occurrences = []
    todo = {}
    for owner, field, text in items:
        for tex, display in formulas(text or ""):
            h = hashlib.sha1((("D" if display else "I") + tex).encode()).hexdigest()[:16]
            occurrences.append((owner, field, tex, display, h))
            if h not in ok and h not in bad:
                todo[h] = (tex, display)
    if todo:
        payload = "".join(json.dumps({"k": h, "tex": t, "display": d}, ensure_ascii=False) + "\n" for h, (t, d) in todo.items())
        proc = subprocess.run(["node", str(CHECKER)], input=payload, capture_output=True, text=True, check=True)
        failed = {}
        for line in proc.stdout.splitlines():
            r = json.loads(line)
            failed[r["k"]] = r["error"].replace("̲", "")
        for h in todo:
            if h in failed:
                bad[h] = failed[h]
            else:
                ok.add(h)
    cfg.cache.mkdir(parents=True, exist_ok=True)
    live = {o[4] for o in occurrences}
    cache_path.write_text(json.dumps({"salt": salt, "ok": sorted(ok & live), "bad": {k: v for k, v in bad.items() if k in live}},
                                     ensure_ascii=False, separators=(",", ":")), "utf-8")
    failures = [{"id": o, "field": f, "tex": t, "display": d, "error": bad[h]} for o, f, t, d, h in occurrences if h in bad]
    stats = {"formulas": len(occurrences), "unique": len(live), "checked_now": len(todo), "failed": len(failures),
             "katex": _version()}
    return failures, stats
