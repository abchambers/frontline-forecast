import type { DecodedElevation, DecodedRadial } from "./level2";
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

// Inverse of destinationPoint: given a real lat/lon, the bearing/ground-range
// from the site that would produce it. Same flat-earth-ish approximation
// tier as destinationPoint (spherical bearing/great-circle distance, no
// beam curvature/refraction) — kept symmetric with it deliberately.
function inverseDestinationPoint(site: RadarSite, lat: number, lon: number): { bearingDeg: number; groundRangeKm: number } {
  const lat1 = (site.latitude * Math.PI) / 180;
  const lon1 = (site.longitude * Math.PI) / 180;
  const lat2 = (lat * Math.PI) / 180;
  const lon2 = (lon * Math.PI) / 180;
  const dLon = lon2 - lon1;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearingDeg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

  const dLat = lat2 - lat1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const groundRangeKm = 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));

  return { bearingDeg, groundRangeKm };
}

// Radials sorted by azimuth, for binary-search nearest-radial lookup below.
type ElevationIndex = { sortedAzimuths: number[]; sortedRadials: DecodedRadial[] };

function buildElevationIndex(elevation: DecodedElevation): ElevationIndex {
  const sorted = [...elevation.radials].sort((a, b) => a.azimuthDeg - b.azimuthDeg);
  return { sortedAzimuths: sorted.map((r) => r.azimuthDeg), sortedRadials: sorted };
}

// Real WSR-88D radials land ~0.5deg apart. A gap much wider than that means
// genuinely missing coverage (dropped radials, VCP transition) — reject
// rather than extrapolate a value from a radial that far away.
const MAX_AZIMUTH_GAP_DEG = 1.0;

function nearestRadial(index: ElevationIndex, bearingDeg: number): DecodedRadial | null {
  const { sortedAzimuths, sortedRadials } = index;
  const n = sortedAzimuths.length;
  if (n === 0) return null;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAzimuths[mid] < bearingDeg) lo = mid + 1;
    else hi = mid;
  }
  let best: DecodedRadial | null = null;
  let bestDelta = Infinity;
  for (const idx of [lo % n, (lo - 1 + n) % n]) {
    const delta = Math.min(Math.abs(sortedAzimuths[idx] - bearingDeg), 360 - Math.abs(sortedAzimuths[idx] - bearingDeg));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = sortedRadials[idx];
    }
  }
  return bestDelta <= MAX_AZIMUTH_GAP_DEG ? best : null;
}

function boundsForSite(site: RadarSite, maxRangeKm: number): MrmsBounds {
  const cosLat = Math.cos((site.latitude * Math.PI) / 180);
  const latSpanDeg = maxRangeKm / 111;
  const lonSpanDeg = maxRangeKm / (111 * cosLat);
  return {
    minLatitude: site.latitude - latSpanDeg,
    maxLatitude: site.latitude + latSpanDeg,
    minLongitude: site.longitude - lonSpanDeg,
    maxLongitude: site.longitude + lonSpanDeg,
  };
}

