import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// NOAA STAR's CDN keeps a real directory listing of every past GOES-19 CONUS frame (weeks of
// history, one image every 5 minutes), not just the latest -- that's what makes a real scrubbable
// timeline possible here, the same way the radar timeline already works off retained history
// rather than a single current tile. Each channel directory uses the same filename shape:
// `{YYYYDDDHHMM}_GOES19-ABI-CONUS-{dir}-1250x750.jpg`, DDD being day-of-year.
//
// Deliberately not computed from wall-clock time: real capture-to-publish latency varies (observed
// 5-10+ minutes, not a fixed offset), so guessing the latest timestamp algorithmically produces
// dead links. Parsing the real directory listing is the only reliable source of truth. The listing
// itself is a few MB, so this trims it down to the most recent frames before responding, and the
// response is cached briefly since new frames only land every 5 minutes.
const CHANNEL_DIRS = { geocolor: "GEOCOLOR", ir: "13", wv: "08" } as const;
type Channel = keyof typeof CHANNEL_DIRS;
// Andrew, live: wanted enough history to actually see synoptic-scale motion (fronts, mid-latitude
// systems), which doesn't read clearly over 2 hours. 48 frames = 4 hours at the CDN's 5-minute
// cadence — still a light fetch (small CONUS JPGs) and well inside the "weeks of history" the
// directory listing retains.
const MAX_FRAMES = 48;

function isoFromTimestamp(stamp: string) {
  const year = Number(stamp.slice(0, 4));
  const dayOfYear = Number(stamp.slice(4, 7));
  const hour = Number(stamp.slice(7, 9));
  const minute = Number(stamp.slice(9, 11));
  const date = new Date(Date.UTC(year, 0, 1));
  date.setUTCDate(date.getUTCDate() + dayOfYear - 1);
  date.setUTCHours(hour, minute, 0, 0);
  return date.toISOString();
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "satellite-frames", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const requestedChannel = new URL(request.url).searchParams.get("channel");
  const channel: Channel = requestedChannel === "ir" || requestedChannel === "wv" ? requestedChannel : "geocolor";
  const dir = CHANNEL_DIRS[channel];
  try {
    const response = await fetch(`https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/${dir}/`, {
      headers: { "User-Agent": "Frontline Forecast weather application" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`GOES image archive returned ${response.status}`);
    const html = await response.text();
    const pattern = new RegExp(`(\\d{11})_GOES19-ABI-CONUS-${dir}-1250x750\\.jpg`, "g");
    const timestamps = [...new Set([...html.matchAll(pattern)].map((match) => match[1]))].sort();
    const recent = timestamps.slice(-MAX_FRAMES);
    if (!recent.length) throw new Error("No recent GOES frames were found.");
    const frames = recent.map((stamp) => ({
      time: isoFromTimestamp(stamp),
      url: `https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/${dir}/${stamp}_GOES19-ABI-CONUS-${dir}-1250x750.jpg`,
    }));
    return NextResponse.json({ channel, frames }, { headers: { "Cache-Control": "public, s-maxage=180, stale-while-revalidate=300" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The satellite image archive is unavailable right now." }, { status: 502 });
  }
}
