import type { DecodedElevation, DecodedRadial } from "./level2";
import type { RadarSite } from "./site";
import type { MrmsBounds, MrmsPoint } from "./types";

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
// from the site that would produce it. Flat-earth Cartesian approximation
// (not the full spherical Haversine destinationPoint above uses) —
// deliberately cheaper: this runs once per OUTPUT GRID CELL (hundreds of
// thousands to low millions at this app's near-native resolution), found
// live to be the dominant cost of a cold request (multiple seconds of pure
// CPU time on Fly's shared-cpu-1x). At this app's max 230km range, the
// error versus full spherical math is well under a single grid cell's
// size — same "doesn't matter at this range" judgment already documented
// on destinationPoint, just applied to the much hotter inverse path.
const KM_PER_DEG_LAT = (EARTH_RADIUS_KM * Math.PI) / 180;

function inverseDestinationPointFast(cosSiteLat: number, siteLat: number, siteLon: number, lat: number, lon: number): { bearingDeg: number; groundRangeKm: number } {
  const dy = (lat - siteLat) * KM_PER_DEG_LAT;
  const dx = (lon - siteLon) * KM_PER_DEG_LAT * cosSiteLat;
  const groundRangeKm = Math.sqrt(dx * dx + dy * dy);
  const bearingDeg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
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

// A candidate output cell with its (expensive) geometry already resolved —
// bearing/ground-range from the site is independent of which moment/
// elevation is being sampled, so this is computed ONCE per request and
// reused across reflectivity, correlation coefficient, and velocity (see
// buildCandidateCells below), instead of redone from scratch per moment.
export type CandidateCell = { key: string; lat: number; lon: number; bearingDeg: number; groundRangeKm: number };

// Enumerates every OUTPUT grid cell within range with its geometry resolved,
// looking backward to what bearing/range it corresponds to, rather than
// scattering each polar sample forward into whichever cell it happens to
// land in. This is the fix for a real, confirmed artifact: radials are
// ~0.5deg apart, so the arc distance between adjacent radials grows with
// range — past ~120km at this app's original 0.01deg grid step, that arc
// gap exceeded the grid cell size, leaving literal empty stripes between
// radials. Gather-mapping guarantees every cell in range gets a value (or a
// deliberate null from a real coverage gap).
export function buildCandidateCells(site: RadarSite, stepDeg: number, maxRangeKm: number): CandidateCell[] {
  const cosLat = Math.cos((site.latitude * Math.PI) / 180);
  const latSpanDeg = maxRangeKm / 111;
  const lonSpanDeg = maxRangeKm / (111 * cosLat);

  const minRow = Math.round((site.latitude - latSpanDeg) / stepDeg);
  const maxRow = Math.round((site.latitude + latSpanDeg) / stepDeg);
  const minCol = Math.round((site.longitude - lonSpanDeg) / stepDeg);
  const maxCol = Math.round((site.longitude + lonSpanDeg) / stepDeg);

  const cells: CandidateCell[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    const lat = row * stepDeg;
    for (let col = minCol; col <= maxCol; col += 1) {
      const lon = col * stepDeg;
      const { bearingDeg, groundRangeKm } = inverseDestinationPointFast(cosLat, site.latitude, site.longitude, lat, lon);
      if (groundRangeKm > maxRangeKm) continue;
      cells.push({ key: cellKey(lat, lon, stepDeg), lat, lon, bearingDeg, groundRangeKm });
    }
  }
  return cells;
}

// Resolves one elevation's values at an already-built candidate cell set —
// the cheap part (binary search + a division, no trig) now that geometry is
// shared rather than recomputed per moment.
function sampleAtCandidateCells(elevation: DecodedElevation, candidateCells: CandidateCell[]): Map<string, number | null> {
  const index = buildElevationIndex(elevation);
  const cosElevation = Math.cos((elevation.elevationDeg * Math.PI) / 180);

  const cells = new Map<string, number | null>();
  for (const cell of candidateCells) {
    const radial = nearestRadial(index, cell.bearingDeg);
    if (!radial) continue;
    const slantRangeKm = cell.groundRangeKm / cosElevation;
    const gateIndex = Math.round((slantRangeKm - radial.firstGateKm) / radial.gateSizeKm);
    if (gateIndex < 0 || gateIndex >= radial.values.length) continue;
    cells.set(cell.key, radial.values[gateIndex]);
  }
  return cells;
}

function angularDelta(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

// Bilinear-style interpolation across the two bracketing radials (azimuth)
// and two bracketing gates (range), instead of nearest-neighbor — used for
// CONTINUOUS fields (reflectivity, correlation coefficient) only. Deliberately
// NOT used for velocity (computeVelocityGrid keeps sampleAtCandidateCells) —
// linearly blending raw Doppler velocity across gates can wash out real,
// small, adjacent-gate rotation/divergence couplets, exactly the severe-
// weather signal this app cares about; same reason despeckle is deliberately
// not applied to velocity either.
//
// Real motivation, found via live before/after comparison against RadarScope
// and IEM's N0Q mosaic on the same storm: at this app's 0.006deg (~670m)
// grid step, WSR-88D's ~0.5deg native radial spacing means the arc gap
// between adjacent radials exceeds a grid cell's width past a modest range,
// so nearest-neighbor gather-mapping stamps the SAME source sample across
// several adjacent output cells — a real, confirmed source of the
// "blockier/gappier than RadarScope" look, upstream of and separate from the
// noise-floor/despeckle/CC filtering (measured near-identical on/off against
// the same real distant storms, so not the cause of this specific texture
// gap — see the in-house-nexrad-radar memory entry for that diagnostic).
//
// Degrades gracefully at coverage edges: if only one of the (up to) four
// corners has real data, the weighted average reduces to exactly that
// corner's raw value (dividing by its own partial weight), not a fabricated
// blend — only a cell with ZERO available corners returns null.
function sampleAtCandidateCellsInterpolated(elevation: DecodedElevation, candidateCells: CandidateCell[]): Map<string, number | null> {
  const index = buildElevationIndex(elevation);
  const { sortedAzimuths, sortedRadials } = index;
  const n = sortedAzimuths.length;
  const cosElevation = Math.cos((elevation.elevationDeg * Math.PI) / 180);
  const cells = new Map<string, number | null>();
  if (n === 0) return cells;

  const accumulate = (radial: DecodedRadial, slantRangeKm: number, azimuthWeight: number, acc: { weightSum: number; valueSum: number }) => {
    const values = radial.values;
    const length = values.length;
    const exactGate = (slantRangeKm - radial.firstGateKm) / radial.gateSizeKm;
    const gateFloor = Math.floor(exactGate);
    const gateFrac = exactGate - gateFloor;
    if (gateFloor >= 0 && gateFloor < length) {
      const v = values[gateFloor];
      if (v !== null) {
        const w = azimuthWeight * (1 - gateFrac);
        acc.weightSum += w;
        acc.valueSum += v * w;
      }
    }
    const gateCeil = gateFloor + 1;
    if (gateCeil >= 0 && gateCeil < length) {
      const v = values[gateCeil];
      if (v !== null) {
        const w = azimuthWeight * gateFrac;
        acc.weightSum += w;
        acc.valueSum += v * w;
      }
    }
  };

  for (const cell of candidateCells) {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedAzimuths[mid] < cell.bearingDeg) lo = mid + 1;
      else hi = mid;
    }
    const idxA = lo % n;
    const idxB = (lo - 1 + n) % n;
    const deltaA = angularDelta(sortedAzimuths[idxA], cell.bearingDeg);
    const deltaB = idxB === idxA ? Infinity : angularDelta(sortedAzimuths[idxB], cell.bearingDeg);
    const aOk = deltaA <= MAX_AZIMUTH_GAP_DEG;
    const bOk = deltaB <= MAX_AZIMUTH_GAP_DEG;
    if (!aOk && !bOk) continue;

    // Tent weighting: the closer radial gets more weight, degrading to 1/0
    // when only one side is within range (identical result to nearestRadial
    // in that case).
    const totalGap = aOk && bOk ? deltaA + deltaB || 1e-9 : 1;
    const weightA = aOk ? (bOk ? deltaB / totalGap : 1) : 0;
    const weightB = bOk ? (aOk ? deltaA / totalGap : 1) : 0;

    const slantRangeKm = cell.groundRangeKm / cosElevation;
    const acc = { weightSum: 0, valueSum: 0 };
    if (aOk) accumulate(sortedRadials[idxA], slantRangeKm, weightA, acc);
    if (bOk) accumulate(sortedRadials[idxB], slantRangeKm, weightB, acc);

    if (acc.weightSum > 0) cells.set(cell.key, acc.valueSum / acc.weightSum);
  }
  return cells;
}

