import { NextResponse } from "next/server";
import { resolveWeatherDeskLocation } from "@/lib/locations";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { parseNbmHourly, mergeNbmProducts } from "@/lib/nbm";

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
  // Generalized further 2026-09-10 while adding NBS support: NBH pads "KAHQ   NBM" (3
  // spaces) but NBS pads "KAHQ    NBM" (4 spaces) -- confirmed by diffing both products'
  // real header lines byte-for-byte -- so the gap between station code and "NBM" is now
  // matched with \s+ instead of a hardcoded 3 spaces, working for either product.
  const nextHeader = /\n\s*[A-Z][A-Z0-9]{3}\s+NBM\s+V/.exec(text.slice(start + station.length));
  const end = nextHeader ? start + station.length + nextHeader.index : start + 9000;
  return text.slice(Math.max(0, text.lastIndexOf("\n", start - 1)), end).trim();
}

// blend_nbhtx = NBH, hourly resolution out to ~25h. blend_nbstx = NBS, 3-hourly out to ~72h --
// same fixed-width bulletin family, real element overlap confirmed live (TMP/DPT/SKY/WDR/WSP/GST
// match directly; precip/rain/thunderstorm fields change shape with the coarser resolution, e.g.
// NBH's hourly P01 vs NBS's windowed P06/P12 -- see mergeNbmProducts for why those are kept
// separate rather than faked into a continuation).
async function fetchNbmProduct(product: "nbh" | "nbs", station: string) {
  const file = product === "nbh" ? "blend_nbhtx" : "blend_nbstx";
  for (const candidate of cycleCandidates()) {
    const { datePart, hour } = formatRun(candidate);
    const url = `https://nomads.ncep.noaa.gov/pub/data/nccf/com/blend/prod/blend.${datePart}/${hour}/text/${file}.t${hour}z`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": "Frontline Forecast weather application" }, cache: "no-store" });
      if (!response.ok) continue;
      const bulletin = stationBulletin(await response.text(), station);
      if (!bulletin) continue;
      const cycle = `${datePart} ${hour}Z`;
      const parsed = parseNbmHourly(bulletin, candidate);
      if (!parsed) continue;
      return { bulletin, cycle, parsed, url };
    } catch {
      continue;
    }
  }
  return null;
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "nbm", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const location = resolveWeatherDeskLocation(new URL(request.url).searchParams);
  const station = location.observationStation;

  const nbh = await fetchNbmProduct("nbh", station);
  if (!nbh) return NextResponse.json({ error: "The latest NBM station bulletin is not available right now." }, { status: 502 });

  // NBS is a real, separate fetch -- best-effort. A visitor still gets the full NBH-only
  // experience (this is exactly how the meteogram worked before NBS support existed) if NBS is
  // slow, missing for this station, or fails outright; it's additive range, not the core source.
  const nbs = await fetchNbmProduct("nbs", station).catch(() => null);
  const hourly = nbs ? { ...mergeNbmProducts(nbh.parsed, nbs.parsed), station, cycle: nbh.cycle } : { ...nbh.parsed, station, cycle: nbh.cycle };

  return NextResponse.json({ station, cycle: nbh.cycle, text: nbh.bulletin, hourly, source: nbh.url }, { headers: { "Cache-Control": "s-maxage=1800" } });
}
