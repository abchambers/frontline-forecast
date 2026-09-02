import { createCanvas } from "@napi-rs/canvas";
import type { MrmsBounds, MrmsPoint } from "./types.js";
import { DESPECKLE_STRENGTH_GATE_DBZ } from "./project.js";

// Server-side port of src/lib/mrms-render.ts (the main app's browser
// canvas renderer) — color tables and blur logic kept byte-for-byte
// identical on purpose, so switching a request from client-rendered JSON to
// worker-rendered PNG doesn't change how anything looks, only how it's
// transported. The reason this exists at all: shipping raw {lat,lon,dbz}
// JSON scales terribly — measured live, doubling this app's grid resolution
// (0.01deg -> 0.005deg) would have taken the payload from 6.3MB to 26MB.
// Rendering server-side and shipping a compressed PNG instead makes
// resolution roughly free from a payload-size standpoint (compression works
// on the same smooth gradients + huge empty areas that make the raw JSON so
// repetitive), which is what actually lets this app get toward
// RadarScope-grade detail instead of trading detail for load time.
// The real NWS 16-level reflectivity color table, pixel-sampled directly off a live IEM N0Q
// radar image (mesonet.agron.iastate.edu/GIS/radmap.php) rather than approximated: fetched the
// actual image via canvas, read RGB values across both the embedded legend swatch and real storm
// pixels on the map itself to confirm the mapping. Replaces an earlier 12-stop gradient that was
// never verified against a reference and had visibly wrong hues (no true saturated blue band, a
// muddy plum instead of magenta at the high end, no pure white core).
// Andrew, live 2026-09-01: "blue is harsh" — the bottom two stops (0 and 5 dBZ, NWS's own "very
// light reflectivity" band) were the full-saturation cyan/deep-blue pixel-sampled from a real storm
// CORE, applied identically to the weakest possible signal this app shows — visually declaring
// "here's real precipitation" at exactly the band where that's least certain.
//
// SUPERSEDED, 2026-09-02: the 55%/45%-toward-white blend below was a judgment call, not a measured
// match, and a fresh live comparison (RadarScope screenshots at KFFC/KMPX, real storms, same
// moment) showed our blue still reading brighter/more saturated than either RadarScope or a live
// NWS radar.weather.gov legend — pixel-sampled directly off that legend's own canvas (getImageData
// across its color ramp), not eyeballed: the 0-10 dBZ band there is a muted, cool gray drifting
// into a desaturated navy blue, nothing near our previous bright cyan. Re-picked 0/5/10 dBZ from
// that real sample (dBZ position on the ramp estimated from its labeled -20..70 span, since exact
// tick pixel positions weren't separately measured — open to a tighter recalibration if a direct
// side-by-side still looks off). 15+ dBZ stays untouched, same reasoning as before: this only
// softens the noise-floor-adjacent bands, not real precipitation once it's clearly real.
const COLOR_STOPS: { dbz: number; rgb: [number, number, number] }[] = [
  { dbz: 0, rgb: [150, 158, 168] },
  { dbz: 5, rgb: [105, 120, 165] },
  { dbz: 10, rgb: [75, 100, 160] },
  { dbz: 15, rgb: [0, 255, 0] },
  { dbz: 20, rgb: [0, 200, 0] },
  { dbz: 25, rgb: [0, 144, 0] },
  { dbz: 30, rgb: [255, 255, 0] },
  { dbz: 35, rgb: [231, 192, 0] },
  { dbz: 40, rgb: [255, 144, 0] },
  { dbz: 45, rgb: [255, 0, 0] },
  { dbz: 50, rgb: [214, 0, 0] },
  { dbz: 55, rgb: [192, 0, 0] },
  { dbz: 60, rgb: [255, 0, 255] },
  { dbz: 65, rgb: [153, 85, 201] },
  { dbz: 70, rgb: [255, 255, 255] },
];
const NO_ECHO_THRESHOLD_DBZ = 2;
// Andrew, live (2026-08-27): pulled a frame from RadarScope at the same station/moment as this
// app's own live view for a direct comparison. RadarScope shows the SAME clear-air/biological-
// scatter clutter this app's noise-floor pipeline deliberately lets through (see project.ts's
// MIN_REFLECTIVITY_DBZ/despeckle/CC history — every attempt to filter that signal out further has a
// real, measured cost of also losing genuine thin/weak precipitation). The visible difference isn't
// the DATA, it's how the surviving weak signal gets PAINTED: RadarScope renders it as a soft,
// blended haze, while this app painted every surviving cell with the same hard edge and the same
// faint blur.
//
// FIRST attempt at this (reverted the same day) split the blur by raw dBZ VALUE — everything under
// 25 dBZ got a heavy blur. Andrew caught the real flaw live: a big, cohesive area of genuine light-
// to-moderate rain (15-24 dBZ is completely ordinary, common weather) got the same mushy treatment
// as actual isolated noise specks, which is exactly backwards for a product whose whole point is
// showing storm shape accurately. Strength was never the right proxy for "is this noise" — SIZE is.
// project.ts's own removeSmallClusters already established this: real clutter forms tiny connected
// blobs (measured live: 1198 of size 1-2, 606 of size 3-5), real storms — even weak, thin ones —
// form large cohesive regions (a 394-cell blob, several 50-200-cell blobs). So this now runs the
// same connected-component analysis at render time and blurs by COMPONENT SIZE, not dBZ: a cell
// that's part of a small, isolated blob gets the heavy blur regardless of its strength, a cell in a
// real, sizeable storm shape stays crisp regardless of how weak that storm's leading edge is.
// SMALL_COMPONENT_MAX_CELLS is deliberately its own constant, well above project.ts's
// MIN_CLUSTER_SIZE (6) — a 6-cell blob already survived that data-integrity cutoff as "plausibly
// real," but at this render resolution it's still visually speck-sized and reads better as soft haze
// than as a hard dot floating in isolation.
const SMALL_COMPONENT_MAX_CELLS = 40;
// Andrew, live (2026-08-27, second report): "this blur is unacceptable" — a whole ring of small
// weak-signal blobs (the clear-air/biological-scatter clutter described above, at a consistent range
// from the radar site) was reading as a dominant, ugly haze across most of the image. Investigated
// with render-preview.ts against live KFFC data before touching anything: dropping WEAK_SIGNAL_BLUR_PX
// all the way to 0 barely changed the appearance — proof the blur RADIUS was never the actual cause.
// The real problem was opacity: every surviving cell, weak-isolated or not, painted at full 255 alpha
// (see PIXEL_ALPHA below), so a wide scatter of small blobs reads as a solid, busy field even blurred
// down to a soft edge. RadarScope's "soft, blended haze" (see the comment above) is a low-OPACITY
// blend, not merely a blurred full-strength color. Fixed by giving the small-component path its own,
// much lower alpha (WEAK_SIGNAL_ALPHA) instead of leaning on blur radius alone — verified against the
// same live volume that produced the ugly ring: real storm cores (large components, still full
// PIXEL_ALPHA) stay exactly as crisp as before, only the scattered weak/isolated signal fades into a
// subtle background texture instead of dominating the frame. Blur radius still gets a small bump
// (was 2.4, now 1.2) purely to soften each speck's own hard edge, not to control how much of the
// image it visually covers — that job now belongs to alpha.
const WEAK_SIGNAL_BLUR_PX = 1.2;
const SOFT_BLUR_PX = 0.6;
const WEAK_SIGNAL_ALPHA = 65;
// Real comparison, 2026-09-02: a live KFFC-area mosaic (all 5 member stations confirmed VCP 35)
// sat right next to the same moment on RadarScope. Both showed the same persistent KFFC clutter
// spoke (elongation-gated, unaffected by this constant), but everywhere else RadarScope went
// almost fully black while this app stayed scattered with visible speckle across multiple states.
// Root cause: isClearAirMode shared WEAK_SIGNAL_ALPHA with the small-component/elongation cases,
// even though it carries a much stronger guarantee -- when EVERY member station reports Clear Air
// Mode, nothing in the frame is real weather, full stop (isExemptFromWeakSignal still protects any
// cell strong enough to be real regardless). There's no real-storm risk being hedged against here,
// so there's no reason to share the same moderate alpha used for "this one small blob might be
// real" -- that's a fundamentally less certain case. Given its own, much lower alpha instead.
const CLEAR_AIR_ALPHA = 16;
// Mirrors a real fix in src/lib/mrms-render.ts — was 235/255 (~92%), which
// stacked multiplicatively with the separate user-facing opacity slider
// (defaults to 72%), making the real on-screen strength ~66% even though the
// slider read 72%. User-reported live as looking dimmer than reference
// radar apps. Raised to fully opaque so the slider is the only opacity lever.
const PIXEL_ALPHA = 255;

