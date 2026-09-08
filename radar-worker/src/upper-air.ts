// Real GFS model upper-air maps — 500mb heights + vorticity to start (the classic "troughs and
// ridges" chart), same visual idiom as the radar (contour lines + a colored fill), rendered
// in-house from real public GRIB2 data rather than an externally-hosted static image. This is a
// DIFFERENT product from the existing /api/upper-air (SPC's own twice-daily OBSERVED analysis
// charts, station plots + hand-analysis, not model output) — that stays as-is; this is the new
// "Model" mode alongside it, matching the same "real map, radar's visual style" upgrade the fronts
// tab got.
//
// Technical foundation verified with real live data before writing any of this (2026-09-08):
// @mattnucc/gribberish (a real, actively-maintained Rust/NAPI GRIB2 reader — same native-addon
// pattern as @napi-rs/canvas, already proven safe in this exact Fly deployment) can fetch just the
// needed field from NOAA's public gfs S3 bucket via a `.idx` sidecar + one HTTP Range request,
// never the full ~500MB file. A real prototype (fetch + decode + contour + render, 500mb HGT+ABSV)
// measured ~230MB peak RSS and under 2 real seconds end to end — light enough to run in this same
// worker process rather than needing a separate service.
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { parseGribIndex, GribMessage } from "@mattnucc/gribberish";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchWithTimeout } from "./fetch-with-timeout.js";
import type { MrmsBounds } from "./types.js";

// Real bug found live, 2026-09-08: this worker has never needed to render TEXT on canvas before
// (radar tiles are pure pixel data) and the production container (node:22-slim) has NO fonts
// installed at all — confirmed directly against a live deploy, contour labels silently rendered as
// nothing rather than erroring. `@napi-rs/canvas` needs a real, explicitly-registered font file
// rather than relying on any OS-level font being present. Bundles @fontsource/roboto (a real,
// openly-licensed Google Font package, not a heavy new runtime dependency) and registers its bold
// weight once at module load, under a fixed alias used everywhere this file sets ctx.font.
const FONT_FAMILY = "Upper Air Labels";
GlobalFonts.registerFromPath(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "@fontsource", "roboto", "files", "roboto-latin-700-normal.woff"),
  FONT_FAMILY,
);

const GFS_BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com";

// GFS publishes 4x daily (00/06/12/18Z) but a run isn't actually on S3 until real processing
// finishes — confirmed live, the 06Z run's own file showed a Last-Modified ~3.5 hours after its
// nominal cycle time. Starting the search 5 hours back is a real, measured safety margin, not a
// guess; falling back one cycle further covers the rest.
const GFS_CYCLE_HOURS = [0, 6, 12, 18];
const REAL_PUBLISH_LAG_HOURS = 5;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function candidateRuns(now: Date): { runDate: string; runHour: string }[] {
  const lagged = new Date(now.getTime() - REAL_PUBLISH_LAG_HOURS * 3_600_000);
  const candidates: { runDate: string; runHour: string }[] = [];
  for (let back = 0; back < 3; back++) {
    // Each step back is a real 6-hour jump, so t's OWN UTC calendar date is always the correct
    // real day for the cycle hour floored from it — no separate day-rollback needed (0 is always
    // in GFS_CYCLE_HOURS, so the filter below never comes back empty).
    const t = new Date(lagged.getTime() - back * 6 * 3_600_000);
    const cycleHour = GFS_CYCLE_HOURS.filter((h) => h <= t.getUTCHours()).pop()!;
    const runDate = `${t.getUTCFullYear()}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCDate())}`;
    const runHour = pad2(cycleHour);
    candidates.push({ runDate, runHour });
  }
  return candidates;
}

function gfsUrl(runDate: string, runHour: string): string {
  return `${GFS_BUCKET}/gfs.${runDate}/${runHour}/atmos/gfs.t${runHour}z.pgrb2.0p25.f000`;
}

