import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { resolveWeatherDeskLocation } from "@/lib/locations";
import { getRadarStations, nearestStations } from "@/lib/nexrad-stations";
import { fetchMosaicFromWorker } from "@/lib/radar-worker-client";

// A mosaic request decodes several stations sequentially on the worker (measured live:
// ~14-20s/station on the performance-1x worker) — genuinely slow compared to every other route in
// this app, so this needs real headroom. No local fallback exists for this one (unlike
// /api/radar/nexrad's own decode-locally-if-the-worker-is-down path) — a multi-station composite
// isn't something a single serverless invocation can reasonably build itself, so a worker failure
// here is a real 502, and the client's job is to fall back to the existing single-station view,
// not to retry a local mosaic build.
export const maxDuration = 60;

// Default station count for the automatic mosaic view. Andrew's call (2026-08-31): mosaic is now
// the default for everyone, not an opt-in — that means every cold request pays this cost, so this
// stays smaller than the worker's own MAX_MOSAIC_STATIONS=8 cap. 4 nearest stations gave a real
// ~40s cold response in testing; wider coverage is available by asking for more via `count`, but
// that's a deliberate tradeoff against latency for the automatic default, tunable later.
const DEFAULT_STATION_COUNT = 4;
const MAX_STATION_COUNT = 8;

const CACHE_TTL_MS = 90_000; // roughly matches the worker's own 5-minute cache with margin to spare, just avoids a redundant network hop on rapid reloads.
type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-mosaic", 10, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const { searchParams } = new URL(request.url);
  const location = resolveWeatherDeskLocation(searchParams);
  const requestedCount = Number(searchParams.get("count"));
  const count = Number.isFinite(requestedCount) && requestedCount > 0 ? Math.min(requestedCount, MAX_STATION_COUNT) : DEFAULT_STATION_COUNT;

  try {
    const allStations = await getRadarStations();
    const nearest = nearestStations(location.latitude, location.longitude, allStations, count);
    if (!nearest.length) {
      return NextResponse.json({ error: "No radar coverage found near this location." }, { status: 404 });
    }
    const stationIds = nearest.map((station) => station.id);
    const cacheKey = [...stationIds].sort().join(",");
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data, { headers: { "Cache-Control": "private, max-age=60", "X-Radar-Source": "cache" } });
    }

    const fromWorker = await fetchMosaicFromWorker(stationIds);
    if (!fromWorker) {
      return NextResponse.json({ error: "The local mosaic is unavailable right now." }, { status: 502 });
    }
    cache.set(cacheKey, { data: fromWorker, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(fromWorker, { headers: { "Cache-Control": "private, max-age=60", "X-Radar-Source": "worker" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The local mosaic is unavailable right now." },
      { status: 502 },
    );
  }
}
