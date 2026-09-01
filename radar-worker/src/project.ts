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

const KM_PER_DEG_LAT = (EARTH_RADIUS_KM * Math.PI) / 180;

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

function angularDelta(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
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

function gridBoxForSite(site: RadarSite, stepDeg: number, maxRangeKm: number) {
  const cosLat = Math.cos((site.latitude * Math.PI) / 180);
  const latSpanDeg = maxRangeKm / 111;
  const lonSpanDeg = maxRangeKm / (111 * cosLat);
  const minRow = Math.round((site.latitude - latSpanDeg) / stepDeg);
  const maxRow = Math.round((site.latitude + latSpanDeg) / stepDeg);
  const minCol = Math.round((site.longitude - lonSpanDeg) / stepDeg);
  const maxCol = Math.round((site.longitude + lonSpanDeg) / stepDeg);
  return { minRow, minCol, width: maxCol - minCol + 1, height: maxRow - minRow + 1 };
}

// --- Flat-array grid representation ---------------------------------------------------------
// Replaces the original Map<string,"row,col">-keyed representation for the hot path (reflectivity,
// velocity, mosaic merge) — kept as a real, measured decision, not a style preference. A live
// benchmark on this app's actual real-world cell counts (~1.8M at today's 0.006deg/460km) found a
// Map<string, number|null> costs ~124MB of real RSS for that many entries, against ~14MB for the
// equivalent Float32Array — a ~9x difference for ONE such structure, and a single request builds
// several of them in sequence (raw sample, post-floor, CC, post-cluster-removal, plus a mosaic's
// shared cross-station merge target). That overhead, not the underlying math, is what made 460km's
// real range increase already consume most of the fly.toml performance-1x/4GB upgrade's headroom,
// and what made anything finer than 0.006deg reliably OOM-crash a real 5-station mosaic even on
// that upgraded tier (confirmed live, calibrated against the worker's own --max-old-space-size).
//
// A cell's position is now a flat index into a fixed-size Float32Array sized to a known bounding
// box, rather than a string key built and hashed on every access — measured ~10-16x faster for the
// same sampling work as a direct side effect (no more per-cell string allocation), independent of
// the memory win. NaN is the single "no value" sentinel, replacing the old undefined-vs-null
// distinction (an absent Map entry vs. an explicit null one) — verified against real live data
// (radar-worker's own diff harness, see project history) that nothing downstream ever actually
// depended on that distinction; every place that read it treated both cases identically.
//
// level3.ts's still-unshipped storm-relative velocity prototype keeps using the original
// Map<string,...>-based cellKey/cellsToGrid below unchanged — it doesn't carry this same memory
// pressure (single station, no mosaic merge) and isn't on the hot path, so there's no reason to
// touch it converting to flat arrays too.
export type FlatGrid = { minRow: number; minCol: number; width: number; height: number; values: Float32Array };

function makeFlatGrid(minRow: number, minCol: number, width: number, height: number): FlatGrid {
  return { minRow, minCol, width, height, values: new Float32Array(width * height).fill(NaN) };
}

// Precomputed per-cell geometry (bearing/ground-range from the site), shared across reflectivity,
// CC, and velocity for one request — mirrors the original CandidateCell array's purpose, just as
// two parallel flat arrays instead of an array of {key, lat, lon, bearingDeg, groundRangeKm}
// objects (dropping the per-cell string key entirely; a cell's absolute lat/lon is always
// recoverable from its flat index + minRow/minCol/stepDeg, so nothing was lost). NaN bearing marks
// a cell outside maxRangeKm, exactly replacing the old candidate list's implicit exclusion (a cell
// simply wasn't in the array).
export type CandidateGrid = { minRow: number; minCol: number; width: number; height: number; bearingDeg: Float32Array; groundRangeKm: Float32Array };

// Enumerates every OUTPUT grid cell within range with its geometry resolved — see the original
// version's own comment (still accurate) for why gather-mapping (looking backward from each output
// cell to the radial/gate it corresponds to) is the fix for the striping artifact this replaced.
export function buildCandidateCells(site: RadarSite, stepDeg: number, maxRangeKm: number): CandidateGrid {
  const cosLat = Math.cos((site.latitude * Math.PI) / 180);
  const { minRow, minCol, width, height } = gridBoxForSite(site, stepDeg, maxRangeKm);
  const bearingDeg = new Float32Array(width * height).fill(NaN);
  const groundRangeKm = new Float32Array(width * height).fill(NaN);

  for (let row = minRow; row < minRow + height; row++) {
    const lat = row * stepDeg;
    const dy = (lat - site.latitude) * KM_PER_DEG_LAT;
    for (let col = minCol; col < minCol + width; col++) {
      const lon = col * stepDeg;
      const dx = (lon - site.longitude) * KM_PER_DEG_LAT * cosLat;
      const range = Math.sqrt(dx * dx + dy * dy);
      if (range > maxRangeKm) continue;
      const idx = (row - minRow) * width + (col - minCol);
      groundRangeKm[idx] = range;
      bearingDeg[idx] = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    }
  }
  return { minRow, minCol, width, height, bearingDeg, groundRangeKm };
}

// Nearest-neighbor sample (no interpolation) — used for velocity, same reasoning as the original:
// linearly blending raw Doppler velocity across gates can wash out real, small, adjacent-gate
// rotation/divergence couplets, exactly the severe-weather signal this app cares about.
function sampleAtCandidateCells(elevation: DecodedElevation, grid: CandidateGrid): FlatGrid {
  const { sortedAzimuths, sortedRadials } = buildElevationIndex(elevation);
  const out = makeFlatGrid(grid.minRow, grid.minCol, grid.width, grid.height);
  const n = sortedAzimuths.length;
  if (n === 0) return out;
  const cosElevation = Math.cos((elevation.elevationDeg * Math.PI) / 180);

  for (let i = 0; i < grid.bearingDeg.length; i++) {
    const bearingDeg = grid.bearingDeg[i];
    if (Number.isNaN(bearingDeg)) continue;
    const radial = nearestRadial({ sortedAzimuths, sortedRadials }, bearingDeg);
    if (!radial) continue;
    const slantRangeKm = grid.groundRangeKm[i] / cosElevation;
    const gateIndex = Math.round((slantRangeKm - radial.firstGateKm) / radial.gateSizeKm);
    if (gateIndex < 0 || gateIndex >= radial.values.length) continue;
    const v = radial.values[gateIndex];
    if (v !== null) out.values[i] = v;
  }
  return out;
}

// Bilinear-style interpolation across the two bracketing radials (azimuth) and two bracketing
// gates (range) — used for CONTINUOUS fields (reflectivity, correlation coefficient) only. See the
// original version's block comment (unchanged reasoning, just reproduced in full there historically)
// for why this exists: at this app's grid step, WSR-88D's ~0.5deg native radial spacing means the
// arc gap between adjacent radials exceeds a cell's width past a modest range, so nearest-neighbor
// gather-mapping stamps the same source sample across several adjacent cells — confirmed live
// against RadarScope/IEM as a real texture gap, fixed by this weighted blend. Degrades gracefully
// at coverage edges: if only one of the (up to) four corners has real data, the weighted average
// reduces to exactly that corner's raw value; only a cell with ZERO available corners stays NaN.
function sampleAtCandidateCellsInterpolated(elevation: DecodedElevation, grid: CandidateGrid): FlatGrid {
  const { sortedAzimuths, sortedRadials } = buildElevationIndex(elevation);
  const out = makeFlatGrid(grid.minRow, grid.minCol, grid.width, grid.height);
  const n = sortedAzimuths.length;
  if (n === 0) return out;
  const cosElevation = Math.cos((elevation.elevationDeg * Math.PI) / 180);

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

  for (let i = 0; i < grid.bearingDeg.length; i++) {
    const bearingDeg = grid.bearingDeg[i];
    if (Number.isNaN(bearingDeg)) continue;

    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sortedAzimuths[mid] < bearingDeg) lo = mid + 1;
      else hi = mid;
    }
    const idxA = lo % n;
    const idxB = (lo - 1 + n) % n;
    const deltaA = angularDelta(sortedAzimuths[idxA], bearingDeg);
    const deltaB = idxB === idxA ? Infinity : angularDelta(sortedAzimuths[idxB], bearingDeg);
    const aOk = deltaA <= MAX_AZIMUTH_GAP_DEG;
    const bOk = deltaB <= MAX_AZIMUTH_GAP_DEG;
    if (!aOk && !bOk) continue;

    const totalGap = aOk && bOk ? deltaA + deltaB || 1e-9 : 1;
    const weightA = aOk ? (bOk ? deltaB / totalGap : 1) : 0;
    const weightB = bOk ? (aOk ? deltaA / totalGap : 1) : 0;

    const slantRangeKm = grid.groundRangeKm[i] / cosElevation;
    const acc = { weightSum: 0, valueSum: 0 };
    if (aOk) accumulate(sortedRadials[idxA], slantRangeKm, weightA, acc);
    if (bOk) accumulate(sortedRadials[idxB], slantRangeKm, weightB, acc);

    if (acc.weightSum > 0) out.values[i] = acc.valueSum / acc.weightSum;
  }
  return out;
}

