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
    items.push({
      id: idMatch ? idMatch[1] : link,
      title,
      issuedAt: pubDate ? new Date(pubDate).toISOString() : null,
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
