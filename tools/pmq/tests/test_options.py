import json
import unittest
from pathlib import Path

from pmq.textutil import parse_options, math_ranges

FIXTURES = Path(__file__).resolve().parents[3] / "schema/fixtures/options.json"


class OptionFixtures(unittest.TestCase):
    def test_at_least_40_cases(self):
        self.assertGreaterEqual(len(json.loads(FIXTURES.read_text("utf-8"))), 40)

    def test_fixtures(self):
        for case in json.loads(FIXTURES.read_text("utf-8")):
            with self.subTest(case["name"]):
                self.assertEqual(parse_options(case["ques"]), case["expect"])

    def test_math_ranges_basic(self):
        self.assertEqual(math_ranges("a $x$ b $$y$$"), [(2, 5, False), (8, 13, True)])
        self.assertEqual(math_ranges("\\$5 $x"), [])


if __name__ == "__main__":
    unittest.main()
