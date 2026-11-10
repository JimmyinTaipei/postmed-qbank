// Run: node --experimental-strip-types --test schema/ts/options.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseOptions, mathRanges } from "./options.ts";

const cases = JSON.parse(readFileSync(new URL("../fixtures/options.json", import.meta.url), "utf8"));

test("at least 40 cases", () => assert.ok(cases.length >= 40));
for (const c of cases) {
  test(`option fixture: ${c.name}`, () => assert.deepEqual(parseOptions(c.ques), c.expect));
}
test("math ranges basic", () => {
  assert.deepEqual(mathRanges("a $x$ b $$y$$"), [[2, 5, false], [8, 13, true]]);
  assert.deepEqual(mathRanges("\\$5 $x"), []);
});
