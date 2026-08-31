// One-off generator for src/lib/mosaic-station-sets.ts — run this again only if the station list
// changes (WSR-88D sites essentially never move) or to regenerate the whole table from scratch.
// Individual entries in the generated file are meant to be hand-edited afterward as real quirks
// get noticed (e.g. a Georgia site wanting an Alabama station upstream) — this script only
// produces the starting default (nearest-by-distance), it does not overwrite hand edits itself.
//
// Usage: node scripts/generate-mosaic-station-sets.mjs > src/lib/mosaic-station-sets.ts
// (review the diff before committing — this OVERWRITES the whole file, including any hand edits.)

const STATION_COUNT = 4; // each site's own list length, including itself. Matches the mosaic route's previous default.
const NWS_STATIONS_URL = "https://api.weather.gov/radar/stations";
const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}

const response = await fetch(NWS_STATIONS_URL, {
  headers: { Accept: "application/geo+json", "User-Agent": "Frontline Forecast mosaic station set generator" },
});
if (!response.ok) throw new Error(`NWS radar station list failed (${response.status})`);
const data = await response.json();
const stations = data.features
  .filter((feature) => feature.properties.stationType === "WSR-88D")
  .map((feature) => ({
    id: feature.properties.id,
    latitude: feature.geometry.coordinates[1],
    longitude: feature.geometry.coordinates[0],
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

const table = {};
for (const site of stations) {
  const nearest = stations
    .filter((other) => other.id !== site.id)
    .map((other) => ({ id: other.id, distanceKm: haversineKm(site.latitude, site.longitude, other.latitude, other.longitude) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, STATION_COUNT - 1)
    .map((entry) => entry.id);
  table[site.id] = [site.id, ...nearest];
}

const lines = Object.entries(table).map(([site, list]) => `  ${site}: [${list.map((id) => `"${id}"`).join(", ")}],`);

console.log(`// AUTO-GENERATED default, then hand-edited — see scripts/generate-mosaic-station-sets.mjs.
// Maps each of the ${stations.length} real WSR-88D sites to the station list used for ITS mosaic (itself
// first, then ${STATION_COUNT - 1} nearest neighbors by default). This is what actually decides mosaic
// coverage, not the live nearest-station math in nexrad-stations.ts (that's only the bootstrap/fallback).
// Edit an entry directly to fix a real quirk noticed in testing — e.g. a Georgia site wanting an
// Alabama station upstream even if it isn't the closest by raw distance. Regenerating this file
// overwrites the whole table, hand edits included; keep a note of any manual changes before rerunning.
export const mosaicStationSets: Record<string, string[]> = {
${lines.join("\n")}
};
`);
