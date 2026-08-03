import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// GribStream's MRMS query returns numeric dBZ values on a lat/lon grid, not a
// rendered image — the client renders it into a colored overlay itself.
// MRMS composite reflectivity (MergedReflectivityQCComposite) lands at
// irregular ~2-minute timestamps (e.g. :40:41, :42:42), so querying an exact
// instant reliably returns nothing; a short window plus "take the latest
// complete timestamp" is the correct query shape, confirmed against the live
// API before writing this.
const MRMS_PARAMETER = "MergedReflectivityQCComposite";
const MRMS_LEVEL = "500 m above mean sea level";
// Tunable: box half-width and grid step trade radar detail against
// GribStream credit usage (credits scale with returned coordinate count).
// ~1.5deg half-width at 0.03deg step is roughly 10-15 credits per fetch.
const BOX_HALF_WIDTH_DEG = 1.5;
const GRID_STEP_DEG = 0.03;
const LOOKBACK_MINUTES = 12;

type GribStreamRow = {
  [key: string]: unknown;
  forecasted_time: string;
  lat: number;
  lon: number;
};

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-gribstream", 20, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const apiKey = process.env.GRIBSTREAM_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GribStream is not configured." }, { status: 501 });

  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NextResponse.json({ error: "A valid lat and lon are required." }, { status: 400 });

  const now = new Date();
  const fromTime = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000).toISOString();
  const untilTime = now.toISOString();
  const grid = {
    minLatitude: lat - BOX_HALF_WIDTH_DEG,
    maxLatitude: lat + BOX_HALF_WIDTH_DEG,
    minLongitude: lon - BOX_HALF_WIDTH_DEG,
    maxLongitude: lon + BOX_HALF_WIDTH_DEG,
    step: GRID_STEP_DEG,
  };

  try {
    const response = await fetch("https://gribstream.com/api/v2/mrms/timeseries", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ grid, variables: [{ name: MRMS_PARAMETER, level: MRMS_LEVEL, info: "" }], fromTime, untilTime }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GribStream returned ${response.status}`);
    const rows = await response.json() as GribStreamRow[];
    if (!Array.isArray(rows) || !rows.length) throw new Error("GribStream returned no data for this area.");

    const valueKey = `${MRMS_PARAMETER}|${MRMS_LEVEL}|`;
    const latestTime = rows.reduce((latest, row) => row.forecasted_time > latest ? row.forecasted_time : latest, rows[0].forecasted_time);
    const latestRows = rows.filter((row) => row.forecasted_time === latestTime);
    if (!latestRows.length) throw new Error("No current MRMS snapshot is available for this area.");

    const points = latestRows.map((row) => {
      const raw = row[valueKey];
      return { lat: row.lat, lon: row.lon, dbz: typeof raw === "number" ? raw : null };
    });
    const hasSignal = points.some((point) => point.dbz !== null);
    if (!hasSignal) throw new Error("No reflectivity data returned for this area.");

    return NextResponse.json({
      time: latestTime,
      bounds: grid,
      step: GRID_STEP_DEG,
      points,
      source: "GribStream MRMS (MergedReflectivityQCComposite)",
    }, { headers: { "Cache-Control": "private, max-age=90" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GribStream radar is unavailable right now." }, { status: 502 });
  }
}
