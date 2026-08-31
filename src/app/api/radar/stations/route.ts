import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getRadarStations } from "@/lib/nexrad-stations";

// Powers the station picker — live from NWS, not a hardcoded list, matching
// how the rest of the in-house radar work resolves site data (see
// src/lib/nexrad/site.ts). Station list fetch/cache logic lives in
// src/lib/nexrad-stations.ts, shared with /api/radar/mosaic's nearest-station lookup.

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-stations", 20, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  try {
    const stations = await getRadarStations();
    return NextResponse.json(stations, { headers: { "Cache-Control": "public, max-age=3600", "X-Radar-Source": "live" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the radar station list right now." },
      { status: 502 },
    );
  }
}
