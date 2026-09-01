import { NextResponse } from "next/server";
import { weatherDeskLocation } from "@/lib/locations";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

type NwsAlertFeature = {
  type: "Feature";
  geometry: unknown | null;
  properties: { event?: string; severity?: string; headline?: string; description?: string; effective?: string; expires?: string; affectedZones?: string[] };
};

type NwsAlertResponse = { features?: NwsAlertFeature[] };

// Real bug found live, 2026-09-01: NWS's own point-query endpoint returns `geometry: null` for the
// large majority of active alerts (confirmed against the live nationwide feed: 376 of 407 active
// alerts, 92%) -- every zone-based product (Heat Advisory, Flood Watch, Small Craft Advisory, Red
// Flag Warning, etc.) has no inline polygon at all, only storm-based products (Flash Flood Warning,
// Tropical Storm Warning) carry one directly. The old code's `feature.geometry &&` filter silently
// dropped every one of those, which is almost certainly why watch/warning polygons stopped showing
// up on the map -- not that there was nothing active, but that most of what's active has no
// geometry of its own to filter on.
//
// The fix: a zone-based alert instead references its `affectedZones` (a list of NWS zone URLs, e.g.
// https://api.weather.gov/zones/forecast/ILZ027) -- each zone endpoint DOES carry a real polygon.
// Resolve those and emit one Feature per zone, all sharing the original alert's properties (event,
// headline, etc.) for the tooltip -- simpler and safer than unioning geometries client-side, and
// exactly how Leaflet's L.geoJSON already expects a FeatureCollection of many features to work.
const zoneGeometryCache = new Map<string, { geometry: unknown | null; expiresAt: number }>();
// Zone boundaries are real, static NWS/Census-derived polygons -- they don't change -- so this is
// cached far longer than the alerts themselves (which genuinely change minute to minute). 7 days is
// just a safety valve against this module-level cache growing forever across a long-lived warm
// instance, not because the data is expected to actually change.
const ZONE_CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

async function resolveZoneGeometry(zoneUrl: string): Promise<unknown | null> {
  const cached = zoneGeometryCache.get(zoneUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.geometry;
  try {
    const response = await fetch(zoneUrl, { headers: { "User-Agent": "Frontline Forecast weather application" }, next: { revalidate: 604_800 } });
    const geometry = response.ok ? ((await response.json()) as { geometry?: unknown }).geometry ?? null : null;
    zoneGeometryCache.set(zoneUrl, { geometry, expiresAt: Date.now() + ZONE_CACHE_TTL_MS });
    return geometry;
  } catch {
    // Don't cache a network failure as a permanent null -- a transient timeout shouldn't hide this
    // zone's polygon for the next 7 days too, only this one request should degrade.
    return null;
  }
}

// A single advisory can span dozens of zones (a statewide Heat Advisory saw live had 29) -- resolved
// in parallel per feature, deduped across features within one request (many overlapping alerts for a
// point often share zones) so a warm cache miss on a busy day doesn't mean dozens of redundant fetches.
async function resolveFeatureGeometries(feature: NwsAlertFeature, zoneCache: Map<string, Promise<unknown | null>>): Promise<NwsAlertFeature[]> {
  if (feature.geometry) return [feature];
  const zoneUrls = feature.properties.affectedZones ?? [];
  const geometries = await Promise.all(
    zoneUrls.map((url) => {
      if (!zoneCache.has(url)) zoneCache.set(url, resolveZoneGeometry(url));
      return zoneCache.get(url)!;
    }),
  );
  return geometries.filter((geometry): geometry is NonNullable<typeof geometry> => geometry != null).map((geometry) => ({ ...feature, geometry }));
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "alerts", 60, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  try {
    const location = weatherDeskLocation(new URL(request.url).searchParams.get("location"));
    const response = await fetch(`https://api.weather.gov/alerts/active?point=${location.latitude},${location.longitude}`, {
      headers: { "User-Agent": "Frontline Forecast weather application" },
      next: { revalidate: 120 },
    });
    if (!response.ok) throw new Error(`NWS alerts returned ${response.status}`);
    const data = await response.json() as NwsAlertResponse;
    const rawFeatures = (data.features ?? []).filter((feature) => feature.properties?.event);

    const requestZoneCache = new Map<string, Promise<unknown | null>>();
    const resolved = await Promise.all(rawFeatures.map((feature) => resolveFeatureGeometries(feature, requestZoneCache)));
    const features = resolved.flat();

    return NextResponse.json({ type: "FeatureCollection", features, provider: "National Weather Service", location: location.name, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=120" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "NWS alerts are unavailable." }, { status: 502 });
  }
}
