"""「來源｜ID」 labels. Moved from web_tools/library/physics_catalog.py:source_label
so the new site writes labels exactly like the current figure library."""
import re
from pathlib import Path


def source_label(question):
    """'台聯大_115_12' → '台聯大 115 12'; '特訓班2_先修作業二_05' → '特訓班2 先修作業二 Q5'."""
    stem = Path(question.get("file", "")).stem
    if not stem:
        return question.get("id", "")
    stem = stem.replace("_Q_", "_Q")
    if question.get("category") == "其他教材":
        stem = re.sub(r"_(\d+)$", lambda m: f"_Q{int(m[1])}", stem)
    return stem.replace("_", " ")


def biochem_label(source):
    """'高醫-115-01' → '高醫 115 01'; '醫學-115-1-93' → '醫學 115-1 93'."""
    parts = source.split("-")
    if len(parts) == 4:
        return f"{parts[0]} {parts[1]}-{parts[2]} {parts[3]}"
    return " ".join(parts)


def display(label, qid):
    return f"{label}｜{qid}"
