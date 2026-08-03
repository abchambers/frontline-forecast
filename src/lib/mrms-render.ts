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
  return canvas.toDataURL("image/png");
}