// --- Legacy Map-based helpers, kept for level3.ts's still-unshipped storm-relative velocity
// prototype (src/level3.ts) — single-station, no mosaic merge, never on the hot path, so there's no
// memory-pressure reason to convert it too. Unchanged from before this refactor.
export function cellKey(lat: number, lon: number, stepDeg: number): string {
  return `${Math.round(lat / stepDeg)},${Math.round(lon / stepDeg)}`;
}

export function cellsToGrid(cells: Map<string, number | null>, stepDeg: number): MrmsPoint[] {
  const grid: MrmsPoint[] = [];
  for (const [key, dbz] of cells) {
    const [rowIndex, colIndex] = key.split(",").map(Number);
    grid.push({ lat: rowIndex * stepDeg, lon: colIndex * stepDeg, dbz });
  }
  return grid;
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

function flatGridToPoints(grid: FlatGrid, stepDeg: number): MrmsPoint[] {
  const points: MrmsPoint[] = [];
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      const v = grid.values[row * grid.width + col];
      if (Number.isNaN(v)) continue;
      points.push({ lat: (grid.minRow + row) * stepDeg, lon: (grid.minCol + col) * stepDeg, dbz: v });
    }
  }
  return points;
}

// --- Quality-control passes (floor, despeckle, CC gate, small-cluster removal) --------------
// Same tuned constants and same ordering as the original — this refactor changes HOW cells are
// stored and indexed, never the thresholds or the sequence they're applied in, which is where all
// of this app's hard-won, measured-against-real-data tuning actually lives (see git history for the
// full incident-by-incident writeups; reproduced in brief below since the numbers still apply).
const CORRELATION_COEFFICIENT_THRESHOLD = 0.85;
const MIN_REFLECTIVITY_DBZ = 5; // matches RadarScope's own "0-10: very light reflectivity" bottom legend band.
const DESPECKLE_MIN_NEIGHBORS = 3;
// Cells at or above this always survive despeckling regardless of neighbor count — real biological
// scatter/clutter is essentially always weak, so strong signal being spatially isolated is almost
// always a real, thin storm feature, not noise.
const DESPECKLE_STRENGTH_GATE_DBZ = 25;
const MIN_CLUSTER_SIZE = 6;

