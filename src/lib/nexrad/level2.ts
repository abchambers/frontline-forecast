import pkg from "nexrad-level-2-data";
import { fetchWithTimeout } from "./fetch-with-timeout";
const { Level2Radar } = pkg;

// Fetches the latest complete assembled volume from Unidata's public S3
// archive per request — a stateless model that fits this route's serverless
// hosting, unlike the persistent chunk-streaming worker planned for
// radar-worker/ (which trades this simplicity for lower latency at scale).
// Measured live: volumes land here within 1-2 minutes of real time, which is
// as fresh as GribStream's MRMS feed ever was — no persistent process is
// needed to get real freshness at this traffic level.
const ARCHIVE_BUCKET = "https://unidata-nexrad-level2.s3.amazonaws.com";

function datePrefix(date: Date, stationId: string): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/${stationId}/`;
}

type S3Object = { key: string; lastModified: string };

async function listVolumes(prefix: string): Promise<S3Object[]> {
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

// Finds the most recent complete volume for a station, checking yesterday's
// prefix too since a volume near UTC midnight can land in either day's folder.
async function fetchLatestVolume(stationId: string): Promise<{ buffer: Buffer; key: string; lastModified: string }> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [today, prior] = await Promise.all([
    listVolumes(datePrefix(now, stationId)),
    listVolumes(datePrefix(yesterday, stationId)),
  ]);
  // Some keys are special variants (observed live: a `_MDM` suffix — a
  // status/maintenance message, not a normal reflectivity+velocity volume,
  // much smaller and not decodable as one). Standard volumes end in exactly
  // `_V0<digit>` with nothing after it.
  const standardVolume = /_V0[0-9]$/;
  const all = [...prior, ...today]
    .filter((object) => standardVolume.test(object.key))
    .sort((a, b) => a.lastModified.localeCompare(b.lastModified));
  const latest = all[all.length - 1];
  if (!latest) throw new Error(`No Level II volumes found for ${stationId} in the last two days.`);

  const response = await fetchWithTimeout(`${ARCHIVE_BUCKET}/${latest.key}`, { cache: "no-store" }, 20_000);
  if (!response.ok) throw new Error(`Failed to download ${latest.key} (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, key: latest.key, lastModified: latest.lastModified };
}

export type DecodedRadial = {
  azimuthDeg: number;
  gateSizeKm: number;
  firstGateKm: number;
  values: (number | null)[]; // dBZ or m/s per gate, already scaled by the decoder
};

export type DecodedElevation = {
  elevationDeg: number;
  radials: DecodedRadial[];
};

// Reflectivity and velocity both need the same underlying volume, PARSED —
// not just downloaded. Caching only the raw buffer (an earlier version of
// this) still re-parsed the full ~5-6MB binary volume on every request, and
// found live, that parse was itself a meaningful chunk of the "several
// seconds" this took to load — not just the S3 download. Caching the parsed
// Level2Radar object means a velocity request right after a reflectivity
// request for the same station (exactly what toggling the Data-layer picker
// does) skips both the download AND the parse, going straight to
// extractLowestElevation. Keyed by station only (not station+moment), TTL
// matches the route's own payload cache so a warmed volume never outlives
// the data it would be re-decoded into anyway.
const VOLUME_CACHE_TTL_MS = 90_000;
type VolumeCacheEntry = {
  radar: InstanceType<typeof Level2Radar>;
  key: string;
  lastModified: string;
  expiresAt: number;
};
const volumeCache = new Map<string, VolumeCacheEntry>();

export async function getVolumeCached(
  stationId: string,
): Promise<{ radar: InstanceType<typeof Level2Radar>; key: string; lastModified: string }> {
  const cached = volumeCache.get(stationId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const { buffer, key, lastModified } = await fetchLatestVolume(stationId);
  const radar = await new Level2Radar(buffer);
  const entry = { radar, key, lastModified, expiresAt: Date.now() + VOLUME_CACHE_TTL_MS };
  volumeCache.set(stationId, entry);
  return entry;
}

export type Moment = "reflectivity" | "velocity" | "correlationCoefficient";

// Picks the lowest elevation angle that actually carries the requested
// moment — reflectivity is on every tilt, but velocity is only on the
// split-cut lower tilts in most VCPs (confirmed empirically against a real
// KFFC volume: REF on all 17 elevations, VEL only on a subset — not
// documented anywhere obvious, it's how the volume actually decoded).
//
// getHighresCorrelationCoefficient(scan) has a real bug found live: calling
// it with an explicit scan index (even 0) throws "invalid scan selected:
// undefined", even when that exact scan's data is present and correct via
// getHeader(scan).rho. Calling it with NO argument returns the full
// per-elevation array instead and works fine — confirmed against real data
// (all 720 entries populated, matching getHeader's values exactly). Worked
// around by fetching the whole-elevation array once per elevation and
// indexing into it, rather than calling per-scan like the other two moments.
export function extractLowestElevation(radar: InstanceType<typeof Level2Radar>, moment: Moment): DecodedElevation {
  for (const elevation of radar.listElevations()) {
    radar.setElevation(elevation);
    const scans = radar.getScans();
    const radials: DecodedRadial[] = [];
    let sawMoment = false;

    const allCorrelationCoefficient = moment === "correlationCoefficient" ? radar.getHighresCorrelationCoefficient() : null;

    for (let scan = 0; scan < scans; scan += 1) {
      const azimuth = radar.getAzimuth(scan) as number;
      const data =
        moment === "reflectivity"
          ? radar.getHighresReflectivity(scan)
          : moment === "velocity"
            ? radar.getHighresVelocity(scan)
            : allCorrelationCoefficient?.[scan];
      if (!data || !data.name) continue;
      sawMoment = true;
      // gate_size/first_gate come back from the decoder already in
      // kilometers, confirmed against real data (0.25 gate_size x 1832
      // gates + 2.125 first_gate ~= 460km, matching WSR-88D's published
      // super-res max range).
      radials.push({
        azimuthDeg: azimuth,
        gateSizeKm: data.gate_size,
        firstGateKm: data.first_gate,
        values: data.moment_data.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)),
      });
    }
    if (sawMoment && radials.length > 0) {
      const header = radar.getHeader(0);
      return { elevationDeg: header.elevation_angle ?? elevation, radials };
    }
  }
  throw new Error(`No elevation in this volume carries ${moment} data.`);
}
