const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { openDatabase } = require("../database");
const { importCities } = require("../import-cities");
const { createCitySearch, buildCityQuery, validate } = require("../cities");
const { createApp } = require("../server");
test("real PostgreSQL/PostGIS: import, search, cursor, spatial boundaries, plans and HTTP", async (t) => {
  const db = await openDatabase({
    memory: true,
    url: process.env.TEST_DATABASE_URL,
  });
  try {
    const imported = await importCities(db);
    assert.equal(imported.status, "imported");
    assert.ok(imported.records > 20000);
    assert.equal((await importCities(db)).status, "unchanged");
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM cities")).rows[0].n,
      imported.records,
    );
    const search = createCitySearch(db);
    const names = (
      await search({ input: { query: "Springfield", first: 100 } })
    ).nodes;
    assert.ok(names.length > 5);
    assert.ok(new Set(names.map((c) => c.state)).size > 5);
    const ca = await search({
      input: { query: "San", state: "CA", first: 100 },
    });
    assert.ok(ca.nodes.length);
    assert.ok(ca.nodes.every((c) => c.state === "CA"));
    const ids = [];
    let after;
    do {
      const page = await search({
        input: { query: "springfield", first: 3, after },
      });
      ids.push(...page.nodes.map((c) => c.id));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
    assert.deepEqual(
      ids,
      names.map((c) => c.id),
    );
    assert.equal(new Set(ids).size, ids.length);
    const page = await search({ input: { query: "san", first: 1 } });
    await assert.rejects(
      search({ input: { query: "new", after: page.pageInfo.endCursor } }),
      /Cursor/,
    );
    for (const input of [
      { first: 101 },
      { query: "x".repeat(81) },
      { state: "XXX" },
      { after: "malformed" },
      { viewport: { west: 0, east: 1, south: 10, north: 0 } },
      { near: { latitude: 0, longitude: 0, radiusKm: 501 } },
    ])
      await assert.rejects(search({ input }));
    assert.deepEqual(
      (await search({ input: { query: "%' OR 1=1--" } })).nodes,
      [],
    );
    assert.deepEqual((await search({ input: { query: "%" } })).nodes, []);
    const sf = (
      await search({ input: { query: "San Francisco", state: "CA", first: 1 } })
    ).nodes[0];
    const near = await search({
      input: {
        near: { latitude: sf.latitude, longitude: sf.longitude, radiusKm: 5 },
        first: 100,
      },
    });
    assert.ok(near.nodes.some((c) => c.id === sf.id));
    assert.ok(near.nodes.every((c) => c.distanceKm <= 5));
    const viewport = await search({
      input: {
        viewport: {
          west: sf.longitude,
          east: sf.longitude,
          south: sf.latitude,
          north: sf.latitude,
        },
      },
    });
    assert.ok(viewport.nodes.some((c) => c.id === sf.id));
    const wrap = await search({
      input: {
        viewport: { west: 170, east: -170, south: -90, north: 90 },
        first: 100,
      },
    });
    assert.ok(wrap.nodes.length);
    assert.ok(
      wrap.nodes.every((c) => c.longitude >= 170 || c.longitude <= -170),
    );
    const plan = {};
    for (const [name, input] of Object.entries({
      viewport: {
        viewport: { west: -122.5, east: -122.4, south: 37.7, north: 37.8 },
      },
      radius: { near: { latitude: 37.77, longitude: -122.42, radiusKm: 5 } },
    })) {
      const { sql, args } = buildCityQuery(validate(input));
      const result = await db.query(
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql,
        args,
      );
      plan[name] = result.rows[0]["QUERY PLAN"];
      assert.match(
        JSON.stringify(plan[name]),
        /cities_(location|geography)_idx/,
      );
    }
    // A changed dataset rejects old cursors rather than mixing snapshots.
    await db.query(
      "INSERT INTO city_imports(sha256,source,retrieved_at,record_count) VALUES('test-version','fixture',now(),0)",
    );
    await db.query("UPDATE cities SET source_version='test-version'");
    await assert.rejects(
      search({ input: { query: "san", after: page.pageInfo.endCursor } }),
      /Cursor/,
    );
    assert.equal((await importCities(db)).status, "imported");
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "city-import-test-"));
    try {
      const source = JSON.parse(
        await fs.readFile(
          path.join(__dirname, "../../data/cities.json"),
          "utf8",
        ),
      );
      const originalName = source[0].name;
      source[0].name += " rollback fixture";
      const changedRaw = JSON.stringify(source);
      const changedManifest = JSON.parse(
        await fs.readFile(
          path.join(__dirname, "../../data/cities-manifest.json"),
          "utf8",
        ),
      );
      changedManifest.outputSha256 = createHash("sha256")
        .update(changedRaw)
        .digest("hex");
      await fs.writeFile(path.join(temp, "cities.json"), changedRaw);
      await fs.writeFile(
        path.join(temp, "cities-manifest.json"),
        JSON.stringify(changedManifest),
      );
      const failingDb = {
        transaction: (fn) =>
          db.transaction((tx) =>
            fn({
              query: async (sql, args) => {
                const result = await tx.query(sql, args);
                if (sql === "DELETE FROM cities")
                  throw new Error("injected transaction failure");
                return result;
              },
            }),
          ),
      };
      await assert.rejects(
        importCities(failingDb, temp),
        /injected transaction failure/,
      );
      assert.equal(
        (await db.query("SELECT name FROM cities WHERE id=$1", [source[0].id]))
          .rows[0].name,
        originalName,
      );
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int AS n FROM city_imports WHERE sha256=$1",
            [changedManifest.outputSha256],
          )
        ).rows[0].n,
        0,
      );
      source[0].name = originalName;
      source[0].latitude = 999;
      const raw = JSON.stringify(source);
      const manifest = JSON.parse(
        await fs.readFile(
          path.join(__dirname, "../../data/cities-manifest.json"),
          "utf8",
        ),
      );
      manifest.outputSha256 = createHash("sha256").update(raw).digest("hex");
      await fs.writeFile(path.join(temp, "cities.json"), raw);
      await fs.writeFile(
        path.join(temp, "cities-manifest.json"),
        JSON.stringify(manifest),
      );
      await assert.rejects(importCities(db, temp), /Invalid/);
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM cities")).rows[0].n,
        imported.records,
      );
      manifest.outputSha256 = "wrong";
      await fs.writeFile(
        path.join(temp, "cities-manifest.json"),
        JSON.stringify(manifest),
      );
      await assert.rejects(importCities(db, temp), /checksum/);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
    const server = createApp({ db }).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    try {
      const result = await fetch(
        `http://127.0.0.1:${server.address().port}/graphql`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Origin: "http://127.0.0.1:8080",
          },
          body: JSON.stringify({
            query:
              '{cities(input:{query:"Springfield",state:"IL"}){nodes{id name state} pageInfo{hasNextPage}}}',
          }),
        },
      );
      assert.equal(
        result.headers.get("access-control-allow-origin"),
        "http://127.0.0.1:8080",
      );
      const json = await result.json();
      assert.ok(!json.errors, JSON.stringify(json.errors));
      assert.ok(json.data.cities.nodes.length);
    } finally {
      await new Promise((r) => server.close(r));
    }
    const version = await db.query("SELECT version(),postgis_full_version()");
    await fs.mkdir(path.join(__dirname, "../../evidence"), { recursive: true });
    await fs.writeFile(
      path.join(__dirname, "../../evidence/spatial-validation.json"),
      JSON.stringify(
        {
          runtime: process.env.TEST_DATABASE_URL
            ? "Native PostgreSQL/PostGIS integration test"
            : "PGlite embedded PostgreSQL + PostGIS; native PostgreSQL deployment not executed",
          version: version.rows,
          records: imported.records,
          plans: plan,
        },
        null,
        2,
      ),
    );
    t.diagnostic(
      `Validated ${imported.records} records with real spatial SQL and index plans`,
    );
  } finally {
    await db.close();
  }
});