function applyFloor(grid: FlatGrid): void {
  const { values } = grid;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isNaN(values[i]) && values[i] < MIN_REFLECTIVITY_DBZ) values[i] = NaN;
  }
}

// Neighbor-counting reads the PRE-despeckle snapshot, same as the original Map version reading the
// still-unmodified `cells` map while building a separate `despeckled` one — a cell's own
// survival must never be decided using an already-despeckled neighbor from earlier in the same pass.
function despeckle(grid: FlatGrid): void {
  const { width, height, values } = grid;
  const original = values.slice();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      const value = original[idx];
      if (Number.isNaN(value) || value >= DESPECKLE_STRENGTH_GATE_DBZ) continue;
      let neighbors = 0;
      for (let dRow = -1; dRow <= 1; dRow++) {
        const nRow = row + dRow;
        if (nRow < 0 || nRow >= height) continue;
        for (let dCol = -1; dCol <= 1; dCol++) {
          if (dRow === 0 && dCol === 0) continue;
          const nCol = col + dCol;
          if (nCol < 0 || nCol >= width) continue;
          if (!Number.isNaN(original[nRow * width + nCol])) neighbors++;
        }
      }
      if (neighbors < DESPECKLE_MIN_NEIGHBORS) values[idx] = NaN;
    }
  }
}

