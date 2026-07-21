/**
 * The Weather Desk's provider-neutral weather contract.
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