// Discrete/stepped, NOT interpolated — real radar displays (IEM, RadarScope, weather.gov) render
// hard 5 dBZ color bands, not a smooth gradient between them. Confirmed directly against a live IEM
// image: sampling adjacent pixels across a real storm core jumps abruptly between exact palette
// values with no blending (aside from single-pixel anti-aliasing at a band edge) — the "banded"
// look is a real, deliberate part of how these displays read, not a rendering limitation to smooth
// over. This app's earlier smooth interpolation was a big part of why it looked more like a
// heatmap/model-guidance render than an actual radar display.
function colorForDbz(dbz: number): [number, number, number] {
  for (let i = COLOR_STOPS.length - 1; i >= 0; i -= 1) {
    if (dbz >= COLOR_STOPS[i].dbz) return COLOR_STOPS[i].rgb;
  }
  return COLOR_STOPS[0].rgb;
}

const VELOCITY_COLOR_STOPS: { velocity: number; rgb: [number, number, number] }[] = [
  { velocity: -30, rgb: [0, 68, 27] },
  { velocity: -20, rgb: [0, 130, 60] },
  { velocity: -10, rgb: [90, 191, 110] },
  { velocity: -2, rgb: [199, 233, 192] },
  { velocity: 2, rgb: [253, 208, 194] },
  { velocity: 10, rgb: [239, 101, 72] },
  { velocity: 20, rgb: [186, 22, 33] },
  { velocity: 30, rgb: [103, 0, 13] },
];
const VELOCITY_NEUTRAL_BAND = 2;

