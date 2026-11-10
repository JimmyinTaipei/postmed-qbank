"""Regenerate schema/fixtures/options.json from the cases below.

Expected values are produced by the Python parser and then reviewed by hand
(`--show`). Once committed, both the Python and TypeScript test suites must
reproduce them exactly. Do not regenerate to make a failing test pass without
re-reviewing the diff.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pmq.textutil import parse_options  # noqa: E402

CASES = [
    ("one_per_line", "Which is a vector?\n(A) mass\n(B) speed\n(C) velocity\n(D) energy"),
    ("one_line_all", "Pick one: (A) 1 m (B) 2 m (C) 3 m (D) 4 m"),
    ("two_per_line", "題幹\n(A) 甲　(B) 乙\n(C) 丙　(D) 丁"),
    ("fullwidth_parens", "下列何者正確？\n（A）甲\n（B）乙\n（C）丙\n（D）丁"),
    ("mixed_paren_styles", "何者？\n(A) 甲\n（B）乙\n(C) 丙"),
    ("five_options_E", "Q\n(A) a\n(B) b\n(C) c\n(D) d\n(E) e"),
    ("eight_options_H", "Q (A) 1 (B) 2 (C) 3 (D) 4 (E) 5 (F) 6 (G) 7 (H) 8"),
    ("math_inline_options", "求加速度\n(A) $2\\,\\mathrm{m/s^2}$\n(B) $4\\,\\mathrm{m/s^2}$\n(C) $8$"),
    ("marker_inside_inline_math", "已知 $f(A)=1$ 與 $g (B) = 2$，則\n(A) 1\n(B) 2"),
    ("marker_inside_display_math", "$$\nx = (A) + (B)\n$$\n(A) yes\n(B) no"),
    ("display_math_in_option", "Find E.\n(A) $$E=mc^2$$\n(B) $$E=\\frac12mv^2$$"),
    ("escaped_dollar", "價格 \\$5 與 \\$6 何者\n(A) \\$5\n(B) \\$6"),
    ("unclosed_dollar_literal", "成本 $5 元\n\n(A) 是\n(B) 否"),
    ("stem_cites_letters_first", "若 (A) 與 (B) 同時成立，則下列何者正確？\n(A) 甲\n(B) 乙\n(C) 丙\n(D) 丁"),
    ("option_cites_other_options", "何者正確？\n(A) 甲\n(B) 乙\n(C) 丙\n(D) (A)與(B)皆是"),
    ("two_full_rounds_take_last", "參考 (A) a (B) b (C) c\n\n(A) x\n(B) y\n(C) z"),
    ("image_options", "哪一張圖正確？\n(A) ![](fig:F1)\n(B) ![](fig:F2)\n(C) ![](fig:F3)"),
    ("tail_figure_after_options", "如圖\n(A) 1\n(B) 2\n(C) 3\n\n![原題圖1](fig:F9)"),
    ("tail_text_after_options", "Q\n(A) 1\n(B) 2\n\n（註：本題送分）"),
    ("options_separated_by_blank_lines", "Q\n\n(A) one\n\n(B) two\n\n(C) three\n\nNote below."),
    ("chinese_punct_before_marker", "選出正確者：(A)甲、(B)乙、(C)丙"),
    ("ideographic_space_before", "題\u3000(A)甲\u3000(B)乙"),
    ("letter_glued_to_word_not_marker", "function f(A) and g(B) here\n(A) 1\n(B) 2"),
    ("followed_by_paren_rejected", "(A)) bad (B)) bad"),
    ("missing_A", "Q\n(B) 1\n(C) 2\n(D) 3"),
    ("single_option_only", "Q\n(A) only"),
    ("gap_in_letters", "Q\n(A) 1\n(B) 2\n(D) 4"),
    ("no_options_text", "Explain why the sky is blue."),
    ("empty_string", ""),
    ("lowercase_not_marker", "Q\n(a) 1\n(b) 2"),
    ("letter_I_not_marker", "Q (A) 1 (B) 2 (I) 9"),
    ("table_cell_options", "| (A) 1 | (B) 2 |\n|---|---|\n| (C) 3 | (D) 4 |"),
    ("bold_marker_not_counted", "Q\n**(A)** 1\n**(B)** 2"),
    ("list_item_markers", "Q\n- (A) 1\n- (B) 2\n- (C) 3"),
    ("non_bmp_before_options", "𝑥 與 𝑦 的關係\n(A) 𝑥=𝑦\n(B) 𝑥>𝑦"),
    ("emoji_in_option", "Q\n(A) 😀 happy\n(B) 😢 sad"),
    ("crlf_lines", "Q\r\n(A) 1\r\n(B) 2\r\n"),
    ("trailing_spaces_trimmed", "Q\n(A)   1   \n(B) 2   "),
    ("subquestion_parts_ignored", "(a) 求 v；(b) 求 a\n\n(A) 1\n(B) 2"),
    ("blank_line_inside_display_math_option", "Q\n(A) 1\n(B) $$\nx\n\ny\n$$\n\nafter"),
    ("inline_math_cannot_span_blank_line", "設 $x\n\n(A) 1\n(B) 2 $"),
    ("restart_after_broken_run", "Q (A) 1 (C) 3\n(A) x (B) y"),
    ("longer_earlier_run_wins_over_later_short", "Q\n(A) 1\n(B) 2\n(C) 3\n(D) 4\n\n說明：(A) 與 (B) 為誤"),
    ("start_of_text_marker", "(A) 1 (B) 2"),
    ("multiline_option_body", "Q\n(A) first line\ncontinued\n(B) second"),
    ("option_cites_own_letter", "Which graph?\n\n(A) 見原圖 (A)\n\n(B) 見原圖 (B)\n\n(C) 見原圖 (C)\n\n![原題圖](fig:F1)"),
    ("placeholder_options_empty", "選出正確的圖\n![](fig:F2)\n(A)　(B)　(C)"),
    ("cyrillic_C_breaks_run", "Q\n(A) 1.3 с\n(B) 1.0 с (С) 0.97 с\n(D) 0.93 с"),
    ("nbsp_before_marker", "Q\u00a0(A) 1\u00a0(B) 2"),
]


def main():
    show = "--show" in sys.argv
    out = []
    for name, ques in CASES:
        res = parse_options(ques)
        out.append({"name": name, "ques": ques, "expect": res})
        if show:
            print("==", name)
            if res is None:
                print("   None")
            else:
                print("   stem:", repr(_u16slice(ques, 0, res["span"][0])), "tail:", repr(_u16slice(ques, res["span"][1], None)))
                for l, a, b in res["opt"]:
                    print("  ", l, repr(_u16slice(ques, a, b)))
    path = Path(__file__).resolve().parents[3] / "schema/fixtures/options.json"
    if "--write" in sys.argv:
        path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("wrote", path, len(out), "cases")


def _u16slice(s, a, b):
    e = s.encode("utf-16-le")
    return e[a * 2:(None if b is None else b * 2)].decode("utf-16-le")


if __name__ == "__main__":
    main()
