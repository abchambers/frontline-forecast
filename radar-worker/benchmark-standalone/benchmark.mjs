// Standalone NEXRAD decode benchmark — 2026-09-02.
//
// Purpose: answer one real question before touching any networking or production setup — does a
// given machine's CPU decode a real NEXRAD Level II volume meaningfully faster than the radar
// worker's current Fly.io box? That box is a "shared-cpu-1x" tier (a throttled, fractional vCPU
// share), and this app's own decode step (new Level2Radar(buffer), from the nexrad-level-2-data
// library) is single-threaded, CPU-bound, and eagerly parses the ENTIRE volume regardless of what's
// actually used afterward — a real, already-documented cost that measured 60-210+ seconds during
// active severe weather on that box. Concurrency/scheduling fixes can't touch that number; only
// faster real CPU can. This script measures it directly and honestly, no guessing.
//
// Deliberately standalone — no dependency on the rest of this repo, just this one folder, so it's
// trivial to copy to any machine (Windows laptop, another Mac, etc) and run. Mirrors the REAL
// fetch/decode logic from radar-worker/src/level2.ts exactly (same S3 archive, same "find the
// latest standard volume" logic) so the numbers are directly comparable to real production numbers,
// not a synthetic approximation.
import { Level2Radar } from "nexrad-level-2-data";

const ARCHIVE_BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com";

// A handful of real, active stations by default — pass your own on the command line instead, e.g.:
//   node benchmark.mjs KMPX KARX
const STATIONS = process.argv.slice(2).length ? process.argv.slice(2) : ["KFFC", "KBMX", "KMPX"];

function datePrefix(date, stationId) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${stationId}/`;
}

async function listVolumes(prefix) {
  const url = `${ARCHIVE_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`S3 list failed for ${prefix} (${response.status})`);
  const xml = await response.text();
  const objects = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;
  while ((match = contentsRegex.exec(xml))) {
    const block = match[1];
    const key = /<Key>(.*?)<\/Key>/.exec(block)?.[1];
    const lastModified = /<LastModified>(.*?)<\/LastModified>/.exec(block)?.[1];
    if (key && lastModified) objects.push({ key, lastModified });
  }
  return objects;
}

// Same "check yesterday's folder too" logic as level2.ts, for a volume that landed right at UTC
// midnight, and the same "_V0<digit> only, no _MDM status messages" filter.
async function fetchLatestVolume(stationId) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [today, prior] = await Promise.all([
    listVolumes(datePrefix(now, stationId)),
    listVolumes(datePrefix(yesterday, stationId)),
  ]);
  const standardVolume = /_V0[0-9]$/;
  const all = [...prior, ...today]
    .filter((object) => standardVolume.test(object.key))
    .sort((a, b) => a.lastModified.localeCompare(b.lastModified));
  const latest = all[all.length - 1];
  if (!latest) throw new Error(`No Level II volumes found for ${stationId} in the last two days.`);

  const t0 = performance.now();
  const response = await fetch(`${ARCHIVE_BUCKET}/${latest.key}`);
  if (!response.ok) throw new Error(`Failed to download ${latest.key} (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const fetchMs = performance.now() - t0;
  return { buffer, key: latest.key, lastModified: latest.lastModified, fetchMs };
}

async function benchmarkStation(station) {
  console.log(`\n=== ${station} ===`);
  const { buffer, key, lastModified, fetchMs } = await fetchLatestVolume(station);
  const ageMin = (Date.now() - new Date(lastModified).getTime()) / 60_000;
  console.log(`  volume: ${key}`);
  console.log(`  size: ${(buffer.length / 1024 / 1024).toFixed(2)} MB, ${ageMin.toFixed(1)} min old`);
  console.log(`  download: ${fetchMs.toFixed(0)}ms`);

  // THE number that matters — this is the exact call that's measured 60-210+ seconds on the Fly
  // box during active severe weather. Run twice: once cold, once again to see if anything about
  // this machine's JIT/caching changes the number on a repeat (shouldn't matter much for a single
  // one-shot decode, but worth seeing).
  const t0 = performance.now();
  const radar = new Level2Radar(buffer, { logger: false });
  const decodeMs = performance.now() - t0;
  console.log(`  decode (the real bottleneck): ${decodeMs.toFixed(0)}ms`);
  console.log(`  VCP: ${radar.vcp?.record?.pattern_number ?? "unknown"}, elevations in volume: ${radar.listElevations().length}`);
  return { station, fetchMs, decodeMs };
}

async function main() {
  console.log(`Node ${process.version} on ${process.platform} ${process.arch}, ${new Date().toISOString()}`);
  const results = [];
  for (const station of STATIONS) {
    try {
      results.push(await benchmarkStation(station));
    } catch (error) {
      console.error(`  FAILED: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (!results.length) {
    console.log("\nNo stations succeeded — check your internet connection and try again.");
    return;
  }
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`${r.station}: download ${r.fetchMs.toFixed(0)}ms, decode ${r.decodeMs.toFixed(0)}ms, total ${(r.fetchMs + r.decodeMs).toFixed(0)}ms`);
  }
  const avgDecode = results.reduce((sum, r) => sum + r.decodeMs, 0) / results.length;
  console.log(`\nAverage decode time this machine: ${avgDecode.toFixed(0)}ms`);
  console.log(`For reference, the Fly.io worker's documented worst case during active severe weather: 60,000-210,000ms.`);
}

main();
