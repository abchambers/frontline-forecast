// Phase 3 of the tile-based radar architecture, 2026-09-03/04: resolves which real stations back a
// given map tile GEOMETRICALLY (closest real stations by distance) instead of a hardcoded
// per-location table (mosaic-station-sets.ts) — the tile itself decides its own coverage, so any
// tile anywhere in the country works the same way, not just the locations someone thought to add
// to a table. Prototyped and validated first against real data before this became a real module:
// see radar-worker/scripts/prototype-tile-station-matching.ts (closest-N by distance independently
// reproduces today's hand-curated combos almost exactly — Atlanta 4/5 match, Minneapolis a
// near-exact match to the existing prewarm combo) and prototype-station-pins.ts (the manual
// override mechanism below).
//
// REAL INCIDENT, first ship attempt, 2026-09-03: resolving independently PER NATIVE TILE meant a
// single viewport (a real ~4x3 grid of visible tiles, confirmed live) could trigger up to 13
// DISTINCT station combos at once, each needing its own mosaic computation — something Phase 1's
// one-combo-per-location design never had to handle. That saturated the worker's outbound
// connections (fly logs: both S3 and api.weather.gov timing out simultaneously) and caused real,
// visible missing tiles in production. Reverted the live client the same night.
//
// THE FIX: coalesce station selection to a shared REGION (COALESCE_ZOOM, coarser than the native
// tile zoom) instead of resolving per native tile — every native tile inside the same region shares
// one combo, so a typical viewport resolves to 1-2 distinct combos instead of a dozen, matching
// Phase 1's own request pattern. This does NOT reintroduce the earlier "coarse super-region"
// mistake (which over-included 23-38 stations per region by checking "is any station's range
// within reach of ANY point in this big box") — that bug was in the FILTER, not the coarsening
// idea itself. The closest-N-by-center-distance ranking already built for the native-tile version
// is independent of how big the region is; applying it to a coarser region still yields exactly
// MAX_STATIONS_PER_TILE stations, just shared across more tiles. Verified this directly (see
// radar-worker/scripts/simulate-viewport-load.ts) against a real captured viewport tile pattern
// before wiring this back into the live client.
import { getRadarStations } from "./nexrad-stations";
import { tileBounds, distanceToBoundsKm, haversineKm } from "./tile-geometry";

// Zoom 6 tiles are ~625km wide at the equator — real evidence from tonight's own network logs: a
// typical viewport shows roughly a 4x3 grid of native (zoom 8) tiles, which span a similar real
// area. Coarsening to zoom 6 means most/all of one viewport's tiles fall inside the SAME region,
// sharing one combo — only tiles right at a region boundary (much rarer than every native tile
// boundary) risk a different, adjacent combo.
const COALESCE_ZOOM = 6;

// Must match radar-worker/src/radar-constants.ts's own MAX_RANGE_KM — the worker won't have real
// data for a station beyond this range anyway, so there's no point selecting one that far out.
const MAX_RANGE_KM = 460;

// Real evidence from the prototype: every station technically within MAX_RANGE_KM of even a
// single small native tile is still 8-23 stations in dense eastern-CONUS coverage — far past
// server.ts's own MAX_MOSAIC_STATIONS=8 hard cap, and a station 400+km away contributes only
// weak, marginal-quality edge-of-range data anyway (the same low-value-at-range signal this app's
// whole QC pipeline exists to filter). Capping at the closest 5 matches today's typical
// hand-curated combo size and the concurrency load already verified safe live.
const MAX_STATIONS_PER_TILE = 5;

// A small, SPARSE table for regions Andrew wants to hand-tune — not a replacement for the
// automatic default everywhere else (that would just be mosaic-station-sets.ts again, the thing
// this module exists to stop maintaining by hand). Anchored on a real station's own coordinates
// rather than inventing new lat/lon constants to maintain.
//
// Real quirk found while prototyping, worth remembering before adding more of these: pin the FULL
// set of stations you want guaranteed for a region, not just the ones pure geometry got wrong.
// Remaining auto-filled slots still rank by raw distance and can bump a wanted-but-unpinned
// station back out — pinning only "the gaps" isn't reliable.
//
// This one entry is Andrew's own real example, direct from conversation: Atlanta's pure-geometric
// closest-5 dropped KGSP (lost to KHTX by raw distance) — the Alabama stations (KMXX, KBMX) were
// already naturally selected, so only KGSP needed forcing in. KJAX ("maybe Jacksonville," his own
// hedge) is deliberately left out for now — add it to mustInclude below whenever that's a firm yes.
// radiusKm real finding, 2026-09-04, while verifying the coalesced (region-based) redesign: 150km
// was calibrated back when resolution happened per NATIVE tile (~156km wide, so a region's center
// was always close to anything inside it). Now that resolution coalesces to COALESCE_ZOOM=6
// regions (~625km wide), a region's CENTER can be up to ~440km from a station that's still well
// within that same region — confirmed live, the Atlanta-viewport region's center measured 295km
// from KFFC itself. radiusKm needs to scale with whatever region size is actually in use, not stay
// fixed at the old native-tile-era value, or pins silently stop firing for the exact areas they
// were written for.
type StationPin = { anchorStationId: string; anchorLat: number; anchorLon: number; radiusKm: number; mustInclude: string[] };
const STATION_PINS: StationPin[] = [
  { anchorStationId: "KFFC", anchorLat: 33.3633, anchorLon: -84.5658, radiusKm: 350, mustInclude: ["KFFC", "KMXX", "KBMX", "KGSP"] },
];

// Maps a native tile down to the coarser coalescing region it falls inside — every native tile
// with the same regionX/regionY shares one combo. z must be >= COALESCE_ZOOM (always true here,
// COALESCE_ZOOM=6 is well below this app's real native zoom of 8).
function coalesceRegion(z: number, x: number, y: number): { rz: number; rx: number; ry: number } {
  const scale = Math.pow(2, z - COALESCE_ZOOM);
  return { rz: COALESCE_ZOOM, rx: Math.floor(x / scale), ry: Math.floor(y / scale) };
}

export async function resolveStationsForTile(z: number, x: number, y: number): Promise<string[]> {
  const stations = await getRadarStations();
  const { rz, rx, ry } = coalesceRegion(z, x, y);
  const bounds = tileBounds(rz, rx, ry);
  const centerLat = (bounds.minLatitude + bounds.maxLatitude) / 2;
  const centerLon = (bounds.minLongitude + bounds.maxLongitude) / 2;

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
