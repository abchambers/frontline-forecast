import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// Iowa Environmental Mesonet's NEXRAD mosaic tile cache — the same NWS/MRMS-standard reflectivity
// color table used on weather.gov, free and keyless. Past frames are exact minute-offsets of the
// same rendering pipeline as "now" (nexrad-n0q-900913-m05m, -m10m, ... -m55m), so the live view and
// the timeline loop are guaranteed to look identical instead of coming from two different providers.
const PAST_MINUTES_AGO = [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5];

function tileUrlFor(minutesAgo: number) {
  const suffix = minutesAgo > 0 ? `-m${String(minutesAgo).padStart(2, "0")}m` : "";
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${suffix}/{z}/{x}/{y}.png`;
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-frames", 60, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const now = Date.now();
  const frames = [...PAST_MINUTES_AGO, 0].map((minutesAgo) => ({
    time: Math.floor((now - minutesAgo * 60_000) / 1000),
    tileUrl: tileUrlFor(minutesAgo),
  }));
  return NextResponse.json(
    { provider: "IEM NEXRAD Mosaic", frames, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=120" } },
  );
}
