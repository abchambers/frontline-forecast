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
const SOFT_BLUR_PX = 0.6;
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

// No hard cell-count cap here unlike the browser version — @napi-rs/canvas
// isn't bound by browser canvas memory conventions the way HTMLCanvasElement
// is, and this worker's own 2gb memory ceiling (see fly.toml) is the real
// limit. Still returns null on a degenerate 0-area grid.
function renderGrid(
  points: MrmsPoint[],
  bounds: MrmsBounds,
  step: number,
  colorFor: (value: number) => [number, number, number],
  passesThreshold: (value: number) => boolean,
): string | null {
  const width = Math.round((bounds.maxLongitude - bounds.minLongitude) / step) + 1;
  const height = Math.round((bounds.maxLatitude - bounds.minLatitude) / step) + 1;
  if (width <= 1 || height <= 1) return null;

  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const imageData = context.createImageData(width, height);
  for (const point of points) {
    if (point.dbz === null || !passesThreshold(point.dbz)) continue;
    const col = Math.round((point.lon - bounds.minLongitude) / step);
    const row = Math.round((bounds.maxLatitude - point.lat) / step);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;
    const [r, g, b] = colorFor(point.dbz);
    const index = (row * width + col) * 4;
    imageData.data[index] = r;
    imageData.data[index + 1] = g;
    imageData.data[index + 2] = b;
    imageData.data[index + 3] = PIXEL_ALPHA;
  }
  context.putImageData(imageData, 0, 0);

  const blurred = createCanvas(width, height);
  const blurredContext = blurred.getContext("2d");
  blurredContext.filter = `blur(${SOFT_BLUR_PX}px)`;
  blurredContext.drawImage(canvas, 0, 0);
  const buffer = blurred.toBuffer("image/png");
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

export function renderMrmsGridToDataUrl(points: MrmsPoint[], bounds: MrmsBounds, step: number): string | null {
  return renderGrid(points, bounds, step, colorForDbz, (v) => v >= NO_ECHO_THRESHOLD_DBZ);
}

export function renderVelocityGridToDataUrl(points: MrmsPoint[], bounds: MrmsBounds, step: number): string | null {
  return renderGrid(points, bounds, step, colorForVelocity, (v) => Math.abs(v) >= VELOCITY_NEUTRAL_BAND);
}
