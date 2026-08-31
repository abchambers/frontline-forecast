import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { mosaicStationSets } from "@/lib/mosaic-station-sets";
import { fetchMosaicFromWorker } from "@/lib/radar-worker-client";

// A mosaic request decodes several stations sequentially on the worker (measured live:
// ~14-20s/station on the performance-1x worker) — genuinely slow compared to every other route in
// this app, so this needs real headroom. No local fallback exists for this one (unlike
// /api/radar/nexrad's own decode-locally-if-the-worker-is-down path) — a multi-station composite
// isn't something a single serverless invocation can reasonably build itself, so a worker failure
// here is a real 502, and the client's job is to fall back to the existing single-station view,
// not to retry a local mosaic build.
//
// Found and fixed 2026-08-31 while explaining this route's real limits: this was set to 60s
// assuming Vercel's Hobby-plan ceiling was still short, but Hobby now allows up to 300s (checked
// live against Vercel's own docs, not assumed) -- and worse, the worker-client's own
// MOSAIC_TIMEOUT_MS is 90s, LONGER than the 60s this route was giving itself, so Vercel would have
// killed the whole function before the worker-client's own timeout+circuit-breaker logic ever got
// a chance to respond cleanly. That was already a real risk at today's 4-station default on a
// slow/cold request, not something that only mattered if more stations get added later. Set to
// comfortably exceed MOSAIC_TIMEOUT_MS (radar-worker-client.ts) so THAT timeout is always what
// actually fires on a genuinely slow worker, not Vercel's own abrupt kill -- keep the two in sync
// if either changes. Worst case at the worker's own 8-station cap (~20s/station): ~160s: 200s
// leaves real margin, still well inside Hobby's 300s ceiling.
export const maxDuration = 200;

// Andrew's call 2026-08-31: mosaic composition is keyed by radar SITE, not by the requester's raw
// lat/lon. The app already has an authoritative "which radar site is yours" answer for every
// location (NWS's own point lookup, see /api/location-lookup and the preset weatherDeskLocations —
// both resolve a real radarSite already) — this route just looks up THAT site's own configured
// mosaic station set (src/lib/mosaic-station-sets.ts) rather than re-deriving nearest-by-distance
// from scratch. Two real advantages over the lat/lon version this replaced: (1) every location
// resolves through the SAME finite set of 159 real sites, so the station list is hand-editable per
// site (a Georgia site can deliberately include an Alabama station upstream, even if it isn't the
// closest by raw distance) instead of being locked to whatever a distance formula produces for an
// arbitrary point; (2) many different users near the same radar site now request the EXACT same
// station combination, so they share the worker's cache instead of each producing a slightly
// different combination that rarely hits the same cache entry.
const CACHE_TTL_MS = 90_000; // roughly matches the worker's own 5-minute cache with margin to spare, just avoids a redundant network hop on rapid reloads.
type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const STATION_ID_PATTERN = /^[A-Z0-9]{3,5}$/;

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-mosaic", 10, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const { searchParams } = new URL(request.url);
  const station = searchParams.get("station")?.trim().toUpperCase();
  if (!station || !STATION_ID_PATTERN.test(station)) {
    return NextResponse.json({ error: "A valid radar station ID is required, e.g. KFFC." }, { status: 400 });
  }

  // Falls back to just the single station alone if it's somehow not in the generated table (should
  // never happen for a real WSR-88D site, but a station this app doesn't recognize yet shouldn't
  // 400 — it degrades to a one-station "mosaic", which the worker handles fine).
  const stationIds = mosaicStationSets[station] ?? [station];

  const cacheKey = [...stationIds].sort().join(",");
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data, { headers: { "Cache-Control": "private, max-age=60", "X-Radar-Source": "cache" } });
  }

  try {
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
