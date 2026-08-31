// Shared station-list fetch/cache + nearest-station lookup, factored out of
// /api/radar/stations so the new /api/radar/mosaic route doesn't duplicate the same NWS fetch
// and 24h cache. Station locations essentially never change (a WSR-88D site isn't going to move).
const NWS_STATIONS_URL = "https://api.weather.gov/radar/stations";
const CACHE_TTL_MS = 24 * 60 * 60_000;

export type RadarStationSummary = { id: string; name: string; latitude: number; longitude: number };

type NwsStationFeature = {
  geometry: { coordinates: [number, number] };
  properties: { id: string; name: string; stationType: string };
};

let cache: { data: RadarStationSummary[]; expiresAt: number } | null = null;

// The full endpoint returns 208 "radar stations" including TDWR (airport terminal radar) and wind
// profilers (not weather radar at all) — filtered to the 159 real WSR-88D sites this app can
// actually show data for, same filter the station picker already applies.
export async function getRadarStations(): Promise<RadarStationSummary[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  const response = await fetch(NWS_STATIONS_URL, {
    headers: { Accept: "application/geo+json", "User-Agent": "Frontline Forecast weather application" },
  });
  if (!response.ok) throw new Error(`NWS radar station list failed (${response.status})`);
  const data = (await response.json()) as { features: NwsStationFeature[] };
  const stations: RadarStationSummary[] = data.features
    .filter((feature) => feature.properties.stationType === "WSR-88D")
    .map((feature) => ({
      id: feature.properties.id,
      name: feature.properties.name,
      longitude: feature.geometry.coordinates[0],
      latitude: feature.geometry.coordinates[1],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  cache = { data: stations, expiresAt: Date.now() + CACHE_TTL_MS };
  return stations;
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(a));
}

// Sorted by real great-circle distance, not just whatever order NWS returns them in. Caps at
// MAX_RANGE_KM (matches radar-worker's own single-site MAX_RANGE_KM) so a station whose coverage
// wouldn't even reach the requested location isn't included just to pad out `count`.
const MAX_RANGE_KM = 230;

export function nearestStations(latitude: number, longitude: number, stations: RadarStationSummary[], count: number): RadarStationSummary[] {
  return stations
    .map((station) => ({ station, distanceKm: haversineKm(latitude, longitude, station.latitude, station.longitude) }))
    .filter((entry) => entry.distanceKm <= MAX_RANGE_KM)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, count)
    .map((entry) => entry.station);
}