function colorForVelocity(velocity: number): [number, number, number] {
  const stops = VELOCITY_COLOR_STOPS;
  if (velocity <= stops[0].velocity) return stops[0].rgb;
  const last = stops[stops.length - 1];
  if (velocity >= last.velocity) return last.rgb;
  let lower = stops[0];
  let upper = last;
  for (let i = 0; i < stops.length - 1; i += 1) {
    if (velocity >= stops[i].velocity && velocity <= stops[i + 1].velocity) {
      lower = stops[i];
      upper = stops[i + 1];
      break;
    }
  }
  const span = upper.velocity - lower.velocity || 1;
  const t = (velocity - lower.velocity) / span;
  return [
    Math.round(lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * t),
    Math.round(lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * t),
    Math.round(lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * t),
  ];
}

type Cell = { row: number; col: number; dbz: number };

// Andrew, live 2026-09-01: the VCP-based Clear-Air-Mode dimming (see the isClearAirMode parameter
// below) only fires when the WHOLE frame has no real weather anywhere — it can't help a station
// that's in Precipitation Mode because there's a real storm somewhere in its range, while a
// persistent local clutter spoke (ground clutter, biological scatter radiating from the site along
// a consistent azimuth — see project.ts's own CC-gating history for the same unresolved spoke
// pattern) keeps showing up near the site itself. A spoke like that is exactly the shape the
// original SIZE-only check (below) misses: it strings together well over SMALL_COMPONENT_MAX_CELLS
// cells despite being a thin radial streak, not a blob, so it rendered at full PIXEL_ALPHA same as
// a real storm.
//
// Size alone can't tell the two apart, but SHAPE can, independent of size — real storm cells are
// roughly blobby (spread out similarly in every direction); a radial streak is stretched along one
// axis and thin along the other. Measured directly against live KGSP data (a real, visually-
// confirmed spoke pattern, all 52 of its size>=40 components): PCA elongation (the ratio of the
// component's two principal-axis eigenvalues, computed from its cells' row/col covariance —
// orientation-independent, unlike an axis-aligned bounding-box fill ratio, which a diagonal spoke
// defeats since its axis-aligned bbox looks artificially "chunky") ranged continuously from 1.10
// (nearly circular) to 7.91 (clearly stretched), with the largest, most visually spoke-like
// components clustering at 3.2-4.3+. ELONGATION_THRESHOLD=3 catches roughly the most-stretched
// quarter of today's real large components without touching the more circular majority — a
// deliberately moderate cut, not a guess: real convective clusters, even elongated ones like a
// squall-line segment, are rarely thinner than a 3:1 aspect ratio at this grid resolution, while a
// true 1-2-cell-wide radial streak trivially exceeds it.
//
// UPDATE, same day: the "real mixed case" this was flagged as untested against happened within
// hours — a real ~32 dBZ rain feature off the Georgia coast (plausibly a narrow shower/sea-breeze-
// convergence line, genuinely common there) measured elongation 6.81 and got incorrectly dimmed.
// Real weather CAN be this elongated; shape alone was never a fully reliable signal on its own. The
// fix wasn't lowering confidence in this threshold, it was adding isExemptFromWeakSignal below —
// real strong signal (>=DESPECKLE_STRENGTH_GATE_DBZ) now always survives regardless of elongation,
// the same rule project.ts's own despeckle pass already used for this exact reason. This check
// still does real work for genuinely WEAK elongated clutter; it just can't be the only signal for
// anything strong enough to plausibly be real.
const ELONGATION_THRESHOLD = 3;

