"""Text helpers shared by every adapter.

`math_ranges` and `parse_options` have a line-for-line TypeScript twin in
`schema/ts/options.ts`; both are tested against `schema/fixtures/options.json`.
Change one, change the other, then run both test suites.

Offsets returned to the content contract are UTF-16 code units, because that
is what JavaScript string indices are. Python works in code points internally
and converts at the boundary (`to_utf16`).
"""
import hashlib
import re

BLANK_LINE = re.compile(r"\n[ \t]*\n")


def sha1(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def utf16_map(text):
    """Return a function code-point index -> UTF-16 index (identity for BMP-only text)."""
    if all(ord(c) < 0x10000 for c in text):
        return lambda i: i
    prefix = [0]
    for c in text:
        prefix.append(prefix[-1] + (2 if ord(c) >= 0x10000 else 1))
    return lambda i: prefix[i]


def _find_unescaped(s, token, start):
    i = start
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if s.startswith(token, i):
            return i
        i += 1
    return -1


def math_ranges(s):
    """[(start, end, display)] of `$$…$$` and `$…$` spans, end exclusive.

    Rules (identical in TypeScript):
    - a backslash escapes the next character (`\\$` is a literal dollar);
    - `$$` opens display math and closes at the next unescaped `$$`;
    - a single `$` opens inline math and closes at the next unescaped `$`
      that comes before the next blank line; otherwise the `$` is literal.
    """
    out = []
    i = 0
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == "$":
            if s.startswith("$$", i):
                j = _find_unescaped(s, "$$", i + 2)
                if j >= 0:
                    out.append((i, j + 2, True))
                    i = j + 2
                    continue
                i += 2
                continue
            j = _find_unescaped(s, "$", i + 1)
            if j >= 0:
                blank = BLANK_LINE.search(s, i + 1, j)
                if blank is None:
                    out.append((i, j + 1, False))
                    i = j + 1
                    continue
            i += 1
            continue
        i += 1
    return out


OPEN = {"(": ")", "（": "）"}
LETTERS = "ABCDEFGH"
# Characters allowed immediately before an option marker besides whitespace.
FULLWIDTH_PUNCT = set("，。、；：！？（）「」『』【】《》〈〉…—｜．・")
# Explicit whitespace set so Python and JavaScript agree exactly.
WS = set(" \t\n\r\f\v\u00a0\u3000")


def _in_ranges(pos, ranges):
    for a, b, _ in ranges:
        if a <= pos < b:
            return True
        if a > pos:
            return False
    return False


def option_markers(s, ranges=None):
    """All candidate markers [(letter, start, end)] in code points."""
    ranges = math_ranges(s) if ranges is None else ranges
    out = []
    n = len(s)
    for i, c in enumerate(s):
        if c not in OPEN or i + 2 >= n:
            continue
        letter = s[i + 1]
        if letter not in LETTERS or s[i + 2] != OPEN[c]:
            continue
        if i > 0:
            prev = s[i - 1]
            if not (prev in WS or prev in FULLWIDTH_PUNCT):
                continue
        if i + 3 < n and s[i + 3] in ")）":
            continue
        if _in_ranges(i, ranges):
            continue
        out.append((letter, i, i + 3))
    return out


def _paragraph_end(s, start, ranges):
    pos = start
    while True:
        m = BLANK_LINE.search(s, pos)
        if m is None:
            return len(s)
        if _in_ranges(m.start(), ranges):
            pos = m.start() + 1
            continue
        return m.start()


def _trim(s, a, b):
    while a < b and s[a] in WS:
        a += 1
    while b > a and s[b - 1] in WS:
        b -= 1
    return a, b


def _spans(s, run, ranges):
    out = []
    for k, (letter, _a, end) in enumerate(run):
        stop = run[k + 1][1] if k + 1 < len(run) else _paragraph_end(s, end, ranges)
        a, b = _trim(s, end, stop)
        out.append([letter, a, b])
    return out


def parse_options(s):
    """Return {"opt": [[letter, start, end], ...], "span": [stem_end, tail_start]} or None.

    Rules (規格書 §4.5):
    1. markers (A)…(H) or （A）…（H）, preceded by start of text, whitespace or
       full-width punctuation, not followed by `)`, outside math;
    2. from every (A), follow the first later (B), then the first later (C)…
       to form a run; runs shorter than 2 are discarded;
    3. among the longest runs prefer those whose options are all non-empty,
       then take the last one (the stem may cite letters before the options;
       an option may cite its own letter, as in "(A) 見原圖 (A)");
    4. option i spans marker end .. next marker start (trimmed); the last option
       ends at the end of its paragraph; text after that is the tail.
    """
    ranges = math_ranges(s)
    marks = option_markers(s, ranges)
    runs = []
    for i, m in enumerate(marks):
        if m[0] != "A":
            continue
        run = [m]
        j = i + 1
        while j < len(marks):
            if LETTERS.index(marks[j][0]) == LETTERS.index(run[-1][0]) + 1:
                run.append(marks[j])
            j += 1
        if len(run) >= 2:
            runs.append(run)
    if not runs:
        return None
    best = max(len(r) for r in runs)
    longest = [r for r in runs if len(r) == best]
    spans = [_spans(s, r, ranges) for r in longest]
    full = [k for k, sp in enumerate(spans) if all(b > a for _l, a, b in sp)]
    pick = full[-1] if full else len(longest) - 1
    run, opts = longest[pick], spans[pick]
    tail = _paragraph_end(s, run[-1][2], ranges)
    u = utf16_map(s)
    return {
        "opt": [[l, u(a), u(b)] for l, a, b in opts],
        "span": [u(run[0][1]), u(tail)],
    }
