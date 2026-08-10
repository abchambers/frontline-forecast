import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { fetchFromWorker } from "@/lib/radar-worker-client";

// Iowa Environmental Mesonet's NEXRAD mosaic tile cache — the same NWS/MRMS-standard reflectivity
// color table used on weather.gov, free and keyless. Past frames are exact minute-offsets of the
// same rendering pipeline as "now" (nexrad-n0q-900913-m05m, -m10m, ... -m55m), so the live view and
// the timeline loop are guaranteed to look identical instead of coming from two different providers.
const PAST_MINUTES_AGO = [55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5];

// A retained in-house frame rarely lands on the exact same second as one of the IEM slots above
// (both are independent polling cadences) — match within this window rather than requiring an
// exact timestamp. Half the IEM slot spacing (5 min), so a slot can never plausibly match two
// different in-house frames.
const MATCH_WINDOW_MS = 150_000;

const STATION_ID_PATTERN = /^[A-Z0-9]{3,5}$/;

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

  // Optional — if the worker has its own retained render close to one of the slots above, prefer
  // it (real in-house data, our own color table) over the IEM mosaic tile for that slot. Any slot
  // without a nearby in-house frame keeps its IEM tileUrl unchanged, so a worker outage or a
  // station outside the retained set degrades to exactly today's behavior, not a broken timeline.
  const station = new URL(request.url).searchParams.get("station")?.trim().toUpperCase();
  if (station && STATION_ID_PATTERN.test(station)) {
    const history = (await fetchFromWorker(`/frames?station=${station}`)) as { frames?: { time: string; elevationDeg: number }[] } | null;
    for (const inHouseFrame of history?.frames ?? []) {
      const inHouseMs = new Date(inHouseFrame.time).getTime();
      if (Number.isNaN(inHouseMs)) continue;
      let closest: (typeof frames)[number] | null = null;
      let closestDelta = Infinity;
      for (const frame of frames) {
        const delta = Math.abs(frame.time * 1000 - inHouseMs);
        if (delta < closestDelta) {
          closestDelta = delta;
          closest = frame;
        }
      }
      if (closest && closestDelta <= MATCH_WINDOW_MS) {
        Object.assign(closest, { source: "nexrad", inHouseTime: inHouseFrame.time });
      }
    }
  }

  return NextResponse.json(
    { provider: "IEM NEXRAD Mosaic", frames, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=120" } },
  );
}
