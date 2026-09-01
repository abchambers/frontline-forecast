import { createCanvas } from "@napi-rs/canvas";
import type { MrmsBounds, MrmsPoint } from "./types.js";

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
const COLOR_STOPS: { dbz: number; rgb: [number, number, number] }[] = [
  { dbz: 0, rgb: [0, 236, 236] },
  { dbz: 5, rgb: [1, 160, 246] },
  { dbz: 10, rgb: [0, 0, 246] },
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

// Same 8-neighbor flood fill as project.ts's removeSmallClusters, but this one tags component size
// instead of deleting anything — every cell here already passed that data-integrity pass, this is a
// purely visual "how big does this blob actually look" question.
function findSmallComponentKeys(cells: Cell[]): Set<string> {
  const byKey = new Map<string, Cell>();
  for (const cell of cells) byKey.set(`${cell.row},${cell.col}`, cell);

  const visited = new Set<string>();
  const smallKeys = new Set<string>();
  for (const key of byKey.keys()) {
    if (visited.has(key)) continue;
    const component: string[] = [key];
    visited.add(key);
    let head = 0;
    while (head < component.length) {
      const [row, col] = component[head].split(",").map(Number);
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
    if (component.length < SMALL_COMPONENT_MAX_CELLS) {
      for (const componentKey of component) smallKeys.add(componentKey);
    }
  }
  return smallKeys;
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
  // haze — including a radial spoke pattern with well over 40 connected cells, which the existing
  // component-SIZE split doesn't catch (a spoke isn't a small isolated blob, it's a long thin
  // streak, so it was rendering at full PIXEL_ALPHA same as a real storm). Clear Air Mode is a real,
  // known fact from the volume's own header (not a per-cell heuristic): NEXRAD only runs it when
  // there is NO active precipitation anywhere in the station's range, by definition — meaning
  // NOTHING surviving in a Clear-Air-Mode frame is a real storm, regardless of that cell's own
  // component size or shape. When true, every surviving cell gets the SAME weak-signal treatment
  // small isolated blobs already get (WEAK_SIGNAL_ALPHA/WEAK_SIGNAL_BLUR_PX), bypassing the size
  // check entirely — there's no "real storm shape" a Clear-Air frame could contain to protect.
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
    const smallKeys = isClearAirMode
      ? new Set(cells.map((c) => `${c.row},${c.col}`))
      : findSmallComponentKeys(cells);
    const small = paintCells(width, height, cells.filter((c) => smallKeys.has(`${c.row},${c.col}`)), colorFor, WEAK_SIGNAL_ALPHA);
    if (small) {
      compositeContext.filter = `blur(${WEAK_SIGNAL_BLUR_PX}px)`;
      compositeContext.drawImage(small, 0, 0);
    }
    const large = paintCells(width, height, cells.filter((c) => !smallKeys.has(`${c.row},${c.col}`)), colorFor, PIXEL_ALPHA);
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
