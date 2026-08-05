import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { fetchStormTracks, fetchHailDetections, fetchTvsDetections, fetchMesocycloneDetections } from "@/lib/nexrad/level3-markers";
import { fetchFromWorker } from "@/lib/radar-worker-client";

// Level III severe-weather detection markers — storm tracks, hail,
// tornadic vortex signatures, mesocyclones. Unlike storm-relative velocity
// (src/lib/nexrad/level3.ts, deliberately kept out of the UI), these are
// small structured detections nexrad-level-3-data already parses into plain
// objects, not an undocumented raster decode — see level3-markers.ts for
// which of the four were verified against a real active detection vs.
// verified only structurally (no active hail/rotation signature existed at
// build time to test against).
//
// An empty result here is the NORMAL state, not a failure — most of the
// time there's no active hail/rotation signature to report, and NOAA
// doesn't even publish a file for those products when there's nothing to
// say. Every sub-fetch already treats "no file found" as an empty list,
// not an error, so this route only fails on a genuine problem (network,
// rate limit, decode error).
const CACHE_TTL_MS = 60_000;
type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const STATION_ID_PATTERN = /^[A-Z0-9]{3,5}$/;

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-nexrad-severe", 20, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const { searchParams } = new URL(request.url);
  const station = searchParams.get("station")?.trim().toUpperCase();
  if (!station || !STATION_ID_PATTERN.test(station)) {
    return NextResponse.json({ error: "A valid radar station ID is required, e.g. KFFC." }, { status: 400 });
  }

  const cached = cache.get(station);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data, { headers: { "Cache-Control": "private, max-age=45", "X-Radar-Source": "cache" } });
  }

  const fromWorker = await fetchFromWorker(`/severe?station=${station}`);
  if (fromWorker) {
    cache.set(station, { data: fromWorker, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(fromWorker, { headers: { "Cache-Control": "private, max-age=45", "X-Radar-Source": "worker" } });
  }

  try {
    const [storms, hail, tvs, mesocyclones] = await Promise.all([
      fetchStormTracks(station),
      fetchHailDetections(station),
      fetchTvsDetections(station),
      fetchMesocycloneDetections(station),
    ]);

    const payload = {
      stormTracks: storms.tracks,
      hail: hail.detections,
      tvs: tvs.detections,
      mesocyclones: mesocyclones.detections,
      times: { stormTracks: storms.time, hail: hail.time, tvs: tvs.time, mesocyclones: mesocyclones.time },
    };
    cache.set(station, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=45", "X-Radar-Source": "live" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Severe-weather markers are unavailable right now." },
      { status: 502 },
    );
  }
}
