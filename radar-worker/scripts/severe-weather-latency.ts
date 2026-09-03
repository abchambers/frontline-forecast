// Measures REAL decode+compute time on genuine severe-weather volumes, to close the gap the
// mosaic prototype (mosaic-prototype.ts) explicitly left open: that run was calm weather, and
// level2.ts's own comments document that a severe-weather VCP's eager full-volume parse measured
// 60-210+ SECONDS in a real past production incident, independent of this app's own grid
// resolution. This script fetches real historical Level II volumes from a well-documented extreme
// event (the April 27, 2011 Super Outbreak, which hit KBMX/KHTX directly) from the same public
// archive bucket the production worker already reads from, and times the exact same decode+sample
// path production uses (extractLowestElevation + computeReflectivityGrid), station by station —
// not the "latest" convenience path level2.ts's getVolumeCached uses, since historical volumes
// need an explicit date/key, not "most recent".
//
// Usage: npm run severe:latency
import zlib from "node:zlib";
import pkg from "nexrad-level-2-data";
import { getRadarSite } from "../src/site.js";
import { extractLowestElevation } from "../src/level2.js";
import { computeReflectivityGrid, buildCandidateCells } from "../src/project.js";
const { Level2Radar } = pkg;

const ARCHIVE_BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com";
const GRID_STEP_DEG = 0.006;
const MAX_RANGE_KM = 230;

// Real archived volumes confirmed present via a live S3 listing against this same bucket
// (2026-08-29) — not guessed filenames.
//
// IMPORTANT, found the hard way: an initial version of this script used 2011 Super Outbreak
// volumes (KBMX/KHTX, April 27 2011) and measured them decoding in ~1.4-1.5s — FASTER than the
// calm-weather baseline, seemingly contradicting level2.ts's documented 60-210+ second production
// incident. That result was a confound, not an answer: April 2011 predates most Southeast WSR-88D
// dual-pol upgrades, so those volumes carry only the 3 legacy moments (reflectivity/velocity/
// spectrum width) instead of today's 6 dual-pol moments per radial — a fundamentally lighter parse
// unrelated to how severe the actual weather was. Kept below as LEGACY_VOLUMES for the record, but
// the real comparison uses two MODERN (dual-pol, V06) events instead, matching the format that
// actually produced the original 60-210s incident: KFFC ~08:08 UTC 2021-03-26 (Newnan, GA EF4
// tornado — directly under this station's own coverage) and KBMX ~22:28 UTC 2021-03-25 (same
// outbreak system, earlier in Alabama).
const SEVERE_VOLUMES = [
  { station: "KFFC", key: "2021/03/26/KFFC/KFFC20210326_080814_V06", event: "2021-03-26 outbreak — Newnan, GA EF4 tornado" },
  { station: "KBMX", key: "2021/03/25/KBMX/KBMX20210325_222841_V06", event: "2021-03-25 outbreak — central Alabama, same storm system" },
];
const LEGACY_VOLUMES = [
  { station: "KBMX", key: "2011/04/27/KBMX/KBMX20110427_221945_V03.gz", event: "2011 Super Outbreak (PRE-DUAL-POL, not representative)" },
];

// For direct comparison, this app's own calm-weather baseline already measured for KBMX in the
// mosaic prototype run (2026-08-29, this same machine): 12.7s.
const CALM_WEATHER_KBMX_SECONDS = 12.7;

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

async function fetchArchivedVolume(key: string): Promise<Buffer> {
  const response = await fetch(`${ARCHIVE_BUCKET}/${key}`);
  if (!response.ok) throw new Error(`Failed to download ${key} (${response.status})`);
  const raw = Buffer.from(await response.arrayBuffer());
  return key.endsWith(".gz") ? zlib.gunzipSync(raw) : raw;
}

type VolumeResult = { station: string; event: string; downloadMs: number; parseMs: number; sampleMs: number; totalMs: number; rssAfter: number };

async function runVolumes(volumes: { station: string; key: string; event: string }[], trackPeak: (rss: number) => void): Promise<VolumeResult[]> {
  const results: VolumeResult[] = [];
  for (const { station, key, event } of volumes) {
    console.log(`\n[${station}] fetching: ${key}`);
    const t0 = performance.now();
    const buffer = await fetchArchivedVolume(key);
    const t1 = performance.now();
    console.log(`[${station}] downloaded+decompressed ${mb(buffer.length)} in ${((t1 - t0) / 1000).toFixed(1)}s — now parsing...`);

    const radar = await new Level2Radar(buffer);
    const t2 = performance.now();
    console.log(`[${station}] parse complete in ${((t2 - t1) / 1000).toFixed(1)}s`);

    const site = await getRadarSite(station);
    const reflectivity = await extractLowestElevation(radar, "reflectivity", station);
    let correlationCoefficient;
    try {
      correlationCoefficient = await extractLowestElevation(radar, "correlationCoefficient", station);
    } catch {
      correlationCoefficient = undefined;
    }
    const candidateCells = buildCandidateCells(site, GRID_STEP_DEG, MAX_RANGE_KM);
    computeReflectivityGrid(reflectivity, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells);
    const t3 = performance.now();

    const rssAfter = process.memoryUsage().rss;
    trackPeak(rssAfter);
    results.push({ station, event, downloadMs: t1 - t0, parseMs: t2 - t1, sampleMs: t3 - t2, totalMs: t3 - t0, rssAfter });
    console.log(`[${station}] sample+grid in ${((t3 - t2) / 1000).toFixed(1)}s — TOTAL ${((t3 - t0) / 1000).toFixed(1)}s, RSS after: ${mb(rssAfter)}`);
  }
  return results;
}

function printTable(label: string, results: VolumeResult[]) {
  console.log(`\n=== ${label} ===`);
  console.table(results.map((r) => ({
    station: r.station,
    event: r.event,
    "download(s)": (r.downloadMs / 1000).toFixed(1),
    "parse(s)": (r.parseMs / 1000).toFixed(1),
    "sample(s)": (r.sampleMs / 1000).toFixed(1),
    "TOTAL(s)": (r.totalMs / 1000).toFixed(1),
    rssAfter: mb(r.rssAfter),
  })));
}

async function main() {
  let peakRss = process.memoryUsage().rss;
  const sampler = setInterval(() => {
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
  }, 250);
  const trackPeak = (rss: number) => { if (rss > peakRss) peakRss = rss; };

  const modernResults = await runVolumes(SEVERE_VOLUMES, trackPeak);
  const legacyResults = await runVolumes(LEGACY_VOLUMES, trackPeak);

  clearInterval(sampler);

  printTable("MODERN dual-pol severe-weather volumes (real comparison)", modernResults);
  printTable("Legacy pre-dual-pol volume, for reference only — NOT representative of today's format", legacyResults);
  console.log(`\nPEAK RSS observed during run: ${mb(peakRss)}`);

  console.log(`\nFor direct comparison — this same station (KBMX), calm weather, same machine: ${CALM_WEATHER_KBMX_SECONDS}s total (mosaic-prototype.ts, 2026-08-29).`);
  const kbmxModern = modernResults.find((r) => r.station === "KBMX");
  if (kbmxModern) {
    const ratio = kbmxModern.totalMs / 1000 / CALM_WEATHER_KBMX_SECONDS;
    console.log(`KBMX modern severe-weather volume took ${ratio.toFixed(1)}x the calm-weather baseline for the SAME station.`);
  }
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
