import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// SPC's categorical convective outlook GeoJSON already carries stroke/fill colors and
// human-readable risk labels per feature, so this is a thin proxy rather than a transform.
// Day 2 is the same product one day out, issued with lower confidence/coarser categories.
const SOURCE_URLS = {
  1: "https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson",
  2: "https://www.spc.noaa.gov/products/outlook/day2otlk_cat.nolyr.geojson",
} as const;

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "outlook", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const requestedDay = new URL(request.url).searchParams.get("day");
  const day = requestedDay === "2" ? 2 : 1;
  try {
    const response = await fetch(SOURCE_URLS[day], { headers: { "User-Agent": "Frontline Forecast weather application" }, cache: "no-store" });
    if (!response.ok) throw new Error(`SPC outlook feed returned ${response.status}`);
    const geojson = await response.json();
    return NextResponse.json(geojson, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The convective outlook is unavailable right now." }, { status: 502 });
  }
}
