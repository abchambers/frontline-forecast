import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// SPC does not expose Mesoscale Discussions through api.weather.gov's product-type listing, so
// this parses SPC's own RSS feed instead — each item's description CDATA holds the full MD text
// (with an <img> tag for the graphic) ahead of a <pre> block containing the plain-text product.
const SOURCE_URL = "https://www.spc.noaa.gov/products/spcmdrss.xml";

type MesoscaleDiscussion = { id: string; title: string; issuedAt: string | null; imageUrl: string | null; text: string; link: string };

function textBetween(source: string, tag: string): string | null {
  const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1].trim() : null;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Real bug found during a scrutiny pass (Andrew, 2026-09-15): the RSS <pubDate> this used to rely on
// is a real, live SPC feed quirk — every item in a given feed refresh gets stamped with the SAME
// pubDate (confirmed live: two MDs issued 36 real minutes apart both carried an identical pubDate),
// so every discussion after the first showed a misleadingly duplicate/wrong issuance time. Fixed by
// deriving the real per-product issuance instant from the product text itself, which every MD reliably
// carries in two forms: a human header ("0235 PM CDT Tue Sep 15 2026", used here only for month/year —
// parsing a 12-hour time + timezone abbreviation correctly would mean building a TZ-abbreviation-to-
// UTC-offset table for no benefit) and a machine-parseable "Valid DDHHMMZ" window, already real UTC,
// used for the day/hour/minute instead. Falls back to the RSS pubDate only if a product text doesn't
// match this shape (defensive — this is SPC's own consistent format across every real MD checked).
function issuedAtFromMdText(text: string, fallback: string | null): string | null {
  const validMatch = text.match(/Valid\s+(\d{2})(\d{2})(\d{2})Z/);
  const dateMatch = text.match(/([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{4})/);
  if (validMatch && dateMatch) {
    const [, day, hour, minute] = validMatch;
    const [, monthAbbr, , year] = dateMatch;
    const monthIndex = MONTH_ABBR.indexOf(monthAbbr);
    if (monthIndex !== -1) {
      const utcMs = Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute));
      if (Number.isFinite(utcMs)) return new Date(utcMs).toISOString();
    }
  }
  return fallback;
}

function parseItems(xml: string): MesoscaleDiscussion[] {
  const items: MesoscaleDiscussion[] = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const block of itemBlocks) {
    const title = textBetween(block, "title") ?? "SPC Mesoscale Discussion";
    const link = textBetween(block, "link") ?? "https://www.spc.noaa.gov/products/md/";
    const pubDate = textBetween(block, "pubDate");
    const description = textBetween(block, "description") ?? "";
    const imageMatch = description.match(/<img[^>]*src="([^"]+)"/);
    const preMatch = description.match(/<pre>([\s\S]*?)<\/pre>/);
    const text = (preMatch ? preMatch[1] : description.replace(/<[^>]+>/g, "")).trim();
    const idMatch = title.match(/(\d+)/);
    const fallbackIssuedAt = pubDate ? new Date(pubDate).toISOString() : null;
    items.push({
      id: idMatch ? idMatch[1] : link,
      title,
      issuedAt: issuedAtFromMdText(text, fallbackIssuedAt),
      imageUrl: imageMatch ? imageMatch[1] : null,
      text,
      link,
    });
  }
  return items;
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "mcd", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  try {
    const response = await fetch(SOURCE_URL, { headers: { "User-Agent": "Frontline Forecast weather application" }, cache: "no-store" });
    if (!response.ok) throw new Error(`SPC mesoscale discussion feed returned ${response.status}`);
    const xml = await response.text();
    const discussions = parseItems(xml);
    return NextResponse.json({ discussions }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Mesoscale discussions are unavailable right now." }, { status: 502 });
  }
}
