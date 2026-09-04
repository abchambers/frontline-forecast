// Real verification for the Phase 3 redesign, 2026-09-04: before wiring the coalesced resolver
// back into the live client, confirm it actually solves the problem that caused the incident --
// a real viewport's worth of tile requests should now resolve to 1-2 distinct combos, not 13.
//
// This is a standalone re-implementation of tile-station-resolver.ts's real logic (that file lives
// in the main Next.js app, a separate package from this worker) using the exact same real station
// list and the exact same tile pattern captured live in fly logs during the incident:
// z=8, x=67..70, y=101..103 (a real 4x3 viewport, 12 tiles) around the Atlanta/KFFC area.
import { tileXToLon, tileYToLat } from "../src/mercator.js";

const MAX_RANGE_KM = 460;
const MAX_STATIONS_PER_TILE = 5;
const COALESCE_ZOOM = 6;

type Station = { id: string; latitude: number; longitude: number };
async function fetchStations(): Promise<Station[]> {
  const response = await fetch("https://api.weather.gov/radar/stations", {
    headers: { Accept: "application/geo+json", "User-Agent": "Frontline Forecast weather application (verification script)" },
  });
  const data = (await response.json()) as { features: { geometry: { coordinates: [number, number] }; properties: { id: string; stationType: string } }[] };
  return data.features.filter((f) => f.properties.stationType === "WSR-88D").map((f) => ({ id: f.properties.id, longitude: f.geometry.coordinates[0], latitude: f.geometry.coordinates[1] }));
}

const EARTH_RADIUS_KM = 6371;
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
type Bounds = { minLat: number; maxLat: number; minLon: number; maxLon: number };
function tileBounds(z: number, x: number, y: number): Bounds {
  return { minLon: tileXToLon(x, z), maxLon: tileXToLon(x + 1, z), maxLat: tileYToLat(y, z), minLat: tileYToLat(y + 1, z) };
}
function distanceToBoundsKm(lat: number, lon: number, bounds: Bounds): number {
  const nearestLat = Math.max(bounds.minLat, Math.min(lat, bounds.maxLat));
  const nearestLon = Math.max(bounds.minLon, Math.min(lon, bounds.maxLon));
  return haversineKm(lat, lon, nearestLat, nearestLon);
}
function coalesceRegion(z: number, x: number, y: number) {
  const scale = Math.pow(2, z - COALESCE_ZOOM);
  return { rz: COALESCE_ZOOM, rx: Math.floor(x / scale), ry: Math.floor(y / scale) };
}

// Mirrors tile-station-resolver.ts's real STATION_PINS exactly -- this script re-implements the
// resolver standalone (a separate package from the main app), so it has to copy this too or the
// simulation isn't a faithful test of what actually ships.
type StationPin = { anchorLat: number; anchorLon: number; radiusKm: number; mustInclude: string[] };
const STATION_PINS: StationPin[] = [{ anchorLat: 33.3633, anchorLon: -84.5658, radiusKm: 350, mustInclude: ["KFFC", "KMXX", "KBMX", "KGSP"] }];

function resolveStationsForRegion(stations: Station[], rz: number, rx: number, ry: number): string[] {
  const bounds = tileBounds(rz, rx, ry);
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLon = (bounds.minLon + bounds.maxLon) / 2;

  const applicablePins = STATION_PINS.filter((pin) => haversineKm(centerLat, centerLon, pin.anchorLat, pin.anchorLon) <= pin.radiusKm);
  const pinnedIds = new Set(applicablePins.flatMap((pin) => pin.mustInclude));

  const ranked = stations
    .map((s) => ({ id: s.id, distanceKm: distanceToBoundsKm(s.latitude, s.longitude, bounds), centerDistanceKm: haversineKm(s.latitude, s.longitude, centerLat, centerLon) }))
    .filter((s) => s.distanceKm <= MAX_RANGE_KM)
    .sort((a, b) => a.centerDistanceKm - b.centerDistanceKm);

  const result: string[] = [...pinnedIds];
  for (const candidate of ranked) {
    if (result.length >= MAX_STATIONS_PER_TILE) break;
    if (pinnedIds.has(candidate.id)) continue;
    result.push(candidate.id);
  }
  return result;
}

async function main() {
  const stations = await fetchStations();

  // The exact real tile pattern from the incident's fly logs (z8, x=67..70, y=101..103) -- Atlanta,
  // has a pin configured. Also test Minneapolis (no pin configured anywhere near it) with the same
  // real 4x3 viewport shape, centered on KMPX's own tile (61/92, from earlier tonight's testing).
  const args = process.argv.slice(2);
  const baseX = args[0] ? Number(args[0]) : 67;
  const baseY = args[1] ? Number(args[1]) : 101;
  const viewportTiles: { z: number; x: number; y: number }[] = [];
  for (let x = baseX; x <= baseX + 3; x++) {
    for (let y = baseY; y <= baseY + 2; y++) {
      viewportTiles.push({ z: 8, x, y });
    }
  }
  console.log(`Simulating a real viewport: ${viewportTiles.length} tiles (z=8, x=${baseX}-${baseX + 3}, y=${baseY}-${baseY + 2})`);

  const comboByTile = new Map<string, string>();
  const distinctCombos = new Map<string, number>();
  for (const tile of viewportTiles) {
    const { rz, rx, ry } = coalesceRegion(tile.z, tile.x, tile.y);
    const combo = resolveStationsForRegion(stations, rz, rx, ry).join(",");
    comboByTile.set(`${tile.z}/${tile.x}/${tile.y}`, combo);
    distinctCombos.set(combo, (distinctCombos.get(combo) ?? 0) + 1);
  }

  console.log(`\nDistinct combos needed for this viewport: ${distinctCombos.size} (was 13 before this fix)`);
  for (const [combo, count] of distinctCombos) {
    console.log(`  [${combo}] -- used by ${count}/${viewportTiles.length} tiles`);
  }
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