type ComponentShape = { keys: string[]; size: number; elongation: number; maxDbz: number };

function findComponents(cells: Cell[]): ComponentShape[] {
  const byKey = new Map<string, Cell>();
  for (const cell of cells) byKey.set(`${cell.row},${cell.col}`, cell);

  const visited = new Set<string>();
  const components: ComponentShape[] = [];
  for (const key of byKey.keys()) {
    if (visited.has(key)) continue;
    const component: string[] = [key];
    visited.add(key);
    let head = 0;
    let sumRow = 0;
    let sumCol = 0;
    let maxDbz = -Infinity;
    while (head < component.length) {
      const [row, col] = component[head].split(",").map(Number);
      sumRow += row;
      sumCol += col;
      maxDbz = Math.max(maxDbz, byKey.get(component[head])!.dbz);
      head += 1;
      for (let dRow = -1; dRow <= 1; dRow += 1) {
        for (let dCol = -1; dCol <= 1; dCol += 1) {
          if (dRow === 0 && dCol === 0) continue;
          const neighborKey = `${row + dRow},${col + dCol}`;
          if (visited.has(neighborKey) || !byKey.has(neighborKey)) continue;
          visited.add(neighborKey);
          component.push(neighborKey);
        }
      }
    }

    const meanRow = sumRow / component.length;
    const meanCol = sumCol / component.length;
    let varRow = 0;
    let varCol = 0;
    let covar = 0;
    for (const componentKey of component) {
      const [row, col] = componentKey.split(",").map(Number);
      const dRow = row - meanRow;
      const dCol = col - meanCol;
      varRow += dRow * dRow;
      varCol += dCol * dCol;
      covar += dRow * dCol;
    }
    varRow /= component.length;
    varCol /= component.length;
    covar /= component.length;
    // Eigenvalues of the 2x2 covariance matrix [[varRow, covar], [covar, varCol]] — a single-cell
    // or perfectly uniform component has both eigenvalues near 0, guarded below to avoid a 0/0.
    const trace = varRow + varCol;
    const det = varRow * varCol - covar * covar;
    const discriminant = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
    const eig1 = trace / 2 + discriminant;
    const eig2 = Math.max(trace / 2 - discriminant, 1e-6);
    const elongation = Math.sqrt(eig1 / eig2);

    components.push({ keys: component, size: component.length, elongation, maxDbz });
  }
  return components;
}