// Finds the most recent real, actually-published GFS run by checking the real object's existence
// (HEAD on the .idx sidecar, much smaller than probing the full file) — never assumes a cycle is
// ready just because its nominal time has passed.
async function findLatestAvailableRun(): Promise<{ runDate: string; runHour: string; fileSize: number }> {
  const candidates = candidateRuns(new Date());
  for (const candidate of candidates) {
    const url = gfsUrl(candidate.runDate, candidate.runHour);
    const head = await fetchWithTimeout(url, { method: "HEAD" }).catch(() => null);
    if (head?.ok) {
      const fileSize = Number(head.headers.get("content-length"));
      return { ...candidate, fileSize };
    }
  }
  throw new Error("No recent GFS run is available on NOAA's public feed.");
}

async function fetchGfsMessage(runDate: string, runHour: string, fileSize: number, varName: string, level: string): Promise<GribMessage> {
  const url = gfsUrl(runDate, runHour);
  const idxText = await (await fetchWithTimeout(`${url}.idx`)).text();
  const entries = parseGribIndex(idxText, fileSize);
  const entry = entries.find((e) => e.var === varName && e.level === level);
  if (!entry) throw new Error(`GFS field not found: ${varName} @ ${level}`);
  const end = entry.length ? entry.offset + entry.length - 1 : fileSize - 1;
  // GRIB2 range fetches can genuinely take longer than the 10s default under real concurrent load
  // now that they share the same global slot every other outbound call does — matches level2.ts's
  // own 20s allowance for its S3 downloads, the same real reasoning (queued behind other traffic
  // isn't a hang, it just needs more real time to actually transfer once its turn comes).
  const res = await fetchWithTimeout(url, { headers: { Range: `bytes=${entry.offset}-${end}` } }, 20_000);
  const buf = new Uint8Array(await res.arrayBuffer());
  return GribMessage.parseFromBuffer(buf, 0);
}

// --- Web Mercator resampling ------------------------------------------------------------------
// GFS ships a REGULAR equirectangular lat/lon grid; Leaflet's ImageOverlay stretches a rectangular
// image linearly between four corner coordinates without reprojecting its content, so for the
// image to align correctly at every zoom/pan (not just its four corners), its own rows must
// already be spaced in Web Mercator, not raw degrees — same reasoning as this file's sibling
// mercator.ts, applied here via the plain (non-tile-indexed) Web Mercator formula since this
// renders one bounded image, not a tile pyramid.
function latToMercatorY(latDeg: number): number {
  const lat = Math.max(-85.0511, Math.min(85.0511, latDeg));
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}
function mercatorYToLat(y: number): number {
  return (Math.atan(Math.exp(y)) * 2 - Math.PI / 2) * (180 / Math.PI);
}

type SourceGrid = { data: Float64Array | Float32Array | number[]; lat: number[]; lon: number[]; rows: number; cols: number };

// Bilinear sample of the source equirectangular grid at an arbitrary real (lat, lon). `lat`
// descends (north-up, via latlngAdjusted(true, true)); `lon` ascends across [-180, 180).
function sampleBilinear(grid: SourceGrid, lat: number, lon: number): number {
  const { data, lat: latAxis, lon: lonAxis, cols } = grid;
  const latCount = latAxis.length;
  let r = 0;
  while (r < latCount - 2 && latAxis[r + 1] > lat) r++;
  const rowFrac = (latAxis[r] - lat) / (latAxis[r] - latAxis[r + 1] || 1);

  const lonCount = lonAxis.length;
  let c = 0;
  while (c < lonCount - 2 && lonAxis[c + 1] < lon) c++;
  const colFrac = (lon - lonAxis[c]) / (lonAxis[c + 1] - lonAxis[c] || 1);

  const v00 = data[r * cols + c];
  const v01 = data[r * cols + c + 1];
  const v10 = data[(r + 1) * cols + c];
  const v11 = data[(r + 1) * cols + c + 1];
  const top = v00 + (v01 - v00) * colFrac;
  const bottom = v10 + (v11 - v10) * colFrac;
  return top + (bottom - top) * rowFrac;
}

