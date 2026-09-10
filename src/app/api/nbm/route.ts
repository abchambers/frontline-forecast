import { NextResponse } from "next/server";
import { resolveWeatherDeskLocation } from "@/lib/locations";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { parseNbmHourly } from "@/lib/nbm";

function cycleCandidates() {
  const candidates: Date[] = [];
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  for (let offset = 1; offset <= 8; offset += 1) {
    candidates.push(new Date(now.getTime() - offset * 60 * 60 * 1000));
  }
  return candidates;
}

function formatRun(date: Date) {
  const datePart = date.toISOString().slice(0, 10).replaceAll("-", "");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return { datePart, hour };
}

function stationBulletin(text: string, station: string) {
  const start = text.indexOf(station);
  if (start < 0) return null;
  // Real bug (found 2026-09-09): the next station's header line is "\n KAHQ   NBM ..." --
  // note the space between the newline and the station code, matching every other row's
  // fixed-width " LBL" convention. Searching for "\nK" (no space) never matches, silently
  // falling through to the 9000-char fallback below and leaking 2+ additional stations'
  // worth of data (confirmed live: a saved reference for one station's bulletin contained
  // three full station blocks concatenated, cut off mid-row at the 9000-char mark).
  const nextHeader = /\n [A-Z][A-Z0-9]{3}   NBM /.exec(text.slice(start + station.length));
  const end = nextHeader ? start + station.length + nextHeader.index : start + 9000;
  return text.slice(Math.max(0, text.lastIndexOf("\n", start - 1)), end).trim();
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "nbm", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const location = resolveWeatherDeskLocation(new URL(request.url).searchParams);
  const station = location.observationStation;
  for (const candidate of cycleCandidates()) {
    const { datePart, hour } = formatRun(candidate);
    const url = `https://nomads.ncep.noaa.gov/pub/data/nccf/com/blend/prod/blend.${datePart}/${hour}/text/blend_nbhtx.t${hour}z`;
    try {
      // NBM text bulletins can be tens of megabytes. We cache the small
      // extracted station bulletin in the response instead of asking Next to
      // cache the full upstream document.
      const response = await fetch(url, { headers: { "User-Agent": "Frontline Forecast weather application" }, cache: "no-store" });
      if (!response.ok) continue;
      const bulletin = stationBulletin(await response.text(), station);
      if (bulletin) {
        const cycle = `${datePart} ${hour}Z`;
        const parsed = parseNbmHourly(bulletin, candidate);
        return NextResponse.json({ station, cycle, text: bulletin, hourly: parsed ? { ...parsed, station, cycle } : null, source: url }, { headers: { "Cache-Control": "s-maxage=1800" } });
      }
    } catch {
      continue;
    }
  }
  return NextResponse.json({ error: "The latest NBM station bulletin is not available right now." }, { status: 502 });
}
