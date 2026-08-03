import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { isGribstreamDisabled, recordGribstreamCall, withinDailyBudget } from "@/lib/gribstream-budget";

// GribStream's MRMS query returns numeric dBZ values on a lat/lon grid, not a
// rendered image — the client renders it into a colored overlay itself.
// MRMS composite reflectivity (MergedReflectivityQCComposite) lands at
// irregular ~2-minute timestamps (e.g. :40:41, :42:42), so querying an exact
// instant reliably returns nothing; a short window plus "take the latest
// complete timestamp" is the correct query shape, confirmed against the live
// API before writing this.
const MRMS_PARAMETER = "MergedReflectivityQCComposite";
const MRMS_LEVEL = "500 m above mean sea level";
// The first version of this route (1.5deg half-width, 0.03deg step, 12-minute
// lookback) measured at ~107 credits per call against a 1200/day free-tier
// cap — about 11 calls before the whole day's quota is gone. Shrunk here to
// reduce both the coordinate count and the number of distinct timestamps a
// wider lookback would return (each returned timestamp re-bills the full
// coordinate count). This reduces per-call cost but is NOT itself a
// guarantee of staying in budget — see the hard daily call cap below, which is.
const BOX_HALF_WIDTH_DEG = 0.75;
const GRID_STEP_DEG = 0.05;
const LOOKBACK_MINUTES = 5;
// Locations within this bucket size share one cached fetch — the app only
// has a handful of preset cities plus occasional custom stations, so most
// traffic collapses onto very few real GribStream calls.
const LOCATION_BUCKET_DEG = 0.5;
const CACHE_TTL_MS = 30 * 60_000;

type GribStreamRow = {
  [key: string]: unknown;
  forecasted_time: string;
  lat: number;
  lon: number;
};

type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function bucketKey(lat: number, lon: number) {
  const bucketLat = Math.round(lat / LOCATION_BUCKET_DEG) * LOCATION_BUCKET_DEG;
  const bucketLon = Math.round(lon / LOCATION_BUCKET_DEG) * LOCATION_BUCKET_DEG;
  return `${bucketLat.toFixed(2)},${bucketLon.toFixed(2)}`;
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-gribstream", 20, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  if (isGribstreamDisabled()) return NextResponse.json({ error: "GribStream is disabled." }, { status: 501 });

  const apiKey = process.env.GRIBSTREAM_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GribStream is not configured." }, { status: 501 });

  const { searchParams } = new URL(request.url);
  const latParam = searchParams.get("lat");
  const lonParam = searchParams.get("lon");
  // Number(null) is 0, not NaN — an absent param would otherwise silently
  // pass validation as "Null Island" (0,0) and spend a real GribStream call
  // on a nonsensical location instead of failing fast.
  if (!latParam || !lonParam) return NextResponse.json({ error: "A valid lat and lon are required." }, { status: 400 });
  const lat = Number(latParam);
  const lon = Number(lonParam);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NextResponse.json({ error: "A valid lat and lon are required." }, { status: 400 });

  const key = bucketKey(lat, lon);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data, { headers: { "Cache-Control": "private, max-age=90", "X-Radar-Source": "cache" } });
  }

  if (!withinDailyBudget()) {
    return NextResponse.json({ error: "GribStream's daily call budget is used up for today." }, { status: 429 });
  }

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
    recordGribstreamCall();
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

    const payload = {
      time: latestTime,
      bounds: grid,
      step: GRID_STEP_DEG,
      points,
      source: "GribStream MRMS (MergedReflectivityQCComposite)",
    };
    cache.set(key, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=90", "X-Radar-Source": "live" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GribStream radar is unavailable right now." }, { status: 502 });
  }
}
