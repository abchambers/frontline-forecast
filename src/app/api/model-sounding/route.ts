import { NextResponse } from "next/server";
import { weatherDeskLocation } from "@/lib/locations";
const LEVELS = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30];
const MODELS = {
  // Open-Meteo's single-run archive exposes HRRR at its completed 6-hour archive cycles.
  hrrr: { label: "HRRR CONUS", parameter: "ncep_hrrr_conus", cadenceHours: 6 },
  gfs: { label: "GFS Global", parameter: "gfs_global", cadenceHours: 6 },
} as const;

type OpenMeteoProfile = { hourly?: Record<string, Array<string | number | null>> };

function valueAt(source: OpenMeteoProfile["hourly"], key: string, index: number) {
  const value = source?.[key]?.[index];
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function runStamp(date: Date) {
  // Open-Meteo requires the run initialization timestamp without seconds.
  return date.toISOString().slice(0, 13);
}

function initialRun(model: (typeof MODELS)[keyof typeof MODELS], offset: number) {
  const run = new Date();
  run.setUTCMinutes(0, 0, 0);
  if (model.cadenceHours === 6) run.setUTCHours(Math.floor(run.getUTCHours() / 6) * 6);
  run.setUTCHours(run.getUTCHours() - offset * model.cadenceHours);
  return run;
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const requested = search.get("model") ?? "hrrr";
  const model = MODELS[requested as keyof typeof MODELS] ?? MODELS.hrrr;
  const location = weatherDeskLocation(search.get("location"));
  const runOffset = Math.max(0, Math.min(24, Number.parseInt(search.get("runOffset") ?? "0", 10) || 0));
  const fields = LEVELS.flatMap((level) => [
    `temperature_${level}hPa`, `relative_humidity_${level}hPa`, `wind_speed_${level}hPa`,
    `wind_direction_${level}hPa`, `geopotential_height_${level}hPa`,
  ]);
  const parameters = new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude), timezone: location.timezone,
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    forecast_days: "3",
    models: model.parameter,
    hourly: [...fields, "cape", "convective_inhibition", "freezing_level_height"].join(","),
  });

  let run = initialRun(model, runOffset);
  let response: Response | null = null;
  try {
    // The archive can lag behind the live model cycle. Fall back by full days,
    // preserving the requested model-run cadence and reporting the actual run.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(`https://single-runs-api.open-meteo.com/v1/forecast?${parameters}&run=${encodeURIComponent(runStamp(run))}`, {
        headers: { "User-Agent": "The Weather Desk student forecasting project" },
        next: { revalidate: 900 },
      });
      if (response.ok) break;
      run.setUTCDate(run.getUTCDate() - 1);
    }
    if (!response?.ok) throw new Error(`Open-Meteo archived run is unavailable (${response?.status ?? "network error"})`);
    const data = await response.json() as OpenMeteoProfile;
    const available = Math.min(36, data.hourly?.time?.length ?? 0);
    const profiles = Array.from({ length: available }, (_, index) => ({
      time: String(data.hourly?.time?.[index] ?? ""),
      diagnostics: {
        cape: valueAt(data.hourly, "cape", index),
        cin: valueAt(data.hourly, "convective_inhibition", index),
        freezingLevelHeightM: valueAt(data.hourly, "freezing_level_height", index),
      },
      levels: LEVELS.map((pressureHpa) => ({
        pressureHpa,
        temperatureF: valueAt(data.hourly, `temperature_${pressureHpa}hPa`, index),
        relativeHumidity: valueAt(data.hourly, `relative_humidity_${pressureHpa}hPa`, index),
        windMph: valueAt(data.hourly, `wind_speed_${pressureHpa}hPa`, index),
        windDirection: valueAt(data.hourly, `wind_direction_${pressureHpa}hPa`, index),
        geopotentialHeightM: valueAt(data.hourly, `geopotential_height_${pressureHpa}hPa`, index),
      })),
    }));
    return NextResponse.json({
      provider: "Open-Meteo archived single run",
      model: model.label,
      location: location.name,
      runTime: runStamp(run),
      runOffset,
      cadenceHours: model.cadenceHours,
      profiles,
      source: "https://open-meteo.com/en/docs/single-runs-api",
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=900" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Model sounding is unavailable." }, { status: 502 });
  }
}
