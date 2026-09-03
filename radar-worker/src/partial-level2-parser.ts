// Real, targeted fix for the biggest lever found in tonight's radar-quality review, 2026-09-03:
// nexrad-level-2-data's own parseData() (node_modules/nexrad-level-2-data/src/parsedata.js) always
// decodes EVERY elevation in a volume before this app's own extractLowestElevation() ever looks at
// which one it actually needs. Measured directly against real live volumes (KFFC/KBMX/KMPX, three
// different VCPs): the lowest elevation alone is only 6-11% of a volume's total records, the lowest
// two only 12-25% — meaning 75%+ of decode work has been wasted on elevations this app never reads.
//
// This is a vendored copy of ONLY the small top-level loop from parsedata.js (~90 lines), NOT a
// reimplementation of any actual record-decoding logic — every per-record parser (Level2Record,
// RandomAccessFile, decompress, parseHeader) is the exact same unmodified, tested code the real
// library ships, reached via a deep require the same way this app's own verification scripts
// already proved works under tsx/ESM. The only change from the original loop: an early-exit once
// we've moved past `maxElevation`.
//
// Why this is safe, verified with real data before writing this (see radar-worker/scripts/
// verify-elevation-order.mjs and verify-vcp-message-position.mjs, run against KFFC/KBMX/KMPX):
// 1. NEXRAD volumes scan lowest-to-highest elevation and write records in that same order — zero
//    out-of-order violations found across all three real files checked. Seeing elevation_number
//    exceed maxElevation therefore guarantees every record for elevations 1..maxElevation has
//    already been collected, not that we got lucky and skipped some interleaved data.
// 2. VCP metadata (message type 5/7, what CLEAR_AIR_VCPS detection depends on) appears exactly
//    once, at ~1-2% through the file in all three real cases — always captured long before
//    maxElevation is reached, at any real maxElevation this app would use.
// 3. Real defense-in-depth: this is a SPEED optimization, not a correctness gamble. Callers must
//    still call extractLowestElevation() as normal against the result, and level2.ts wraps the
//    whole thing with a fallback to a full decode if the partial result doesn't actually contain
//    what was asked for (see getVolumeCachedPartial's own comment) — an edge case this data says
//    should be essentially unreachable in practice, not something silently trusted.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { RandomAccessFile, BIG_ENDIAN } = require("nexrad-level-2-data/src/classes/RandomAccessFile");
const { Level2Record } = require("nexrad-level-2-data/src/classes/Level2Record");
const decompress = require("nexrad-level-2-data/src/decompress");
const parseHeader = require("nexrad-level-2-data/src/parseheader");
const { RADAR_DATA_SIZE } = require("nexrad-level-2-data/src/constants");

// Verbatim copy of parsedata.js's own groupAndSortScans — unchanged, just needs to live here too
// since it's a private (non-exported) helper in the original module.
function groupAndSortScans(scans: any[]): any[] {
  const groups: any[] = [];
  scans.forEach((scan) => {
    const elevationNumber = scan.record.elevation_number;
    if (groups[elevationNumber]) groups[elevationNumber].push(scan);
    else groups[elevationNumber] = [scan];
  });
  return groups;
}

export type PartialParseResult = {
  data: any[];
  header: any;
  vcp: any;
  isTruncated: boolean;
  hasGaps: boolean;
  stoppedEarly: boolean;
};

// Same options shape parseData accepts ({ logger }) — see nexrad-level-2-data's own JSDoc.
export function parsePartialVolume(file: Buffer, maxElevation: number, options: { logger?: any } = {}): PartialParseResult {
  const resolvedOptions = { logger: options.logger === false ? { log: () => {}, warn: () => {}, error: () => {} } : (options.logger ?? console) };
  const rafCompressed = new RandomAccessFile(file, BIG_ENDIAN);
  const data: any[] = [];
  const raf = decompress(rafCompressed);
  const header = parseHeader(raf);

  let messageOffset31 = 0;
  let recordNumber = 0;
  let r: any;
  let vcp: any = {};
  let hasGaps = false;
  let isTruncated = false;
  let stoppedEarly = false;

  if (raf.getPos() < raf.getLength()) {
    do {
      try {
        r = Level2Record(raf, recordNumber, messageOffset31, header, resolvedOptions);
        recordNumber += 1;
      } catch (e) {
        resolvedOptions.logger.warn(e);
        isTruncated = true;
        r = { finished: true };
      }

      if (!r.finished) {
        if (r.message_type === 31) {
          const messageSize = r.actual_size ?? r.message_size;
          hasGaps = true;
          messageOffset31 += messageSize * 2 + 12 - RADAR_DATA_SIZE;

          // THE early exit. See this file's header comment for why crossing this boundary is safe
          // to treat as "every record for 1..maxElevation is already collected."
          if (r.record?.elevation_number !== undefined && r.record.elevation_number > maxElevation) {
            stoppedEarly = true;
            r = { finished: true };
          }
        }

        if (!r.finished && [1, 5, 7, 31].includes(r.message_type)) {
          if (r?.record?.reflect || r?.record?.velocity || r?.record?.spectrum || r?.record?.zdr || r?.record?.phi || r?.record?.rho) {
            data.push(r);
          }
          if ([5, 7].includes(r.message_type)) vcp = r;
        }
      }
    } while (!r.finished);
  }

  return {
    data: groupAndSortScans(data),
    header,
    vcp,
    isTruncated,
    hasGaps,
    stoppedEarly,
  };
}