// Samples every OUTPUT grid cell within range by looking backward to its
// nearest radial+gate, rather than scattering each polar sample forward into
// whichever cell it happens to land in. This is the fix for a real, confirmed
// artifact: radials are ~0.5deg apart, so the arc distance between adjacent
// radials grows with range — past ~120km at this app's 0.01deg grid step, that
// arc gap exceeds the grid cell size, so the old forward-scatter approach left
// literal empty stripes between radials (visible live as parallel lines
// slicing through real storm cells, worse the farther from the site — matches
// exactly where the math predicts it). Gather-mapping guarantees every cell
// in range gets a value (or a deliberate null from a real coverage gap), the
// same approach real radar display software uses. Side benefit: reflectivity,
// velocity, and correlation-coefficient grids for the same request now all
// visit the identical candidate cell set, so they line up cell-for-cell by
// construction rather than by coincidence of independently-scattered points.
function sampleElevationGrid(elevation: DecodedElevation, site: RadarSite, stepDeg: number, maxRangeKm: number): Map<string, number | null> {
  const index = buildElevationIndex(elevation);
  const elevationRad = (elevation.elevationDeg * Math.PI) / 180;
  const cosLat = Math.cos((site.latitude * Math.PI) / 180);
  const latSpanDeg = maxRangeKm / 111;
  const lonSpanDeg = maxRangeKm / (111 * cosLat);

  const minRow = Math.round((site.latitude - latSpanDeg) / stepDeg);
  const maxRow = Math.round((site.latitude + latSpanDeg) / stepDeg);
  const minCol = Math.round((site.longitude - lonSpanDeg) / stepDeg);
  const maxCol = Math.round((site.longitude + lonSpanDeg) / stepDeg);

  const cells = new Map<string, number | null>();
  for (let row = minRow; row <= maxRow; row += 1) {
    const lat = row * stepDeg;
    for (let col = minCol; col <= maxCol; col += 1) {
      const lon = col * stepDeg;
      const { bearingDeg, groundRangeKm } = inverseDestinationPoint(site, lat, lon);
      if (groundRangeKm > maxRangeKm) continue;
      const radial = nearestRadial(index, bearingDeg);
      if (!radial) continue;
      const slantRangeKm = groundRangeKm / Math.cos(elevationRad);
      const gateIndex = Math.round((slantRangeKm - radial.firstGateKm) / radial.gateSizeKm);
      if (gateIndex < 0 || gateIndex >= radial.values.length) continue;
      cells.set(cellKey(lat, lon, stepDeg), radial.values[gateIndex]);
    }
  }
  return cells;
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
// Both constants below were originally tuned against the pre-gather-mapping
// scatter algorithm's naturally sparse, gap-riddled point cloud — see the
// striping-fix commit. Once that was fixed, gather-mapping produces a dense,
// complete grid, and these two heuristics turned out to be far more
// aggressive against REAL signal than intended. Measured live against a real
// KFFC volume before changing anything: the old 15 dBZ floor alone removed
// 50.4% of ALL raw non-null cells (not just weak biological-scatter noise —
// half of everything the radar detected), and the old despeckle pass (no
// strength gate) additionally removed cells with real dBZ up to 34 — solidly
// real moderate rain, not noise, just spatially thin (a storm's leading
// edge, a narrow band). This is very likely why the user saw noticeably
// thinner/less-detailed storms live vs. RadarScope's same-time view, once
// the gridding bug itself was already fixed.
const CORRELATION_COEFFICIENT_THRESHOLD = 0.85;
const MIN_REFLECTIVITY_DBZ = 5; // lowered from 15 — matches RadarScope's own "0-10: very light reflectivity" bottom legend band rather than hard-cutting it.
const DESPECKLE_MIN_NEIGHBORS = 3;
// Cells at or above this always survive despeckling regardless of neighbor
// count — real biological scatter/clutter is essentially always weak
// (confirmed in the earlier noise investigation), so strong signal being
// spatially isolated is virtually always a real, thin storm feature, not
// noise. Despeckling should only ever be adjudicating genuinely marginal
// signal, not throwing away a storm's leading edge.
const DESPECKLE_STRENGTH_GATE_DBZ = 25;

function despeckle(cells: Map<string, number | null>): Map<string, number | null> {
  const despeckled = new Map<string, number | null>();
  for (const [key, value] of cells) {
    if (value === null || value >= DESPECKLE_STRENGTH_GATE_DBZ) {
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
  const bounds = boundsForSite(site, maxRangeKm);
  const rawCells = sampleElevationGrid(elevation, site, stepDeg, maxRangeKm);

  // Baseline: the same proven floor+despeckle pass regardless of whether CC
  // is available — unchanged from before CC existed.
  let cells = new Map<string, number | null>();
  for (const [key, value] of rawCells) {
    cells.set(key, value !== null && value < MIN_REFLECTIVITY_DBZ ? null : value);
  }
  cells = despeckle(cells);

  // CC as an additional AND on top of the baseline — see the block comment
  // above for why this isn't a replacement. Sampled with the same
  // gather-mapping as reflectivity, so it lines up cell-for-cell without
  // reintroducing the range-dependent gap this whole rewrite fixes.
  if (correlationCoefficient) {
    const ccCells = sampleElevationGrid(correlationCoefficient, site, stepDeg, maxRangeKm);
    for (const [key, value] of cells) {
      if (value === null) continue;
      const cc = ccCells.get(key);
      if (cc === undefined || cc === null || cc < CORRELATION_COEFFICIENT_THRESHOLD) cells.set(key, null);
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
  const bounds = boundsForSite(site, maxRangeKm);
  const rawCells = sampleElevationGrid(elevation, site, stepDeg, maxRangeKm);

  const cells = new Map<string, number | null>();
  for (const [key, value] of rawCells) {
    cells.set(key, echoMask.has(key) ? value : null);
  }

  return { grid: cellsToGrid(cells, stepDeg), bounds };
}
