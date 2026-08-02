/** Shared verification contract for browser collection, cron jobs, and future sensor ingestion. */
export type ForecastPeriodActual = {
  observationCount: number;
  highF: number | null;
  lowF: number | null;
  maxWindMph: number | null;
  precipitationObserved: boolean;
  conditions: string[];
  complete: boolean;
};

export type AutomaticScoringConfig = {
  temperatureWeight: number;
  temperaturePenaltyPerDegree: number;
  precipitationWeight: number;
  precipitationThresholdPercent: number;
};

// Kept in sync with the seed row for site_content key "hq.algorithms" (see
// supabase/migrations/20260802160000_seed_algorithm_settings.sql) — this is the fallback used if
// that row is ever missing, not a second source of truth to edit independently of it.
export const defaultAutomaticScoringConfig: AutomaticScoringConfig = {
  temperatureWeight: 70,
  temperaturePenaltyPerDegree: 10,
  precipitationWeight: 30,
  precipitationThresholdPercent: 50,
};

/**
 * Transparent scoring rule, editable at HQ > Algorithms: temperature accuracy supplies
 * `temperatureWeight` points, losing `temperaturePenaltyPerDegree` per degree F of error, and the
 * precipitation-occurrence call supplies `precipitationWeight` points, all-or-nothing, based on
 * whether the forecast's rain chance crossed `precipitationThresholdPercent`. Keep this pure so the
 * same input creates the same score whether it came from NWS or owned sensors.
 */
export function automaticForecastScore(forecastTemperature: string, rainChance: string, actual: ForecastPeriodActual, useHigh: boolean, config: AutomaticScoringConfig = defaultAutomaticScoringConfig) {
  const predictedTemperature = Number.parseFloat(forecastTemperature);
  const observedTemperature = useHigh ? actual.highF : actual.lowF;
  if (!actual.observationCount || !Number.isFinite(predictedTemperature) || observedTemperature === null) return null;
  const temperaturePoints = Math.max(0, config.temperatureWeight - Math.abs(predictedTemperature - observedTemperature) * config.temperaturePenaltyPerDegree);
  const precipitationPoints = (Number.parseFloat(rainChance) >= config.precipitationThresholdPercent) === actual.precipitationObserved ? config.precipitationWeight : 0;
  return Math.round(temperaturePoints + precipitationPoints);
}
