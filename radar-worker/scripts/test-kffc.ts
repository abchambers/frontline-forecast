import { getRadarSite } from "../src/site.js";
import { getVolumeCached, extractLowestElevation } from "../src/level2.js";
import { computeReflectivityGrid } from "../src/project.js";

const STATION_ID = process.argv[2] ?? "KFFC";
const GRID_STEP_DEG = 0.01;
const MAX_RANGE_KM = 230;

async function main() {
  console.log(`Resolving site coordinates for ${STATION_ID}...`);
  const site = await getRadarSite(STATION_ID);
  console.log(`  ${site.name} (${site.id}): ${site.latitude}, ${site.longitude}, ${site.elevationMeters}m`);

  console.log("Fetching + parsing latest Level II volume...");
  const { key, lastModified, radar } = await getVolumeCached(STATION_ID);
  console.log(`  ${key} (last modified ${lastModified})`);
  const ageMinutes = (Date.now() - new Date(lastModified).getTime()) / 60_000;
  console.log(`  age: ${ageMinutes.toFixed(1)} minutes`);

  console.log("Decoding lowest reflectivity elevation...");
  const reflectivity = await extractLowestElevation(radar, "reflectivity", STATION_ID);
  console.log(`  elevation ${reflectivity.elevationDeg.toFixed(2)}deg, ${reflectivity.radials.length} radials`);

  let correlationCoefficient;
  try {
    correlationCoefficient = await extractLowestElevation(radar, "correlationCoefficient", STATION_ID);
    console.log(`  correlation coefficient present: ${correlationCoefficient.radials.length} radials`);
  } catch {
    console.log("  correlation coefficient not present in this volume");
  }

  console.log(`Sampling (gather-mapped, ${GRID_STEP_DEG}deg step, ${MAX_RANGE_KM}km range)...`);
  const { grid, bounds, qualityControl } = computeReflectivityGrid(reflectivity, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient);
  const withEcho = grid.filter((p) => p.dbz !== null);
  const dbzValues = withEcho.map((p) => p.dbz as number);
  console.log(`  quality control: ${qualityControl}`);
  console.log(`  ${grid.length} grid cells, ${withEcho.length} with signal`);
  if (dbzValues.length) {
    console.log(`  dBZ range: ${Math.min(...dbzValues).toFixed(1)} to ${Math.max(...dbzValues).toFixed(1)}`);
  }
  console.log(`  bounds: lat ${bounds.minLatitude.toFixed(3)}-${bounds.maxLatitude.toFixed(3)}, lon ${bounds.minLongitude.toFixed(3)}-${bounds.maxLongitude.toFixed(3)}`);

  printAsciiHeatmap(grid, bounds);
}

// Quick spatial-coherence sanity check: render a coarse ASCII heatmap. Real
// storm cells should appear as contiguous blobs, not scattered noise.
function printAsciiHeatmap(grid: { lat: number; lon: number; dbz: number | null }[], bounds: { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number }) {
  const cols = 100;
  const rows = 45;
  const cellLat = (bounds.maxLatitude - bounds.minLatitude) / rows;
  const cellLon = (bounds.maxLongitude - bounds.minLongitude) / cols;
  const canvas: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-Infinity));

  for (const p of grid) {
    if (p.dbz === null) continue;
    const row = rows - 1 - Math.min(rows - 1, Math.floor((p.lat - bounds.minLatitude) / cellLat));
    const col = Math.min(cols - 1, Math.floor((p.lon - bounds.minLongitude) / cellLon));
    if (p.dbz > canvas[row][col]) canvas[row][col] = p.dbz;
  }

  const ramp = " .:-=+*#%@";
  console.log("\nASCII heatmap (blank=no data, denser char=higher dBZ):");
  for (const row of canvas) {
    console.log(
      row
        .map((v) => {
          if (v === -Infinity) return " ";
          const t = Math.max(0, Math.min(1, v / 60));
          return ramp[Math.floor(t * (ramp.length - 1))];
        })
        .join(""),
    );
  }
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