// Real incident, 2026-09-01: shipped VCP-mode and elongation dimming (both below) without this
// exemption, and both immediately mis-fired on real, meaningful precipitation the same day — KJGX
// showed genuine coastal Georgia rain up to 47 dBZ while STILL reporting VCP 35 (Clear Air Mode),
// disproving the assumption that VCP mode reliably flips the instant real precip exists anywhere in
// range (it lags real conditions); separately, a real ~32 dBZ rain feature (elongation 6.8, plausibly
// a narrow shower/sea-breeze-convergence line — genuinely common off the Georgia coast) tripped the
// elongation check on shape alone. Both are exactly the mistake this app's history already warned
// against (see MIN_REFLECTIVITY_DBZ/DESPECKLE_STRENGTH_GATE_DBZ's own comments): trusting a proxy
// for "is this real" over the actual measured strength. project.ts's despeckle/cluster-removal
// already solved this with one rule — strong signal always survives, regardless of any other
// heuristic — and neither new mechanism carried that rule over when it should have from the start.
// Every weak-signal path below is now gated by the SAME rule: a component this strong is real,
// full stop, no matter how small, how elongated, or what VCP the station claims to be running.
function isExemptFromWeakSignal(component: ComponentShape): boolean {
  return component.maxDbz >= DESPECKLE_STRENGTH_GATE_DBZ;
}

// Same 8-neighbor flood fill as project.ts's removeSmallClusters, but this one tags weak-signal
// components instead of deleting anything — every cell here already passed that data-integrity
// pass, this is a purely visual "does this look like real storm shape" question. A component reads
// as weak signal if it's small, OR shaped like a thin radial streak, OR the whole frame is Clear Air
// Mode — UNLESS it's strong enough to be exempt (see isExemptFromWeakSignal above), which always
// wins regardless of the other three.
//
// Clear Air Mode gets its own bucket (clearAirKeys), separate from the small/elongated case
// (otherWeakKeys) — see CLEAR_AIR_ALPHA's comment for why the two deserve different treatment, not
// just different bookkeeping. When the whole frame is Clear Air, every non-exempt component
// already qualifies via that path alone; checking size/elongation on top of it would only ever
// reclassify cells that are already going in the (more aggressive) clear-air bucket, so the other
// checks only run when isClearAirMode is false.
function findWeakSignalKeys(cells: Cell[], isClearAirMode: boolean): { clearAirKeys: Set<string>; otherWeakKeys: Set<string> } {
  const clearAirKeys = new Set<string>();
  const otherWeakKeys = new Set<string>();
  for (const component of findComponents(cells)) {
    if (isExemptFromWeakSignal(component)) continue;
    if (isClearAirMode) {
      for (const componentKey of component.keys) clearAirKeys.add(componentKey);
    } else if (component.size < SMALL_COMPONENT_MAX_CELLS || component.elongation >= ELONGATION_THRESHOLD) {
      for (const componentKey of component.keys) otherWeakKeys.add(componentKey);
    }
  }
  return { clearAirKeys, otherWeakKeys };
}

