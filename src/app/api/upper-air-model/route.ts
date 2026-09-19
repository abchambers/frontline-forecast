import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { fetchUpperAirFromWorker } from "@/lib/radar-worker-client";

// Real, in-house-rendered GFS upper-air maps -- height contours at every level, plus the one
// conventional field each level highlights (250/300/925mb isotachs, 500mb relative vorticity,
// 700mb relative humidity, 850mb temperature; see radar-worker/src/upper-air.ts's own LEVEL_FIELD
// for the real reasoning). A DIFFERENT product from /api/upper-air (SPC's own twice-daily OBSERVED
// station-plot analyses, kept as-is) -- this is model output, the same "own real map, radar's
// visual style" upgrade the fronts tab got, rendered on the SAME persistent worker that already
// does radar's decode+render work — see that file's own comments for why (real measured footprint,
// ~270MB/2-3s, is light enough not to need a separate service).
//
// No local fallback exists here (unlike radar's NEXRAD path, which can decode locally if the
// worker is down) — this product ONLY exists via the worker for now. A real, visible "unavailable"
// state on a worker outage is preferable to silently building a second, rarely-exercised GRIB2
// pipeline in Vercel's serverless environment for a case that's already rare in practice.
const VALID_LEVELS = new Set(["250", "300", "500", "700", "850", "925"]);

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "upper-air-model", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const requestedLevel = new URL(request.url).searchParams.get("level") ?? "500";
  const level = VALID_LEVELS.has(requestedLevel) ? requestedLevel : "500";
  const payload = await fetchUpperAirFromWorker(level);
  if (!payload) {
    return NextResponse.json({ error: "The in-house upper-air model map is unavailable right now." }, { status: 502 });
  }
  // GFS only publishes a new run every 6 real hours — a real 10-minute edge cache is generous
  // relative to that cadence, not aggressive, and keeps repeat visits from re-hitting the worker.
  // A degraded payload skipped a newer GFS cycle on uncertain grounds; don't let the edge hold it for 30 minutes.
  const degraded = (payload as { degraded?: boolean }).degraded === true;
  return NextResponse.json(payload, { headers: { "Cache-Control": degraded ? "public, s-maxage=60" : "public, s-maxage=600, stale-while-revalidate=1200" } });
}
