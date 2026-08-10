import pkg from "nexrad-level-2-data";
import { fetchWithTimeout } from "./fetch-with-timeout.js";
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
// extractLowestElevation.
// Real incident, found live: during active severe weather, this parse alone
// (nexrad-level-2-data eagerly decoding the entire volume — every elevation
// and moment, not just the one this app extracts) measured 60-210+ SECONDS,
// independent of anything in this app's own code (grid resolution, sampling
// — none of it touches this step). A 90s TTL meant that expensive parse
// often needed redoing again almost as soon as it finished, especially with
// the pre-warm loop forcing it on a fixed schedule regardless of real
// traffic — a major contributor to sustained memory pressure and repeated
// OOMs. Volumes update roughly every 4-10 minutes depending on VCP anyway,
// so a much longer TTL doesn't mean meaningfully staler data, just far less
// re-parsing. Raised to 5 minutes as an immediate stabilization measure
// during the severe-weather event; revisit once real parse times return to
// their calmer-weather baseline (a few seconds).
const VOLUME_CACHE_TTL_MS = 300_000;
// The dashboard's two always-warm stations (see server.ts's PREWARM_STATIONS and
// src/lib/locations.ts's weatherDeskLocations — keep this list in sync with both if the app's
// presets ever change). These two volumes are ALREADY concurrently cached in production
// continuously (the prewarm cycle refreshes both every 5 minutes) without incident, so they keep
// the full TTL above. Real incident, found live via a stress test while building the radar
// timeline buffer feature: requesting 5 distinct stations in quick succession (exercising the
// station picker's real, unbounded 159-site range, not just the two presets) OOM'd this worker.
// Each parsed volume measures ~800MB+ RSS (see the leak-fix comment below), and nothing
// previously bounded how many distinct NON-preset stations' volumes could be alive at once within
// the TTL window — the existing TTL-sweep fix bounds GROWTH RATE, not a worst-case CEILING.
const PRESET_STATIONS = new Set(["KFFC", "KBMX"]);
// Short enough that an ad-hoc station's volume can't meaningfully accumulate, long enough to still
// cover the one real benefit this cache exists for on a non-preset station: toggling between the
// Reflectivity and Velocity picker for the SAME station in one viewing session (see
// getVolumeCached's own comment) without re-downloading and re-parsing.
const NON_PRESET_VOLUME_TTL_MS = 90_000;
// At most one ad-hoc station's volume alive at a time, beyond the two presets — bounds worst-case
// concurrent volumes to a small, fixed number (3) regardless of how many of the 159 real stations
// get requested over the worker's lifetime, instead of unbounded.
const MAX_NON_PRESET_STATIONS = 1;
type VolumeCacheEntry = {
  radar: InstanceType<typeof Level2Radar>;
  key: string;
  lastModified: string;
  expiresAt: number;
};
const volumeCache = new Map<string, VolumeCacheEntry>();

// Real memory leak found live, hours into production uptime: this Map is
// keyed by station, so a repeat request for the SAME station correctly
// overwrites its old entry — but a DIFFERENT station's expired entry was
// never being deleted anywhere, just silently ignored by the expiresAt
// check below. With 159 selectable stations reachable via the map picker,
// each holding a full parsed Level2Radar object (measured live: ~800MB+ RSS
// contribution for a single volume), a handful of distinct stations
// requested over the course of a day was enough to exhaust the worker's 2GB
// ceiling — degrading into severe GC thrashing well before the actual OOM
// (explains request times inflating from single-digit seconds to 200-350+
// seconds, including for plain S3 fetches that have nothing to do with this
// cache). Sweeping expired entries on every access bounds steady-state
// memory to roughly "distinct stations requested within the last 90s",
// not "every distinct station ever requested in this process's lifetime".
function evictExpiredVolumes() {
  const now = Date.now();
  for (const [key, entry] of volumeCache) {
    if (entry.expiresAt <= now) volumeCache.delete(key);
  }
}

// Evicts the least-recently-set non-preset entry (or entries) when a new NON-preset station would
// push the count past MAX_NON_PRESET_STATIONS. Never touches preset entries — only their own TTL
// governs those, exactly as before this fix.
function evictExcessNonPresetVolumes(incomingStation: string) {
  if (PRESET_STATIONS.has(incomingStation)) return;
  const nonPresetEntries = [...volumeCache.entries()].filter(([station]) => !PRESET_STATIONS.has(station));
  if (nonPresetEntries.length < MAX_NON_PRESET_STATIONS) return;
  nonPresetEntries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  for (let i = 0; i <= nonPresetEntries.length - MAX_NON_PRESET_STATIONS; i += 1) {
    volumeCache.delete(nonPresetEntries[i][0]);
  }
}

export async function getVolumeCached(
  stationId: string,
): Promise<{ radar: InstanceType<typeof Level2Radar>; key: string; lastModified: string }> {
  evictExpiredVolumes();
  const cached = volumeCache.get(stationId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  evictExcessNonPresetVolumes(stationId);
  const { buffer, key, lastModified } = await fetchLatestVolume(stationId);
  const radar = await new Level2Radar(buffer);
  const ttl = PRESET_STATIONS.has(stationId) ? VOLUME_CACHE_TTL_MS : NON_PRESET_VOLUME_TTL_MS;
  const entry = { radar, key, lastModified, expiresAt: Date.now() + ttl };
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
