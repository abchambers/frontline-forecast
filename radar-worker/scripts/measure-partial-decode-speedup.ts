// Real before/after measurement, 2026-09-03: full decode vs partial decode, same real live
// volumes, timing AND memory (RSS), not just the theoretical gate-count estimate from earlier.
import pkg from "nexrad-level-2-data";
const { Level2Radar } = pkg;
import { fetchWithTimeout } from "../src/fetch-with-timeout.js";
import { parsePartialVolume } from "../src/partial-level2-parser.js";

const STATIONS = process.argv.slice(2).length ? process.argv.slice(2) : ["KFFC", "KBMX", "KMPX"];
const MAX_ELEVATION_FOR_PARTIAL_DECODE = 3;

const ARCHIVE_BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com";
function datePrefix(date: Date, stationId: string): string {
  const yyyy = date.getUTCFullYear(), mm = String(date.getUTCMonth() + 1).padStart(2, "0"), dd = String(date.getUTCDate()).padStart(2, "0");
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
  const now = new Date(), yesterday = new Date(now.getTime() - 86400000);
  const [today, prior] = await Promise.all([listVolumes(datePrefix(now, stationId)), listVolumes(datePrefix(yesterday, stationId))]);
  const all = [...prior, ...today].filter((o) => /_V0[0-9]$/.test(o.key)).sort((a, b) => a.lastModified.localeCompare(b.lastModified));
  const latest = all[all.length - 1];
  const response = await fetchWithTimeout(`${ARCHIVE_BUCKET}/${latest.key}`, { cache: "no-store" }, 20_000);
  return Buffer.from(await response.arrayBuffer());
}

function rss() {
  if (global.gc) global.gc();
  return process.memoryUsage().rss / 1024 / 1024;
}

async function measure(station: string) {
  const buffer = await fetchLatestVolumeBuffer(station);

  const rssBeforeFull = rss();
  const t0 = performance.now();
  const fullRadar = await new Level2Radar(buffer);
  const fullMs = performance.now() - t0;
  const rssAfterFull = rss();

  const t1 = performance.now();
  const partial = parsePartialVolume(buffer, MAX_ELEVATION_FOR_PARTIAL_DECODE, { logger: false });
  const partialRadar = await new Level2Radar(partial as any);
  const partialMs = performance.now() - t1;
  const rssAfterPartial = rss();

  console.log(`${station}: full decode ${fullMs.toFixed(0)}ms (rss +${(rssAfterFull - rssBeforeFull).toFixed(0)}MB), partial decode ${partialMs.toFixed(0)}ms (rss +${(rssAfterPartial - rssAfterFull).toFixed(0)}MB) -- ${((1 - partialMs / fullMs) * 100).toFixed(0)}% faster`);
  void fullRadar;
  void partialRadar;
}

async function main() {
  for (const station of STATIONS) {
    try {
      await measure(station);
    } catch (error) {
      console.error(`${station} FAILED:`, error instanceof Error ? error.message : error);
    }
  }
}
main();
