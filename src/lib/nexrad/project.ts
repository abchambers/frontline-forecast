import type { DecodedElevation } from "./level2";
import type { RadarSite } from "./site";
import type { MrmsBounds, MrmsPoint } from "@/lib/mrms-render";

const EARTH_RADIUS_KM = 6371;

// Destination-point formula (spherical), converting a radar-relative
// bearing/ground-range into a lat/lon. Ground range approximates slant range
// via a flat-earth * cos(elevation) correction — the same approximation tier
// as mrms-render.ts's color table. It ignores beam curvature/refraction and
// earth curvature at long range; only matters for the highest tilts/longest
// ranges, not the near-range low-elevation view this app displays.
export function destinationPoint(site: RadarSite, bearingDeg: number, groundRangeKm: number): { lat: number; lon: number } {
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (site.latitude * Math.PI) / 180;
  const lon1 = (site.longitude * Math.PI) / 180;
  const angularDistance = groundRangeKm / EARTH_RADIUS_KM;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: (lat2 * 180) / Math.PI, lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180 };
}

// Projects every gate of every radial to a real lat/lon — an irregular point
// cloud at polar-native resolution (down to 250m near the radar). Kept
// separate from resampling so geometry and output-resolution stay two
// independently testable concerns.
//
// maxRangeKm crops gates beyond a useful local-viewing radius. Super-res
// reflectivity's real max range is ~460km, which at any reasonable grid
// resolution blows past src/lib/mrms-render.ts's 500,000-cell safety cap
// (found live: the full-range grid silently failed to render and fell back
// to GribStream every time — a real bug, not a hypothetical one). Cropping
// to a closer radius also matches the RadarScope-style "local station view"
// this app is aiming for, rather than trying to show the full detection range.
function projectElevation(elevation: DecodedElevation, site: RadarSite, maxRangeKm: number): MrmsPoint[] {
  const points: MrmsPoint[] = [];
  const elevationRad = (elevation.elevationDeg * Math.PI) / 180;

  for (const radial of elevation.radials) {
    for (let gateIndex = 0; gateIndex < radial.values.length; gateIndex += 1) {
      const slantRangeKm = radial.firstGateKm + gateIndex * radial.gateSizeKm;
      const groundRangeKm = slantRangeKm * Math.cos(elevationRad);
      if (groundRangeKm > maxRangeKm) break; // gates are range-ordered, so nothing further out matters either.
      const value = radial.values[gateIndex];
      const { lat, lon } = destinationPoint(site, radial.azimuthDeg, groundRangeKm);
      points.push({ lat, lon, dbz: value });
    }
  }
  return points;
}

// Absolute grid indexing (not relative to a per-call bounding box) so a
// reflectivity grid and a velocity grid from the same request line up
// cell-for-cell even though they come from different elevation tilts with
// different native gate spacing (observed live: 1832 reflectivity gates vs.
// 1192 velocity gates on the same volume) and therefore slightly different
// data extents.
export function cellKey(lat: number, lon: number, stepDeg: number): string {
  return `${Math.round(lat / stepDeg)},${Math.round(lon / stepDeg)}`;
}

// Raw Level II reflectivity has none of MRMS's quality control applied —
// GribStream's feed (and NOAA's MRMS generally) already strips ground
// clutter and biological scatter (insects, birds — especially common at
// dusk) before it ever reaches an app. The noise floor + despeckle pass
// below is a heuristic, not real QC.
//
// Correlation coefficient (RHO), when dual-pol data decodes for this volume,
// is applied as an ADDITIONAL filter on top of the floor+despeckle result,
// not a replacement for it. Real precipitation is highly self-similar pulse
// to pulse (RHO close to 1); non-meteorological targets are not (commonly
// well under 0.7) — that part is real and confirmed (0.98/0.99 alongside
// 0.21/0.29 in the same volume). But tested standalone against real live
// data, gating by RHO alone (even up to 0.97, a very strict threshold) let
// through a persistent radial spoke pattern centered on the radar site that
// the floor+despeckle baseline did NOT show — plausibly real widespread
// light rain/drizzle (which genuinely has very high RHO), or plausibly some
// other radar-geometry artifact; not resolved with confidence either way.
// Given that ambiguity on a feature this core to the app, CC is deliberately
// wired as an AND on top of the proven baseline rather than instead of it —
// it can only remove cells the baseline already let through, never add ones
// the baseline would have excluded, so it's strictly safe regardless of
// which explanation for that spoke pattern turns out to be right.
const CORRELATION_COEFFICIENT_THRESHOLD = 0.85;
const MIN_REFLECTIVITY_DBZ = 15;
const DESPECKLE_MIN_NEIGHBORS = 3;

