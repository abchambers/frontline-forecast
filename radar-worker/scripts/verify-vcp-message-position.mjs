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
  const yyyy = date.getUTCFullYear(), mm = String(date.getUTCMonth() + 1).padStart(2, "0"), dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${stationId}/`;
}
async function listVolumes(prefix) {
  const response = await fetch(`${ARCHIVE_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`);
  const xml = await response.text();
  const objects = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m;
  while ((m = re.exec(xml))) {
    const key = /<Key>(.*?)<\/Key>/.exec(m[1])?.[1];
    const lastModified = /<LastModified>(.*?)<\/LastModified>/.exec(m[1])?.[1];
    if (key && lastModified) objects.push({ key, lastModified });
  }
  return objects;
}
async function fetchLatestVolume(stationId) {
  const now = new Date(), yesterday = new Date(now.getTime() - 86400000);
  const [today, prior] = await Promise.all([listVolumes(datePrefix(now, stationId)), listVolumes(datePrefix(yesterday, stationId))]);
  const all = [...prior, ...today].filter((o) => /_V0[0-9]$/.test(o.key)).sort((a, b) => a.lastModified.localeCompare(b.lastModified));
  const latest = all[all.length - 1];
  const response = await fetch(`${ARCHIVE_BUCKET}/${latest.key}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const buffer = await fetchLatestVolume(STATION_ID);
  const rafCompressed = new RandomAccessFile(buffer, BIG_ENDIAN);
  const raf = decompress(rafCompressed);
  const header = parseHeader(raf);
  let messageOffset31 = 0, recordNumber = 0, r;
  const options = { logger: false };
  let totalRecords = 0;
  const vcpSightings = [];

  if (raf.getPos() < raf.getLength()) {
    do {
      try {
        r = Level2Record(raf, recordNumber, messageOffset31, header, options);
        recordNumber += 1;
      } catch (e) { r = { finished: true }; }
      if (!r.finished) {
        totalRecords += 1;
        if (r.message_type === 31) {
          const messageSize = r.actual_size ?? r.message_size;
          messageOffset31 += (messageSize * 2 + 12 - RADAR_DATA_SIZE);
        }
        if (r.message_type === 5 || r.message_type === 7) {
          vcpSightings.push({ recordIndex: totalRecords - 1, messageType: r.message_type, pattern: r.record?.pattern_number });
        }
      }
    } while (!r.finished);
  }

  console.log(`Station: ${STATION_ID}, total records: ${totalRecords}`);
  console.log(`VCP (message type 5/7) sightings:`);
  for (const s of vcpSightings) {
    console.log(`  record #${s.recordIndex} (${((s.recordIndex / totalRecords) * 100).toFixed(2)}% through file): type=${s.messageType} pattern=${s.pattern}`);
  }
  if (vcpSightings.length === 0) console.log("  NONE FOUND (unexpected)");
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
