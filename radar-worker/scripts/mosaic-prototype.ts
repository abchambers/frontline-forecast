// Southeast regional mosaic prototype — measures REAL wall-clock time and peak memory for
// sequentially decoding + compositing multiple NEXRAD sites into one composite image, instead of
// extrapolating from the single-station numbers already measured in production (see fly.toml /
// level2.ts comments: single volume ~800MB+ RSS, 2GB is the real ceiling on shared-cpu-1x).
//
// Deliberately sequential, one station in flight at a time (matches the production worker's
// existing MAX_CONCURRENT_COMPUTE=1 / MAX_NON_PRESET_STATIONS=1 safety invariants) — the point of
// this run is to find out what that costs in TIME, and what the real peak memory looks like, not
// to prototype a parallelized architecture yet.
//
// Merge policy for overlapping station coverage: max dBZ wins at each absolute grid cell, but a
// null (filtered/no-echo) value never overwrites a real value from a station that already covered
// that cell, only fills a genuinely unclaimed cell.
//
// Usage: npm run mosaic:prototype -- [OUT_PATH]  (defaults to /tmp/mosaic-prototype.png)
import fs from "node:fs";
import { getRadarSite } from "../src/site.js";
import { getVolumeCached, extractLowestElevation } from "../src/level2.js";
import { computeReflectivityGrid, buildCandidateCells, cellsToGrid, boundsOf, mergeReflectivityCells } from "../src/project.js";
import { renderMrmsGridToDataUrl } from "../src/render.js";
import type { MrmsPoint } from "../src/types.js";

// GA-core Southeast mosaic: GA's own three sites plus the nearest site in each bordering state.
// Not the full ~18-20 site "whole neighboring states" version discussed as the eventual production
// scope — this is the minimum real multi-state composite needed to get an honest per-station
// time/memory measurement plus a real merged-coverage visual to look at.
const STATIONS = [
  "KFFC", // Atlanta/Peachtree City, GA
  "KJGX", // Robins AFB/Macon, GA
  "KVAX", // Moody AFB/Valdosta, GA
  "KBMX", // Birmingham, AL
  "KCAE", // Columbia, SC
  "KTLH", // Tallahassee, FL
];

const GRID_STEP_DEG = 0.006; // same resolution as production (server.ts)
const MAX_RANGE_KM = 230; // same range as production (server.ts)
const OUT = process.argv[2] ?? "/tmp/mosaic-prototype.png";
const MEMORY_SAMPLE_MS = 500;

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

async function main() {
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
  }, MEMORY_SAMPLE_MS);

  const merged = new Map<string, number | null>();
  const perStation: { station: string; ms: number; cells: number; rssAfter: number }[] = [];
  const runStart = performance.now();

  for (const station of STATIONS) {
    const stationStart = performance.now();
    const rssBefore = process.memoryUsage().rss;
    console.log(`[${station}] starting — RSS before: ${mb(rssBefore)}`);

    const site = await getRadarSite(station);
    const { radar } = await getVolumeCached(station);
    const reflectivity = extractLowestElevation(radar, "reflectivity");
    let correlationCoefficient;
    try {
      correlationCoefficient = extractLowestElevation(radar, "correlationCoefficient");
    } catch {
      correlationCoefficient = undefined;
    }
    const candidateCells = buildCandidateCells(site, GRID_STEP_DEG, MAX_RANGE_KM);
    const { grid } = computeReflectivityGrid(reflectivity, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells);

    mergeReflectivityCells(merged, grid, GRID_STEP_DEG);

    const elapsedMs = performance.now() - stationStart;
    const rssAfter = process.memoryUsage().rss;
    if (rssAfter > peakRss) peakRss = rssAfter;
    perStation.push({ station, ms: elapsedMs, cells: grid.length, rssAfter });
    console.log(`[${station}] done in ${(elapsedMs / 1000).toFixed(1)}s — ${grid.length} candidate cells, RSS after: ${mb(rssAfter)}`);
  }

  clearInterval(sampler);
  const totalMs = performance.now() - runStart;

  const mergedPoints: MrmsPoint[] = cellsToGrid(merged, GRID_STEP_DEG);
  const nonNullCount = mergedPoints.filter((p) => p.dbz !== null).length;
  const bounds = boundsOf(mergedPoints);

  console.log(`\nCompositing ${mergedPoints.length} merged cells (${nonNullCount} with signal) into final image...`);
  const renderStart = performance.now();
  const dataUrl = renderMrmsGridToDataUrl(mergedPoints, bounds, GRID_STEP_DEG);
  const renderMs = performance.now() - renderStart;
  if (!dataUrl) {
    console.error("render returned null (no cells in range?)");
    process.exit(1);
  }
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(OUT, Buffer.from(base64, "base64"));

  const width = Math.round((bounds.maxLongitude - bounds.minLongitude) / GRID_STEP_DEG) + 1;
  const height = Math.round((bounds.maxLatitude - bounds.minLatitude) / GRID_STEP_DEG) + 1;

  console.log(`\n=== Southeast mosaic prototype — ${STATIONS.length} stations, sequential ===`);
  console.table(perStation.map((s) => ({ station: s.station, seconds: (s.ms / 1000).toFixed(1), cells: s.cells, rssAfter: mb(s.rssAfter) })));
  console.log(`Composite image: ${width}x${height}px (${GRID_STEP_DEG}deg grid, ${MAX_RANGE_KM}km range per site)`);
  console.log(`Render+encode: ${(renderMs / 1000).toFixed(1)}s`);
  console.log(`TOTAL wall time (decode+compute, all ${STATIONS.length} stations, sequential): ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`PEAK RSS observed during run: ${mb(peakRss)}`);
  console.log(`Wrote ${OUT}`);
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
