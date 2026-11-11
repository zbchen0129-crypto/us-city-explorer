<template>
  <main>
    <header>
      <p class="eyebrow">GEOSPATIAL SEARCH · PERSONAL PROJECT</p>
      <h1>US City Explorer</h1>
      <p>Find populated places by name, map area, or distance.</p>
    </header>
    <form @submit.prevent="search()">
      <label
        >City name
        <input v-model="query" maxlength="80" placeholder="Try Springfield"
      /></label>
      <label
        >State code <input v-model="state" maxlength="2" placeholder="e.g. CA"
      /></label>
      <label
        >Search area
        <select v-model="mode">
          <option value="all">All US records</option>
          <option value="near">Within a radius</option>
          <option value="viewport" :disabled="!mapReady">
            Current map view
          </option>
        </select></label
      >
      <template v-if="mode === 'near'">
        <label
          >Latitude
          <input
            v-model.number="latitude"
            type="number"
            min="-90"
            max="90"
            step="any"
            required
        /></label>
        <label
          >Longitude
          <input
            v-model.number="longitude"
            type="number"
            min="-180"
            max="180"
            step="any"
            required
        /></label>
        <label
          >Radius (km)
          <input
            v-model.number="radiusKm"
            type="number"
            min="0.1"
            max="500"
            step="any"
            required
        /></label>
      </template>
      <button type="submit">
        {{ loading ? "Searching…" : "Search cities" }}
      </button>
      <button type="button" @click="share">Copy search link</button>
    </form>
    <p role="status">{{ mapStatus }}</p>
    <p v-if="shareStatus" role="status">{{ shareStatus }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <section class="workspace">
      <div>
        <h2>
          Results
          <small v-if="cities.length">({{ cities.length }} shown)</small>
        </h2>
        <p v-if="!loading && !cities.length">
          No matching records. Try another name or area.
        </p>
        <ul aria-label="City results">
          <li v-for="city in cities" :key="city.id">
            <button class="result" @click="focusCity(city)">
              <strong>{{ city.name }}, {{ city.state }}</strong
              ><span
                >Population {{ Number(city.population).toLocaleString()
                }}<template v-if="city.distanceKm !== null">
                  · {{ city.distanceKm.toFixed(1) }} km</template
                ></span
              >
            </button>
          </li>
        </ul>
        <button
          v-if="pageInfo.hasNextPage"
          :disabled="loading"
          @click="search(true)"
        >
          Load more
        </button>
      </div>
      <div ref="mapElement" id="map" aria-label="City map"></div>
    </section>
    <footer>
      Data: <a href="https://www.geonames.org/">GeoNames</a>,
      <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>,
      filtered and transformed. Populated places in the cities500 dataset; not a
      complete list of incorporated US cities. Local prototype; no production
      usage claimed.
    </footer>
  </main>
</template>
<script>
import { markRaw } from "vue";
import { loadMaps } from "./maps";
import { findCities } from "./cities";
export default {
  data: () => ({
    query: "",
    state: "",
    mode: "all",
    latitude: 37.7749,
    longitude: -122.4194,
    radiusKm: 25,
    cities: [],
    pageInfo: { hasNextPage: false },
    loading: false,
    error: "",
    mapReady: false,
    mapStatus: "Loading optional Google map…",
    shareStatus: "",
    savedViewport: null,
  }),
  mounted() {
    this.sequence = 0;
    this.markers = [];
    const params = new URLSearchParams(location.search);
    this.query = params.get("q") || "";
    this.state = params.get("state") || "";
    if (["all", "near", "viewport"].includes(params.get("mode")))
      this.mode = params.get("mode");
    for (const field of ["latitude", "longitude", "radiusKm"])
      if (params.has(field)) this[field] = Number(params.get(field));
    if (params.has("view")) {
      try {
        this.savedViewport = JSON.parse(params.get("view"));
      } catch {
        this.mode = "all";
      }
    }
    this.search();
    loadMaps(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
      .then((maps) => {
        if (this.disposed) return;
        this.maps = maps;
        this.map = new maps.Map(this.$refs.mapElement, {
          center: { lat: 37.0902, lng: -95.7129 },
          zoom: 4,
        });
        if (this.mode === "viewport" && this.savedViewport)
          this.map.fitBounds(this.savedViewport);
        this.mapReady = true;
        this.mapStatus =
          "Select a city to focus the map. Map-area searches run when you press Search cities.";
        this.drawMarkers();
      })
      .catch((error) => {
        if (!this.disposed) this.mapStatus = error.message;
      });
  },
  beforeUnmount() {
    this.disposed = true;
    this.controller?.abort();
    this.markers.forEach((marker) => marker.setMap(null));
  },
  methods: {
    input() {
      const input = { query: this.query, state: this.state, first: 25 };
      if (this.mode === "near")
        input.near = {
          latitude: this.latitude,
          longitude: this.longitude,
          radiusKm: this.radiusKm,
        };
      if (this.mode === "viewport") {
        const bounds = this.map?.getBounds();
        if (bounds) {
          const ne = bounds.getNorthEast(),
            sw = bounds.getSouthWest();
          this.savedViewport = {
            west: sw.lng(),
            east: ne.lng(),
            south: sw.lat(),
            north: ne.lat(),
          };
        }
        if (!this.savedViewport)
          throw new Error(
            "Map bounds are not ready. Try again after the map loads.",
          );
        input.viewport = this.savedViewport;
      }
      return input;
    },
    async search(more = false) {
      const sequence = ++this.sequence;
      this.controller?.abort();
      this.controller = new AbortController();
      this.loading = true;
      this.error = "";
      try {
        const input = more
          ? { ...this.lastInput, after: this.pageInfo.endCursor }
          : this.input();
        if (!more) {
          this.lastInput = input;
          this.cities = [];
          this.pageInfo = { hasNextPage: false };
        }
        const result = await findCities(input, this.controller.signal);
        if (sequence !== this.sequence || this.disposed) return;
        this.cities = more ? [...this.cities, ...result.nodes] : result.nodes;
        this.pageInfo = result.pageInfo;
        this.drawMarkers();
        this.writeUrl();
      } catch (error) {
        if (
          sequence === this.sequence &&
          !this.disposed &&
          error.name !== "AbortError"
        )
          this.error = error.message;
      } finally {
        if (sequence === this.sequence && !this.disposed) this.loading = false;
      }
    },
    drawMarkers() {
      if (!this.mapReady) return;
      this.markers.forEach((marker) => marker.setMap(null));
      this.markers = this.cities.map((city) => {
        const marker = new this.maps.Marker({
          map: this.map,
          position: { lat: city.latitude, lng: city.longitude },
          title: city.name + ", " + city.state,
        });
        marker.addListener("click", () => this.focusCity(city));
        return markRaw(marker);
      });
    },
    focusCity(city) {
      if (this.mapReady) {
        this.map.panTo({ lat: city.latitude, lng: city.longitude });
        this.map.setZoom(10);
      } else
        this.mapStatus =
          "Map unavailable. Coordinates: " +
          city.latitude +
          ", " +
          city.longitude;
    },
    writeUrl() {
      const p = new URLSearchParams();
      p.set("q", this.lastInput.query);
      p.set("state", this.lastInput.state);
      if (this.lastInput.near) {
        p.set("mode", "near");
        Object.entries(this.lastInput.near).forEach(([k, v]) => p.set(k, v));
      }
      if (this.lastInput.viewport) {
        p.set("mode", "viewport");
        p.set("view", JSON.stringify(this.lastInput.viewport));
      }
      history.replaceState(null, "", location.pathname + "?" + p);
    },
    async share() {
      try {
        await navigator.clipboard.writeText(location.href);
        this.shareStatus = "Search link copied.";
      } catch {
        this.shareStatus = "Copy the current browser URL to share this search.";
      }
    },
  },
};
</script>
<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: #f4f6f8;
  color: #20303c;
  font-family: system-ui, sans-serif;
}
main {
  max-width: 1200px;
  padding: 32px 24px;
  margin: auto;
}
.eyebrow {
  letter-spacing: 0.12em;
  font-size: 12px;
  color: #4a6878;
}
h1 {
  font-size: 36px;
  margin: 8px 0;
}
form {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: end;
  background: white;
  padding: 20px;
  border-radius: 12px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 14px;
}
input,
select,
button {
  font: inherit;
  padding: 10px;
  border: 1px solid #bdcbd2;
  border-radius: 6px;
}
input {
  max-width: 210px;
}
button {
  cursor: pointer;
  background: #155e75;
  color: white;
}
button:disabled {
  opacity: 0.5;
}
button:focus-visible,
input:focus-visible,
select:focus-visible {
  outline: 3px solid #eead45;
  outline-offset: 2px;
}
.workspace {
  display: grid;
  grid-template-columns: 340px 1fr;
  gap: 24px;
}
ul {
  list-style: none;
  padding: 0;
  max-height: 480px;
  overflow: auto;
}
.result {
  width: 100%;
  text-align: left;
  background: white;
  color: inherit;
  margin-bottom: 6px;
}
.result span {
  display: block;
  font-size: 12px;
  margin-top: 6px;
}
#map {
  height: 580px;
  background: #dfe7eb;
  border-radius: 12px;
}
small,
footer {
  font-size: 12px;
}
footer {
  margin-top: 28px;
  line-height: 1.8;
}
a {
  color: #155e75;
}
[role="alert"] {
  color: #a32222;
}
@media (max-width: 750px) {
  .workspace {
    grid-template-columns: 1fr;
  }
  #map {
    height: 360px;
  }
}
</style>
