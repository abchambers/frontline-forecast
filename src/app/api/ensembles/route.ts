import { NextResponse } from "next/server";

const ATHENS = { latitude: "33.9519", longitude: "-83.3576", timezone: "America/New_York" };

type EnsembleResponse = { hourly?: Record<string, Array<string | number | null>> };

function numberAt(values: Array<string | number | null> | undefined, index: number) {
  const value = values?.[index];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function membersFor(hourly: EnsembleResponse["hourly"], base: string, index: number) {
  return Object.entries(hourly ?? {})
    .filter(([key]) => key === base || new RegExp(`^${base}_member\\d+$`).test(key))
    .map(([, values]) => numberAt(values, index))
    .filter((value): value is number => value !== null);
}

function distribution(values: number[]) {
  if (!values.length) return { members: 0, min: null, max: null, mean: null, spread: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { members: values.length, min: sorted[0], max: sorted.at(-1) ?? null, mean: Math.round(mean), spread: Math.round(Math.sqrt(variance)) };
}

export async function GET() {
  const parameters = new URLSearchParams({
    ...ATHENS,
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    forecast_days: "10",
    models: "gfs_seamless",
    hourly: "temperature_2m,precipitation,wind_speed_10m",
  });

  try {
    const response = await fetch(`https://ensemble-api.open-meteo.com/v1/ensemble?${parameters}`, {
      headers: { "User-Agent": "The Weather Desk student forecasting project" },
      next: { revalidate: 1800 },
    });
    if (!response.ok) throw new Error(`Open-Meteo ensemble returned ${response.status}`);
    const data = await response.json() as EnsembleResponse;
    const times = data.hourly?.time ?? [];
    const rows = times.slice(0, 80).map((time, index) => ({
      time: String(time),
      temperature: distribution(membersFor(data.hourly, "temperature_2m", index)),
      precipitation: distribution(membersFor(data.hourly, "precipitation", index)),
      wind: distribution(membersFor(data.hourly, "wind_speed_10m", index)),
    }));
    return NextResponse.json({ provider: "Open-Meteo Ensemble API", model: "NOAA GFS ensemble", location: "Athens, GA", rows, source: "https://open-meteo.com/en/docs/ensemble-api", fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=1800" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ensemble guidance is unavailable." }, { status: 502 });
  }
}
