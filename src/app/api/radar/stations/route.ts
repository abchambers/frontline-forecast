import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// Powers the station picker — live from NWS, not a hardcoded list, matching
// how the rest of the in-house radar work resolves site data (see
// src/lib/nexrad/site.ts). The full endpoint returns 208 "radar stations"
// including TDWR (airport terminal radar, different product set) and wind
// profilers (not weather radar at all) — filtered to the 159 real WSR-88D
// sites this app can actually show data for. The raw response also carries
// a lot of live operability/telemetry fields (transmitter power, alarm
// status, etc.) irrelevant to picking a station, trimmed down here to keep
// the payload small.
const NWS_STATIONS_URL = "https://api.weather.gov/radar/stations";
// Station locations essentially never change (a WSR-88D site isn't going to
// move), so this can be cached far longer than any live weather data.
const CACHE_TTL_MS = 24 * 60 * 60_000;

type NwsStationFeature = {
  geometry: { coordinates: [number, number] };
  properties: { id: string; name: string; stationType: string };
};

export type RadarStationSummary = { id: string; name: string; latitude: number; longitude: number };

let cache: { data: RadarStationSummary[]; expiresAt: number } | null = null;

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-stations", 20, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  if (cache && cache.expiresAt > Date.now()) {
    return NextResponse.json(cache.data, { headers: { "Cache-Control": "public, max-age=3600", "X-Radar-Source": "cache" } });
  }

  try {
    const response = await fetch(NWS_STATIONS_URL, {
      headers: { Accept: "application/geo+json", "User-Agent": "Frontline Forecast weather application" },
    });
    if (!response.ok) throw new Error(`NWS radar station list failed (${response.status})`);
    const data = (await response.json()) as { features: NwsStationFeature[] };

    const stations: RadarStationSummary[] = data.features
      .filter((feature) => feature.properties.stationType === "WSR-88D")
      .map((feature) => ({
        id: feature.properties.id,
        name: feature.properties.name,
        longitude: feature.geometry.coordinates[0],
        latitude: feature.geometry.coordinates[1],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    cache = { data: stations, expiresAt: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(stations, { headers: { "Cache-Control": "public, max-age=3600", "X-Radar-Source": "live" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load the radar station list right now." },
      { status: 502 },
    );
  }
}
