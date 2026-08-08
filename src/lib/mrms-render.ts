// `dbz` is reused as a generic scaled-value field across radar products
// sharing this grid shape — dBZ for reflectivity (GribStream, in-house
// NEXRAD), m/s for in-house velocity. Whichever product requested it knows
// which unit it actually is; see renderVelocityGridToDataUrl below for the
// velocity case.
export type MrmsPoint = { lat: number; lon: number; dbz: number | null };
export type MrmsBounds = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number };

// The real NWS 16-level reflectivity color table (the same one IEM's N0Q
// mosaic and weather.gov render), pixel-sampled directly off a live IEM
// radar image rather than approximated — see the render.ts copy for the
// verification method. This replaces an earlier hand-built 12-stop gradient
// that was never actually checked against a reference and had visibly wrong
// hues (e.g. no true saturated blue band, a muddy plum instead of magenta at
// the high end, no pure white core).
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
// Below this, treat as no meaningful echo (matches the legend's bands, which
// start at "0-10") rather than painting a faint wash across clear areas —
// MRMS composite reflectivity legitimately includes negative dBZ noise-floor
// values that aren't real precipitation signal.
const NO_ECHO_THRESHOLD_DBZ = 2;
// User-reported live: the radar read noticeably dimmer than reference apps.
// Real, compounding cause found — this per-pixel alpha (previously 235/255,
// ~92%) stacks multiplicatively with the separate user-facing opacity slider
// (defaults to 72%), so the actual on-screen strength was ~92% * 72% =~66%,
// not the 72% the slider implied. The slider is the intended control for
// basemap-vs-radar balance; this constant has no reason to independently
// dim on top of it. Raised to fully opaque so the slider is the only lever.
const PIXEL_ALPHA = 255;

// Cosmetic smoothing only — the underlying grid data is untouched, this
// just softens how it's painted. Native single-radar resolution genuinely
// looks grainier than MRMS composite reflectivity (which smooths across
// multiple merged radars before an app ever sees it) — confirmed via real
// texture analysis and direct visual inspection that this app's remaining
// speckle is real weak precipitation, not clutter, so the right fix is a
// softer render, not a stricter data cutoff (that would just delete real
// rain). Draws the sharp-pixel canvas onto a second canvas with a light
// canvas-native blur, which also naturally softens hard edges into a fade —
// a storm boundary shouldn't look like a stencil cutout.
// User-reported live: at 1.4px this read as too blurry once Leaflet scaled
// the ~496x414 native canvas up to fill the map at typical zoom levels — the
// blur amount is fixed in native-canvas pixels, so it gets visually
// amplified by whatever zoom/stretch factor the map is at, which a
// zoomed-in test render doesn't show. Dialed back to a gentler touch.
const SOFT_BLUR_PX = 0.6;

function applySoftBlur(source: HTMLCanvasElement): string {
  const blurred = document.createElement("canvas");
  blurred.width = source.width;
  blurred.height = source.height;
  const context = blurred.getContext("2d");
  if (!context) return source.toDataURL("image/png");
  context.filter = `blur(${SOFT_BLUR_PX}px)`;
  context.drawImage(source, 0, 0);
  return blurred.toDataURL("image/png");
}

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

// Renders the sparse lat/lon/dBZ grid to a data URL image matching the given
// bounds exactly, so it can be dropped straight into a Leaflet imageOverlay.
export function renderMrmsGridToDataUrl(points: MrmsPoint[], bounds: MrmsBounds, step: number): string | null {
  const width = Math.round((bounds.maxLongitude - bounds.minLongitude) / step) + 1;
  const height = Math.round((bounds.maxLatitude - bounds.minLatitude) / step) + 1;
  if (width <= 1 || height <= 1 || width * height > 500_000) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const imageData = context.createImageData(width, height);
  for (const point of points) {
    if (point.dbz === null || point.dbz < NO_ECHO_THRESHOLD_DBZ) continue;
    const col = Math.round((point.lon - bounds.minLongitude) / step);
    const row = Math.round((bounds.maxLatitude - point.lat) / step);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;
    const [r, g, b] = colorForDbz(point.dbz);
    const index = (row * width + col) * 4;
    imageData.data[index] = r;
    imageData.data[index + 1] = g;
    imageData.data[index + 2] = b;
    imageData.data[index + 3] = PIXEL_ALPHA;
  }
  context.putImageData(imageData, 0, 0);
  return applySoftBlur(canvas);
}

// Diverging green/red velocity scale (NWS convention: green = moving toward
// the radar, red = moving away), symmetric around a near-transparent neutral
// band at 0. Values are native m/s straight from the Level II decoder — not
// converted to knots, unlike most NWS velocity displays, since converting
// without a clear reason to would just be an extra place to get the math
// wrong. Clamped at +-30 m/s (~67mph); genuine tornadic velocities can
// exceed this, same clamp-to-max-color approach as reflectivity's 68.75 dBZ.
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
const VELOCITY_NEUTRAL_BAND = 2; // |velocity| below this renders as no-echo, same idea as reflectivity's noise-floor cutoff.

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

export function renderVelocityGridToDataUrl(points: MrmsPoint[], bounds: MrmsBounds, step: number): string | null {
  const width = Math.round((bounds.maxLongitude - bounds.minLongitude) / step) + 1;
  const height = Math.round((bounds.maxLatitude - bounds.minLatitude) / step) + 1;
  if (width <= 1 || height <= 1 || width * height > 500_000) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const imageData = context.createImageData(width, height);
  for (const point of points) {
    if (point.dbz === null || Math.abs(point.dbz) < VELOCITY_NEUTRAL_BAND) continue;
    const col = Math.round((point.lon - bounds.minLongitude) / step);
    const row = Math.round((bounds.maxLatitude - point.lat) / step);
    if (col < 0 || col >= width || row < 0 || row >= height) continue;
    const [r, g, b] = colorForVelocity(point.dbz);
    const index = (row * width + col) * 4;
    imageData.data[index] = r;
    imageData.data[index + 1] = g;
    imageData.data[index + 2] = b;
    imageData.data[index + 3] = PIXEL_ALPHA;
  }
  context.putImageData(imageData, 0, 0);
  return applySoftBlur(canvas);
}
