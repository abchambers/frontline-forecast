// Real-evidence check, 2026-09-03, BEFORE writing any early-exit decode patch: does raw NEXRAD
// message data actually arrive in ascending elevation order in the file, or does
// nexrad-level-2-data's groupAndSortScans() just make it LOOK sorted afterward regardless of true
// file order? An early-exit patch is only safe if elevations genuinely arrive in order — otherwise
// stopping "once we've seen elevation 2" could miss data if a later message in the file actually
// belongs to elevation 1, arriving out of order.
//
// Reaches into the library's internal (non-exported) parseData by requiring the module file
// directly and re-implementing just enough of its top-level loop to log raw message order —
// doesn't modify anything in node_modules, purely observational.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { RandomAccessFile, BIG_ENDIAN } = require("nexrad-level-2-data/src/classes/RandomAccessFile");
const { Level2Record } = require("nexrad-level-2-data/src/classes/Level2Record");
const decompress = require("nexrad-level-2-data/src/decompress");
const parseHeader = require("nexrad-level-2-data/src/parseheader");
const { RADAR_DATA_SIZE } = require("nexrad-level-2-data/src/constants");

const STATION_ID = process.argv[2] ?? "KFFC";

const ARCHIVE_BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com";
function datePrefix(date, stationId) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${stationId}/`;
}
async function listVolumes(prefix) {
  const response = await fetch(`${ARCHIVE_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`);
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
async function fetchLatestVolume(stationId) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [today, prior] = await Promise.all([listVolumes(datePrefix(now, stationId)), listVolumes(datePrefix(yesterday, stationId))]);
  const standardVolume = /_V0[0-9]$/;
  const all = [...prior, ...today].filter((o) => standardVolume.test(o.key)).sort((a, b) => a.lastModified.localeCompare(b.lastModified));
  const latest = all[all.length - 1];
  const response = await fetch(`${ARCHIVE_BUCKET}/${latest.key}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const buffer = await fetchLatestVolume(STATION_ID);
  const rafCompressed = new RandomAccessFile(buffer, BIG_ENDIAN);
  const raf = decompress(rafCompressed);
  const header = parseHeader(raf);

  let messageOffset31 = 0;
  let recordNumber = 0;
  let r;
  const sequence = [];
  const options = { logger: false };

  if (raf.getPos() < raf.getLength()) {
    do {
      try {
        r = Level2Record(raf, recordNumber, messageOffset31, header, options);
        recordNumber += 1;
      } catch (e) {
        r = { finished: true };
      }
      if (!r.finished) {
        if (r.message_type === 31) {
          const messageSize = r.actual_size ?? r.message_size;
          messageOffset31 += (messageSize * 2 + 12 - RADAR_DATA_SIZE);
          if (r.record?.reflect) {
            sequence.push(r.record.elevation_number);
          }
        }
      }
    } while (!r.finished);
  }

  console.log(`Station: ${STATION_ID}, total message-31 reflectivity records in FILE order: ${sequence.length}`);

  // Check: does elevation_number ever DECREASE as we move through the file? A single violation
  // means "elevations arrive in ascending order" is FALSE and any early-exit patch needs to handle
  // out-of-order arrival explicitly, not just "stop once N distinct elevations seen."
  let violations = 0;
  let maxSeenSoFar = -Infinity;
  const firstIndexOfElevation = new Map();
  for (let i = 0; i < sequence.length; i += 1) {
    const elevation = sequence[i];
    if (!firstIndexOfElevation.has(elevation)) firstIndexOfElevation.set(elevation, i);
    if (elevation < maxSeenSoFar) violations += 1;
    maxSeenSoFar = Math.max(maxSeenSoFar, elevation);
  }

  console.log(`\nDistinct elevations in FILE-ARRIVAL order (first appearance index): `);
  for (const [elevation, index] of firstIndexOfElevation) {
    console.log(`  elevation ${elevation}: first seen at record #${index} of ${sequence.length}`);
  }
  console.log(`\nOut-of-order violations (elevation number decreased compared to max seen so far): ${violations}`);
  if (violations === 0) {
    console.log("CONFIRMED: elevations arrive in monotonically non-decreasing order in this real file.");
  } else {
    console.log("WARNING: elevations do NOT arrive strictly in order -- an early-exit patch cannot safely assume this.");
  }

  // Also report: what fraction of the file (by record index) do we need to read to have seen the
  // lowest 1 and lowest 2 distinct elevations completely (i.e. up through the LAST record of that
  // elevation, not just the first)?
  const lowestElevation = Math.min(...firstIndexOfElevation.keys());
  const sortedElevations = [...firstIndexOfElevation.keys()].sort((a, b) => a - b);
  const secondLowest = sortedElevations[1];
  let lastIndexOfLowest = -1;
  let lastIndexOfSecondLowest = -1;
  sequence.forEach((elevation, i) => {
    if (elevation === lowestElevation) lastIndexOfLowest = i;
    if (elevation === secondLowest) lastIndexOfSecondLowest = i;
  });
  console.log(`\nLast record index belonging to elevation ${lowestElevation} (lowest): ${lastIndexOfLowest} of ${sequence.length} (${((lastIndexOfLowest / sequence.length) * 100).toFixed(1)}% through the file)`);
  console.log(`Last record index belonging to elevation ${secondLowest} (2nd lowest): ${lastIndexOfSecondLowest} of ${sequence.length} (${((lastIndexOfSecondLowest / sequence.length) * 100).toFixed(1)}% through the file)`);
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
