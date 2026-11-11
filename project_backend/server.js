const express = require("express");
const cors = require("cors");
const { createHandler } = require("graphql-http/lib/use/express");
const { buildSchema, GraphQLError } = require("graphql");
const { searchRegions } = require("./search");
const { createCitySearch } = require("./cities");
function boundedDocument(context) {
  let fields = 0;
  return {
    Field() {
      if (++fields === 101)
        context.reportError(new GraphQLError("Query has too many fields."));
    },
  };
}
const schema = buildSchema(`
  enum MatchType { EXACT PREFIX WORD_PREFIX TYPO }
  type RegionMatch { name: String!, matchType: MatchType! }
  input ViewportInput { west: Float!, east: Float!, south: Float!, north: Float! }
  input NearInput { latitude: Float!, longitude: Float!, radiusKm: Float! }
  input CitySearchInput { query: String, state: String, first: Int = 25, after: String, densityLevel: Int, viewport: ViewportInput, near: NearInput }
  type City { id: ID!, name: String!, state: String!, population: String!, latitude: Float!, longitude: Float!, distanceKm: Float }
  type PageInfo { hasNextPage: Boolean!, endCursor: String }
  type DensityBounds { west: Float!, east: Float!, south: Float!, north: Float! }
  type DensityCell { id: ID!, count: Int!, latitude: Float!, longitude: Float!, bounds: DensityBounds! }
  type CityDensity { level: Int!, total: Int!, cells: [DensityCell!]! }
  type CityConnection { density: CityDensity, nodes: [City!]!, pageInfo: PageInfo!, datasetVersion: String! }
  type Query {
    cities(input: CitySearchInput): CityConnection!
    getSuggestions(input: String!): [String!]!
    searchRegions(input: String!, limit: Int = 10): [RegionMatch!]!
  }
`);
// Preserve the original query shape for existing frontend callers.
function getSuggestions(args) {
  return searchRegions(args)
    .filter((region) => ["EXACT", "PREFIX"].includes(region.matchType))
    .map((region) => region.name);
}
function createApp({ db } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  app.use(
    cors({
      origin: (process.env.FRONTEND_ORIGIN || "http://127.0.0.1:8080").split(
        ",",
      ),
    }),
  );
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.all(
    "/graphql",
    createHandler({
      schema,
      validationRules: [boundedDocument],
      rootValue: {
        getSuggestions,
        searchRegions,
        cities: db
          ? async (args) => {
              try {
                return await createCitySearch(db)(args);
              } catch (error) {
                if (error instanceof GraphQLError) throw error;
                throw new GraphQLError(
                  "City search is temporarily unavailable.",
                  { extensions: { code: "INTERNAL_SERVER_ERROR" } },
                );
              }
            }
          : () => {
              throw new Error("City database is not configured.");
            },
      },
    }),
  );
  app.use((error, _req, res, _next) =>
    res
      .status(error.status === 413 ? 413 : 400)
      .json({ errors: [{ message: "Invalid request body." }] }),
  );
  return app;
}
if (require.main === module) {
  (async () => {
    const { openDatabase } = require("./database");
    const db = await openDatabase();
    const server = createApp({ db }).listen(
      process.env.PORT || 4000,
      "127.0.0.1",
      () => console.log("Map search API listening"),
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.on(signal, () =>
        server.close(async () => {
          await db.close();
          process.exit(0);
        }),
      );
  })().catch(() => {
    console.error("Database startup failed. Check configuration.");
    process.exitCode = 1;
  });
}
module.exports = { createApp, getSuggestions };
