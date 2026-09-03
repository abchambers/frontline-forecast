// Phase 3 prototype, 2026-09-03: the geometric core of "any tile, anywhere, resolved from whichever
// real stations actually cover it" instead of a hardcoded per-location combo table
// (mosaicStationSets). Standalone and read-only — doesn't touch any live route, same spirit as
// prototype-mercator-tiles.ts before it became a real module.
//
// Design being tested: snap station-coverage decisions to a coarser "super-region" grid
// (SUPER_REGION_ZOOM) rather than deciding per native-zoom tile, so adjacent native tiles inside
// the same super-region always share the same station set -- avoids a Clear-Air-Mode dimming
// seam appearing at arbitrary tile edges (see the real design discussion this followed). Real
// native radar tiles (NATIVE_ZOOM=8) get their station list by finding which super-region they
// fall in, then using that super-region's own (larger) bounds for the station-coverage check --
// not the native tile's own tiny bounds -- so a station just outside one native tile's box but
// well within the super-region still gets included, keeping neighboring tiles consistent.
import { tileXToLon, tileYToLat, NATIVE_ZOOM } from "../src/mercator.js";
import { MAX_RANGE_KM } from "../src/radar-constants.js";

const SUPER_REGION_ZOOM = 6; // ~625km-wide tiles at the equator -- see this file's own printed real widths below.

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
  return {
    minLon: tileXToLon(x, z),
    maxLon: tileXToLon(x + 1, z),
    maxLat: tileYToLat(y, z),
    minLat: tileYToLat(y + 1, z),
  };
}

// Real point-to-axis-aligned-lat/lon-box distance: clamp the station's own coordinates into the
// box (0 if already inside), then haversine from the station to that clamped point. Same
// flat/local-geometry spirit already used elsewhere in this codebase (project.ts's own
// flat-earth approximation) -- accurate enough at these scales, not attempting true geodesic
// polygon intersection.
function distanceToBoundsKm(lat: number, lon: number, bounds: Bounds): number {
  const nearestLat = Math.max(bounds.minLat, Math.min(lat, bounds.maxLat));
  const nearestLon = Math.max(bounds.minLon, Math.min(lon, bounds.maxLon));
  return haversineKm(lat, lon, nearestLat, nearestLon);
}

function stationsCoveringBounds(stations: Station[], bounds: Bounds, maxRangeKm: number): Station[] {
  return stations.filter((s) => distanceToBoundsKm(s.latitude, s.longitude, bounds) <= maxRangeKm);
}

// Real finding while prototyping: every station technically within MAX_RANGE_KM of even a single
// small native tile is still 8-23 stations in practice (dense eastern-CONUS coverage + a generous
// 460km range) -- server.ts's own MAX_MOSAIC_STATIONS=8 would flat-out REJECT most of these
// requests, and a station 400+km away contributes weak, marginal-quality edge-of-range data
// anyway (the same low-value-at-range signal this session's whole QC pipeline exists to filter).
// Rank by real distance to the tile's own center and keep the closest MAX_STATIONS_PER_TILE --
// matches today's typical hand-curated combo size (KFFC's is 5) and the concurrency load already
// verified safe live tonight, comfortably under the hard server-side cap.
const MAX_STATIONS_PER_TILE = 5;

function closestStationsCoveringBounds(stations: Station[], bounds: Bounds, maxRangeKm: number, maxStations: number): Station[] {
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const centerLon = (bounds.minLon + bounds.maxLon) / 2;
  return stations
    .map((s) => ({ station: s, distanceKm: distanceToBoundsKm(s.latitude, s.longitude, bounds), centerDistanceKm: haversineKm(s.latitude, s.longitude, centerLat, centerLon) }))
    .filter((s) => s.distanceKm <= maxRangeKm)
    .sort((a, b) => a.centerDistanceKm - b.centerDistanceKm)
    .slice(0, maxStations)
    .map((s) => s.station);
}

function superRegionFor(z: number, x: number, y: number): { sz: number; sx: number; sy: number } {
  const scale = Math.pow(2, z - SUPER_REGION_ZOOM);
  return { sz: SUPER_REGION_ZOOM, sx: Math.floor(x / scale), sy: Math.floor(y / scale) };
}