function despeckle(cells: Map<string, number | null>): Map<string, number | null> {
  const despeckled = new Map<string, number | null>();
  for (const [key, value] of cells) {
    if (value === null) {
      despeckled.set(key, value);
      continue;
    }
    const [row, col] = key.split(",").map(Number);
    let neighbors = 0;
    for (let dRow = -1; dRow <= 1; dRow += 1) {
      for (let dCol = -1; dCol <= 1; dCol += 1) {
        if (dRow === 0 && dCol === 0) continue;
        const neighbor = cells.get(`${row + dRow},${col + dCol}`);
        if (neighbor !== undefined && neighbor !== null) neighbors += 1;
      }
    }
    despeckled.set(key, neighbors >= DESPECKLE_MIN_NEIGHBORS ? value : null);
  }
  return despeckled;
}

export function boundsOf(points: MrmsPoint[]): MrmsBounds {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { minLatitude: minLat, maxLatitude: maxLat, minLongitude: minLon, maxLongitude: maxLon };
}

export function cellsToGrid(cells: Map<string, number | null>, stepDeg: number): MrmsPoint[] {
  const grid: MrmsPoint[] = [];
  for (const [key, dbz] of cells) {
    const [rowIndex, colIndex] = key.split(",").map(Number);
    grid.push({ lat: rowIndex * stepDeg, lon: colIndex * stepDeg, dbz });
  }
  return grid;
}

// Bins reflectivity's irregular polar point cloud into a regular lat/lon
// grid matching the exact shape src/lib/mrms-render.ts already renders, with
// the noise-floor + despeckle pass above applied. Also returns an "echo
// mask" — the set of grid cells with real signal — so velocity (computed
// separately, see computeVelocityGrid) can be gated to only where real
// reflectivity echo exists.
export function computeReflectivityGrid(
  elevation: DecodedElevation,
  site: RadarSite,
  stepDeg: number,
  maxRangeKm: number,
  correlationCoefficient?: DecodedElevation,
): { grid: MrmsPoint[]; bounds: MrmsBounds; echoMask: Set<string>; qualityControl: "noise-floor+correlation-coefficient" | "noise-floor" } {
  const points = projectElevation(elevation, site, maxRangeKm);
  const bounds = boundsOf(points);

  // Baseline: the same proven floor+despeckle pass regardless of whether CC
  // is available — unchanged from before CC existed.
  let cells = new Map<string, number | null>();
  for (const p of points) {
    const key = cellKey(p.lat, p.lon, stepDeg);
    const value = p.dbz !== null && p.dbz < MIN_REFLECTIVITY_DBZ ? null : p.dbz;
    cells.set(key, value);
  }
  cells = despeckle(cells);

  // CC as an additional AND on top of the baseline — see the block comment
  // above for why this isn't a replacement.
  if (correlationCoefficient) {
    const confidenceMask = new Set<string>();
    for (const p of projectElevation(correlationCoefficient, site, maxRangeKm)) {
      if (p.dbz !== null && p.dbz >= CORRELATION_COEFFICIENT_THRESHOLD) confidenceMask.add(cellKey(p.lat, p.lon, stepDeg));
    }
    for (const [key, value] of cells) {
      if (value !== null && !confidenceMask.has(key)) cells.set(key, null);
    }
  }

  const echoMask = new Set<string>();
  for (const [key, value] of cells) if (value !== null) echoMask.add(key);

  return {
    grid: cellsToGrid(cells, stepDeg),
    bounds,
    echoMask,
    qualityControl: correlationCoefficient ? "noise-floor+correlation-coefficient" : "noise-floor",
  };
}

// Bins velocity's irregular polar point cloud into a regular lat/lon grid,
// keeping a cell only where the co-located reflectivity echo mask says
// there's real signal underneath it. This is the actual fix for velocity
// noise, not despeckling velocity itself: you can't get a meaningful
// Doppler shift from a target that barely exists, so weak/clutter gates
// produce essentially random velocity, not just weak velocity — nulling by
// value doesn't help, gating by co-located reflectivity does. Deliberately
// NOT despeckled on its own axis, unlike reflectivity — real severe-weather
// signatures (tornadic rotation, microburst divergence) are often small,
// tightly localized couplets, exactly what a despeckle pass would erase.
export function computeVelocityGrid(
  elevation: DecodedElevation,
  site: RadarSite,
  stepDeg: number,
  maxRangeKm: number,
  echoMask: Set<string>,
): { grid: MrmsPoint[]; bounds: MrmsBounds } {
  const points = projectElevation(elevation, site, maxRangeKm);
  const bounds = boundsOf(points);

  const cells = new Map<string, number | null>();
  for (const p of points) {
    const key = cellKey(p.lat, p.lon, stepDeg);
    cells.set(key, echoMask.has(key) ? p.dbz : null);
  }

  return { grid: cellsToGrid(cells, stepDeg), bounds };
}
