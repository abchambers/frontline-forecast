import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { nearestUpperAirStation } from "@/lib/upper-air-stations";

// Prototype for dynamic location resolution: given raw coordinates (from browser geolocation or a
// manual pin), resolve everything the rest of the app currently expects a hand-curated preset in
// src/lib/locations.ts to supply. api.weather.gov/points already knows the forecast office (cwa),
// radar site, nearest observation station collection, and IANA time zone for any US point — the
// one gap it doesn't fill is the upper-air (sounding) site, which nearestUpperAirStation covers
// locally since NWS has no API for it.
type PointProperties = {
  cwa: string;
  radarStation: string | null;
  timeZone: string;
  observationStations: string;
  relativeLocation: { properties: { city: string; state: string } };
};

async function nws<T>(url: string) {
  const response = await fetch(url, {
    headers: { Accept: "application/geo+json", "User-Agent": "Frontline Forecast weather application" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`NWS request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "location-lookup", 20, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const params = new URL(request.url).searchParams;
  const stationId = params.get("stationId")?.trim().toUpperCase();
  const query = params.get("q")?.trim();
  let latitude = Number(params.get("lat"));
  let longitude = Number(params.get("lon"));

  try {
    // A typed station ID (e.g. KDFW) resolves to coordinates first; either path converges on the
    // same points-based resolution below.
    if (stationId) {
      if (!/^[A-Z0-9]{3,5}$/.test(stationId)) {
        return NextResponse.json({ error: "Station IDs are 3-5 letters/numbers, e.g. KDFW." }, { status: 400 });
      }
      const station = await nws<{ geometry: { coordinates: [number, number] } | null }>(`https://api.weather.gov/stations/${stationId}`);
      if (!station.geometry) throw new Error(`${stationId} has no known coordinates.`);
      [longitude, latitude] = station.geometry.coordinates;
    } else if (query) {
      // Free-text city/state/ZIP search. Open-Meteo's geocoder is free, keyless, and ranks by
      // population -- good enough to take the top match rather than building a disambiguation UI.
      if (query.length < 2 || query.length > 100) {
        return NextResponse.json({ error: "Enter a city, state, or ZIP code." }, { status: 400 });
      }
      const geoResponse = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&country=US&language=en&format=json`,
        { cache: "no-store" },
      );
      if (!geoResponse.ok) throw new Error("Location search is temporarily unavailable.");
      const geoData = await geoResponse.json() as { results?: { latitude: number; longitude: number }[] };
      const match = geoData.results?.[0];
      if (!match) return NextResponse.json({ error: `No U.S. location found for "${query}". Try a city, state, or ZIP code.` }, { status: 404 });
      latitude = match.latitude;
      longitude = match.longitude;
    }

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return NextResponse.json({ error: "A valid station ID, location search, or lat/lon pair is required." }, { status: 400 });
    }

    const point = await nws<{ properties: PointProperties }>(
      `https://api.weather.gov/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`,
    );
    const pointData = point.properties;

    // Honor a typed station ID exactly rather than silently substituting whatever the points API
    // considers "nearest" — a user who typed KDFW wants KDFW, even if a closer site exists.
    let observationStation = stationId ?? null;
    if (!observationStation) {
      const stationList = await nws<{ features: { properties: { stationIdentifier: string } }[] }>(pointData.observationStations);
      observationStation = stationList.features[0]?.properties.stationIdentifier ?? null;
    }

    const { station: upperAirStation, distanceKm: upperAirDistanceKm } = nearestUpperAirStation(latitude, longitude);

    return NextResponse.json({
      latitude,
      longitude,
      city: pointData.relativeLocation.properties.city,
      state: pointData.relativeLocation.properties.state,
      timezone: pointData.timeZone,
      forecastOffice: pointData.cwa,
      radarSite: pointData.radarStation,
      observationStation,
      upperAirStation: upperAirStation.id,
      upperAirStationName: upperAirStation.name,
      upperAirDistanceKm,
    }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to resolve this location right now." }, { status: 502 });
  }
}
