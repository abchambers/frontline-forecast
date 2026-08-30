/**
 * Frontline Forecast's provider-neutral weather contract.
 *
 * External APIs and future sensor/model feeds are adapted into these small,
 * stable records before they reach a chart, forecast, or verification. This
 * keeps the UI independent of any one commercial feed and gives a future
 * ingest service one target schema for locally owned observations and models.
 */
export type WeatherSourceKind = "observation" | "model" | "sensor";

export type CanonicalWeatherPoint = {
  source: string;
  kind: WeatherSourceKind;
  locationId: string;
  observedAt: string;
  temperatureF: number | null;
  dewpointF: number | null;
  relativeHumidity: number | null;
  precipitationIn: number | null;
  precipitationProbability: number | null;
  windMph: number | null;
  windDirectionDeg: number | null;
  windGustMph: number | null;
  condition: string | null;
};

export function round(value: number | null | undefined, precision = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const multiplier = 10 ** precision;
  return Math.round(value * multiplier) / multiplier;
}

export function celsiusToFahrenheit(value: number | null | undefined) {
  return value === null || value === undefined ? null : round((value * 9) / 5 + 32);
}

export function metersPerSecondToMph(value: number | null | undefined) {
  return value === null || value === undefined ? null : round(value * 2.23694);
}

export function windDirectionLabel(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(value / 45) % 8];
}

export function canonicalObservation(input: Omit<CanonicalWeatherPoint, "kind">): CanonicalWeatherPoint {
  return { ...input, kind: "observation" };
}

export function canonicalModelPoint(input: Omit<CanonicalWeatherPoint, "kind">): CanonicalWeatherPoint {
  return { ...input, kind: "model" };
}

export function canonicalSensorPoint(input: Omit<CanonicalWeatherPoint, "kind">): CanonicalWeatherPoint {
  return { ...input, kind: "sensor" };
}

export type DailyOutlookDay = { date: string; label: string; high: number | null; low: number | null; shortForecast: string; precipitationChance: number | null; wind: string | null };

type ForecastPeriodLike = { startTime: string; temperature: number; precipitationChance: number | null; windSpeed: string | null; windDirection: string | null; shortForecast: string; isDaytime: boolean };

// Groups NWS's day/night forecast periods into one entry per calendar date. Shared between
// /api/weather (live) and /api/cron/outlook (the durable archive) so both produce identically
// keyed dates -- the archive backfills whatever dates the live feed no longer has.
//
// `high` is only ever set from a daytime (isDaytime: true) period and `low` only from a
// nighttime one -- NOT simply max/min across whatever periods happen to be present. Real bug this
// fixes (Andrew, live, 2026-08-31): once today's daytime period ages out of NWS's own feed (evening
// -- only "Tonight" is left), the old version of this function echoed that single leftover
// temperature into BOTH high and low ("70°/70°"), which reads as a real narrow-range day instead of
// "we don't have today's high anymore." Now a day with no daytime period in THIS batch simply
// reports high: null -- callers (the /api/weather merge, specifically) are responsible for filling
// that from a durable source (the archive) rather than this function fabricating a value.
export function reduceForecastPeriodsToDailyOutlook(periods: ForecastPeriodLike[], timezone: string): DailyOutlookDay[] {
  const days: DailyOutlookDay[] = [];
  for (const period of periods) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(period.startTime));
    const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(new Date(period.startTime));
    const wind = period.windSpeed ? `${period.windDirection ?? ""} ${period.windSpeed}`.trim() : null;
    let day = days.find((d) => d.date === date);
    if (!day) {
      if (days.length >= 7) continue;
      day = { date, label, high: null, low: null, shortForecast: period.shortForecast, precipitationChance: period.precipitationChance, wind };
      days.push(day);
    }
    if (period.isDaytime) {
      day.high = day.high === null ? period.temperature : Math.max(day.high, period.temperature);
    } else {
      day.low = day.low === null ? period.temperature : Math.min(day.low, period.temperature);
    }
    day.precipitationChance = Math.max(day.precipitationChance ?? 0, period.precipitationChance ?? 0);
  }
  return days;
}
