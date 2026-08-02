import { NextRequest, NextResponse } from "next/server";
import { defaultWeatherDeskLocation, weatherDeskLocations } from "@/lib/locations";
import { automaticForecastScore, defaultAutomaticScoringConfig, type AutomaticScoringConfig, type ForecastPeriodActual } from "@/lib/forecast-verification";

type Period = { id: string; valid_date: string; period: "day" | "night"; forecast_data: { highLow?: string; rainChance?: string } };
type Run = { id: string; location_name?: string | null; forecast_periods: Period[] };
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Scheduler storage is not configured." }, { status: 500 });
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
  try {
    const scoringConfigResponse = await fetch(`${supabaseUrl}/rest/v1/site_content?select=value&key=eq.hq.algorithms`, { headers, cache: "no-store" });
    const scoringConfigRow = scoringConfigResponse.ok ? (await scoringConfigResponse.json() as { value: Partial<AutomaticScoringConfig> }[])[0] : undefined;
    const scoringConfig: AutomaticScoringConfig = { ...defaultAutomaticScoringConfig, ...scoringConfigRow?.value };

    const runsResponse = await fetch(`${supabaseUrl}/rest/v1/forecast_runs?select=id,location_name,forecast_periods(id,valid_date,period,forecast_data)&status=eq.submitted`, { headers, cache: "no-store" });
    if (!runsResponse.ok) throw new Error("Unable to load submitted forecast runs.");
    const runs = await runsResponse.json() as Run[];
    const targets = [...new Map(runs.flatMap((run) => run.forecast_periods.map((period) => {
      const location = weatherDeskLocations.find((item) => item.name === run.location_name) ?? defaultWeatherDeskLocation;
      return [`${period.valid_date}:${location.id}`, { date: period.valid_date, locationId: location.id }];
    }))).values()];
    const actuals = new Map<string, { day: ForecastPeriodActual; night: ForecastPeriodActual }>();
    await Promise.all(targets.map(async ({ date, locationId }) => {
      const response = await fetch(new URL(`/api/verify?date=${date}&location=${locationId}`, request.url), { cache: "no-store" });
      if (response.ok) actuals.set(`${date}:${locationId}`, await response.json());
    }));
    let saved = 0;
    for (const run of runs) {
      let allComplete = run.forecast_periods.length > 0;
      let allSavedWithScores = run.forecast_periods.length > 0;
      const location = weatherDeskLocations.find((item) => item.name === run.location_name) ?? defaultWeatherDeskLocation;
      for (const period of run.forecast_periods) {
        const actual = actuals.get(`${period.valid_date}:${location.id}`)?.[period.period];
        if (!actual) { allComplete = false; allSavedWithScores = false; continue; }
        const automaticScore = automaticForecastScore(period.forecast_data.highLow ?? "", period.forecast_data.rainChance ?? "", actual, period.period === "day", scoringConfig);
        const response = await fetch(`${supabaseUrl}/rest/v1/forecast_verifications?on_conflict=forecast_period_id`, { method: "POST", headers, body: JSON.stringify({ forecast_period_id: period.id, observed_data: actual, score_data: { automaticScore, preliminary: !actual.complete, method: `temperature (${scoringConfig.temperatureWeight}) + precipitation occurrence (${scoringConfig.precipitationWeight})`, automatedAt: new Date().toISOString() } }) });
        if (response.ok) saved += 1;
        else allSavedWithScores = false;
        if (!actual.complete || automaticScore === null) { allComplete = false; allSavedWithScores = false; }
      }
      // A forecast is not called verified simply because its valid times have
      // elapsed. Both observations and both computed scores must be persisted.
      if (allComplete && allSavedWithScores) {
        const statusResponse = await fetch(`${supabaseUrl}/rest/v1/forecast_runs?id=eq.${run.id}`, { method: "PATCH", headers, body: JSON.stringify({ status: "verified" }) });
        if (!statusResponse.ok) throw new Error(`Verification records were saved, but run ${run.id} could not be marked verified.`);
      }
    }
    return NextResponse.json({ checkedRuns: runs.length, savedPeriods: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Automated verification failed." }, { status: 500 });
  }
}