// Backward-compatible one-shot form for callers that don't share candidate
// cells across multiple moments in the same request (e.g. the main app's
// Vercel fallback route, which only ever needs one elevation per call).
function sampleElevationGrid(elevation: DecodedElevation, site: RadarSite, stepDeg: number, maxRangeKm: number): Map<string, number | null> {
  return sampleAtCandidateCells(elevation, buildCandidateCells(site, stepDeg, maxRangeKm));
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
  candidateCells?: CandidateCell[],
): { grid: MrmsPoint[]; bounds: MrmsBounds; echoMask: Set<string>; qualityControl: "noise-floor+correlation-coefficient" | "noise-floor" } {
  const bounds = boundsForSite(site, maxRangeKm);
  const cells0 = candidateCells ?? buildCandidateCells(site, stepDeg, maxRangeKm);
  const rawCells = sampleAtCandidateCellsInterpolated(elevation, cells0);

  // Baseline: the same proven floor+despeckle pass regardless of whether CC
  // is available — unchanged from before CC existed.
  let cells = new Map<string, number | null>();
  for (const [key, value] of rawCells) {
    cells.set(key, value !== null && value < MIN_REFLECTIVITY_DBZ ? null : value);
  }
  cells = despeckle(cells);

  // CC as an additional AND on top of the baseline — see the block comment
  // above for why this isn't a replacement. Sampled with the same
  // gather-mapping (and the same interpolation) as reflectivity, so it lines
  // up cell-for-cell without reintroducing the range-dependent gap this
  // whole rewrite fixes.
  if (correlationCoefficient) {
    const ccCells = sampleAtCandidateCellsInterpolated(correlationCoefficient, cells0);
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
  candidateCells?: CandidateCell[],
): { grid: MrmsPoint[]; bounds: MrmsBounds } {
  const bounds = boundsForSite(site, maxRangeKm);
  const rawCells = sampleAtCandidateCells(elevation, candidateCells ?? buildCandidateCells(site, stepDeg, maxRangeKm));

  const cells = new Map<string, number | null>();
  for (const [key, value] of rawCells) {
    cells.set(key, echoMask.has(key) ? value : null);
  }

  return { grid: cellsToGrid(cells, stepDeg), bounds };
}
