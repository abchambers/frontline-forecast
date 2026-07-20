import { NextResponse } from "next/server";
import { weatherDeskLocation } from "@/lib/locations";
const MODELS = {
  best_match: { label: "Best match", endpoint: "https://api.open-meteo.com/v1/forecast", model: "best_match" },
  hrrr_conus: { label: "HRRR CONUS", endpoint: "https://api.open-meteo.com/v1/forecast", model: "ncep_hrrr_conus" },
  nbm_conus: { label: "NBM CONUS blend", endpoint: "https://api.open-meteo.com/v1/forecast", model: "ncep_nbm_conus" },
  nam_conus: { label: "NAM CONUS", endpoint: "https://api.open-meteo.com/v1/forecast", model: "ncep_nam_conus" },
  gfs_global: { label: "GFS Global", endpoint: "https://api.open-meteo.com/v1/forecast", model: "gfs_global" },
  ecmwf_ifs: { label: "ECMWF IFS", endpoint: "https://api.open-meteo.com/v1/forecast", model: "ecmwf_ifs025" },
  icon_global: { label: "DWD ICON Global", endpoint: "https://api.open-meteo.com/v1/forecast", model: "icon_global" },
  gem_global: { label: "GEM Global", endpoint: "https://api.open-meteo.com/v1/forecast", model: "gem_global" },
} as const;

type OpenMeteoResponse = {
  current?: { time: string; temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; wind_gusts_10m: number };
  hourly?: Record<string, Array<string | number | null>>;
  daily?: Record<string, Array<string | number | null>>;
};

function numeric(value: string | number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function hourlyValue(source: OpenMeteoResponse["hourly"], field: string, index: number) {
  return numeric(source?.[field]?.[index]);
}

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams;
  const requestedModel = search.get("model") ?? "best_match";
  const location = weatherDeskLocation(search.get("location"));
  const model = MODELS[requestedModel as keyof typeof MODELS] ?? MODELS.best_match;
  const parameters = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: location.timezone,
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    forecast_days: "7",
    models: model.model,
    current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m",
    hourly: "temperature_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,cape",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max",
  });

  try {
    const response = await fetch(`${model.endpoint}?${parameters}`, {
      headers: { "User-Agent": "The Weather Desk student forecasting project" },
      next: { revalidate: 900 },
    });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    const data = await response.json() as OpenMeteoResponse;
    const hourly = data.hourly;
    const currentHour = data.current?.time.slice(0, 13);
    const firstHour = Math.max(0, (hourly?.time?.findIndex((time) => String(time).slice(0, 13) >= (currentHour ?? "")) ?? 0));

    const nextHours = Array.from({ length: Math.min(12, Math.max(0, (hourly?.time?.length ?? 0) - firstHour)) }, (_, offset) => {
      const index = firstHour + offset;
      return {
        time: String(hourly?.time?.[index] ?? ""),
        temperatureF: hourlyValue(hourly, "temperature_2m", index),
        dewpointF: hourlyValue(hourly, "dew_point_2m", index),
        precipitationProbability: hourlyValue(hourly, "precipitation_probability", index),
        precipitationIn: typeof hourly?.precipitation?.[index] === "number" ? Number(hourly.precipitation[index].toFixed(2)) : null,
        cloudCover: hourlyValue(hourly, "cloud_cover", index),
        windMph: hourlyValue(hourly, "wind_speed_10m", index),
        gustMph: hourlyValue(hourly, "wind_gusts_10m", index),
        cape: hourlyValue(hourly, "cape", index),
        weatherCode: hourlyValue(hourly, "weather_code", index),
      };
    });

    const days = (data.daily?.time ?? []).map((date, index) => ({
      date: String(date),
      highF: numeric(data.daily?.temperature_2m_max?.[index]),
      lowF: numeric(data.daily?.temperature_2m_min?.[index]),
      precipitationProbability: numeric(data.daily?.precipitation_probability_max?.[index]),
      windMph: numeric(data.daily?.wind_speed_10m_max?.[index]),
      gustMph: numeric(data.daily?.wind_gusts_10m_max?.[index]),
      weatherCode: numeric(data.daily?.weather_code?.[index]),
    }));

    return NextResponse.json({
      provider: "Open-Meteo",
      model: model.label,
      location: location.name,
      current: data.current ? {
        time: data.current.time,
        temperatureF: numeric(data.current.temperature_2m),
        feelsLikeF: numeric(data.current.apparent_temperature),
        windMph: numeric(data.current.wind_speed_10m),
        gustMph: numeric(data.current.wind_gusts_10m),
        weatherCode: numeric(data.current.weather_code),
      } : null,
      days,
      nextHours,
      source: "https://open-meteo.com/en/docs",
      fetchedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=900" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Open-Meteo guidance is unavailable." }, { status: 502 });
  }
}
