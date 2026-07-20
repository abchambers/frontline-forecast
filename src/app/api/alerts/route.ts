import { NextResponse } from "next/server";
import { weatherDeskLocation } from "@/lib/locations";

type NwsAlertFeature = {
  type: "Feature";
  geometry: unknown | null;
  properties: { event?: string; severity?: string; headline?: string; description?: string; effective?: string; expires?: string };
};

type NwsAlertResponse = { features?: NwsAlertFeature[] };

export async function GET(request: Request) {
  try {
    const location = weatherDeskLocation(new URL(request.url).searchParams.get("location"));
    const response = await fetch(`https://api.weather.gov/alerts/active?point=${location.latitude},${location.longitude}`, {
      headers: { "User-Agent": "The Weather Desk student forecasting project" },
      next: { revalidate: 120 },
    });
    if (!response.ok) throw new Error(`NWS alerts returned ${response.status}`);
    const data = await response.json() as NwsAlertResponse;
    const features = (data.features ?? []).filter((feature) => feature.geometry && feature.properties?.event);
    return NextResponse.json({ type: "FeatureCollection", features, provider: "National Weather Service", location: location.name, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=120" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "NWS alerts are unavailable." }, { status: 502 });
  }
}
