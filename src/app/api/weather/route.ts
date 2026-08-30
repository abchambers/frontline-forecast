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
  // Andrew, 2026-08-31: this used to fail completely silently (both the missing-env-var case and
  // any fetch/HTTP failure just returned [] with no trace), which made a real production
  // discrepancy (dev correctly showed today's archived high, prod showed null for the same
  // location/date/row) impossible to diagnose from logs alone. Logging here costs nothing --
  // this path already fails open to an empty array either way -- but now at least says why.
  if (!supabaseUrl || !serviceKey) { console.error("[weather] archived outlook skipped: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); return []; }
  const since = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/weather_daily_outlook?location_id=eq.${encodeURIComponent(locationId)}&valid_date=gte.${since}&order=valid_date.asc`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, cache: "no-store" },
    );
    if (!response.ok) { console.error(`[weather] archived outlook fetch failed for ${locationId}: HTTP ${response.status} ${await response.text().catch(() => "")}`); return []; }
    const rows: { valid_date: string; label: string; high_f: number | null; low_f: number | null; short_forecast: string; precipitation_chance: number | null; wind: string | null }[] = await response.json();
    return rows.map((row) => ({ date: row.valid_date, label: row.label, high: row.high_f, low: row.low_f, shortForecast: row.short_forecast, precipitationChance: row.precipitation_chance, wind: row.wind }));
  } catch (error) {
    console.error(`[weather] archived outlook fetch threw for ${locationId}:`, error);
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
  isDaytime: boolean;
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

    const [observationResult, forecastResult, alertsResult, hourlyResult] = await Promise.allSettled([
      nws<NwsFeature<ObservationProperties>>(
        `https://api.weather.gov/stations/${stationId}/observations/latest`,
      ),
      nws<{ properties: { periods: ForecastPeriod[] } }>(pointData.forecast),
      nws<{ features: NwsFeature<AlertProperties>[] }>(
        `https://api.weather.gov/alerts/active?point=${selectedLocation.latitude},${selectedLocation.longitude}`,
      ),
      // Andrew, 2026-08-29: new 12-hour view, unrelated to radar — pointData.forecastHourly was
      // already captured from the NWS point response but never fetched. Same free NWS product as
      // the daily forecast, just the hourly grid instead of the 7-day one; not gated behind sign-in
      // like the forecaster tools, since this is plain NWS guidance same as the 7-day outlook.
      nws<{ properties: { periods: (ForecastPeriod & { isDaytime: boolean })[] } }>(pointData.forecastHourly),
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
    //
    // Andrew, live (2026-08-31): today's card showed "70°/70°" in the evening -- once today's
    // daytime period rolls out of NWS's own feed (only "Tonight" is left), the old version of this
    // reducer had no day/night awareness and just echoed that single leftover temperature into BOTH
    // high and low. Real fix per Andrew: hold onto today's actual high once we've seen it, and only
    // let a REAL replacement overwrite it -- a missing value should never erase a known one. Two
    // parts: the reducer below now only ever assigns `high` from an isDaytime period and `low` from
    // a night period (so an evening-only fetch correctly reports high:null for today, not a fake
    // echoed value), and the merge just below prefers live's value but falls back to the archive's
    // whenever live doesn't have one for that field -- so once the archive captured this morning's
    // real high (the daily cron runs at 8:45am ET, comfortably before today's daytime period drops
    // out of NWS's feed), the evening view keeps showing it instead of losing it.
    const liveDailyOutlook = reduceForecastPeriodsToDailyOutlook(
      forecast.properties.periods.map((period) => ({ startTime: period.startTime, temperature: period.temperature, precipitationChance: period.probabilityOfPrecipitation.value, windSpeed: period.windSpeed ?? null, windDirection: period.windDirection ?? null, shortForecast: period.shortForecast, isDaytime: period.isDaytime })),
      selectedLocation.timezone,
    );
    const archivedDailyOutlook = await fetchArchivedOutlook(selectedLocation.id, selectedLocation.timezone);
    const archivedByDate = new Map(archivedDailyOutlook.map((day) => [day.date, day]));
    const dailyOutlookByDate = new Map<string, DailyOutlookDay>();
    for (const day of archivedDailyOutlook) dailyOutlookByDate.set(day.date, day);
    for (const day of liveDailyOutlook) {
      const archived = archivedByDate.get(day.date);
      dailyOutlookByDate.set(day.date, { ...day, high: day.high ?? archived?.high ?? null, low: day.low ?? archived?.low ?? null });
    }
    const dailyOutlook = [...dailyOutlookByDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    // 12-hour view, unrelated to radar — sits between the reference-data panel and Radar on the
    // page. Failing open to an empty array rather than throwing: this is a nice-to-have alongside
    // the daily outlook/observation, not core enough to take down the whole /api/weather response.
    const hourly = hourlyResult.status === "fulfilled"
      ? hourlyResult.value.properties.periods.slice(0, 12).map((period) => ({
          startTime: period.startTime,
          temperatureF: period.temperature,
          shortForecast: period.shortForecast,
          precipitationChance: period.probabilityOfPrecipitation.value,
          windSpeed: period.windSpeed ?? null,
          windDirection: period.windDirection ?? null,
          isDaytime: period.isDaytime,
        }))
      : [];

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
          isDaytime: period.isDaytime,
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
        hourly,
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
