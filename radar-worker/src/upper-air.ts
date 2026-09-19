// Real GFS model upper-air maps — same visual idiom as the radar (height contour lines + one
// colored fill field), rendered in-house from real public GRIB2 data rather than an externally-
// hosted static image. This is a DIFFERENT product from the existing /api/upper-air (SPC's own
// twice-daily OBSERVED analysis charts, station plots + hand-analysis, not model output) — that
// stays as-is; this is the "Model" mode alongside it, matching the same "real map, radar's visual
// style" upgrade the fronts tab got.
//
// Extended 2026-09-14 from 500mb-only to all 6 levels the Observed tab already offers (250/300/
// 500/700/850/925mb) -- Andrew's own critique: "the upper air map should be taking over the nws
// images... show the different levels too. Ours is too messy." Height contours are drawn at every
// level (the one parameter real synoptic analysis always plots); the ONE additional filled field
// varies by level, matching the real convention Observed's own level captions already promised but
// Model never delivered on:
//   250/300mb -> wind speed isotachs (jet stream/upper-level wind)
//   500mb     -> relative vorticity (troughs & ridges, already built)
//   700mb     -> relative humidity (mid-level moisture)
//   850mb     -> temperature (low-level thermal ridges/troughs)
//   925mb     -> wind speed isotachs (near-surface flow)
// All 5 needed GRIB2 variables (HGT/TMP/RH/UGRD/VGRD) confirmed present at every one of these 6
// levels via a live .idx fetch before writing this, not assumed from the 500mb-only precedent.
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
import { selectLatestRun } from "./gfs-run-selection.js";
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
function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function gfsUrl(runDate: string, runHour: string): string {
  return `${GFS_BUCKET}/gfs.${runDate}/${runHour}/atmos/gfs.t${runHour}z.pgrb2.0p25.f000`;
}