// Earth's own rotation rate, rad/s — needed to convert GFS's ABSV (absolute vorticity) into the
// RELATIVE vorticity every real synoptic chart actually plots (WeatherBell's own product is
// literally labeled "Cyclonic Rel. Vorticity"). Absolute vorticity = relative + planetary
// (f = 2*OMEGA*sin(latitude)), and the planetary term alone already exceeds a sensible "is this
// real weather" color threshold across most of CONUS's latitude range — confirmed directly against
// a real live render before this fix: coloring raw ABSV painted nearly the entire map, not the
// sparse, feature-following bands a real vorticity chart shows.
const EARTH_ANGULAR_VELOCITY = 7.2921e-5;
function coriolisParameter(latDeg: number): number {
  return 2 * EARTH_ANGULAR_VELOCITY * Math.sin((latDeg * Math.PI) / 180);
}

function resampleToMercator(grid: SourceGrid, bounds: MrmsBounds, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  const yTop = latToMercatorY(bounds.maxLatitude);
  const yBottom = latToMercatorY(bounds.minLatitude);
  for (let row = 0; row < height; row++) {
    const y = yTop + ((yBottom - yTop) * row) / (height - 1);
    const lat = mercatorYToLat(y);
    for (let col = 0; col < width; col++) {
      const lon = bounds.minLongitude + ((bounds.maxLongitude - bounds.minLongitude) * col) / (width - 1);
      out[row * width + col] = sampleBilinear(grid, lat, lon);
    }
  }
  return out;
}

// Subtracts each output pixel's own real planetary vorticity (a function of ITS latitude, not a
// single domain-average value) from an already-Mercator-resampled absolute-vorticity grid, turning
// it into the relative vorticity real charts plot. Must run AFTER resampleToMercator (needs the
// same per-row latitude the resampling loop used) — kept as a separate pass rather than folded into
// resampleToMercator itself since that function has no reason to know this is vorticity data.
function absoluteToRelativeVorticity(absoluteVorticity: Float32Array, bounds: MrmsBounds, width: number, height: number): Float32Array {
  const relative = new Float32Array(absoluteVorticity.length);
  const yTop = latToMercatorY(bounds.maxLatitude);
  const yBottom = latToMercatorY(bounds.minLatitude);
  for (let row = 0; row < height; row++) {
    const y = yTop + ((yBottom - yTop) * row) / (height - 1);
    const f = coriolisParameter(mercatorYToLat(y));
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      relative[idx] = absoluteVorticity[idx] - f;
    }
  }
  return relative;
}

// --- Marching squares contours ----------------------------------------------------------------
// Standard case table, one pass per contour level. Runs on the ALREADY-Mercator-resampled grid
// (not the raw GFS grid) so the resulting line segments are directly in output-pixel space and
// come out geometrically correct once drawn — no separate reprojection of the contour geometry
// itself needed.
type Segment = [[number, number], [number, number]];

function marchingSquaresSegments(grid: Float32Array, width: number, height: number, threshold: number): Segment[] {
  const segments: Segment[] = [];
  const at = (r: number, c: number) => grid[r * width + c];
  const interp = (v0: number, v1: number) => (v1 === v0 ? 0.5 : (threshold - v0) / (v1 - v0));

  for (let r = 0; r < height - 1; r++) {
    for (let c = 0; c < width - 1; c++) {
      const tl = at(r, c), tr = at(r, c + 1), bl = at(r + 1, c), br = at(r + 1, c + 1);
      let caseIndex = 0;
      if (tl > threshold) caseIndex |= 8;
      if (tr > threshold) caseIndex |= 4;
      if (br > threshold) caseIndex |= 2;
      if (bl > threshold) caseIndex |= 1;
      if (caseIndex === 0 || caseIndex === 15) continue;

      const top: [number, number] = [c + interp(tl, tr), r];
      const bottom: [number, number] = [c + interp(bl, br), r + 1];
      const left: [number, number] = [c, r + interp(tl, bl)];
      const right: [number, number] = [c + 1, r + interp(tr, br)];
      const pairs: Record<number, Segment[]> = {
        1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]],
        4: [[top, right]], 5: [[top, left], [bottom, right]], 6: [[top, bottom]],
        7: [[top, left]], 8: [[top, left]], 9: [[top, bottom]],
        10: [[top, right], [bottom, left]], 11: [[top, right]], 12: [[left, right]],
        13: [[bottom, right]], 14: [[left, bottom]],
      };
      segments.push(...(pairs[caseIndex] ?? []));
    }
  }
  return segments;
}

