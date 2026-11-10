"""Facts about image files: pixel size, SVG fonts, whether an SVG is black/white/gray only."""
import re
import struct

FONT_WHITELIST = {"times new roman", "times", "helvetica", "arial", "serif", "sans-serif"}
SVG_SIZE_LIMIT = 500 * 1024
CM_TO_PX = 37.8

_FONT_ATTR = re.compile(r"font-family\s*[=:]\s*(\"[^\"]*\"|'[^']*'|[^;\"'>]+)", re.I)
_COLOR_ATTR = re.compile(r"(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*[=:]\s*(\"[^\"]*\"|'[^']*'|[^;\"'\s>]+)", re.I)
_SVG_TAG = re.compile(r"<svg\b[^>]*>", re.I | re.S)
_NUM = re.compile(r"[-+]?\d*\.?\d+(?:e[-+]?\d+)?", re.I)
NEUTRAL_NAMES = {"black", "white", "gray", "grey", "none", "transparent", "currentcolor", "inherit",
                 "silver", "darkgray", "darkgrey", "lightgray", "lightgrey", "dimgray", "dimgrey", "gainsboro", "whitesmoke"}


def png_size(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", data[16:24])
    return [w, h]


def jpeg_size(data):
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return [w, h]
        seg = struct.unpack(">H", data[i + 2:i + 4])[0]
        i += 2 + seg
    return None


def raster_size(data):
    return png_size(data) or jpeg_size(data)


def _is_neutral(value):
    v = value.strip().strip("\"'").strip().lower()
    if not v or v in NEUTRAL_NAMES or v.startswith("url("):
        return True
    if v.startswith("#"):
        h = v[1:]
        if len(h) in (3, 4):
            return h[0] == h[1] == h[2]
        if len(h) in (6, 8):
            return h[0:2] == h[2:4] == h[4:6]
        return False
    m = re.match(r"rgba?\(([^)]*)\)", v)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")][:3]
        return len(parts) == 3 and parts[0] == parts[1] == parts[2]
    return False


def _length(v):
    if v is None:
        return None
    m = _NUM.match(v.strip())
    if not m:
        return None
    num = float(m.group(0))
    unit = v.strip()[m.end():].strip().lower()
    scale = {"": 1, "px": 1, "pt": 4 / 3, "mm": 3.7795, "cm": 37.795, "in": 96}.get(unit)
    return None if scale is None or unit == "%" else num * scale


def svg_facts(data):
    text = data.decode("utf-8", "replace")
    tag = _SVG_TAG.search(text)
    w = h = None
    if tag:
        t = tag.group(0)
        attr = lambda name: (re.search(r"\b" + name + r"\s*=\s*[\"']([^\"']*)[\"']", t) or [None, None])[1]
        w, h = _length(attr("width")), _length(attr("height"))
        vb = attr("viewBox")
        if (w is None or h is None) and vb:
            nums = [float(x) for x in _NUM.findall(vb)]
            if len(nums) == 4:
                if w is None and h is None:
                    w, h = nums[2], nums[3]
                elif w is None:
                    w = h * nums[2] / nums[3]
                else:
                    h = w * nums[3] / nums[2]
    fonts = set()
    for m in _FONT_ATTR.finditer(text):
        for f in m.group(1).strip("\"'").split(","):
            f = f.strip().strip("\"'").strip()
            if f:
                fonts.add(f)
    has_text = bool(re.search(r"<(text|tspan)\b", text))
    mono = all(_is_neutral(m.group(1)) for m in _COLOR_ATTR.finditer(text)) and "<image" not in text
    bad_fonts = sorted(f for f in fonts if f.lower() not in FONT_WHITELIST)
    return {
        "w": round(w) if w else None,
        "h": round(h) if h else None,
        "fonts": sorted(fonts),
        "bad_fonts": bad_fonts,
        "has_text": has_text,
        "text_without_font": has_text and not fonts,
        "mono": mono,
        "bytes": len(data),
    }
