import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// HRRR simulated composite reflectivity, served as pre-rendered tiles by the Iowa Environmental
// Mesonet (same free tile cache as the observed NEXRAD mosaic) — genuine model-forecast radar
// imagery rather than a gridded probability field standing in for "future radar."
const FORECAST_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function tileUrlFor(forecastHour: number) {
  const forecastMinute = String(forecastHour * 60).padStart(4, "0");
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F${forecastMinute}-0/{z}/{x}/{y}.png`;
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-future-frames", 60, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const now = Date.now();
  const frames = FORECAST_HOURS.map((forecastHour) => ({
    time: Math.floor((now + forecastHour * 60 * 60_000) / 1000),
    tileUrl: tileUrlFor(forecastHour),
  }));
  return NextResponse.json(
    { provider: "IEM HRRR Simulated Reflectivity", frames, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300" } },
  );
}
