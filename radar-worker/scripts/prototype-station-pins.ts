// Phase 3 prototype, 2026-09-03: manual station control on top of the automatic geometric
// selection (prototype-tile-station-matching.ts). Real requirement from Andrew, direct quote: for
// Atlanta specifically he wants the Alabama stations, KGSP, and "maybe Jacksonville" guaranteed
// present, regardless of what pure closest-N ranking picks. The pure-geometric closest-5 for
// Atlanta (see the other prototype's real output) was KFFC, KMXX, KHTX, KBMX, KJGX -- KGSP lost
// out to KHTX by raw distance, and KJAX wasn't close enough to make the list at all. That's exactly
// the kind of "little quirk" he wants to be able to override.
//
// Design: a small, SPARSE pin table -- only for regions Andrew actually wants to hand-tune, not a
// full replacement for the automatic default everywhere else (that would just be
// mosaicStationSets again, the thing Phase 3 exists to stop maintaining by hand). Resolution
// priority: pinned stations are ALWAYS included; remaining slots (up to MAX_STATIONS_PER_TILE) go
// to the closest un-pinned candidates by pure geometry. A pinned station is never displaced to make
// room for another pin or an auto-selected one.
import { tileXToLon, tileYToLat, NATIVE_ZOOM } from "../src/mercator.js";
import { MAX_RANGE_KM } from "../src/radar-constants.js";

type Station = { id: string; name: string; latitude: number; longitude: number };

async function fetchStations(): Promise<Station[]> {
  const response = await fetch("https://api.weather.gov/radar/stations", {
    headers: { Accept: "application/geo+json", "User-Agent": "Frontline Forecast weather application (prototype script)" },
  });
  const data = (await response.json()) as { features: { geometry: { coordinates: [number, number] }; properties: { id: string; name: string; stationType: string } }[] };
  return data.features
    .filter((f) => f.properties.stationType === "WSR-88D")
    .map((f) => ({ id: f.properties.id, name: f.properties.name, longitude: f.geometry.coordinates[0], latitude: f.geometry.coordinates[1] }));
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

const MAX_STATIONS_PER_TILE = 5;

// THE real pin table -- deliberately tiny. Anchored on a real station's own coordinates rather
// than inventing new lat/lon constants to maintain. radiusKm is how far from that anchor the pin
// rule applies -- a tile whose center falls within this radius gets the mustInclude stations
// force-added.
//
// REAL FINDING while testing this, worth knowing before using it for real: pinning ONLY the
// stations that were missing (KGSP, KJAX) isn't actually enough to guarantee Andrew's full
// intended set. The remaining slots still fill by raw closest-distance among UN-pinned candidates
// -- which, for this exact tile, ranked KHTX slightly closer than KBMX and would have bumped
// KBMX (one of "the Alabama stations" he explicitly wants) right back out. Pinning is only
// deterministic for what you actually pin -- if you want a station guaranteed, pin it explicitly,
// don't rely on "it'll probably win the remaining-slot ranking anyway." So this list is the FULL
// intended Atlanta set (KFFC, KMXX, KBMX, KGSP, KJAX), not just the two that the pure-geometric
// pick got wrong.
type StationPin = { anchorStationId: string; anchorLat: number; anchorLon: number; radiusKm: number; mustInclude: string[] };
const STATION_PINS: StationPin[] = [
  { anchorStationId: "KFFC", anchorLat: 33.3633, anchorLon: -84.5658, radiusKm: 150, mustInclude: ["KFFC", "KMXX", "KBMX", "KGSP", "KJAX"] },
];

function resolveStationsForTile(stations: Station[], bounds: Bounds, maxRangeKm: number, maxStations: number): { stationId: string; pinned: boolean }[] {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLon = (bounds.minLon + bounds.maxLon) / 2;

  const applicablePins = STATION_PINS.filter((pin) => haversineKm(centerLat, centerLon, pin.anchorLat, pin.anchorLon) <= pin.radiusKm);
  const pinnedIds = new Set(applicablePins.flatMap((pin) => pin.mustInclude));

  const ranked = stations
    .map((s) => ({ station: s, distanceKm: distanceToBoundsKm(s.latitude, s.longitude, bounds), centerDistanceKm: haversineKm(s.latitude, s.longitude, centerLat, centerLon) }))
    .filter((s) => s.distanceKm <= maxRangeKm)
    .sort((a, b) => a.centerDistanceKm - b.centerDistanceKm);

  const result: { stationId: string; pinned: boolean }[] = [];
  // Pinned stations first, always included even if they're not the closest -- this is the whole
  // point. A pin for a station genuinely out of MAX_RANGE_KM would still get force-added here
  // (deliberate: if Andrew pins it, he's asserting it's actually relevant, not asking the geometry
  // to double-check him) -- worth knowing as a real design choice, not an oversight.
  for (const id of pinnedIds) {
    if (!result.some((r) => r.stationId === id)) result.push({ stationId: id, pinned: true });
  }
  // Fill remaining slots with the closest un-pinned candidates.
  for (const candidate of ranked) {
    if (result.length >= maxStations) break;
    if (pinnedIds.has(candidate.station.id)) continue;
    result.push({ stationId: candidate.station.id, pinned: false });
  }
  return result;
}

async function main() {
  const stations = await fetchStations();

  console.log("=== Atlanta, without pins (pure geometric closest-5) ===");
  const z = NATIVE_ZOOM;
  const lat = 33.749, lon = -84.388;
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z));
  const bounds = tileBounds(z, x, y);

  const withoutPinsSaved = STATION_PINS.splice(0, STATION_PINS.length);
  const withoutPins = resolveStationsForTile(stations, bounds, MAX_RANGE_KM, MAX_STATIONS_PER_TILE);
  console.log(`  ${withoutPins.map((r) => r.stationId).join(", ")}`);
  STATION_PINS.push(...withoutPinsSaved);

  console.log("\n=== Atlanta, WITH the real KFFC pin (KGSP + KJAX forced in) ===");
  const withPins = resolveStationsForTile(stations, bounds, MAX_RANGE_KM, MAX_STATIONS_PER_TILE);
  for (const r of withPins) console.log(`  ${r.stationId}${r.pinned ? "  <- pinned (forced)" : ""}`);

  console.log("\n=== A location with no pin rule nearby (Minneapolis) still resolves automatically ===");
  const mspLat = 44.98, mspLon = -93.27;
  const mspX = Math.floor(((mspLon + 180) / 360) * Math.pow(2, z));
  const mspLatRad = (mspLat * Math.PI) / 180;
  const mspY = Math.floor(((1 - Math.log(Math.tan(mspLatRad) + 1 / Math.cos(mspLatRad)) / Math.PI) / 2) * Math.pow(2, z));
  const mspBounds = tileBounds(z, mspX, mspY);
  const mspResolved = resolveStationsForTile(stations, mspBounds, MAX_RANGE_KM, MAX_STATIONS_PER_TILE);
  console.log(`  ${mspResolved.map((r) => r.stationId).join(", ")} (no pins applied -- none defined near here)`);
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