// CC as an ADDITIONAL AND on top of the floor+despeckle baseline, never a replacement — see the
// original version's extensive block comment (git history) for the real, still-unresolved ambiguity
// this reasoning is based on (a persistent radial spoke pattern that survives RHO gating alone).
// `ccGrid` is always the SAME dimensions as `grid` by construction (both built from the same site,
// stepDeg, maxRangeKm via the same CandidateGrid).
function applyCorrelationCoefficientGate(grid: FlatGrid, ccGrid: FlatGrid): void {
  const { values } = grid;
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) continue;
    const cc = ccGrid.values[i];
    if (Number.isNaN(cc) || cc < CORRELATION_COEFFICIENT_THRESHOLD) values[i] = NaN;
  }
}

// Runs on the FINAL survivor set (after CC, not just after despeckle) — removing small connected
// components of whatever actually survived every earlier filter, regardless of which one is
// responsible for a neighbor's absence. See the original version's extensive comment for the real
// measured distribution (2180 blobs on a real live volume; 82.8% were noise-sized) that MIN_CLUSTER_SIZE
// was chosen directly from.
function removeSmallClusters(grid: FlatGrid): void {
  const { width, height, values } = grid;
  const visited = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  for (let start = 0; start < values.length; start++) {
    const v = values[start];
    if (Number.isNaN(v) || v >= DESPECKLE_STRENGTH_GATE_DBZ || visited[start]) continue;
    let stackLen = 0;
    let compLen = 0;
    stack[stackLen++] = start;
    visited[start] = 1;
    const componentStart = compLen;
    const component: number[] = [start];
    while (stackLen > 0) {
      const idx = stack[--stackLen];
      const row = Math.floor(idx / width);
      const col = idx % width;
      for (let dRow = -1; dRow <= 1; dRow++) {
        const nRow = row + dRow;
        if (nRow < 0 || nRow >= height) continue;
        for (let dCol = -1; dCol <= 1; dCol++) {
          if (dRow === 0 && dCol === 0) continue;
          const nCol = col + dCol;
          if (nCol < 0 || nCol >= width) continue;
          const nIdx = nRow * width + nCol;
          if (visited[nIdx]) continue;
          const nv = values[nIdx];
          if (Number.isNaN(nv) || nv >= DESPECKLE_STRENGTH_GATE_DBZ) continue;
          visited[nIdx] = 1;
          stack[stackLen++] = nIdx;
          component.push(nIdx);
        }
      }
      compLen++;
    }
    void componentStart;
    if (component.length < MIN_CLUSTER_SIZE) {
      for (const idx of component) values[idx] = NaN;
    }
  }
}

