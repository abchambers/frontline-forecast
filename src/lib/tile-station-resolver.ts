// Phase 3 of the tile-based radar architecture, 2026-09-03: resolves which real stations back a
// given map tile GEOMETRICALLY (closest real stations by distance) instead of a hardcoded
// per-location table (mosaic-station-sets.ts) — the tile itself decides its own coverage, so any
// tile anywhere in the country works the same way, not just the locations someone thought to add
// to a table. Prototyped and validated first against real data before this became a real module:
// see radar-worker/scripts/prototype-tile-station-matching.ts (closest-N by distance independently
// reproduces today's hand-curated combos almost exactly — Atlanta 4/5 match, Minneapolis a
// near-exact match to the existing prewarm combo) and prototype-station-pins.ts (the manual
// override mechanism below).
import { getRadarStations } from "./nexrad-stations";
import { tileBounds, distanceToBoundsKm, haversineKm } from "./tile-geometry";

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
type StationPin = { anchorStationId: string; anchorLat: number; anchorLon: number; radiusKm: number; mustInclude: string[] };
const STATION_PINS: StationPin[] = [
  { anchorStationId: "KFFC", anchorLat: 33.3633, anchorLon: -84.5658, radiusKm: 150, mustInclude: ["KFFC", "KMXX", "KBMX", "KGSP"] },
];

export async function resolveStationsForTile(z: number, x: number, y: number): Promise<string[]> {
  const stations = await getRadarStations();
  const bounds = tileBounds(z, x, y);
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
