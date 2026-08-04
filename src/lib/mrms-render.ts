// `dbz` is reused as a generic scaled-value field across radar products
// sharing this grid shape — dBZ for reflectivity (GribStream, in-house
// NEXRAD), m/s for in-house velocity. Whichever product requested it knows
// which unit it actually is; see renderVelocityGridToDataUrl below for the
// velocity case.
export type MrmsPoint = { lat: number; lon: number; dbz: number | null };
export type MrmsBounds = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number };

// Reuses the same 12-color family as the app's existing reflectivity legend
// gradient (src/app/page.tsx radarLegends.composite), redistributed across
// even 6.25 dBZ steps from 0-75. This is a documented approximation, not a
// pixel-verified match to the legend's CSS gradient percentages — the legend
// gradient was built for visual display, not as a calibrated lookup table.
const COLOR_STOPS: { dbz: number; rgb: [number, number, number] }[] = [
  { dbz: 0, rgb: [111, 183, 255] },
  { dbz: 6.25, rgb: [59, 216, 233] },
  { dbz: 12.5, rgb: [53, 202, 138] },
  { dbz: 18.75, rgb: [54, 184, 77] },
  { dbz: 25, rgb: [169, 211, 55] },
  { dbz: 31.25, rgb: [239, 226, 58] },
  { dbz: 37.5, rgb: [255, 191, 37] },
  { dbz: 43.75, rgb: [255, 128, 39] },
  { dbz: 50, rgb: [236, 62, 50] },
  { dbz: 56.25, rgb: [190, 31, 87] },
  { dbz: 62.5, rgb: [155, 38, 120] },
  { dbz: 68.75, rgb: [219, 220, 229] },
];
// Below this, treat as no meaningful echo (matches the legend's bands, which
// start at "0-10") rather than painting a faint wash across clear areas —
// MRMS composite reflectivity legitimately includes negative dBZ noise-floor
// values that aren't real precipitation signal.
const NO_ECHO_THRESHOLD_DBZ = 2;

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
const SOFT_BLUR_PX = 1.4;

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

function colorForDbz(dbz: number): [number, number, number] {
  if (dbz <= COLOR_STOPS[0].dbz) return COLOR_STOPS[0].rgb;
  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  if (dbz >= last.dbz) return last.rgb;
  let lower = COLOR_STOPS[0];
  let upper = last;
  for (let i = 0; i < COLOR_STOPS.length - 1; i += 1) {
    if (dbz >= COLOR_STOPS[i].dbz && dbz <= COLOR_STOPS[i + 1].dbz) {
      lower = COLOR_STOPS[i];
      upper = COLOR_STOPS[i + 1];
      break;
    }
  }
  const span = upper.dbz - lower.dbz || 1;
  const t = (dbz - lower.dbz) / span;
  return [
    Math.round(lower.rgb[0] + (upper.rgb[0] - lower.rgb[0]) * t),
    Math.round(lower.rgb[1] + (upper.rgb[1] - lower.rgb[1]) * t),
    Math.round(lower.rgb[2] + (upper.rgb[2] - lower.rgb[2]) * t),
  ];
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
    imageData.data[index + 3] = 235;
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
    imageData.data[index + 3] = 235;
  }
  context.putImageData(imageData, 0, 0);
  return applySoftBlur(canvas);
}