// No hard cell-count cap here unlike the browser version — @napi-rs/canvas
// isn't bound by browser canvas memory conventions the way HTMLCanvasElement
// is, and this worker's own 2gb memory ceiling (see fly.toml) is the real
// limit. Still returns null on a degenerate 0-area grid.
function paintCells(width: number, height: number, cells: Cell[], colorFor: (value: number) => [number, number, number], alpha: number) {
  if (!cells.length) return null;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);
  for (const cell of cells) {
    const [r, g, b] = colorFor(cell.dbz);
    const index = (cell.row * width + cell.col) * 4;
    imageData.data[index] = r;
    imageData.data[index + 1] = g;
    imageData.data[index + 2] = b;
    imageData.data[index + 3] = alpha;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

function renderGrid(
  points: MrmsPoint[],
  bounds: MrmsBounds,
  step: number,
  colorFor: (value: number) => [number, number, number],
  passesThreshold: (value: number) => boolean,
  // Only reflectivity gets the small-blob/real-shape split (see SMALL_COMPONENT_MAX_CELLS above) —
  // velocity keeps a single uniform blur, same as before. project.ts already documents why velocity
  // deliberately gets different treatment than reflectivity throughout this pipeline (real severe-
  // weather couplets are themselves small and localized, exactly what this split would blur away).
  splitBySize: boolean,
  // Andrew, live 2026-09-01: RadarScope's own screenshots at 5 real local stations, all confirmed
  // running VCP 35 (Clear Air Mode — see compute-worker.ts's CLEAR_AIR_VCPS), showed the SAME real
  // weak/biological/ground-clutter signal this app's noise-floor pipeline already lets through (see
  // the SMALL_COMPONENT_MAX_CELLS comment above for that history) as a barely-visible, near-white
  // haze. When true, every surviving cell gets the SAME weak-signal treatment small isolated blobs
  // already get (WEAK_SIGNAL_ALPHA/WEAK_SIGNAL_BLUR_PX), bypassing the size check entirely.
  //
  // Corrected same day, real incident: this comment originally claimed Clear Air Mode is an
  // absolute guarantee ("NOTHING surviving is a real storm") because that's the mode's documented
  // PURPOSE. Real live data proved that wrong within hours — KJGX showed genuine coastal Georgia
  // rain up to 47 dBZ while STILL reporting VCP 35, meaning automatic VCP switching lags real
  // conditions and isn't a hard guarantee. isClearAirMode is now a WEAK-signal-favoring default,
  // not an absolute override — findWeakSignalKeys still exempts any component strong enough to be
  // real regardless of what VCP the station claims (see isExemptFromWeakSignal), the same rule
  // project.ts's own despeckle logic already uses for exactly this reason.
  isClearAirMode: boolean,
): string | null {
  const width = Math.round((bounds.maxLongitude - bounds.minLongitude) / step) + 1;
  const height = Math.round((bounds.maxLatitude - bounds.minLatitude) / step) + 1;
  if (width <= 1 || height <= 1) return null;

  const cells: Cell[] = [];
  for (const point of points) {
    if (point.dbz === null || !passesThreshold(point.dbz)) continue;
    const col = Math.round((point.lon - bounds.minLongitude) / step);
    const row = Math.round((bounds.maxLatitude - point.lat) / step);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;
    cells.push({ row, col, dbz: point.dbz });
  }

  const composite = createCanvas(width, height);
  const compositeContext = composite.getContext("2d");

  if (splitBySize) {
    const { clearAirKeys, otherWeakKeys } = findWeakSignalKeys(cells, isClearAirMode);
    const clearAir = paintCells(width, height, cells.filter((c) => clearAirKeys.has(`${c.row},${c.col}`)), colorFor, CLEAR_AIR_ALPHA);
    if (clearAir) {
      compositeContext.filter = `blur(${WEAK_SIGNAL_BLUR_PX}px)`;
      compositeContext.drawImage(clearAir, 0, 0);
    }
    const small = paintCells(width, height, cells.filter((c) => otherWeakKeys.has(`${c.row},${c.col}`)), colorFor, WEAK_SIGNAL_ALPHA);
    if (small) {
      compositeContext.filter = `blur(${WEAK_SIGNAL_BLUR_PX}px)`;
      compositeContext.drawImage(small, 0, 0);
    }
    const large = paintCells(width, height, cells.filter((c) => !clearAirKeys.has(`${c.row},${c.col}`) && !otherWeakKeys.has(`${c.row},${c.col}`)), colorFor, PIXEL_ALPHA);
    if (large) {
      compositeContext.filter = `blur(${SOFT_BLUR_PX}px)`;
      compositeContext.drawImage(large, 0, 0);
    }
  } else {
    const canvas = paintCells(width, height, cells, colorFor, PIXEL_ALPHA);
    if (canvas) {
      compositeContext.filter = `blur(${SOFT_BLUR_PX}px)`;
      compositeContext.drawImage(canvas, 0, 0);
    }
  }

  const buffer = composite.toBuffer("image/png");
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export function renderMrmsGridToDataUrl(points: MrmsPoint[], bounds: MrmsBounds, step: number, isClearAirMode = false): string | null {
  return renderGrid(points, bounds, step, colorForDbz, (v) => v >= NO_ECHO_THRESHOLD_DBZ, true, isClearAirMode);
}

export function renderVelocityGridToDataUrl(points: MrmsPoint[], bounds: MrmsBounds, step: number): string | null {
  // Deliberately no Clear-Air-Mode dimming here — velocity never had the small-blob/real-shape split
  // to begin with (splitBySize=false, see above), and there's no live evidence yet that velocity has
  // the same "harsh noise" problem reflectivity does. Scoped to reflectivity only for this pass.
  return renderGrid(points, bounds, step, colorForVelocity, (v) => Math.abs(v) >= VELOCITY_NEUTRAL_BAND, false, false);
}
