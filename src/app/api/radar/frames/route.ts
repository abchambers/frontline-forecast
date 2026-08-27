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

// Andrew, live (2026-08-26): a station with a genuinely healthy, continuously-running worker
// retains this many frames (radar-worker's own MAX_FRAMES_PER_STATION) — confirmed live via the
// worker's own /frames endpoint (12 real frames for KFFC, at capacity). Below this, treat the
// in-house history as too thin/patchy to build a full loop from and use IEM's grid instead.
const MIN_INHOUSE_FRAMES = 8;

function tileUrlFor(minutesAgo: number) {
  const suffix = minutesAgo > 0 ? `-m${String(minutesAgo).padStart(2, "0")}m` : "";
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913${suffix}/{z}/{x}/{y}.png`;
}

// IEM's cache only pre-renders these exact 5-minute-past-the-hour offsets (confirmed by this app's
// own PAST_MINUTES_AGO usage below) — an arbitrary offset like "-m07m" isn't a real cached tile.
// Only used as a fallback tileUrl for an in-house-sourced frame, in case its own render fails at
// request time (see radar-map.tsx's inHouseFrameTime catch path) — rounds to the nearest one IEM
// actually has, so that fallback stays a real, working URL.
function nearestIemOffset(minutesAgo: number) {
  const rounded = Math.round(minutesAgo / 5) * 5;
  return Math.min(55, Math.max(0, rounded));
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-frames", 60, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const now = Date.now();

  // Andrew, live: previously this always built the timeline from IEM's fixed 5-minute grid, then
  // opportunistically tried to match individual worker-retained frames onto it. That worked fine
  // for "is there a nearby in-house frame" but broke down when checking "is there one for EVERY
  // slot" (needed to fix the source-mixing bug from earlier this session): the worker's own capture
  // cadence runs every ~4-5 minutes but drifts and occasionally skips a cycle, so it almost never
  // lines up with all 11 of IEM's exact 5-minute-past-the-hour marks inside a tight tolerance window
  // — even with a full, healthy 12-frame retained history, confirmed live. The fix isn't a looser
  // tolerance (that risks misattributing a frame to the wrong time); it's to stop forcing the
  // worker's timeline onto a schedule it was never designed to hit. When the worker has enough of
  // its own history, use ITS real timestamps as the timeline directly instead.
  const station = new URL(request.url).searchParams.get("station")?.trim().toUpperCase();
  if (station && STATION_ID_PATTERN.test(station)) {
    const history = (await fetchFromWorker(`/frames?station=${station}`)) as { frames?: { time: string; elevationDeg: number }[] } | null;
    const inHouseFrames = (history?.frames ?? [])
      .map((frame) => ({ ...frame, ms: new Date(frame.time).getTime() }))
      .filter((frame) => !Number.isNaN(frame.ms))
      .sort((a, b) => a.ms - b.ms);
    if (inHouseFrames.length >= MIN_INHOUSE_FRAMES) {
      const frames = inHouseFrames.map((frame) => ({
        time: Math.floor(frame.ms / 1000),
        tileUrl: tileUrlFor(nearestIemOffset(Math.round((now - frame.ms) / 60_000))),
        source: "nexrad" as const,
        inHouseTime: frame.time,
      }));
      return NextResponse.json(
        { provider: "In-house NEXRAD", frames, fetchedAt: new Date().toISOString() },
        { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=120" } },
      );
    }
  }

  const frames = [...PAST_MINUTES_AGO, 0].map((minutesAgo) => ({
    time: Math.floor((now - minutesAgo * 60_000) / 1000),
    tileUrl: tileUrlFor(minutesAgo),
  }));
  return NextResponse.json(
    { provider: "IEM NEXRAD Mosaic", frames, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=120" } },
  );
}
