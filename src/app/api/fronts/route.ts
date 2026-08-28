import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { parseWpcSurfaceBulletin } from "@/lib/wpc-fronts";

// WPC's live surface analysis — fronts, troughs, and pressure centers — free, public-domain NOAA
// data, issued every 3 hours. Fetched through IEM's text-product archive (the same provider this
// app already depends on for radar tiles), since WPC itself doesn't publish a directly-fetchable
// URL for the current bulletin. See src/lib/wpc-fronts.ts for how the PIL/WMO-header pair below was
// found and verified against live data.
const SOURCE_URL = "https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py?pil=CODSUS&ttaaii=ASUS02&limit=1&order=desc&fmt=text";

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "fronts", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  try {
    const response = await fetch(SOURCE_URL, { headers: { "User-Agent": "Frontline Forecast weather application" }, cache: "no-store" });
    if (!response.ok) throw new Error(`WPC surface bulletin feed returned ${response.status}`);
    const raw = await response.text();
    const { validTime, issuedAt, features } = parseWpcSurfaceBulletin(raw);
    if (!features.length) throw new Error("WPC surface bulletin returned no features to plot.");
    const geojson = { type: "FeatureCollection" as const, features, properties: { validTime, issuedAt } };
    // Bulletin only updates every 3 hours; a 10-minute edge cache keeps this well within that
    // cadence without hammering IEM on every map load.
    return NextResponse.json(geojson, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Surface fronts are unavailable right now." }, { status: 502 });
  }
}
