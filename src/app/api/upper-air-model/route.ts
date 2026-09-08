import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { fetchUpperAirFromWorker } from "@/lib/radar-worker-client";

// Real, in-house-rendered 500mb heights + relative vorticity — a DIFFERENT product from
// /api/upper-air (SPC's own twice-daily OBSERVED station-plot analyses, kept as-is): this is model
// output (GFS, via radar-worker/src/upper-air.ts), the same "own real map, radar's visual style"
// upgrade the fronts tab got, rendered on the SAME persistent worker that already does radar's
// decode+render work — see that file's own comments for why (real measured footprint, ~270MB/2-3s,
// is light enough not to need a separate service).
//
// No local fallback exists here (unlike radar's NEXRAD path, which can decode locally if the
// worker is down) — this product ONLY exists via the worker for now. A real, visible "unavailable"
// state on a worker outage is preferable to silently building a second, rarely-exercised GRIB2
// pipeline in Vercel's serverless environment for a case that's already rare in practice.
export async function GET(request: Request) {
  const limit = checkRateLimit(request, "upper-air-model", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const payload = await fetchUpperAirFromWorker();
  if (!payload) {
    return NextResponse.json({ error: "The in-house upper-air model map is unavailable right now." }, { status: 502 });
  }
  // GFS only publishes a new run every 6 real hours — a real 10-minute edge cache is generous
  // relative to that cadence, not aggressive, and keeps repeat visits from re-hitting the worker.
  return NextResponse.json(payload, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" } });
}
