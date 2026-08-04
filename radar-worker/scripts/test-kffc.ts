import { getRadarSite } from "../src/site.js";
import { fetchLatestVolume, decodeLowestElevation } from "../src/level2.js";
import { projectElevation, resampleToGrid } from "../src/project.js";

const STATION_ID = process.argv[2] ?? "KFFC";
const GRID_STEP_DEG = 0.01; // ~1.1km — much finer than GribStream's 0.05deg MRMS grid, closer to native Level II resolution.

async function main() {
  console.log(`Resolving site coordinates for ${STATION_ID}...`);
  const site = await getRadarSite(STATION_ID);
  console.log(`  ${site.name} (${site.id}): ${site.latitude}, ${site.longitude}, ${site.elevationMeters}m`);

  console.log("Fetching latest Level II volume...");
  const { key, lastModified, buffer } = await fetchLatestVolume(STATION_ID);
  console.log(`  ${key} (${buffer.length} bytes, last modified ${lastModified})`);
  const ageMinutes = (Date.now() - new Date(lastModified).getTime()) / 60_000;
  console.log(`  age: ${ageMinutes.toFixed(1)} minutes`);

  console.log("Decoding lowest reflectivity elevation...");
  const reflectivity = await decodeLowestElevation(buffer, "reflectivity");
  console.log(`  elevation ${reflectivity.elevationDeg.toFixed(2)}deg, ${reflectivity.radials.length} radials`);

  console.log("Decoding lowest velocity elevation...");
  const velocity = await decodeLowestElevation(buffer, "velocity");
  console.log(`  elevation ${velocity.elevationDeg.toFixed(2)}deg, ${velocity.radials.length} radials`);

  console.log("Projecting reflectivity to lat/lon...");
  const reflectivityPoints = projectElevation(reflectivity, site);
  console.log(`  ${reflectivityPoints.length} raw polar points`);

  console.log(`Resampling to a regular ${GRID_STEP_DEG}deg grid...`);
  const { grid, bounds } = resampleToGrid(reflectivityPoints, GRID_STEP_DEG);
  const withEcho = grid.filter((p) => p.dbz !== null && p.dbz > 2);
  const dbzValues = withEcho.map((p) => p.dbz as number);
  console.log(`  ${grid.length} grid cells, ${withEcho.length} with meaningful echo (>2 dBZ)`);
  if (dbzValues.length) {
    console.log(`  dBZ range: ${Math.min(...dbzValues).toFixed(1)} to ${Math.max(...dbzValues).toFixed(1)}`);
  }
  console.log(`  bounds: lat ${bounds.minLatitude.toFixed(3)}-${bounds.maxLatitude.toFixed(3)}, lon ${bounds.minLongitude.toFixed(3)}-${bounds.maxLongitude.toFixed(3)}`);

  // Sanity check: the radar site itself must fall inside the projected bounds.
  const siteInBounds =
    site.latitude >= bounds.minLatitude &&
    site.latitude <= bounds.maxLatitude &&
    site.longitude >= bounds.minLongitude &&
    site.longitude <= bounds.maxLongitude;
  console.log(`  site coordinates fall within projected bounds: ${siteInBounds}`);

  console.log("\nPayload shape (matches src/lib/mrms-render.ts GridPoint/Bounds):");
  console.log(JSON.stringify({ bounds, step: GRID_STEP_DEG, samplePoints: grid.slice(0, 3) }, null, 2));

  printAsciiHeatmap(grid, bounds);
}

// Quick spatial-coherence sanity check: render a coarse ASCII heatmap. Real
// storm cells should appear as contiguous blobs, not scattered noise — if
// resampleToGrid had an indexing bug, this would look like static.
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
