// Real-evidence research spike, 2026-09-03: nexrad-level-2-data's parseData() (see node_modules/
// nexrad-level-2-data/src/parsedata.js) loops through EVERY message in the file and fully decodes
// every elevation/moment before this app ever calls extractLowestElevation() to pick out just the
// one or two it actually uses. Question: how much of the total per-scan data volume would a
// hypothetical early-exit (stop once the lowest 1-2 elevations are collected, since NEXRAD VCPs
// scan lowest-to-highest) actually skip? Real per-elevation scan counts, not a guess.
import { getVolumeCached } from "../src/level2.js";

const STATION_ID = process.argv[2] ?? "KFFC";

async function main() {
  const { radar } = await getVolumeCached(STATION_ID);
  const elevations = radar.listElevations();
  console.log(`VCP: ${radar.vcp?.record?.pattern_number}, total elevations in volume: ${elevations.length}`);

  let totalScans = 0;
  let totalGatesAllMoments = 0;
  const perElevation: { elevation: number; scans: number; gates: number }[] = [];

  for (const elevation of elevations) {
    radar.setElevation(elevation);
    const scans = radar.getScans();
    let gates = 0;
    for (let scan = 0; scan < scans; scan += 1) {
      const refl = radar.getHighresReflectivity(scan);
      if (refl?.moment_data) gates += refl.moment_data.length;
    }
    perElevation.push({ elevation, scans, gates });
    totalScans += scans;
    totalGatesAllMoments += gates;
  }

  console.log("\nPer-elevation breakdown (reflectivity moment only, real gate counts):");
  for (const e of perElevation) {
    console.log(`  elevation ${e.elevation}: ${e.scans} scans, ${e.gates} total gates`);
  }

  const lowestOneElevation = perElevation[0];
  const lowestTwoElevations = perElevation.slice(0, 2).reduce((sum, e) => sum + e.gates, 0);
  console.log(`\nTotal gates across ALL ${elevations.length} elevations: ${totalGatesAllMoments}`);
  console.log(`Gates in just the lowest 1 elevation: ${lowestOneElevation.gates} (${((lowestOneElevation.gates / totalGatesAllMoments) * 100).toFixed(1)}% of total)`);
  console.log(`Gates in just the lowest 2 elevations: ${lowestTwoElevations} (${((lowestTwoElevations / totalGatesAllMoments) * 100).toFixed(1)}% of total)`);
  console.log(`\nThis app's own extractLowestElevation only ever needs 1-2 elevations (reflectivity, optionally velocity+CC on a nearby tilt) out of all ${elevations.length} — the rest is fully decoded and held in memory for nothing this app uses.`);
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
