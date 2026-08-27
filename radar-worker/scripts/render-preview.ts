// Renders a real live volume straight to a PNG file for direct visual inspection — the missing
// piece test-kffc.ts's ASCII heatmap can't give you. Used to verify the weak/strong blur-split
// change (2026-08-27) against real data before deploying, instead of guessing at a blur pixel
// count. Usage: npm run render:preview -- [STATION] [OUT_PATH], e.g.
// `npm run render:preview -- KFFC /tmp/kffc.png`.
import fs from "node:fs";
import { getRadarSite } from "../src/site.js";
import { getVolumeCached, extractLowestElevation } from "../src/level2.js";
import { computeReflectivityGrid } from "../src/project.js";
import { renderMrmsGridToDataUrl } from "../src/render.js";

const STATION_ID = process.argv[2] ?? "KFFC";
const OUT = process.argv[3] ?? "/tmp/render-preview.png";
const GRID_STEP_DEG = 0.01;
const MAX_RANGE_KM = 230;

async function main() {
  const site = await getRadarSite(STATION_ID);
  const { radar } = await getVolumeCached(STATION_ID);
  const reflectivity = extractLowestElevation(radar, "reflectivity");
  let correlationCoefficient;
  try {
    correlationCoefficient = extractLowestElevation(radar, "correlationCoefficient");
  } catch {
    correlationCoefficient = undefined;
  }
  const { grid, bounds } = computeReflectivityGrid(reflectivity, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient);
  const dataUrl = renderMrmsGridToDataUrl(grid, bounds, GRID_STEP_DEG);
  if (!dataUrl) {
    console.error("render returned null");
    process.exit(1);
  }
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(OUT, Buffer.from(base64, "base64"));
  console.log(`wrote ${OUT}`);
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