// Chains raw, unordered marching-squares segments into continuous polylines (shared endpoints
// merged within a small epsilon) purely so a label can be placed once near a real line's own
// midpoint instead of once per tiny segment — cosmetic, not needed for the contour geometry itself.
function chainSegments(segments: Segment[]): [number, number][][] {
  const EPS = 0.001;
  const key = (p: [number, number]) => `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)}`;
  const remaining = new Set(segments);
  const byEndpoint = new Map<string, Segment[]>();
  for (const seg of segments) {
    for (const p of [seg[0], seg[1]]) {
      const k = key(p);
      if (!byEndpoint.has(k)) byEndpoint.set(k, []);
      byEndpoint.get(k)!.push(seg);
    }
  }
  const chains: [number, number][][] = [];
  for (const seg of segments) {
    if (!remaining.has(seg)) continue;
    remaining.delete(seg);
    const chain: [number, number][] = [seg[0], seg[1]];
    let extended = true;
    while (extended) {
      extended = false;
      const tail = chain[chain.length - 1];
      const candidates = byEndpoint.get(key(tail)) ?? [];
      for (const cand of candidates) {
        if (!remaining.has(cand)) continue;
        const [a, b] = cand;
        const next = key(a) === key(tail) ? b : key(b) === key(tail) ? a : null;
        if (!next) continue;
        chain.push(next);
        remaining.delete(cand);
        extended = true;
        break;
      }
    }
    chains.push(chain);
  }
  return chains;
}

// --- Rendering ----------------------------------------------------------------------------------
// Real ramp anchored to WeatherBell's own visual convention (checked live, 2026-09-08): near-zero
// RELATIVE vorticity is left uncolored, cyclonic (positive) vorticity scales from pale green
// through yellow/orange/red into purple at extreme values, labeled in the same 1e-5 s^-1 units
// charts use. Takes relative vorticity specifically (see absoluteToRelativeVorticity) — coloring
// raw ABSV instead paints nearly the whole domain, since the planetary component alone exceeds
// this threshold across most of CONUS's latitude range (confirmed live before this fix existed).
function vorticityColor(relativeVorticitySiUnits: number): [number, number, number, number] | null {
  const scaled = relativeVorticitySiUnits * 1e5;
  if (scaled < 5) return null;
  if (scaled < 10) return [173, 235, 173, 140];
  if (scaled < 15) return [230, 230, 130, 160];
  if (scaled < 20) return [240, 180, 90, 175];
  if (scaled < 30) return [235, 110, 70, 190];
  if (scaled < 40) return [205, 55, 55, 205];
  return [150, 30, 130, 220];
}

const CONTOUR_INTERVAL_M = 60; // the real standard interval for 500mb height charts

