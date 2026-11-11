const fs = require("node:fs");
const { searchRegions } = require("./search");
const regions = require("../data/regions.json");
// Hand-authored targeted fixtures, not a sampled user-query dataset.
const cases = [
  ["California", "California"],
  ["  new   york ", "New York"],
  ["virginia", "Virginia"],
  ["Puerto Rico", "Puerto Rico"],
  ["cali", "California"],
  ["new j", "New Jersey"],
  ["amer", "American Samoa"],
  ["york", "New York"],
  ["rico", "Puerto Rico"],
  ["samoa", "American Samoa"],
  ["columbia", "District of Columbia"],
  ["californa", "California"],
  ["texass", "Texas"],
  ["florid", "Florida"],
  ["new yorl", "New York"],
  ["Guam", null],
  ["zzzz", null],
  ["", null],
  ['" } bad', null],
  ["califxxnia", null],
];
const rows = cases.map(([input, expected]) => {
  const baseline = regions
    .filter((name) => name.toLowerCase().startsWith(input.toLowerCase()))
    .slice(0, 10);
  const improved = searchRegions({ input });
  const passes = (names) =>
    expected === null ? names.length === 0 : names[0] === expected;
  return {
    input,
    expected,
    baseline,
    improved,
    baselinePass: passes(baseline),
    improvedPass: passes(improved.map((x) => x.name)),
  };
});
const report = {
  scope:
    "20 hand-authored targeted regression fixtures; top-1 intended region or empty result. Not user accuracy, broad relevance or performance benchmark.",
  total: rows.length,
  baselinePassed: rows.filter((x) => x.baselinePass).length,
  improvedPassed: rows.filter((x) => x.improvedPass).length,
  rows,
};
fs.mkdirSync(require("node:path").join(__dirname, "../evidence"), {
  recursive: true,
});
fs.writeFileSync(
  require("node:path").join(__dirname, "../evidence/search-evaluation.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, rows: undefined }));
if (report.improvedPassed !== report.total) process.exitCode = 1;
