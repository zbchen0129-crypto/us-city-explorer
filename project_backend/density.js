// Equal-angle WGS84 grid fitted to the matched data extent, not people/km².
// Grid level 0..5 gives a structural response bound of 1..1024 cells.
async function summarizeDensity(tx, filter, level) {
  const { buildCityPredicate } = require("./cities");
  const { args, bind, where } = buildCityPredicate(filter);
  const divisions = 2 ** level;
  const n = bind(divisions);
  // Unwrap an explicitly antimeridian-crossing viewport before averaging.
  const longitude = filter.viewport && filter.viewport.west > filter.viewport.east
    ? `CASE WHEN longitude < ${bind(filter.viewport.west)} THEN longitude+360 ELSE longitude END`
    : "longitude";
  const result = await tx.query(`
    WITH filtered AS MATERIALIZED (
      SELECT latitude, ${longitude} AS grid_longitude FROM cities
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ), extent AS (
      SELECT min(grid_longitude) AS west, max(grid_longitude) AS east,
             min(latitude) AS south, max(latitude) AS north FROM filtered
    ), bucketed AS (
      SELECT LEAST(${n}-1, floor((grid_longitude-west)/GREATEST(east-west,1e-9)*${n}))::int AS x,
             LEAST(${n}-1, floor((latitude-south)/GREATEST(north-south,1e-9)*${n}))::int AS y,
             latitude, grid_longitude, west, east, south, north
      FROM filtered CROSS JOIN extent
    )
    SELECT x,y,count(*)::int AS count, avg(latitude)::float8 AS latitude,
           avg(grid_longitude)::float8 AS longitude,
           min(west) AS west,min(east) AS east,min(south) AS south,min(north) AS north
    FROM bucketed GROUP BY x,y ORDER BY x,y`, args);
  const wrap = v => v > 180 ? v - 360 : v;
  const cells = result.rows.map(({ x, y, west, east, south, north, ...row }) => ({
    ...row,
    longitude: wrap(row.longitude),
    id: `${level}:${x}:${y}`,
    bounds: {
      west: wrap(west + x * (east - west) / divisions),
      east: wrap(west + (x + 1) * (east - west) / divisions),
      south: south + y * (north - south) / divisions,
      north: south + (y + 1) * (north - south) / divisions,
    },
  }));
  return { level, total: cells.reduce((sum, cell) => sum + cell.count, 0), cells };
}
module.exports = { summarizeDensity };