// --- Public grid computation, unchanged signatures/return shapes from the original ------------
export function computeReflectivityGrid(
  elevation: DecodedElevation,
  site: RadarSite,
  stepDeg: number,
  maxRangeKm: number,
  correlationCoefficient?: DecodedElevation,
  candidateCells?: CandidateGrid,
): { grid: MrmsPoint[]; bounds: MrmsBounds; echoMask: FlatGrid; qualityControl: "noise-floor+correlation-coefficient" | "noise-floor" } {
  const bounds = boundsForSite(site, maxRangeKm);
  const cg = candidateCells ?? buildCandidateCells(site, stepDeg, maxRangeKm);
  const grid = sampleAtCandidateCellsInterpolated(elevation, cg);

  applyFloor(grid);
  despeckle(grid);

  if (correlationCoefficient) {
    const ccGrid = sampleAtCandidateCellsInterpolated(correlationCoefficient, cg);
    applyCorrelationCoefficientGate(grid, ccGrid);
  }

  // Runs on the FINAL survivor set (after CC, not just after despeckle) — see removeSmallClusters'
  // own comment for why that ordering matters.
  removeSmallClusters(grid);

  return {
    grid: flatGridToPoints(grid, stepDeg),
    bounds,
    echoMask: grid,
    qualityControl: correlationCoefficient ? "noise-floor+correlation-coefficient" : "noise-floor",
  };
}

// `echoMask` is the FULL post-QC reflectivity FlatGrid (NaN = no real echo there), not a separate
// Set — it's always the same dimensions as this function's own sampling grid by construction (both
// built from the same site/stepDeg/maxRangeKm), so gating is a direct same-index lookup.
export function computeVelocityGrid(
  elevation: DecodedElevation,
  site: RadarSite,
  stepDeg: number,
  maxRangeKm: number,
  echoMask: FlatGrid,
  candidateCells?: CandidateGrid,
): { grid: MrmsPoint[]; bounds: MrmsBounds } {
  const bounds = boundsForSite(site, maxRangeKm);
  const cg = candidateCells ?? buildCandidateCells(site, stepDeg, maxRangeKm);
  const grid = sampleAtCandidateCells(elevation, cg);

  for (let i = 0; i < grid.values.length; i++) {
    if (Number.isNaN(echoMask.values[i])) grid.values[i] = NaN;
  }

  return { grid: flatGridToPoints(grid, stepDeg), bounds };
}

// --- Mosaic merge (flat-array shared accumulator) ---------------------------------------------
// A mosaic combines several stations' independently-computed grids into one composite. The shared
// accumulator used to be a Map<string, number|null> (the single biggest memory cost of a mosaic
// request, since it holds the union of every member station's coverage for the whole request) —
// now a flat array sized to the union bounding box, computed once upfront from the member sites'
// known coordinates before any station is decoded.
export type SharedMergeGrid = FlatGrid;

export function makeSharedMergeGrid(sites: RadarSite[], stepDeg: number, maxRangeKm: number): SharedMergeGrid {
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;
  for (const site of sites) {
    const box = gridBoxForSite(site, stepDeg, maxRangeKm);
    minRow = Math.min(minRow, box.minRow);
    maxRow = Math.max(maxRow, box.minRow + box.height - 1);
    minCol = Math.min(minCol, box.minCol);
    maxCol = Math.max(maxCol, box.minCol + box.width - 1);
  }
  return makeFlatGrid(minRow, minCol, maxCol - minCol + 1, maxRow - minRow + 1);
}

// Merges one station's already-computed grid into the shared accumulator: max dBZ wins, matching
// the original policy exactly — a null/absent value from one station never overwrites a real value
// a DIFFERENT station already found at that cell, only fills a cell nothing has claimed yet. Reads
// row/col back from each point's absolute lat/lon (same `Math.round(value/stepDeg)` convention
// cellKey always used, so this lines up cell-for-cell with every other grid in the same request).
export function mergeReflectivityCells(target: SharedMergeGrid, source: MrmsPoint[], stepDeg: number): void {
  for (const point of source) {
    if (point.dbz === null) continue;
    const row = Math.round(point.lat / stepDeg) - target.minRow;
    const col = Math.round(point.lon / stepDeg) - target.minCol;
    if (row < 0 || row >= target.height || col < 0 || col >= target.width) continue;
    const idx = row * target.width + col;
    if (Number.isNaN(target.values[idx]) || point.dbz > target.values[idx]) target.values[idx] = point.dbz;
  }
}

export function sharedMergeGridToPoints(grid: SharedMergeGrid, stepDeg: number): MrmsPoint[] {
  return flatGridToPoints(grid, stepDeg);
}
