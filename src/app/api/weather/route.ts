import { NextResponse } from "next/server";
import { resolveWeatherDeskLocation } from "@/lib/locations";
import { canonicalObservation, celsiusToFahrenheit, metersPerSecondToMph, windDirectionLabel, reduceForecastPeriodsToDailyOutlook, type DailyOutlookDay } from "@/lib/weather-data";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// Backfills dates the live NWS feed has already rolled past (see weather_daily_outlook_archive
// migration / /api/cron/outlook) using the service role -- this table has no client-facing RLS
// policy, so it can only be read server-side, never fetched from the browser.
async function fetchArchivedOutlook(locationId: string, timezone: string): Promise<DailyOutlookDay[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return [];
  const since = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/weather_daily_outlook?location_id=eq.${encodeURIComponent(locationId)}&valid_date=gte.${since}&order=valid_date.asc`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: "no-store" },
    );
    if (!response.ok) return [];
    const rows: { valid_date: string; label: string; high_f: number | null; low_f: number | null; short_forecast: string; precipitation_chance: number | null; wind: string | null }[] = await response.json();
    return rows.map((row) => ({ date: row.valid_date, label: row.label, high: row.high_f, low: row.low_f, shortForecast: row.short_forecast, precipitationChance: row.precipitation_chance, wind: row.wind }));
  } catch {
    return [];
  }
}

type NwsFeature<T> = { properties: T };

type PointProperties = {
  forecast: string;
  forecastHourly: string;
  observationStations: string;
  relativeLocation: { properties: { city: string; state: string } };
};

type ObservationProperties = {
  stationIdentifier: string;
  name: string;
  timestamp: string;
  textDescription: string;
  temperature: { value: number | null };
  dewpoint: { value: number | null };
  windSpeed: { value: number | null };
  windDirection: { value: number | null };
};

type ForecastPeriod = {
  name: string;
  startTime: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  detailedForecast: string;
  icon?: string | null;
  probabilityOfPrecipitation: { value: number | null };
  windSpeed?: string | null;
  windDirection?: string | null;
};

type AlertProperties = { event: string; headline: string | null; severity?: string | null; expires?: string | null; effective?: string | null; description?: string | null; instruction?: string | null; areaDesc?: string | null; senderName?: string | null };

async function nws<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json, application/ld+json",
      "User-Agent": "Frontline Forecast weather application",
    },
    // Alerts are safety-critical reference data for this workspace. Do not
    // serve a minutes-old cached response as if it were current.
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`NWS request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "weather", 60, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  try {
    const selectedLocation = resolveWeatherDeskLocation(new URL(request.url).searchParams);
    const point = await nws<NwsFeature<PointProperties>>(
      `https://api.weather.gov/points/${selectedLocation.latitude},${selectedLocation.longitude}`,
    );
    const pointData = point.properties;

    const stationList = await nws<{ features: NwsFeature<{ stationIdentifier: string }>[] }>(
      pointData.observationStations,
    );
    const stationId = stationList.features.find(({ properties }) => properties.stationIdentifier === selectedLocation.observationStation)?.properties.stationIdentifier
      ?? stationList.features[0]?.properties.stationIdentifier;
    if (!stationId) throw new Error("No nearby NWS observation station was available");

    const [observationResult, forecastResult, alertsResult] = await Promise.allSettled([
      nws<NwsFeature<ObservationProperties>>(
        `https://api.weather.gov/stations/${stationId}/observations/latest`,
      ),
      nws<{ properties: { periods: ForecastPeriod[] } }>(pointData.forecast),
      nws<{ features: NwsFeature<AlertProperties>[] }>(
        `https://api.weather.gov/alerts/active?point=${selectedLocation.latitude},${selectedLocation.longitude}`,
      ),
    ]);

    if (observationResult.status !== "fulfilled" || forecastResult.status !== "fulfilled") {
      const details = [observationResult, forecastResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : "NWS request failed")
        .join("; ");
      throw new Error(`NWS live data is temporarily unavailable: ${details}`);
    }

    const observation = observationResult.value;
    const forecast = forecastResult.value;
    const alertsAvailable = alertsResult.status === "fulfilled";
    const alerts = alertsAvailable ? alertsResult.value : { features: [] };

    // Live wins for any date the current NWS feed still has; the archive fills in the dates it's
    // already dropped (typically just yesterday, but the merge covers whatever's missing).
    const liveDailyOutlook = reduceForecastPeriodsToDailyOutlook(
      forecast.properties.periods.map((period) => ({ startTime: period.startTime, temperature: period.temperature, precipitationChance: period.probabilityOfPrecipitation.value, windSpeed: period.windSpeed ?? null, windDirection: period.windDirection ?? null, shortForecast: period.shortForecast })),
      selectedLocation.timezone,
    );
    const archivedDailyOutlook = await fetchArchivedOutlook(selectedLocation.id, selectedLocation.timezone);
    const dailyOutlookByDate = new Map<string, DailyOutlookDay>();
    for (const day of archivedDailyOutlook) dailyOutlookByDate.set(day.date, day);
    for (const day of liveDailyOutlook) dailyOutlookByDate.set(day.date, day);
    const dailyOutlook = [...dailyOutlookByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    const current = observation.properties;
    const nextPeriod = forecast.properties.periods[0];
    const observedTemperatureF = celsiusToFahrenheit(current.temperature.value);
    const forecastTemperatureF = nextPeriod?.temperature ?? null;
    const normalizedObservation = canonicalObservation({
      source: "NWS station observation",
      locationId: selectedLocation.id,
      observedAt: current.timestamp,
      temperatureF: observedTemperatureF,
      dewpointF: celsiusToFahrenheit(current.dewpoint.value),
      relativeHumidity: null,
      precipitationIn: null,
      precipitationProbability: null,
      windMph: metersPerSecondToMph(current.windSpeed.value),
      windDirectionDeg: current.windDirection.value,
      windGustMph: null,
      condition: current.textDescription,
    });

    return NextResponse.json(
      {
        location: selectedLocation.name,
        locationDetails: { ...selectedLocation, nwsOffice: (pointData as PointProperties & { gridId?: string }).gridId ?? null, gridX: (pointData as PointProperties & { gridX?: number }).gridX ?? null, gridY: (pointData as PointProperties & { gridY?: number }).gridY ?? null },
        observation: {
          station: current.stationIdentifier,
          stationName: current.name,
          observedAt: current.timestamp,
          description: current.textDescription,
          // Some METAR observations legitimately omit temperature. In that
          // case, keep the dashboard useful with a clearly identified NWS
          // forecast estimate rather than rendering a blank reading.
          temperatureF: observedTemperatureF ?? forecastTemperatureF,
          temperatureSource: observedTemperatureF === null && forecastTemperatureF !== null
            ? "forecast estimate"
            : "observation",
          dewpointF: normalizedObservation.dewpointF,
          windMph: normalizedObservation.windMph,
          windDirection: windDirectionLabel(normalizedObservation.windDirectionDeg),
        },
        normalizedObservation,
        forecast: nextPeriod
          ? {
              period: nextPeriod.name,
              temperature: nextPeriod.temperature,
              temperatureUnit: nextPeriod.temperatureUnit,
              shortForecast: nextPeriod.shortForecast,
              detailedForecast: nextPeriod.detailedForecast,
              precipitationChance: nextPeriod.probabilityOfPrecipitation.value,
            }
          : null,
        forecastPeriods: forecast.properties.periods.slice(0, 14).map((period) => ({
          name: period.name,
          startTime: period.startTime,
          temperature: period.temperature,
          temperatureUnit: period.temperatureUnit,
          shortForecast: period.shortForecast,
          precipitationChance: period.probabilityOfPrecipitation.value,
          icon: period.icon ?? null,
          windSpeed: period.windSpeed ?? null,
          windDirection: period.windDirection ?? null,
        })),
        alerts: alerts.features.slice(0, 10).map(({ properties }) => ({
          event: properties.event,
          headline: properties.headline,
          severity: properties.severity ?? "Unknown",
          expires: properties.expires ?? null,
          effective: properties.effective ?? null,
          description: properties.description ?? null,
          instruction: properties.instruction ?? null,
          areaDesc: properties.areaDesc ?? null,
          senderName: properties.senderName ?? null,
        })),
        alertsAvailable,
        dailyOutlook,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to load NWS weather data", error);
    return NextResponse.json(
      { error: "Live NWS data is temporarily unavailable. Please try again shortly." },
      { status: 502 },
    );
  }
}
