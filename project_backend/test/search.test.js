const { test } = require("node:test");
const assert = require("node:assert/strict");
const { searchRegions, withinOneEdit } = require("../search");
test("ranking and query normalization are deterministic", () => {
  assert.deepEqual(searchRegions({ input: "  NEW   YORK " }), [
    { name: "New York", matchType: "EXACT" },
  ]);
  assert.deepEqual(searchRegions({ input: "york" }), [
    { name: "New York", matchType: "WORD_PREFIX" },
  ]);
  assert.deepEqual(searchRegions({ input: "californa" }), [
    { name: "California", matchType: "TYPO" },
  ]);
  assert.equal(searchRegions({ input: "virginia" })[0].name, "Virginia");
  assert.equal(searchRegions({ input: "virginia" })[1].name, "West Virginia");
  assert.deepEqual(searchRegions({ input: "ca", limit: 1 }), [
    { name: "California", matchType: "PREFIX" },
  ]);
  assert.deepEqual(searchRegions({ input: "zzzz" }), []);
  assert.deepEqual(searchRegions({ input: "   " }), []);
  for (const limit of [0, 11, 1.5])
    assert.throws(() => searchRegions({ input: "n", limit }));
  assert.throws(() => searchRegions({ input: " ".repeat(81) }));
});
test("edit predicate agrees with reference Levenshtein for exhaustive short strings", () => {
  function distance(a, b) {
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(
          next[j - 1] + 1,
          row[j] + 1,
          row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
      row = next;
    }
    return row[b.length];
  }
  const words = [""];
  for (let n = 1; n <= 4; n++)
    for (let k = 0; k < 2 ** n; k++) words.push(k.toString(2).padStart(n, "0"));
  for (const a of words)
    for (const b of words)
      assert.equal(withinOneEdit(a, b), distance(a, b) <= 1, `${a}/${b}`);
});
