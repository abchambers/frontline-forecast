import { NextResponse } from "next/server";
import { resolveWeatherDeskLocation } from "@/lib/locations";
import { round } from "@/lib/weather-data";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// Feeds the meteogram's multi-model overlay. GFS/HRRR/NAM are already wired into this app via
// Open-Meteo (see /api/open-meteo), just one model at a time -- this route fetches all three in a
// SINGLE Open-Meteo call (its own documented multi-model support: a comma-separated `models` param
// returns one shared `time` array plus per-model fields suffixed by model id, e.g.
// `temperature_2m_ncep_hrrr_conus`), confirmed live before building this: all three return real,
// distinct values (not one model silently duplicated), fully populated for every field requested
// except NAM's precipitation_probability, which Open-Meteo simply doesn't provide for that model
// (confirmed null for every hour, not a bug) -- reported here as `null`, not fabricated.
const MODELS = [
  { key: "gfs", label: "GFS", id: "gfs_global" },
  { key: "hrrr", label: "HRRR", id: "ncep_hrrr_conus" },
  { key: "nam", label: "NAM", id: "ncep_nam_conus" },
] as const;

const FIELDS = ["temperature_2m", "dew_point_2m", "wind_speed_10m", "wind_gusts_10m", "cloud_cover", "precipitation_probability", "precipitation"] as const;

type OpenMeteoMultiResponse = { hourly?: Record<string, Array<number | null>> };

function series(hourly: OpenMeteoMultiResponse["hourly"], field: string, modelId: string) {
  const key = `${field}_${modelId}`;
  return (hourly?.[key] ?? []).map((value) => (typeof value === "number" ? round(value, 2) : null));
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "model-overlay", 30, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const location = resolveWeatherDeskLocation(new URL(request.url).searchParams);
  const parameters = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    // Real Open-Meteo behavior, confirmed live: passing the location's own IANA timezone returns
    // naive local wall-clock strings ("2026-09-10T00:00") with no offset -- new Date(...) on the
    // client would parse that using the VIEWER's browser timezone, not the forecast location's,
    // silently misaligning every hour for anyone not in the same zone as the forecast. Requesting
    // UTC instead (confirmed utc_offset_seconds:0) gives genuine UTC instants, matching NBM's own
    // hours contract exactly -- 'Z' is appended below so both sources parse identically downstream.
    timezone: "UTC",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    forecast_days: "2",
    models: MODELS.map((model) => model.id).join(","),
    hourly: FIELDS.join(","),
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${parameters}`, {
      headers: { "User-Agent": "Frontline Forecast weather application" },
      next: { revalidate: 900 },
    });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    const data = (await response.json()) as OpenMeteoMultiResponse;
    const hours = ((data.hourly?.time as unknown as string[] | undefined) ?? []).map((time) => `${time}:00Z`);
    const models = Object.fromEntries(MODELS.map((model) => [model.key, {
      label: model.label,
      temperatureF: series(data.hourly, "temperature_2m", model.id),
      dewpointF: series(data.hourly, "dew_point_2m", model.id),
      windMph: series(data.hourly, "wind_speed_10m", model.id),
      gustMph: series(data.hourly, "wind_gusts_10m", model.id),
      cloudCoverPct: series(data.hourly, "cloud_cover", model.id),
      precipProbabilityPct: series(data.hourly, "precipitation_probability", model.id),
      precipitationIn: series(data.hourly, "precipitation", model.id),
    }]));
    return NextResponse.json({ hours, models, source: "https://open-meteo.com/en/docs" }, { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=900" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Model overlay data is unavailable." }, { status: 502 });
  }
}
