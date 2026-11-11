const { GraphQLError } = require("graphql");
const { createHash } = require("node:crypto");
const fail = (message) => {
  throw new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
};
function validate(input = {}) {
  const q = (input.query || "").trim().replace(/\s+/g, " ").toLowerCase();
  if (typeof input.query === "string" && input.query.length > 80)
    fail("Query is limited to 80 characters.");
  const state = input.state?.trim().toUpperCase() || null;
  if (state && !/^[A-Z]{2}$/.test(state))
    fail("State must be a two-letter code.");
  const first = input.first ?? 25;
  if (!Number.isInteger(first) || first < 1 || first > 100)
    fail("Page size must be 1–100.");
  const viewport = input.viewport || null,
    near = input.near || null;
  if (viewport) {
    const { west, east, south, north } = viewport;
    if (
      ![west, east, south, north].every(Number.isFinite) ||
      Math.abs(west) > 180 ||
      Math.abs(east) > 180 ||
      Math.abs(south) > 90 ||
      Math.abs(north) > 90 ||
      south > north
    )
      fail("Invalid viewport bounds.");
  }
  if (near) {
    const { latitude, longitude, radiusKm } = near;
    if (
      ![latitude, longitude, radiusKm].every(Number.isFinite) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180 ||
      radiusKm <= 0 ||
      radiusKm > 500
    )
      fail("Radius must be >0 and <=500 km, with valid coordinates.");
  }
  return { q, state, first, viewport, near };
}
function buildCityPredicate(filter) {
  const args = [];
  const bind = (value) => {
    args.push(value);
    return `$${args.length}`;
  };
  const where = [];
  if (filter.q)
    where.push(
      `lower(name) LIKE ${bind(filter.q.replace(/[\\%_]/g, "\\$&") + "%")} ESCAPE '\\'`,
    );
  if (filter.state) where.push(`state=${bind(filter.state)}`);
  if (filter.viewport) {
    const { west, east, south, north } = filter.viewport;
    const envelope = (w, e) =>
      `ST_MakeEnvelope(${bind(w)},${bind(south)},${bind(e)},${bind(north)},4326)`;
    where.push(
      west <= east
        ? `location && ${envelope(west, east)}`
        : `(location && ${envelope(west, 180)} OR location && ${envelope(-180, east)})`,
    );
  }
  let distance = "NULL::float8";
  if (filter.near) {
    const { latitude, longitude, radiusKm } = filter.near;
    const point = `ST_SetSRID(ST_MakePoint(${bind(longitude)},${bind(latitude)}),4326)::geography`;
    where.push(
      `ST_DWithin(location::geography,${point},${bind(radiusKm * 1000)})`,
    );
    distance = `ST_Distance(location::geography,${point})/1000.0`;
  }
  return { args, bind, where, distance };
}
function buildCityQuery(filter, cursor) {
  const { args, bind, where, distance } = buildCityPredicate(filter);
  if (cursor)
    where.push(
      `(lower(name),id)>(${bind(cursor.name)},${bind(cursor.id)}::bigint)`,
    );
  return {
    sql: `SELECT id::text,lower(name) AS sort_name,name,state,population::text,latitude,longitude,${distance} AS "distanceKm" FROM cities ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY lower(name),id LIMIT ${bind(filter.first + 1)}`,
    args,
  };
}
function createCitySearch(db) {
  return async ({ input = {} }) => {
    input = input || {};
    const filter = validate(input);
    const densityLevel = input.densityLevel;
    if (densityLevel != null && (!Number.isInteger(densityLevel) || densityLevel < 0 || densityLevel > 5))
      fail("Density level must be an integer from 0 to 5.");
    // Read data version and page from one snapshot so cursors cannot mix imports.
    return db.transaction(async (tx) => {
      await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const version =
        (await tx.query("SELECT source_version FROM cities LIMIT 1")).rows[0]
          ?.source_version || "empty";
      const fingerprint = createHash("sha256")
        .update(JSON.stringify({ ...filter, first: undefined, version }))
        .digest("hex");
      let cursor;
      if (input.after) {
        try {
          if (input.after.length > 2048) throw Error();
          cursor = JSON.parse(Buffer.from(input.after, "base64url").toString());
          if (
            cursor.fingerprint !== fingerprint ||
            typeof cursor.name !== "string" ||
            cursor.name.length > 200 ||
            !/^\d{1,16}$/.test(cursor.id)
          )
            throw Error();
        } catch {
          fail(
            "Cursor is invalid, filters changed, or data was refreshed. Restart pagination.",
          );
        }
      }
      const { sql, args } = buildCityQuery(filter, cursor);
      const rows = (await tx.query(sql, args)).rows;
      const hasNextPage = rows.length > filter.first;
      const nodes = rows.slice(0, filter.first);
      const last = nodes.at(-1);
      const endCursor = last
        ? Buffer.from(
            JSON.stringify({ name: last.sort_name, id: last.id, fingerprint }),
          ).toString("base64url")
        : null;
      // Both views use the same REPEATABLE READ snapshot and the full filter.
      // Density ignores the cursor and page size, but never ignores area/name/state.
      const density = densityLevel == null ? null
        : await require("./density").summarizeDensity(tx, filter, densityLevel);
      return {
        density,
        nodes,
        pageInfo: { hasNextPage, endCursor },
        datasetVersion: version,
      };
    });
  };
}
module.exports = { createCitySearch, validate, buildCityQuery, buildCityPredicate };