// Finds the most recent real, actually-published GFS run by checking the real object's existence
// (HEAD on the file itself) -- never assumes a cycle is ready just because its nominal time has
// passed, and never assumes it is MISSING just because a probe failed (see gfs-run-selection.ts).
async function findLatestAvailableRun(): Promise<{ runDate: string; runHour: string; fileSize: number; degraded: boolean }> {
  return selectLatestRun(new Date(), async (candidate) => {
    try {
      const head = await fetchWithTimeout(gfsUrl(candidate.runDate, candidate.runHour), { method: "HEAD" });
      if (head.ok) return { kind: "present", fileSize: Number(head.headers.get("content-length")) };
      // S3 answers 404 (or 403 on a private-listing bucket) for an object that does not exist yet.
      return head.status === 404 || head.status === 403 ? { kind: "absent" } : { kind: "unknown" };
    } catch {
      return { kind: "unknown" };
    }
  });
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

// Isotachs, real convention (WeatherBell/Pivotal-style upper-air wind charts): banded every 20kt
// starting at 50kt, the conventional jet-level "notable wind" threshold. GFS wind is m/s; converted
// to knots since isotachs are conventionally read and labeled in knots on a real chart, not m/s.
function jetWindSpeedColor(speedMs: number): [number, number, number, number] | null {
  const kt = speedMs * 1.94384;
  if (kt < 50) return null;
  if (kt < 70) return [175, 215, 235, 150];
  if (kt < 90) return [235, 225, 120, 170];
  if (kt < 110) return [240, 165, 80, 185];
  if (kt < 130) return [220, 90, 70, 200];
  return [165, 60, 165, 220];
}

// Real bug found live before shipping (2026-09-14): reusing the jet-level 50kt threshold at 925mb
// rendered a completely blank fill -- near-surface wind almost never reaches jet-level speeds even
// in a strong low-level jet, so a real "near-surface flow" chart needs a much lower band, banded
// every 10kt starting at 20kt (a genuinely notable sustained near-surface wind).
function surfaceWindSpeedColor(speedMs: number): [number, number, number, number] | null {
  const kt = speedMs * 1.94384;
  if (kt < 20) return null;
  if (kt < 30) return [175, 215, 235, 150];
  if (kt < 40) return [235, 225, 120, 170];
  if (kt < 50) return [240, 165, 80, 185];
  if (kt < 60) return [220, 90, 70, 200];
  return [165, 60, 165, 220];
}

// Relative humidity, real convention (the classic 700mb moisture chart): dry air below 40% left
// uncolored, moist air banded in green shades up to a saturated dark green -- the same "highlight
// the feature, leave the background alone" idiom as the vorticity/wind fills above.
function relativeHumidityColor(rhPercent: number): [number, number, number, number] | null {
  if (rhPercent < 40) return null;
  if (rhPercent < 60) return [222, 236, 202, 120];
  if (rhPercent < 70) return [182, 221, 162, 150];
  if (rhPercent < 80) return [132, 201, 122, 170];
  if (rhPercent < 90) return [82, 171, 92, 190];
  return [42, 132, 62, 210];
}

// Temperature, real convention (the classic 850mb thermal chart): blue (cold) through green/yellow
// into red/orange (warm), banded every 10C. Converted from GFS's native Kelvin to Celsius, the
// real unit these charts are read in.
function temperatureColor(tempK: number): [number, number, number, number] | null {
  const c = tempK - 273.15;
  if (c < -20) return [90, 50, 165, 200];
  if (c < -10) return [65, 100, 205, 190];
  if (c < 0) return [95, 155, 230, 175];
  if (c < 10) return [150, 205, 225, 150];
  if (c < 20) return [250, 225, 140, 155];
  if (c < 25) return [248, 175, 90, 175];
  if (c < 30) return [235, 120, 70, 195];
  return [205, 60, 60, 215];
}

export const UPPER_AIR_LEVELS = ["250", "300", "500", "700", "850", "925"] as const;
export type UpperAirLevel = (typeof UPPER_AIR_LEVELS)[number];
type PrimaryField = "vorticity" | "jetWind" | "relativeHumidity" | "temperature" | "surfaceWind";

const LEVEL_FIELD: Record<UpperAirLevel, PrimaryField> = {
  "250": "jetWind",
  "300": "jetWind",
  "500": "vorticity",
  "700": "relativeHumidity",
  "850": "temperature",
  "925": "surfaceWind",
};

const LEVEL_TITLE: Record<UpperAirLevel, string> = {
  "250": "250mb Heights & Isotachs",
  "300": "300mb Heights & Isotachs",
  "500": "500mb Heights & Relative Vorticity",
  "700": "700mb Heights & Relative Humidity",
  "850": "850mb Heights & Temperature",
  "925": "925mb Heights & Isotachs",
};

// Real standard contour intervals, scaled to each level's own real height range -- 500mb's 60m is
// the well-established classic; upper levels (250/300mb, heights ~9-11km) use a coarser 120m so the
// map isn't packed with dozens of near-parallel lines, lower levels (700/850/925mb, heights under
// ~3.2km) use a finer 30m since the real height gradients there are much shallower in absolute terms.
const CONTOUR_INTERVAL_BY_LEVEL: Record<UpperAirLevel, number> = {
  "250": 120,
  "300": 120,
  "500": 60,
  "700": 30,
  "850": 30,
  "925": 30,
};

export async function renderUpperAirLevel(level: UpperAirLevel, widthPx = 900, heightPx: number | null = null): Promise<{ time: string; bounds: MrmsBounds; imageDataUrl: string; level: UpperAirLevel; title: string; degraded: boolean }> {
  const gribLevel = `${level} mb`;
  const { runDate, runHour, fileSize, degraded } = await findLatestAvailableRun();
  const field = LEVEL_FIELD[level];

  const hgtMsg = await fetchGfsMessage(runDate, runHour, fileSize, "HGT", gribLevel);
  const { latitude, longitude } = hgtMsg.latlngAdjusted(true, true);
  const { cols } = hgtMsg.gridShape;
  const toGrid = (data: Float64Array | Float32Array | number[]): SourceGrid => ({ data, lat: latitude, lon: longitude, rows: latitude.length, cols });
  const hgtGrid = toGrid(hgtMsg.dataAdjusted(true, true));

  // CONUS-focused bounds, matching the region every other tab (radar, fronts) defaults to.
  const bounds: MrmsBounds = { minLatitude: 20, maxLatitude: 55, minLongitude: -130, maxLongitude: -60 };
  const height = heightPx ?? Math.round((widthPx * (latToMercatorY(bounds.maxLatitude) - latToMercatorY(bounds.minLatitude))) / (((bounds.maxLongitude - bounds.minLongitude) * Math.PI) / 180));
  const hgtOut = resampleToMercator(hgtGrid, bounds, widthPx, height);

  // The ONE additional field highlighted per level -- see LEVEL_FIELD's own comment above for why
  // each level gets its real, conventional field rather than every level repeating 500mb's own.
  let fillOut: Float32Array;
  let colorForValue: (value: number) => [number, number, number, number] | null;
  if (field === "vorticity") {
    const absvMsg = await fetchGfsMessage(runDate, runHour, fileSize, "ABSV", gribLevel);
    const absoluteOut = resampleToMercator(toGrid(absvMsg.dataAdjusted(true, true)), bounds, widthPx, height);
    fillOut = absoluteToRelativeVorticity(absoluteOut, bounds, widthPx, height);
    colorForValue = vorticityColor;
  } else if (field === "jetWind" || field === "surfaceWind") {
    const [uMsg, vMsg] = await Promise.all([
      fetchGfsMessage(runDate, runHour, fileSize, "UGRD", gribLevel),
      fetchGfsMessage(runDate, runHour, fileSize, "VGRD", gribLevel),
    ]);
    const uOut = resampleToMercator(toGrid(uMsg.dataAdjusted(true, true)), bounds, widthPx, height);
    const vOut = resampleToMercator(toGrid(vMsg.dataAdjusted(true, true)), bounds, widthPx, height);
    fillOut = new Float32Array(uOut.length);
    for (let i = 0; i < uOut.length; i++) fillOut[i] = Math.hypot(uOut[i], vOut[i]);
    colorForValue = field === "jetWind" ? jetWindSpeedColor : surfaceWindSpeedColor;
  } else if (field === "relativeHumidity") {
    const rhMsg = await fetchGfsMessage(runDate, runHour, fileSize, "RH", gribLevel);
    fillOut = resampleToMercator(toGrid(rhMsg.dataAdjusted(true, true)), bounds, widthPx, height);
    colorForValue = relativeHumidityColor;
  } else {
    const tmpMsg = await fetchGfsMessage(runDate, runHour, fileSize, "TMP", gribLevel);
    fillOut = resampleToMercator(toGrid(tmpMsg.dataAdjusted(true, true)), bounds, widthPx, height);
    colorForValue = temperatureColor;
  }

  const canvas = createCanvas(widthPx, height);
  const ctx = canvas.getContext("2d");

  // Field fill first, blurred slightly the same way render.ts softens the radar's own weak signal —
  // raw per-pixel model output reads as noisy speckle otherwise (confirmed directly against the
  // real, unblurred prototype render).
  const fillCanvas = createCanvas(widthPx, height);
  const fillCtx = fillCanvas.getContext("2d");
  const imageData = fillCtx.createImageData(widthPx, height);
  for (let i = 0; i < fillOut.length; i++) {
    const color = colorForValue(fillOut[i]);
    if (!color) continue;
    imageData.data[i * 4] = color[0];
    imageData.data[i * 4 + 1] = color[1];
    imageData.data[i * 4 + 2] = color[2];
    imageData.data[i * 4 + 3] = color[3];
  }
  fillCtx.putImageData(imageData, 0, 0);
  // Real defect found live (2026-09-14): vorticity is a spatial DERIVATIVE of the wind field, so it
  // carries real grid-scale noise the other fields (a direct measurement-like quantity: RH, temp,
  // wind speed itself) don't have nearly as much of -- 1.5px was tuned against wind/RH/temp fills
  // and left vorticity looking like scattered speckle rather than the smooth bands a real chart
  // shows. Only vorticity gets the heavier blur; the other three fields already rendered cleanly at
  // 1.5px and a heavier blur on them would just smear away real, meaningful gradient detail.
  ctx.filter = field === "vorticity" ? "blur(4px)" : "blur(1.5px)";
  ctx.drawImage(fillCanvas, 0, 0);
  ctx.filter = "none";

  // Height contour lines, this level's own real standard interval, labeled in decameters (the
  // conventional unit on a real chart, e.g. "564" for 5640m) at each chained line's own midpoint.
  let contourInterval = CONTOUR_INTERVAL_BY_LEVEL[level];
  let hgtMin = Infinity, hgtMax = -Infinity;
  for (const v of hgtOut) { if (v < hgtMin) hgtMin = v; if (v > hgtMax) hgtMax = v; }
  // Real defect found live (2026-09-14): a genuinely steep real height gradient (e.g. a deep 700mb
  // low) packed so many standard-interval contour lines into one small region that they visually
  // merged into a solid black blob -- confirmed against a real render, not a hypothetical. Rather
  // than hand-picking a coarser fixed interval per level (which would lose real detail on an
  // ordinary day), doubling the interval only when the actual value range on THIS run would need
  // more than a reasonable number of lines keeps normal days at the standard interval and only
  // backs off when a real run's gradient actually calls for it.
  const MAX_CONTOUR_LINES = 24;
  while ((hgtMax - hgtMin) / contourInterval > MAX_CONTOUR_LINES) contourInterval *= 2;
  const levels: number[] = [];
  for (let lvl = Math.ceil(hgtMin / contourInterval) * contourInterval; lvl <= hgtMax; lvl += contourInterval) levels.push(lvl);

  // Real defect found live (2026-09-15, Andrew's own report): plain near-black contour lines and
  // labels are invisible against this map's dark basemap -- and the obvious fix, switching to
  // white, would then be invisible against the light-colored field fill underneath (pale green/
  // yellow/orange). No single flat color has real contrast against both a dark basemap AND a light
  // fill at once. Fixed with the standard cartographic halo technique instead: a wide, translucent
  // WHITE stroke drawn first, then the real dark stroke on top -- reads clearly over either
  // background, same idea as a text drop-shadow/outline.
  ctx.lineJoin = "round";
  ctx.font = `bold 13px "${FONT_FAMILY}"`;
  // Real defect found in the first live render, fixed here: closely-spaced contours (a tight
  // height gradient, e.g. near a deep trough) placed their labels close enough to overlap into
  // illegible garbled text. Tracks already-placed label centers and skips a new one that would
  // land within LABEL_MIN_SPACING_PX of an existing one, rather than trying to space contour
  // levels themselves differently (which would need to change the real interval convention).
  const LABEL_MIN_SPACING_PX = 40;
  const placedLabels: [number, number][] = [];
  for (const lvl of levels) {
    const segments = marchingSquaresSegments(hgtOut, widthPx, height, lvl);
    if (!segments.length) continue;
    const chains = chainSegments(segments);
    for (const chain of chains) {
      ctx.beginPath();
      ctx.moveTo(chain[0][0], chain[0][1]);
      for (const point of chain.slice(1)) ctx.lineTo(point[0], point[1]);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 3.2;
      ctx.stroke();
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 1.3;
      ctx.stroke();
      if (chain.length >= 4) {
        const mid = chain[Math.floor(chain.length / 2)];
        const tooClose = placedLabels.some(([lx, ly]) => Math.hypot(lx - mid[0], ly - mid[1]) < LABEL_MIN_SPACING_PX);
        if (!tooClose) {
          const label = Math.round(lvl / 10).toString();
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.strokeText(label, mid[0] + 4, mid[1] - 4);
          ctx.fillStyle = "#1a1a1a";
          ctx.fillText(label, mid[0] + 4, mid[1] - 4);
          placedLabels.push(mid);
        }
      }
    }
  }

  const dataUrl = `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
  return { time: hgtMsg.referenceDate.toISOString(), bounds, imageDataUrl: dataUrl, level, title: LEVEL_TITLE[level], degraded };
}
