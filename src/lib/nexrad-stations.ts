// Shared station-list fetch/cache, factored out of /api/radar/stations so other routes reading
// the same NWS list don't duplicate the fetch and 24h cache. Station locations essentially never
// change (a WSR-88D site isn't going to move).
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
