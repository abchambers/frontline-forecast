// Real-evidence check, 2026-09-03: before optimizing project.ts's FlatGrid storage format, verify
// it's actually where the memory goes. Hypothesis to test: is the documented "~800MB+ RSS per
// volume" (level2.ts's own comment) mostly the raw decoded Level2Radar object (nexrad-level-2-data's
// own internal representation, NOT something this app's code controls the format of), or this app's
// own FlatGrid/CandidateGrid Float32Arrays built on top of it? That determines whether an
// Int16Array conversion in project.ts would meaningfully help the STEADY-STATE cache ceiling found
// live tonight, or only reduce transient per-request working memory.
import { getRadarSite } from "../src/site.js";
import { getVolumeCached, extractLowestElevation } from "../src/level2.js";
import { computeReflectivityGrid, buildCandidateCells } from "../src/project.js";

const STATION_ID = process.argv[2] ?? "KFFC";
const GRID_STEP_DEG = 0.004;
const MAX_RANGE_KM = 460;

function heapSnapshot(label: string) {
  if (global.gc) global.gc();
  const mem = process.memoryUsage();
  console.log(`[${label}] rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB external=${(mem.external / 1024 / 1024).toFixed(1)}MB arrayBuffers=${(mem.arrayBuffers / 1024 / 1024).toFixed(1)}MB`);
}

async function main() {
  heapSnapshot("baseline");

  const site = await getRadarSite(STATION_ID);
  const { radar } = await getVolumeCached(STATION_ID);
  heapSnapshot("after decode (raw Level2Radar object alive)");

  const elevation = await extractLowestElevation(radar, "reflectivity", STATION_ID);
  let correlationCoefficient;
  try {
    correlationCoefficient = await extractLowestElevation(radar, "correlationCoefficient", STATION_ID);
  } catch {
    correlationCoefficient = undefined;
  }
  heapSnapshot("after extractLowestElevation (still holding radar + extracted radials)");

  const candidateCells = buildCandidateCells(site, GRID_STEP_DEG, MAX_RANGE_KM);
  heapSnapshot("after buildCandidateCells (geometry cache built, radar still alive)");

  const { grid } = computeReflectivityGrid(elevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells);
  heapSnapshot("after computeReflectivityGrid (FlatGrid built, radar still alive)");

  console.log(`\nFinal grid: ${grid.length} points`);

  // Now drop the raw radar object and candidate cells, keep only the final small MrmsPoint[] array,
  // to isolate what "the FlatGrid/CandidateGrid working set" alone would cost if the raw decoded
  // object were released promptly instead of cached for 90-300s.
  (global as any).__radar = undefined;
  (global as any).__candidateCells = undefined;
  heapSnapshot("after nulling local refs (radar/candidateCells still reachable via closures/cache though)");
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
