const regions = require("../data/regions.json");
const { GraphQLError } = require("graphql");
function normalize(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
// At most one insertion, deletion or substitution; linear time, constant space.
function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}
const catalog = regions.map((name) => ({ name, normalized: normalize(name) }));
function searchRegions({ input, limit = 10 }) {
  if (typeof input !== "string" || input.length > 80)
    throw new GraphQLError("Input must be a string of at most 80 characters.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10)
    throw new GraphQLError("Limit must be an integer from 1 to 10.");
  const query = normalize(input);
  if (!query) return [];
  return catalog
    .flatMap((region) => {
      const text = region.normalized;
      let rank, matchType;
      if (text === query) {
        rank = 0;
        matchType = "EXACT";
      } else if (text.startsWith(query)) {
        rank = 1;
        matchType = "PREFIX";
      } else if (text.split(" ").some((word) => word.startsWith(query))) {
        rank = 2;
        matchType = "WORD_PREFIX";
      }
      // Full-name correction only, and never on queries shorter than four characters.
      else if (query.length >= 4 && withinOneEdit(query, text)) {
        rank = 3;
        matchType = "TYPO";
      } else return [];
      return [{ name: region.name, matchType, rank }];
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "en"))
    .slice(0, limit)
    .map(({ name, matchType }) => ({ name, matchType }));
}
module.exports = { searchRegions, normalize, withinOneEdit };
