import { NextResponse } from "next/server";
import { resolveWeatherDeskLocation } from "@/lib/locations";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

type ProductListing = { "@graph": Array<{ id: string; issuanceTime: string }> };
type ProductText = { productText: string; issuanceTime: string; issuingOffice: string };

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "afd", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const location = resolveWeatherDeskLocation(new URL(request.url).searchParams);
  // The upper-air station id doubles as the NWS forecast office (WFO) identifier for these
  // locations — e.g. Peachtree City GA's office and its co-located sounding site are both "FFC".
  const wfo = location.upperAirStation;
  const headers = { Accept: "application/geo+json", "User-Agent": "Frontline Forecast weather application" };
  try {
    const listing = await fetch(`https://api.weather.gov/products/types/AFD/locations/${wfo}`, { headers, cache: "no-store" });
    if (!listing.ok) throw new Error(`NWS product listing returned ${listing.status}`);
    const listingData = await listing.json() as ProductListing;
    const latest = listingData["@graph"]?.[0];
    if (!latest) throw new Error("No recent forecast discussion was found for this office.");
    const product = await fetch(`https://api.weather.gov/products/${latest.id}`, { headers, cache: "no-store" });
    if (!product.ok) throw new Error(`NWS product text returned ${product.status}`);
    const productData = await product.json() as ProductText;
    return NextResponse.json(
      { office: productData.issuingOffice, issuedAt: productData.issuanceTime, text: productData.productText.trim() },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" } },
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The forecast discussion is unavailable right now." }, { status: 502 });
  }
}
