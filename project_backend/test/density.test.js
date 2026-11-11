const { test } = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase } = require("../database");
const { importCities } = require("../import-cities");
const { createCitySearch } = require("../cities");
const { createApp } = require("../server");

test("density conserves filtered counts, bounds output, and shares the page snapshot", async () => {
  const db = await openDatabase({ memory: true, url: process.env.TEST_DATABASE_URL });
  try {
    const imported = await importCities(db);
    const search = createCitySearch(db);
    for (const level of [0, 3, 5]) {
      const result = await search({ input: { first: 1, densityLevel: level } });
      assert.equal(result.nodes.length, 1);
      assert.equal(result.density.total, imported.records);
      assert.ok(result.density.cells.length <= 4 ** level);
      assert.equal(new Set(result.density.cells.map(c => c.id)).size, result.density.cells.length);
      for (const c of result.density.cells) {
        assert.ok(c.count > 0);
        assert.ok(c.longitude >= c.bounds.west && c.longitude <= c.bounds.east);
        assert.ok(c.latitude >= c.bounds.south && c.latitude <= c.bounds.north);
      }
    }
    for (const filter of [
      { query: "San", state: "CA" },
      { near: { latitude: 37.7749, longitude: -122.4194, radiusKm: 5 } },
      { viewport: { west: 170, east: -170, south: -90, north: 90 } },
      { query: "%' OR 1=1--" },
      { query: "San", state: "CA", near: { latitude: 37.7749, longitude: -122.4194, radiusKm: 25 } },
    ]) {
      const allIds = [];
      let after;
      do {
        const page = await search({ input: { ...filter, first: 100, after } });
        allIds.push(...page.nodes.map(c => c.id));
        after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      } while (after);
      const summary = await search({ input: { ...filter, first: 1, densityLevel: 4 } });
      assert.equal(summary.density.total, allIds.length, JSON.stringify(filter));
    }
    const first = await search({ input: { state: "CA", first: 1, densityLevel: 3 } });
    const second = await search({ input: { state: "CA", first: 1, after: first.pageInfo.endCursor, densityLevel: 3 } });
    assert.deepEqual(second.density, first.density); // Summary covers all matches, independent of page.
    assert.equal(second.datasetVersion, first.datasetVersion);
    assert.equal((await search({ input: {} })).density, null); // Existing clients keep cheap page-only path.
    for (const densityLevel of [-1, 6, 2.5])
      await assert.rejects(search({ input: { densityLevel } }), /Density level/);

    // Boundary and shared-cell fixtures are rolled back; persisted data stays intact.
    const rollback = new Error("rollback density fixture");
    await assert.rejects(db.transaction(async tx => {
      for (const [i, [longitude, latitude]] of [[-180,-90], [180,90], [0,0], [0,0], [-0.001,-0.001]].entries())
        await tx.query(`INSERT INTO cities(id,name,state,population,latitude,longitude,location,source_version)
          VALUES($1,'DensityFixture','ZZ',1,$2,$3,ST_SetSRID(ST_MakePoint($3::float8,$2::float8),4326),$4)`,
          [String(9000000000000 + i), latitude, longitude, imported.sha256]);
      const { summarizeDensity } = require("../density");
      const { validate } = require("../cities");
      const d = await summarizeDensity(tx, validate({ state: "ZZ" }), 1);
      assert.equal(d.total, 5);
      assert.deepEqual(d.cells.map(c => [c.id,c.count]), [["1:0:0",2],["1:1:1",3]]);
      for (const [i, longitude] of [179, -179].entries())
        await tx.query(`INSERT INTO cities(id,name,state,population,latitude,longitude,location,source_version)
          VALUES($1,'DateLineFixture','ZY',1,0,$2,ST_SetSRID(ST_MakePoint($2::float8,0),4326),$3)`,
          [String(9000000000005+i), longitude, imported.sha256]);
      const across = await summarizeDensity(tx, validate({ state: "ZY", viewport: { west:170,east:-170,south:-5,north:5 } }), 0);
      assert.equal(across.total, 2);
      assert.equal(Math.abs(across.cells[0].longitude), 180);
      assert.equal(across.cells[0].bounds.west, 179);
      assert.equal(across.cells[0].bounds.east, -179);
      const empty = await summarizeDensity(tx, validate({ query: "NoSuchDensityFixture" }), 5);
      assert.deepEqual(empty.cells, []);
      assert.equal(empty.total, 0);
      throw rollback;
    }), e => e === rollback);

    // In native PostgreSQL, commit a writer between reading the version and reading
    // the two views. A page and its summary must still see the earlier snapshot.
    if (process.env.TEST_DATABASE_URL) {
      const fixtureId = "9000000000010";
      let inserted = false;
      const interleaved = {
        transaction: fn => db.transaction(tx => fn({ query: async (sql, args) => {
          const result = await tx.query(sql, args);
          if (!inserted && sql === "SELECT source_version FROM cities LIMIT 1") {
            inserted = true;
            await db.query(`INSERT INTO cities(id,name,state,population,latitude,longitude,location,source_version)
              VALUES($1,'SnapshotFixture','ZZ',1,0,0,ST_SetSRID(ST_MakePoint(0,0),4326),$2)`, [fixtureId, imported.sha256]);
          }
          return result;
        } })),
      };
      try {
        const before = await createCitySearch(interleaved)({ input: { state: "ZZ", densityLevel: 4 } });
        assert.equal(before.nodes.length, 0);
        assert.equal(before.density.total, 0);
        const after = await search({ input: { state: "ZZ", densityLevel: 4 } });
        assert.equal(after.nodes.length, 1);
        assert.equal(after.density.total, 1);
      } finally { await db.query("DELETE FROM cities WHERE id=$1", [fixtureId]); }
    }

    // HTTP schema and variable coercion, not just direct function calls.
    const server = createApp({ db }).listen(0, "127.0.0.1");
    await new Promise(r => server.once("listening", r));
    try {
      const frontend = await require("node:fs/promises").readFile(require("node:path").join(__dirname, "../../project_frontend/src/cities.js"), "utf8");
      const operation = frontend.match(/query: `([^`]+)`/)[1];
      const result = await fetch(`http://127.0.0.1:${server.address().port}/graphql`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: operation, variables: { input: { state: "CA", densityLevel: 4, first: 1 } } }),
      });
      const json = await result.json();
      assert.ok(!json.errors, JSON.stringify(json.errors));
      assert.equal(json.data.cities.nodes.length, 1);
      assert.ok(json.data.cities.density.total > 100);
      assert.ok(json.data.cities.density.cells.length <= 256);
    } finally {
      await new Promise(r => server.close(r));
    }
  } finally { await db.close(); }
});