async function main() {
  console.log(`Fetching real station list...`);
  const stations = await fetchStations();
  console.log(`Got ${stations.length} real WSR-88D stations.\n`);

  const superBounds = tileBounds(SUPER_REGION_ZOOM, 0, 0);
  const widthKm = haversineKm(0, superBounds.minLon, 0, superBounds.maxLon);
  console.log(`Super-region zoom ${SUPER_REGION_ZOOM}: ~${widthKm.toFixed(0)}km wide at the equator (narrower at higher latitudes).\n`);

  // Real test cases: a known-busy area (Atlanta, should roughly match/improve on the existing
  // hardcoded KFFC combo), a coastal area (asymmetric coverage, half the range circle is ocean),
  // a genuinely sparse-coverage area (real known NEXRAD gap), and two ADJACENT super-regions to
  // directly inspect how much their station sets actually differ at a real boundary.
  const testPoints: { label: string; lat: number; lon: number }[] = [
    { label: "Atlanta, GA (busy coverage, compare to today's hardcoded KFFC combo)", lat: 33.749, lon: -84.388 },
    { label: "Charleston, SC (coastal, asymmetric coverage)", lat: 32.7765, lon: -79.9311 },
    { label: "Great Basin, NV (known sparse-coverage gap)", lat: 40.0, lon: -116.5 },
    { label: "Minneapolis, MN (KMPX area, tested earlier tonight)", lat: 44.98, lon: -93.27 },
  ];

  for (const point of testPoints) {
    const z = NATIVE_ZOOM;
    const x = Math.floor(((point.lon + 180) / 360) * Math.pow(2, z));
    const latRad = (point.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z));

    const { sz, sx, sy } = superRegionFor(z, x, y);
    const superRegionBounds = tileBounds(sz, sx, sy);
    const superRegionCovering = stationsCoveringBounds(stations, superRegionBounds, MAX_RANGE_KM);

    const nativeBounds = tileBounds(z, x, y);
    const nativeCovering = stationsCoveringBounds(stations, nativeBounds, MAX_RANGE_KM);
    const closestCapped = closestStationsCoveringBounds(stations, nativeBounds, MAX_RANGE_KM, MAX_STATIONS_PER_TILE);

    console.log(`=== ${point.label} ===`);
    console.log(`  native tile z${z}/${x}/${y}, bounds: lat ${nativeBounds.minLat.toFixed(2)}..${nativeBounds.maxLat.toFixed(2)}, lon ${nativeBounds.minLon.toFixed(2)}..${nativeBounds.maxLon.toFixed(2)}`);
    console.log(`  ALL in-range (${nativeCovering.length}): ${nativeCovering.map((s) => s.id).join(", ") || "NONE"}`);
    console.log(`  CLOSEST ${MAX_STATIONS_PER_TILE}, capped (real design): ${closestCapped.map((s) => s.id).join(", ") || "NONE"}`);
    console.log(`  SUPER-REGION (z${sz}, uncapped, for reference) covering (${superRegionCovering.length}): ${superRegionCovering.map((s) => s.id).join(", ") || "NONE"}`);
    console.log();
  }

  // Adjacent NATIVE tile seam check (the real design now, no coarsening): how different is the
  // capped closest-5 station set between directly neighboring native tiles? This is the real seam
  // risk -- if it changes on every single tile boundary, Clear-Air-Mode dimming inconsistency
  // would be visually constant, not rare.
  console.log(`=== Adjacent NATIVE tile seam check, closest-${MAX_STATIONS_PER_TILE}-capped (near the Atlanta test point) ===`);
  const atlantaZ = NATIVE_ZOOM;
  const atlantaX = Math.floor(((-84.388 + 180) / 360) * Math.pow(2, atlantaZ));
  const atlantaLatRad = (33.749 * Math.PI) / 180;
  const atlantaY = Math.floor(((1 - Math.log(Math.tan(atlantaLatRad) + 1 / Math.cos(atlantaLatRad)) / Math.PI) / 2) * Math.pow(2, atlantaZ));
  for (const [dx, dy, label] of [[0, 0, "center"], [1, 0, "east neighbor"], [-1, 0, "west neighbor"], [0, 1, "south neighbor"], [0, -1, "north neighbor"]] as const) {
    const bounds = tileBounds(atlantaZ, atlantaX + dx, atlantaY + dy);
    const covering = closestStationsCoveringBounds(stations, bounds, MAX_RANGE_KM, MAX_STATIONS_PER_TILE);
    console.log(`  ${label} (z${atlantaZ}/${atlantaX + dx}/${atlantaY + dy}): ${covering.map((s) => s.id).join(", ")}`);
  }
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
