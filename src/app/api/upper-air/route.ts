import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// SPC's live upper-air observation charts — 250mb (jet stream/isotachs), 300mb, 500mb
// (heights/troughs & ridges), 700/850/925mb (lower-level moisture, temps, low-level jet). Real NWS
// station-plot analyses, produced twice daily (00Z/12Z) from actual radiosonde/aircraft/satellite
// observations, not model output. SPC doesn't publish a stable "latest.gif" alias per level — the
// filename itself is timestamped (e.g. 250_260828_00.gif) and changes every cycle — so this proxies
// the index page's HTML once, per request, to find each level's current filename rather than trying
// to compute the expected timestamp ourselves (fragile: cycles have a real, sometimes-late
// production lag after 00Z/12Z that isn't worth guessing at).
const INDEX_URL = "https://www.spc.noaa.gov/obswx/maps/";
const LEVELS = ["250", "300", "500", "700", "850", "925"] as const;

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "upper-air", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  try {
    const response = await fetch(INDEX_URL, { headers: { "User-Agent": "Frontline Forecast weather application" }, cache: "no-store" });
    if (!response.ok) throw new Error(`SPC upper-air index returned ${response.status}`);
    const html = await response.text();

    const levels: Record<string, string> = {};
    let validTime: string | null = null;
    for (const level of LEVELS) {
      const match = html.match(new RegExp(`/obswx/maps/${level}_(\\d{2})(\\d{2})(\\d{2})_(\\d{2})\\.gif`));
      if (!match) continue;
      levels[level] = `https://www.spc.noaa.gov${match[0]}`;
      if (!validTime) {
        const [, yy, mm, dd, hh] = match;
        validTime = `20${yy}-${mm}-${dd}T${hh}:00:00Z`;
      }
    }
    if (!Object.keys(levels).length) throw new Error("No upper-air chart images found.");

    return NextResponse.json({ validTime, levels }, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=1800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upper-air charts are unavailable right now." }, { status: 502 });
  }
}
