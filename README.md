# US City Explorer

A Vue 3 and GraphQL application for searching US populated places by name, state, map viewport, or distance. PostgreSQL/PostGIS handles spatial filtering; cursor pagination preserves a deterministic name/ID order. An optional Google map plots results. City search and result lists work without a map key.

Originally a 2023 region-search prototype, subsequently extended with persistent city data, spatial queries, import validation and regression tests. Personal project: no production deployment, user counts, latency SLA or business impact claimed.

## Quick start — no database server needed

Requires Node **22.12+** and npm; verification used Node 22.16.0. From this directory:

```sh
npm ci --prefix project_backend
npm run import:cities --prefix project_backend
npm start --prefix project_backend
```

The default local mode persists PostgreSQL data through **PGlite**, using its experimental PostGIS extension. It runs real PostgreSQL/PostGIS SQL in WebAssembly, inside a single Node process; it does not establish native-server deployment, multi-process safety or production readiness. Do not run multiple processes against the same `.local-db` directory. Stop the API before running a separate import in this mode. For server deployment use PostgreSQL/PostGIS below.

In a second terminal:

```sh
npm ci --prefix project_frontend
npm run serve --prefix project_frontend
```

Open http://127.0.0.1:8080. API: http://127.0.0.1:4000/graphql. The source snapshot contains 21,786 US populated places derived from GeoNames cities500, including unincorporated places and neighborhoods; it is not a complete municipal-city registry. State codes distinguish same-name records; identical names within a state retain distinct GeoNames IDs.

### Optional Google Maps

Copy `project_frontend/.env.example` to `.env.local` in that directory and set `VITE_GOOGLE_MAPS_API_KEY` to a new website/API-restricted browser key. Restart Vite after changes. Keys in a browser bundle are public; environment variables keep keys out of source control, not out of browsers. Restrict the key to Maps JavaScript API and the expected referrers; confirm billing and quotas. An old key existed in the historical project and must be rotated by its owner. It is excluded from this source package and has not been used for verification.

Successful map interaction tests use an SDK mock. Real Google authentication, tiles and marker rendering are not verified. The basic Marker API is a compatibility choice and is a future candidate for migration to Advanced Markers.

### Native PostgreSQL/PostGIS

Docker Compose configuration is provided; Docker was unavailable in the local verification environment, so this Compose path is **not locally executed**. Native PostgreSQL 17/PostGIS 3.5 integration tests passed in [GitHub Actions](https://github.com/zbchen0129-crypto/us-city-explorer/actions/runs/42975897075), alongside frontend lint and build checks. This validates the CI service path, not a production deployment.

```sh
export POSTGRES_PASSWORD='choose-a-local-password'
docker compose up -d --wait
export DATABASE_URL='postgresql://city_explorer:URL_ENCODED_PASSWORD@127.0.0.1:5432/city_explorer'
npm run import:cities --prefix project_backend
npm start --prefix project_backend
```

Replace the password in the URL; percent-encode reserved characters. Without DATABASE_URL the API uses PGlite. `PGLITE_DIR`, `PORT`, and comma-separated `FRONTEND_ORIGIN` are optional settings. The default allowed browser origin is http://127.0.0.1:8080. SQL statements on native PostgreSQL have a 5s timeout; the pool is limited to five connections. This is a local development configuration, not a hardened public-hosting recipe.

## Query behavior

```graphql
query {
  cities(input: {
    query: "Springfield"
    state: "IL"
    first: 25
    near: { latitude: 39.8, longitude: -89.65, radiusKm: 50 }
  }) {
    nodes { id name state population latitude longitude distanceKm }
    pageInfo { hasNextPage endCursor }
    datasetVersion
  }
}
```

- City-name search is literal, case-insensitive prefix matching with whitespace normalization; `%` and `_` are escaped. No city-name fuzzy or semantic search is claimed. The earlier region-only `searchRegions` query retains separate bounded typo-correction behavior.
- `viewport: {west, east, south, north}` filters WGS84 points. A viewport with west > east crosses the antimeridian and is split into two envelopes. Boundary points are included.
- `near` uses PostGIS geography `ST_DWithin`, meters internally, kilometers at the API boundary. Radius: >0 and <=500 km. Distance is returned in kilometers. Results sort by lowercased name then unique ID, **not nearest-first**.
- Name/state/viewport/radius filters intersect. Page sizes are 1–100. Cursors are query- and dataset-bound, with a deterministic composite key; changing filters or importing another snapshot requires restarting pagination. Cursors are navigation tokens, not authorization credentials.
- Map-area search is explicit: move the map, select Current map view, then press Search. It does not automatically request data on every movement. URL sharing preserves applied filters, radius and viewport, but not a page cursor. Request cancellation plus sequence checks prevent late responses replacing newer results.
- Native transaction connections are pinned. Pages read a repeatable snapshot; import stages and replaces the entire data snapshot atomically. Imports serialize on the audit table and repeated identical imports are no-ops. This is full-snapshot replacement, not an incremental synchronization service.

## Data provenance and refresh

`data/cities-manifest.json` records source URL, retrieval time, archive/output SHA-256, filtering and rejected rows. Attribution: **GeoNames**, https://www.geonames.org/, licensed **CC BY 4.0**, https://creativecommons.org/licenses/by/4.0/. Data was filtered to US P-class records from cities500 and transformed into JSON. Upstream readme: https://download.geonames.org/export/dump/readme.txt. No warranty of accuracy, completeness, recency or population comparability.

To download a fresh snapshot, run `python3 scripts/prepare-cities.py`, inspect the manifest/diff, then import. Import verifies checksum, duplicate IDs, coordinate ranges, required fields and population before modifying the database. A failed validation leaves the previous committed snapshot intact. An import ledger retains snapshot source/version metadata. Historical state/territory boundary files have unconfirmed provenance and are deliberately excluded from the GitHub source package; this version displays city points rather than those polygons.

## Verification

```sh
npm test --prefix project_backend
npm run lint --prefix project_frontend
npm run build --prefix project_frontend
```

Default integration tests create an isolated in-memory PGlite database, execute PostGIS SQL, import the checked-in snapshot twice, validate same-name cities/state filters, complete cursor traversal, cursor invalidation, input rejection, injection-like input, radius boundaries, viewport boundaries and antimeridian handling. `EXPLAIN (ANALYZE, BUFFERS)` checks that selective viewport/radius fixtures use the corresponding GiST indexes. Those plans are evidence for these queries and dataset, not a general performance guarantee.

Native tests require an **empty disposable database** in `TEST_DATABASE_URL`. They replace city tables/data inside that database. `DATABASE_URL` is intentionally ignored by isolated tests. GitHub Actions runs native PostGIS service verification plus frontend checks. [Run 42975897075](https://github.com/zbchen0129-crypto/us-city-explorer/actions/runs/42975897075) passed all checks for source commit `793f8c7`.

## Publication and scope

Publish the prepared source package with a fresh Git history. Do not upload the original repository, private career notes, local database, `.env` files, dependency directories, generated bundles or historical evidence directory. No project-wide open-source code license is granted at this stage; review authorship and choose a license before advertising the project as open source. GeoNames data remains separately governed by CC BY 4.0.

Remaining work includes live Google validation, local Compose and production deployment validation, accessibility and cross-browser testing, more representative search evaluation, and larger-dataset/load testing. Current automated checks are correctness checks, not real-user metrics.

Technical references: [PGlite PostGIS extension](https://pglite.dev/extensions/), [PostGIS geography distance/index semantics](https://postgis.net/docs/ST_DWithin.html), [GeoNames format and license](https://download.geonames.org/export/dump/readme.txt).
