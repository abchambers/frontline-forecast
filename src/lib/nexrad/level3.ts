import parseLevel3 from "nexrad-level-3-data";
import type { RadarSite } from "./site";
import type { MrmsBounds, MrmsPoint } from "@/lib/mrms-render";
import { destinationPoint, cellKey, cellsToGrid, boundsOf } from "./project";
import { fetchWithTimeout } from "./fetch-with-timeout";

// Storm-Relative Mean Radial Velocity (product code 56, files named
// {SSS}_N0S_...). NOT wired into the public UI yet — this exists to be
// inspected and verified before it's ever shown to a real user. It
// duplicates a lot of what the already-shipped, already-gated base velocity
// shows, and its decode (below) is NOT something the nexrad-level-3-data
// library resolves for us, unlike Level II moments. Real correctness risk
// if the bit-level math here is wrong, hence: build it, keep it hidden,
// verify it, THEN consider exposing it.
const ARCHIVE_BUCKET = "https://unidata-nexrad-level3.s3.amazonaws.com";

export function siteCode(stationId: string): string {
  // Registry convention: CONUS WSR-88D site codes in this bucket drop the
  // leading "K" (KFFC -> FFC). Only CONUS stations are in this app's
  // location list right now, so this simple strip is safe; non-CONUS sites
  // (Alaska PAxx, Hawaii PHxx, etc.) use a different convention this
  // doesn't handle.
  return stationId.startsWith("K") ? stationId.slice(1) : stationId;
}

function datePrefix(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}_${mm}_${dd}`;
}

type S3Object = { key: string; lastModified: string };

async function listProducts(prefix: string): Promise<S3Object[]> {
  const url = `${ARCHIVE_BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}`;
  const response = await fetchWithTimeout(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`S3 list failed for ${prefix} (${response.status})`);
  const xml = await response.text();
  const objects: S3Object[] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;
  while ((match = contentsRegex.exec(xml))) {
    const block = match[1];
    const key = /<Key>(.*?)<\/Key>/.exec(block)?.[1];
    const lastModified = /<LastModified>(.*?)<\/LastModified>/.exec(block)?.[1];
    if (key && lastModified) objects.push({ key, lastModified });
  }
  return objects;
}

// Shared across every Level III product this app reads. Returns null (not a
// throw) when nothing is found in the lookback window — for detection-only
// products (hail, TVS), no file at all is the NORMAL state most of the time
// (no severe signature to report), not an error condition.
export async function fetchLatestLevel3Product(
  stationId: string,
  productAbbreviation: string,
): Promise<{ buffer: Buffer; key: string; lastModified: string } | null> {
  const site = siteCode(stationId);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [today, prior] = await Promise.all([
    listProducts(`${site}_${productAbbreviation}_${datePrefix(now)}`),
    listProducts(`${site}_${productAbbreviation}_${datePrefix(yesterday)}`),
  ]);
  const all = [...prior, ...today].sort((a, b) => a.lastModified.localeCompare(b.lastModified));
  const latest = all[all.length - 1];
  if (!latest) return null;

  const response = await fetchWithTimeout(`${ARCHIVE_BUCKET}/${latest.key}`, { cache: "no-store" }, 20_000);
  if (!response.ok) throw new Error(`Failed to download ${latest.key} (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, key: latest.key, lastModified: latest.lastModified };
}

// Decodes one of the 16 raw "Data Level Threshold" halfwords (Product
// Description Block halfwords 31-46) into a real physical value, or null
// for missing/range-folded/non-numeric categorical codes. This is the exact
// bit format used by legacy 16-level color-table products (packet AF1F) —
// NOT resolved by nexrad-level-3-data itself, and genuinely easy to get
// wrong from the raw ICD spec alone. Ported from Unidata's MetPy
// (metpy/io/nexrad.py, LegacyMapper class) — the same reference
// implementation the wider Python weather-software community relies on —
// rather than reverse-engineered from scratch, specifically because a
// silent math error here would show real-looking but wrong velocity values.
// MetPy itself doesn't distinguish "missing" from "range-folded" numerically
// (both collapse to NaN, with an explicit upstream TODO about it) — this
// does the same, both collapse to null.
// codes bit7 set = a flag byte, not a number: 0/1/2 = Blank/"TH"/"ND"
// (all "missing"), 3 = "RF" (range-folded), 4-14 = categorical labels
// (BI/GC/IC/GR/WS/DS/RA/HR/BD/HA/UK) used by precip-type products that
// share this same mapper — none of these are a numeric value for velocity.
function decodeThreshold(raw: number): number | null {
  const codes = (raw >> 8) & 0xff;
  let value = raw & 0xff;

  if (codes & 0x80) return null;

  if (codes & 0x40) value *= 0.01;
  else if (codes & 0x20) value *= 0.05;
  else if (codes & 0x10) value *= 0.1;

  if (codes & 0x01) value *= -1;
  return value;
}

function buildLookupTable(dependent31_46: Buffer): (number | null)[] {
  const table: (number | null)[] = [];
  for (let i = 0; i < 16; i += 1) {
    table.push(decodeThreshold(dependent31_46.readUInt16BE(i * 2)));
  }
  return table;
}

export async function computeStormRelativeVelocityGrid(
  stationId: string,
  stepDeg: number,
  maxRangeKm: number,
): Promise<{ grid: MrmsPoint[]; bounds: MrmsBounds; time: string; elevationDeg: number }> {
  const product = await fetchLatestLevel3Product(stationId, "N0S");
  if (!product) throw new Error(`No storm-relative velocity product found for ${stationId} in the last two days.`);
  const { buffer, lastModified } = product;
  const data = parseLevel3(buffer, { logger: false });

  const packet = data.radialPackets?.["0"];
  if (!packet) throw new Error(`No radial data in the storm-relative velocity product for ${stationId}.`);

  const site: RadarSite = {
    id: stationId,
    name: stationId,
    latitude: data.productDescription.latitude,
    longitude: data.productDescription.longitude,
    elevationMeters: data.productDescription.height,
  };
  const lookup = buildLookupTable(data.productDescription.dependent31_46);
  const elevationRad = (data.productDescription.elevationAngle * Math.PI) / 180;

  const points: MrmsPoint[] = [];
  for (const radial of packet.radials) {
    for (let binIndex = 0; binIndex < radial.bins.length; binIndex += 1) {
      const slantRangeKm = (packet.firstBin + binIndex) * packet.rangeScale;
      const groundRangeKm = slantRangeKm * Math.cos(elevationRad);
      if (groundRangeKm > maxRangeKm) break;
      const code = radial.bins[binIndex];
      const value = lookup[code] ?? null;
      const { lat, lon } = destinationPoint(site, radial.startAngle, groundRangeKm);
      points.push({ lat, lon, dbz: value });
    }
  }

  const bounds = boundsOf(points);
  const cells = new Map<string, number | null>();
  for (const p of points) cells.set(cellKey(p.lat, p.lon, stepDeg), p.dbz);

  return { grid: cellsToGrid(cells, stepDeg), bounds, time: lastModified, elevationDeg: data.productDescription.elevationAngle };
}
