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

type ForecastPeriodLike = { startTime: string; temperature: number; precipitationChance: number | null; windSpeed: string | null; windDirection: string | null; shortForecast: string };

// Groups NWS's day/night forecast periods into one entry per calendar date. Shared between
// /api/weather (live) and /api/cron/outlook (the durable archive) so both produce identically
// keyed dates -- the archive backfills whatever dates the live feed no longer has.
export function reduceForecastPeriodsToDailyOutlook(periods: ForecastPeriodLike[], timezone: string): DailyOutlookDay[] {
  const days: DailyOutlookDay[] = [];
  for (const period of periods) {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(period.startTime));
    const label = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: timezone }).format(new Date(period.startTime));
    const wind = period.windSpeed ? `${period.windDirection ?? ""} ${period.windSpeed}`.trim() : null;
    const existing = days.find((day) => day.date === date);
    if (existing) {
      existing.high = existing.high === null ? period.temperature : Math.max(existing.high, period.temperature);
      existing.low = existing.low === null ? period.temperature : Math.min(existing.low, period.temperature);
      existing.precipitationChance = Math.max(existing.precipitationChance ?? 0, period.precipitationChance ?? 0);
    } else if (days.length < 7) {
      days.push({ date, label, high: period.temperature, low: period.temperature, shortForecast: period.shortForecast, precipitationChance: period.precipitationChance, wind });
    }
  }
  return days;
}
