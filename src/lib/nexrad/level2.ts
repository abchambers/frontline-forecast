import pkg from "nexrad-level-2-data";
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
  const response = await fetch(url, { cache: "no-store" });
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
export async function fetchLatestVolume(stationId: string): Promise<{ buffer: Buffer; key: string; lastModified: string }> {
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

  const response = await fetch(`${ARCHIVE_BUCKET}/${latest.key}`, { cache: "no-store" });
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

// Picks the lowest elevation angle that actually carries the requested
// moment — reflectivity is on every tilt, but velocity is only on the
// split-cut lower tilts in most VCPs (confirmed empirically against a real
// KFFC volume: REF on all 17 elevations, VEL only on a subset — not
// documented anywhere obvious, it's how the volume actually decoded).
export async function decodeLowestElevation(
  buffer: Buffer,
  moment: "reflectivity" | "velocity",
): Promise<DecodedElevation> {
  const radar = await new Level2Radar(buffer);
  const getter = moment === "reflectivity" ? radar.getHighresReflectivity.bind(radar) : radar.getHighresVelocity.bind(radar);

  for (const elevation of radar.listElevations()) {
    radar.setElevation(elevation);
    const scans = radar.getScans();
    const radials: DecodedRadial[] = [];
    let sawMoment = false;
    for (let scan = 0; scan < scans; scan += 1) {
      const azimuth = radar.getAzimuth(scan) as number;
      const data = getter(scan);
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
