// THE critical correctness check before trusting the partial-decode optimization in production,
// 2026-09-03: decode the same real, live volume TWO ways -- the new partial path (what
// getVolumeCached now does by default) and the original full path -- and diff the actual
// extractLowestElevation() results value-for-value, not just "did it run without erroring."
// A silent wrong answer here would mean wrong radar data reaching real users.
import pkg from "nexrad-level-2-data";
const { Level2Radar } = pkg;
import { fetchWithTimeout } from "../src/fetch-with-timeout.js";
import { parsePartialVolume } from "../src/partial-level2-parser.js";

const STATIONS = process.argv.slice(2).length ? process.argv.slice(2) : ["KFFC", "KBMX", "KMPX", "KGSP", "KJGX"];
const MAX_ELEVATION_FOR_PARTIAL_DECODE = 3;

const ARCHIVE_BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com";
function datePrefix(date: Date, stationId: string): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${stationId}/`;
}
async function listVolumes(prefix: string) {
  const response = await fetchWithTimeout(`${ARCHIVE_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`, { cache: "no-store" });
  const xml = await response.text();
  const objects: { key: string; lastModified: string }[] = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while ((m = re.exec(xml))) {
    const key = /<Key>(.*?)<\/Key>/.exec(m[1])?.[1];
    const lastModified = /<LastModified>(.*?)<\/LastModified>/.exec(m[1])?.[1];
    if (key && lastModified) objects.push({ key, lastModified });
  }
  return objects;
}
async function fetchLatestVolumeBuffer(stationId: string): Promise<Buffer> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const [today, prior] = await Promise.all([listVolumes(datePrefix(now, stationId)), listVolumes(datePrefix(yesterday, stationId))]);
  const all = [...prior, ...today].filter((o) => /_V0[0-9]$/.test(o.key)).sort((a, b) => a.lastModified.localeCompare(b.lastModified));
  const latest = all[all.length - 1];
  const response = await fetchWithTimeout(`${ARCHIVE_BUCKET}/${latest.key}`, { cache: "no-store" }, 20_000);
  return Buffer.from(await response.arrayBuffer());
}

function extractRaw(radar: any, moment: "reflectivity" | "velocity" | "correlationCoefficient") {
  for (const elevation of radar.listElevations()) {
    radar.setElevation(elevation);
    const scans = radar.getScans();
    const allCC = moment === "correlationCoefficient" ? radar.getHighresCorrelationCoefficient() : null;
    const radials: { azimuthDeg: number; values: (number | null)[] }[] = [];
    let sawMoment = false;
    for (let scan = 0; scan < scans; scan += 1) {
      const azimuth = radar.getAzimuth(scan);
      const data = moment === "reflectivity" ? radar.getHighresReflectivity(scan) : moment === "velocity" ? radar.getHighresVelocity(scan) : allCC?.[scan];
      if (!data || !data.name) continue;
      sawMoment = true;
      radials.push({ azimuthDeg: azimuth, values: data.moment_data.map((v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null)) });
    }
    if (sawMoment && radials.length > 0) return { elevationDeg: radar.getHeader(0).elevation_angle ?? elevation, radials };
  }
  return null;
}

function deepEqualResult(a: any, b: any): string | null {
  if (!a && !b) return null;
  if (!a || !b) return `one is null, the other isn't (a=${!!a}, b=${!!b})`;
  if (a.elevationDeg !== b.elevationDeg) return `elevationDeg differs: ${a.elevationDeg} vs ${b.elevationDeg}`;
  if (a.radials.length !== b.radials.length) return `radial count differs: ${a.radials.length} vs ${b.radials.length}`;
  for (let i = 0; i < a.radials.length; i += 1) {
    const ra = a.radials[i];
    const rb = b.radials[i];
    if (ra.azimuthDeg !== rb.azimuthDeg) return `radial ${i} azimuth differs: ${ra.azimuthDeg} vs ${rb.azimuthDeg}`;
    if (ra.values.length !== rb.values.length) return `radial ${i} gate count differs: ${ra.values.length} vs ${rb.values.length}`;
    for (let g = 0; g < ra.values.length; g += 1) {
      if (ra.values[g] !== rb.values[g]) return `radial ${i} gate ${g} value differs: ${ra.values[g]} vs ${rb.values[g]}`;
    }
  }
  return null;
}

async function checkStation(station: string) {
  console.log(`\n=== ${station} ===`);
  const buffer = await fetchLatestVolumeBuffer(station);

  const fullRadar = await new Level2Radar(buffer);
  const partial = parsePartialVolume(buffer, MAX_ELEVATION_FOR_PARTIAL_DECODE, { logger: false });
  const partialRadar = await new Level2Radar(partial as any);

  console.log(`  VCP: full=${fullRadar.vcp?.record?.pattern_number} partial=${partialRadar.vcp?.record?.pattern_number} (must match)`);
  console.log(`  elevations: full=${fullRadar.listElevations().length} partial=${partialRadar.listElevations().length} (partial should be <= full)`);
  console.log(`  partial stoppedEarly: ${partial.stoppedEarly}`);

  let allPassed = true;
  for (const moment of ["reflectivity", "correlationCoefficient", "velocity"] as const) {
    const fullResult = extractRaw(fullRadar, moment);
    const partialResult = extractRaw(partialRadar, moment);
    const diff = deepEqualResult(fullResult, partialResult);
    if (diff) {
      console.log(`  ${moment}: MISMATCH -- ${diff}`);
      allPassed = false;
    } else if (!fullResult) {
      console.log(`  ${moment}: both absent (consistent)`);
    } else {
      console.log(`  ${moment}: IDENTICAL (${fullResult.radials.length} radials, elevation ${fullResult.elevationDeg.toFixed(2)}deg)`);
    }
  }
  return allPassed;
}

async function main() {
  const results: boolean[] = [];
  for (const station of STATIONS) {
    try {
      results.push(await checkStation(station));
    } catch (error) {
      console.error(`  FAILED: ${error instanceof Error ? error.message : error}`);
      results.push(false);
    }
  }
  console.log(`\n=== Summary: ${results.filter(Boolean).length}/${results.length} stations fully identical ===`);
  if (!results.every(Boolean)) process.exit(1);
}

main();