export async function renderUpperAir500mb(widthPx = 900, heightPx: number | null = null): Promise<{ time: string; bounds: MrmsBounds; imageDataUrl: string }> {
  const { runDate, runHour, fileSize } = await findLatestAvailableRun();
  const [hgtMsg, absvMsg] = await Promise.all([
    fetchGfsMessage(runDate, runHour, fileSize, "HGT", "500 mb"),
    fetchGfsMessage(runDate, runHour, fileSize, "ABSV", "500 mb"),
  ]);

  const { latitude, longitude } = hgtMsg.latlngAdjusted(true, true);
  const hgtData = hgtMsg.dataAdjusted(true, true);
  const absvData = absvMsg.dataAdjusted(true, true);
  const { cols } = hgtMsg.gridShape;
  const hgtGrid: SourceGrid = { data: hgtData, lat: latitude, lon: longitude, rows: latitude.length, cols };
  const absvGrid: SourceGrid = { data: absvData, lat: latitude, lon: longitude, rows: latitude.length, cols };

  // CONUS-focused bounds, matching the region every other tab (radar, fronts) defaults to.
  const bounds: MrmsBounds = { minLatitude: 20, maxLatitude: 55, minLongitude: -130, maxLongitude: -60 };
  const height = heightPx ?? Math.round((widthPx * (latToMercatorY(bounds.maxLatitude) - latToMercatorY(bounds.minLatitude))) / (((bounds.maxLongitude - bounds.minLongitude) * Math.PI) / 180));

  const hgtOut = resampleToMercator(hgtGrid, bounds, widthPx, height);
  const absoluteVorticityOut = resampleToMercator(absvGrid, bounds, widthPx, height);
  const absvOut = absoluteToRelativeVorticity(absoluteVorticityOut, bounds, widthPx, height);

  const canvas = createCanvas(widthPx, height);
  const ctx = canvas.getContext("2d");

  // Vorticity fill first, blurred slightly the same way render.ts softens the radar's own weak
  // signal — raw per-pixel model output reads as noisy speckle otherwise (confirmed directly
  // against the real, unblurred prototype render).
  const fillCanvas = createCanvas(widthPx, height);
  const fillCtx = fillCanvas.getContext("2d");
  const imageData = fillCtx.createImageData(widthPx, height);
  for (let i = 0; i < absvOut.length; i++) {
    const color = vorticityColor(absvOut[i]);
    if (!color) continue;
    imageData.data[i * 4] = color[0];
    imageData.data[i * 4 + 1] = color[1];
    imageData.data[i * 4 + 2] = color[2];
    imageData.data[i * 4 + 3] = color[3];
  }
  fillCtx.putImageData(imageData, 0, 0);
  ctx.filter = "blur(1.5px)";
  ctx.drawImage(fillCanvas, 0, 0);
  ctx.filter = "none";

  // Height contour lines, the real standard 60m interval, labeled in decameters (the conventional
  // unit on a real 500mb chart, e.g. "564" for 5640m) at each chained line's own midpoint.
  let hgtMin = Infinity, hgtMax = -Infinity;
  for (const v of hgtOut) { if (v < hgtMin) hgtMin = v; if (v > hgtMax) hgtMax = v; }
  const levels: number[] = [];
  for (let level = Math.ceil(hgtMin / CONTOUR_INTERVAL_M) * CONTOUR_INTERVAL_M; level <= hgtMax; level += CONTOUR_INTERVAL_M) levels.push(level);

  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1.4;
  ctx.font = `bold 13px "${FONT_FAMILY}"`;
  ctx.fillStyle = "#1a1a1a";
  // Real defect found in the first live render, fixed here: closely-spaced contours (a tight
  // height gradient, e.g. near a deep trough) placed their labels close enough to overlap into
  // illegible garbled text. Tracks already-placed label centers and skips a new one that would
  // land within LABEL_MIN_SPACING_PX of an existing one, rather than trying to space contour
  // levels themselves differently (which would need to change the real 60m interval convention).
  const LABEL_MIN_SPACING_PX = 40;
  const placedLabels: [number, number][] = [];
  for (const level of levels) {
    const segments = marchingSquaresSegments(hgtOut, widthPx, height, level);
    if (!segments.length) continue;
    const chains = chainSegments(segments);
    for (const chain of chains) {
      ctx.beginPath();
      ctx.moveTo(chain[0][0], chain[0][1]);
      for (const point of chain.slice(1)) ctx.lineTo(point[0], point[1]);
      ctx.stroke();
      if (chain.length >= 4) {
        const mid = chain[Math.floor(chain.length / 2)];
        const tooClose = placedLabels.some(([lx, ly]) => Math.hypot(lx - mid[0], ly - mid[1]) < LABEL_MIN_SPACING_PX);
        if (!tooClose) {
          const label = Math.round(level / 10).toString();
          ctx.fillText(label, mid[0] + 4, mid[1] - 4);
          placedLabels.push(mid);
        }
      }
    }
  }

  const dataUrl = `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
  return { time: hgtMsg.referenceDate.toISOString(), bounds, imageDataUrl: dataUrl };
}
