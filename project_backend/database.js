const fs = require("node:fs/promises");
const path = require("node:path");
async function openDatabase(options = {}) {
  let db;
  if (options.url || (!options.memory && process.env.DATABASE_URL)) {
    const { Pool } = require("pg");
    const pool = new Pool({
      connectionString: options.url || process.env.DATABASE_URL,
      max: 5,
      statement_timeout: 5000,
    });
    // Pin all operations in an import transaction to the same pooled connection.
    db = {
      query: (sql, args) => pool.query(sql, args),
      close: () => pool.end(),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { postgis } = await import("@electric-sql/pglite-postgis");
    const instance = new PGlite({
      dataDir: options.memory
        ? undefined
        : process.env.PGLITE_DIR || path.join(__dirname, ".local-db"),
      extensions: { postgis },
    });
    await instance.waitReady;
    db = {
      query: (sql, args) => instance.query(sql, args),
      close: () => instance.close(),
      transaction: (fn) => instance.transaction(fn),
    };
    // exec supports the multi-statement migration with the embedded adapter.
    db.migrate = (sql) => instance.exec(sql);
  }
  const migration = await fs.readFile(
    path.join(__dirname, "sql/001-cities.sql"),
    "utf8",
  );
  if (db.migrate) await db.migrate(migration);
  else await db.query(migration);
  return db;
}
module.exports = { openDatabase };
