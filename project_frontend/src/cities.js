export async function findCities(input, signal) {
  const response = await fetch(
    import.meta.env.VITE_GRAPHQL_URL || "http://127.0.0.1:4000/graphql",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        query: `query Cities($input:CitySearchInput){cities(input:$input){nodes{id name state population latitude longitude distanceKm} pageInfo{hasNextPage endCursor} datasetVersion}}`,
        variables: { input },
      }),
    },
  );
  if (!response.ok)
    throw new Error("City search is unavailable. Please retry.");
  const data = await response.json();
  if (data.errors)
    throw new Error(data.errors[0].message || "City search failed.");
  if (!Array.isArray(data.data?.cities?.nodes))
    throw new Error("Invalid city response.");
  return data.data.cities;
}
