const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { openDatabase } = require("./database");
async function importCities(db, directory = path.join(__dirname, "../data")) {
  const raw = await fs.readFile(path.join(directory, "cities.json"));
  const manifest = JSON.parse(
    await fs.readFile(path.join(directory, "cities-manifest.json"), "utf8"),
  );
  const hash = createHash("sha256").update(raw).digest("hex");
  if (hash !== manifest.outputSha256)
    throw new Error("City data checksum mismatch");
  const rows = JSON.parse(raw);
  const ids = new Set();
  for (const row of rows) {
    if (
      !Number.isSafeInteger(row.id) ||
      row.id <= 0 ||
      ids.has(row.id) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      !/^([A-Z]{2}|\d{2})$/.test(row.state) ||
      !Number.isFinite(row.latitude) ||
      Math.abs(row.latitude) > 90 ||
      !Number.isFinite(row.longitude) ||
      Math.abs(row.longitude) > 180 ||
      !Number.isSafeInteger(row.population) ||
      row.population < 0
    )
      throw new Error("Invalid or duplicate city record");
    ids.add(row.id);
  }
  if (
    !rows.length ||
    rows.length !== manifest.records ||
    manifest.license !== "CC BY 4.0"
  )
    throw new Error("Invalid import manifest");
  return db.transaction(async (tx) => {
    // Serialize snapshot replacement, including imports from multiple processes.
    await tx.query("LOCK TABLE city_imports IN EXCLUSIVE MODE");
    const existing = await tx.query(
      "SELECT sha256 FROM city_imports WHERE sha256=$1",
      [hash],
    );
    const active = await tx.query(
      "SELECT count(*)::int AS count FROM cities WHERE source_version=$1",
      [hash],
    );
    if (existing.rows.length && active.rows[0].count === rows.length)
      return { status: "unchanged", records: rows.length, sha256: hash };
    await tx.query(
      "INSERT INTO city_imports(sha256,source,retrieved_at,record_count) VALUES($1,$2,$3,$4) ON CONFLICT(sha256) DO NOTHING",
      [hash, manifest.source, manifest.retrievedAt, rows.length],
    );
    await tx.query(
      "CREATE TEMP TABLE import_stage (LIKE cities INCLUDING DEFAULTS) ON COMMIT DROP",
    );
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const args = [];
      const values = batch.map((row) => {
        const start = args.length;
        args.push(
          row.id,
          row.name,
          row.state,
          row.population,
          row.latitude,
          row.longitude,
          hash,
        );
        const v = (n) => `$${start + n}`;
        return `(${v(1)},${v(2)},${v(3)},${v(4)},${v(5)},${v(6)},ST_SetSRID(ST_MakePoint(${v(6)}::float8,${v(5)}::float8),4326),${v(7)})`;
      });
      await tx.query(
        `INSERT INTO import_stage(id,name,state,population,latitude,longitude,location,source_version) VALUES ${values.join(",")}`,
        args,
      );
    }
    // Readers observe either the old committed snapshot or the new complete snapshot.
    await tx.query("DELETE FROM cities");
    await tx.query("INSERT INTO cities SELECT * FROM import_stage");
    await tx.query("ANALYZE cities");
    return { status: "imported", records: rows.length, sha256: hash };
  });
}
if (require.main === module)
  (async () => {
    const db = await openDatabase();
    try {
      console.log(JSON.stringify(await importCities(db)));
    } finally {
      await db.close();
    }
  })().catch(() => {
    console.error(
      "City import failed; check input data and database configuration.",
    );
    process.exitCode = 1;
  });
module.exports = { importCities };
