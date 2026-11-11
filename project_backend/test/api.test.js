const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server");
test("GraphQL HTTP contract, limits, validation, and supported data", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/graphql`;
  async function query(input) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "query($input:String!){getSuggestions(input:$input)}",
        variables: { input },
      }),
    });
    return response.json();
  }
  try {
    assert.deepEqual((await query(" ca ")).data.getSuggestions, ["California"]);
    assert.deepEqual((await query("new ")).data.getSuggestions, [
      "New Hampshire",
      "New Jersey",
      "New Mexico",
      "New York",
    ]);
    assert.deepEqual((await query("")).data.getSuggestions, []);
    assert.deepEqual((await query("Guam")).data.getSuggestions, []);
    assert.deepEqual((await query("American")).data.getSuggestions, [
      "American Samoa",
    ]);
    assert.deepEqual((await query('" } broken')).data.getSuggestions, []);
    assert.ok((await query("x".repeat(81))).errors);
    assert.ok((await query(null)).errors);
    assert.ok((await query("n")).data.getSuggestions.length <= 10);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/graphql-response+json",
      },
      body: JSON.stringify({ query: "{unknown}" }),
    });
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test("structured search API exposes match reasons and validates limits", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    async function query(input, limit = 10) {
      return (
        await fetch(`http://127.0.0.1:${server.address().port}/graphql`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query:
              "query($input:String!,$limit:Int){searchRegions(input:$input,limit:$limit){name matchType}}",
            variables: { input, limit },
          }),
        })
      ).json();
    }
    assert.deepEqual((await query("californa")).data.searchRegions, [
      { name: "California", matchType: "TYPO" },
    ]);
    assert.deepEqual((await query("york")).data.searchRegions, [
      { name: "New York", matchType: "WORD_PREFIX" },
    ]);
    assert.equal((await query("n", 1)).data.searchRegions.length, 1);
    assert.ok((await query("n", 11)).errors);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
