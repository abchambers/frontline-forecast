"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const RadarMap = dynamic(() => import("./radar-map"), {
  ssr: false,
  loading: () => <div className="radar-loading">Loading live radar…</div>,
});

type DataPanel = "nbm" | "sounding" | "models" | "ensembles" | "model-sounding";
type GuidanceGroup = "high-res" | "global";
type RadarMapView = "composite" | "base" | "precipitation_new" | "clouds_new" | "pressure_new" | "wind_new" | "temp_new";
type RadarLegend = { title: string; left: string; middle: string; right: string; unit: string; gradient: string };
type OpenMeteoModel = "best_match" | "hrrr_conus" | "nbm_conus" | "nam_conus" | "gfs_global" | "ecmwf_ifs" | "icon_global" | "gem_global";
type WorkspaceSection = "dashboard" | "forecast" | "verify" | "control";
type LiveWeather = {
  location: string;
  observation: { station: string; stationName: string; observedAt: string; description: string; temperatureF: number | null; temperatureSource: "observation" | "forecast estimate"; dewpointF: number | null; windMph: number | null; windDirection: string | null };
  forecast: { period: string; temperature: number; temperatureUnit: string; shortForecast: string; detailedForecast: string; precipitationChance: number | null } | null;
  forecastPeriods: { name: string; startTime: string; temperature: number; temperatureUnit: string; shortForecast: string; precipitationChance: number | null; icon: string | null }[];
  alerts: { event: string; headline: string | null }[];
  alertsAvailable: boolean;
  fetchedAt: string;
};
type RadarTimelineFrame = { time: number; tileUrl: string };
type OpenMeteoGuidance = {
  provider: string;
  model: string;
  location: string;
  current: { time: string; temperatureF: number | null; feelsLikeF: number | null; windMph: number | null; gustMph: number | null; weatherCode: number | null } | null;
  days: { date: string; highF: number | null; lowF: number | null; precipitationProbability: number | null; windMph: number | null; gustMph: number | null; weatherCode: number | null }[];
  nextHours: { time: string; temperatureF: number | null; dewpointF: number | null; precipitationProbability: number | null; precipitationIn: number | null; cloudCover: number | null; windMph: number | null; gustMph: number | null; cape: number | null; weatherCode: number | null }[];
  source: string;
  fetchedAt: string;
};
type ModelSounding = {
  provider: string;
  model: string;
  location: string;
  runTime: string;
  runOffset: number;
  cadenceHours: number;
  profiles: { time: string; diagnostics: { cape: number | null; cin: number | null; freezingLevelHeightM: number | null }; levels: { pressureHpa: number; temperatureF: number | null; relativeHumidity: number | null; windMph: number | null; windDirection: number | null; geopotentialHeightM: number | null }[] }[];
  source: string;
  fetchedAt: string;
};
type EnsembleGuidance = {
  provider: string;
  model: string;
  location: string;
  rows: { time: string; temperature: EnsembleDistribution; precipitation: EnsembleDistribution; wind: EnsembleDistribution }[];
  source: string;
  fetchedAt: string;
};
type EnsembleDistribution = { members: number; min: number | null; max: number | null; mean: number | null; spread: number | null };
type SavedForecast = {
  id: string;
  runId?: string;
  periodIds?: { day?: string; night?: string };
  savedAt: string;
  label: string;
  targetDate: string;
  status: "draft" | "submitted" | "revised" | "verified" | "withdrawn";
  versionNumber: number;
  day: { high: string; conditions: string; rainChance: string; timing: string; hazards: string; reasoning?: string; references?: ReferenceItem[] };
  night: { low: string; conditions: string; rainChance: string; timing: string; hazards: string; reasoning?: string; references?: ReferenceItem[] };
  evidence: { observation: string; forecast: string; alerts: string };
};
type WeatherDeskSession = { access_token: string; refresh_token?: string; user: { id: string; email?: string } };
type ReferenceItem = { id: string; label: string; detail: string };
type PeriodDraft = { highLow: string; conditions: string; rainChance: string; timing: string; wind: string; confidence: string; hazards: string; reasoning: string; references: ReferenceItem[] };
type ForecastDayDraft = { date: string; day: PeriodDraft; night: PeriodDraft };
type ForecastRunDraft = { id: string; days: ForecastDayDraft[]; initialHorizonDays: number };
type CloudRunRow = { id: string; created_at: string; status: string; forecast_periods: { id: string; valid_date: string; period: "day" | "night"; forecast_data: PeriodDraft; evidence_snapshot: SavedForecast["evidence"]; forecast_verifications?: { observed_data: ActualPeriod; score_data: { automaticScore?: number | null } }[] }[] };
type ActualPeriod = { observationCount: number; highF: number | null; lowF: number | null; maxWindMph: number | null; precipitationObserved: boolean; conditions: string[]; complete: boolean };
type AutomaticVerification = { station: string; fetchedAt: string; day: ActualPeriod; night: ActualPeriod; dayScore: number | null; nightScore: number | null };
type VerificationRow = { forecast_period_id: string; observed_data: ActualPeriod; score_data: { automaticScore?: number | null } | null };
type Profile = { id: string; email: string | null; role: "student" | "forecaster" | "reviewer" | "admin" };

const archiveStorageKey = "weather-desk-forecast-archives";
const forecastDraftStorageKey = "weather-desk-active-forecast-draft";
const sessionStorageKey = "weather-desk-supabase-session";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const officialFfcSoundingImageUrl = "https://www.spc.noaa.gov/exper/soundings/LATEST/FFC.gif";
const guidanceModels = {
  "high-res": [["best_match", "Auto"], ["hrrr_conus", "HRRR"], ["nam_conus", "NAM"], ["nbm_conus", "NBM blend"]],
  global: [["gfs_global", "GFS"], ["ecmwf_ifs", "ECMWF"], ["icon_global", "ICON"], ["gem_global", "GEM"]],
} as const satisfies Record<GuidanceGroup, readonly (readonly [OpenMeteoModel, string])[]>;

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next.toISOString().slice(0, 10);
}

function validForecastDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function fallbackForecastDate(value: unknown) {
  return validForecastDate(value) ? value : addDays(new Date(), 0);
}

function emptyPeriod(period: "day" | "night"): PeriodDraft {
  return period === "day"
    ? { highLow: "86", conditions: "storms", rainChance: "60%", timing: "3–8 PM", wind: "SW 8–12 mph; gusts 20", confidence: "moderate", hazards: "Scattered thunderstorms; brief heavy rain", reasoning: "", references: [] }
    : { highLow: "68", conditions: "showers", rainChance: "20%", timing: "Before 10 PM", wind: "W 4–8 mph", confidence: "moderate", hazards: "Patchy fog near daybreak", reasoning: "", references: [] };
}

function createForecastDay(date: string): ForecastDayDraft { return { date, day: emptyPeriod("day"), night: emptyPeriod("night") }; }

function archiveTitle(archive: Pick<SavedForecast, "savedAt">) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(archive.savedAt));
}

function forecastTargetTitle(targetDate: string) {
  if (!validForecastDate(targetDate)) return "Forecast date not set";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`));
}

function archiveVersionTitle(archive: SavedForecast) {
  const status = archive.status ? archive.status[0].toUpperCase() + archive.status.slice(1) : "Saved";
  return `Forecast: ${forecastTargetTitle(archive.targetDate)} · V${archive.versionNumber ?? 1} · ${status}`;
}

function archiveSubmissionTitle(archive: SavedForecast) {
  return `Submitted ${archiveTitle(archive)}`;
}

function weatherIcon(description: string) {
  const text = description.toLowerCase();
  if (text.includes("thunder")) return "⛈";
  if (text.includes("snow")) return "❄️";
  if (text.includes("rain") || text.includes("shower")) return "🌧";
  if (text.includes("cloud")) return "☁️";
  if (text.includes("fog")) return "🌫";
  return "☀️";
}

function openMeteoWeatherLabel(code: number | null) {
  if (code === null) return "Unavailable";
  if ([95, 96, 99].includes(code)) return "Thunderstorms";
  if ([80, 81, 82].includes(code)) return "Rain showers";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([45, 48].includes(code)) return "Fog";
  if ([1, 2, 3].includes(code)) return "Partly cloudy";
  return "Clear";
}

function openMeteoHour(time: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "America/New_York" }).format(new Date(`${time}:00`));
}

function modelTimestamp(time: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(`${time}:00`));
}

function runTimestamp(time: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(`${time}:00Z`));
}

const radarLegends: Record<RadarMapView, RadarLegend | null> = {
  composite: { title: "Base reflectivity", left: "0", middle: "35", right: "70+", unit: "dBZ", gradient: "linear-gradient(90deg,#6fb7ff 0 7%,#3bd8e9 7% 14%,#35ca8a 14% 22%,#36b84d 22% 30%,#a9d337 30% 38%,#efe23a 38% 46%,#ffbf25 46% 54%,#ff8027 54% 62%,#ec3e32 62% 70%,#be1f57 70% 78%,#9b2678 78% 86%,#dbdce5 86% 100%)" },
  precipitation_new: { title: "Precipitation intensity", left: "Light", middle: "Moderate", right: "Heavy", unit: "OpenWeather", gradient: "linear-gradient(90deg,#77b7ff 0%,#38c5d5 22%,#38bf68 44%,#e2d42f 65%,#ff8d21 82%,#d7263d 100%)" },
  clouds_new: { title: "Cloud cover", left: "0%", middle: "50%", right: "100%", unit: "OpenWeather", gradient: "linear-gradient(90deg,#eef5fa 0%,#bfcbd8 35%,#748293 68%,#263544 100%)" },
  pressure_new: { title: "Surface pressure", left: "Lower", middle: "Typical", right: "Higher", unit: "OpenWeather", gradient: "linear-gradient(90deg,#5061bf 0%,#77b0db 30%,#d9df6e 55%,#e79239 78%,#b33447 100%)" },
  wind_new: { title: "Wind speed", left: "Light", middle: "Breezy", right: "Strong", unit: "OpenWeather", gradient: "linear-gradient(90deg,#b3ecff 0%,#4ab8f0 24%,#46c76e 48%,#f0c42f 70%,#e65642 88%,#a72777 100%)" },
  temp_new: { title: "Temperature", left: "Colder", middle: "Mild", right: "Warmer", unit: "OpenWeather", gradient: "linear-gradient(90deg,#5148a8 0%,#4a9de0 22%,#65c86b 48%,#f0d544 68%,#f48635 84%,#d84242 100%)" },
  base: null,
};

const radarLegendBands: Record<Exclude<RadarMapView, "base">, { label: string; description: string }[]> = {
  composite: [
    { label: "0–10", description: "Very light reflectivity: drizzle, insects, or weak echoes." },
    { label: "10–20", description: "Light precipitation or a weak shower." },
    { label: "20–30", description: "Steady light to moderate rain." },
    { label: "30–40", description: "Moderate rain; heavier showers may be developing." },
    { label: "40–50", description: "Heavy rain and stronger convective cores." },
    { label: "50–60", description: "Very heavy rain; thunderstorms are likely." },
    { label: "60–70", description: "Severe-intensity core; hail is possible." },
    { label: "70+", description: "Extreme reflectivity; treat as a potentially dangerous core." },
  ],
  precipitation_new: [{ label: "Low", description: "Lighter precipitation intensity." }, { label: "Mid", description: "Moderate precipitation intensity." }, { label: "High", description: "Heavier precipitation intensity." }],
  clouds_new: [{ label: "0–25%", description: "Mostly clear sky." }, { label: "25–75%", description: "Partial to broken cloud cover." }, { label: "75–100%", description: "Overcast cloud cover." }],
  pressure_new: [{ label: "Lower", description: "Lower relative surface pressure." }, { label: "Typical", description: "Typical local pressure range." }, { label: "Higher", description: "Higher relative surface pressure." }],
  wind_new: [{ label: "Light", description: "Light wind speeds." }, { label: "Breezy", description: "Breezy wind speeds." }, { label: "Strong", description: "Stronger wind speeds." }],
  temp_new: [{ label: "Cool", description: "Cooler temperatures within the displayed layer." }, { label: "Mild", description: "Middle temperature range." }, { label: "Warm", description: "Warmer temperatures within the displayed layer." }],
};

function RadarLegendStrip({ view }: { view: RadarMapView }) {
  const legend = radarLegends[view];
  const [hoveredBand, setHoveredBand] = useState<{ label: string; description: string } | null>(null);
  if (view === "base" || !legend) return <span className="radar-source-note">Base map · pan and zoom to explore</span>;
  const bands = radarLegendBands[view];
  return <div className="radar-legend" aria-label={`${legend.title} color scale`}><span>{legend.title}</span><div className="radar-legend-scale"><i style={{ background: legend.gradient }} />{bands.map((band) => <button type="button" key={band.label} aria-label={`${band.label}: ${band.description}`} onBlur={() => setHoveredBand(null)} onFocus={() => setHoveredBand(band)} onMouseLeave={() => setHoveredBand(null)} onMouseEnter={() => setHoveredBand(band)} />)}</div><div><small>{legend.left}</small><small>{legend.middle}</small><small>{legend.right}</small></div><em>{hoveredBand ? `${hoveredBand.label} · ${hoveredBand.description}` : `${legend.unit} · Hover a color band for guidance`}</em></div>;
}

function ModelGuidanceTable({ guidance, view, compact = false }: { guidance: OpenMeteoGuidance; view: "hourly" | "daily"; compact?: boolean }) {
  const tableClassName = `guidance-table${compact ? " compact-guidance-table" : ""}`;
  if (view === "daily") return <div className="guidance-table-wrap"><table className={tableClassName}><thead><tr><th>Day</th><th>High / low</th><th>Conditions</th><th>Max PoP</th><th>Wind / gust</th></tr></thead><tbody>{guidance.days.map((day) => <tr key={day.date}><th>{forecastTargetTitle(day.date)}</th><td>{day.highF ?? "—"}° / {day.lowF ?? "—"}°</td><td>{openMeteoWeatherLabel(day.weatherCode)}</td><td>{day.precipitationProbability ?? "—"}%</td><td>{day.windMph ?? "—"} / {day.gustMph ?? "—"} mph</td></tr>)}</tbody></table></div>;
  return <div className="guidance-table-wrap"><table className={tableClassName}><thead><tr><th>Valid</th><th>Temp / dew</th><th>PoP</th><th>Wind / gust</th><th>Cloud</th><th>CAPE</th></tr></thead><tbody>{guidance.nextHours.map((hour) => <tr key={hour.time}><th>{modelTimestamp(hour.time)}</th><td>{hour.temperatureF ?? "—"}° / {hour.dewpointF ?? "—"}°</td><td>{hour.precipitationProbability ?? "—"}%</td><td>{hour.windMph ?? "—"} / {hour.gustMph ?? "—"} mph</td><td>{hour.cloudCover ?? "—"}%</td><td>{hour.cape ?? "—"} J/kg</td></tr>)}</tbody></table></div>;
}

function dewpointFromTemperatureAndRh(temperatureF: number | null, relativeHumidity: number | null) {
  if (temperatureF === null || relativeHumidity === null || relativeHumidity <= 0) return null;
  const temperatureC = (temperatureF - 32) * 5 / 9;
  const gamma = Math.log(relativeHumidity / 100) + (17.625 * temperatureC) / (243.04 + temperatureC);
  return Math.round(((243.04 * gamma) / (17.625 - gamma)) * 9 / 5 + 32);
}

function LegacyModelSoundingChart({ profile }: { profile: ModelSounding["profiles"][number] }) {
  const levels = profile.levels.filter((level) => level.temperatureF !== null);
  const width = 900;
  const height = 430;
  const margin = { top: 22, right: 310, bottom: 38, left: 52 };
  const plotBottom = height - margin.bottom;
  const plotRight = width - margin.right;
  const pressureToY = (pressure: number) => margin.top + ((Math.log(1000) - Math.log(pressure)) / (Math.log(1000) - Math.log(100))) * (plotBottom - margin.top);
  const toCelsius = (temperatureF: number) => (temperatureF - 32) * 5 / 9;
  const temperatureToX = (temperatureC: number, pressure: number) => margin.left + ((temperatureC + 60) / 110) * (plotRight - margin.left) + ((plotBottom - pressureToY(pressure)) / (plotBottom - margin.top)) * 118;
  const pointPath = (values: (number | null)[]) => levels.map((level, index) => values[index] === null ? null : `${index === 0 || values[index - 1] === null ? "M" : "L"}${temperatureToX(toCelsius(values[index] as number), level.pressureHpa).toFixed(1)},${pressureToY(level.pressureHpa).toFixed(1)}`).filter(Boolean).join(" ");
  const temperatures = levels.map((level) => level.temperatureF);
  const dewpoints = levels.map((level) => dewpointFromTemperatureAndRh(level.temperatureF, level.relativeHumidity));
  const pressureLines = [1000, 925, 850, 700, 500, 400, 300, 200, 100];
  const temperatureLines = [-60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
  const windBarbs = levels.filter((level) => level.windMph !== null && level.windDirection !== null);
  const hodo = { x: plotRight + 150, y: 176, radius: 108 };
  const hodoPoint = (level: typeof windBarbs[number]) => { const speedKt = (level.windMph ?? 0) / 1.15078; const radians = ((level.windDirection ?? 0) * Math.PI) / 180; return { x: hodo.x - speedKt * Math.sin(radians) * 2.1, y: hodo.y + speedKt * Math.cos(radians) * 2.1 }; };
  const hodoPath = windBarbs.map((level, index) => { const point = hodoPoint(level); return `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`; }).join(" ");
  return <figure className="sounding-chart"><figcaption><span>Skew-T / log-P forecast profile</span><small>Model guidance · temperature, moisture, wind, and hodograph</small></figcaption><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Skew-T log-P model sounding with temperature, dew point, pressure, winds, and hodograph"><defs><clipPath id="sounding-plot"><rect x={margin.left} y={margin.top} width={plotRight - margin.left} height={plotBottom - margin.top} /></clipPath></defs><rect x={margin.left} y={margin.top} width={plotRight - margin.left} height={plotBottom - margin.top} rx="6" /><g className="sounding-grid">{pressureLines.map((pressure) => <g key={pressure}><line x1={margin.left} x2={plotRight} y1={pressureToY(pressure)} y2={pressureToY(pressure)} /><text x={margin.left - 9} y={pressureToY(pressure) + 4} textAnchor="end">{pressure}</text></g>)}{temperatureLines.map((temperature) => <g key={temperature}><line x1={temperatureToX(temperature, 1000)} x2={temperatureToX(temperature, 100)} y1={plotBottom} y2={margin.top} /><text x={temperatureToX(temperature, 1000)} y={height - 16} textAnchor="middle">{temperature}°</text></g>)}</g><g clipPath="url(#sounding-plot)"><path className="sounding-temperature" d={pointPath(temperatures)} /><path className="sounding-dewpoint" d={pointPath(dewpoints)} /></g><g className="sounding-winds">{windBarbs.map((level) => { const speedKt = Math.round((level.windMph ?? 0) / 1.15078 / 5) * 5; const barbs = Array.from({ length: Math.floor(speedKt / 10) }, (_, index) => index); const hasHalf = speedKt % 10 >= 5; return <g key={level.pressureHpa} transform={`translate(${plotRight + 48} ${pressureToY(level.pressureHpa)}) rotate(${(level.windDirection ?? 0) + 180})`}><line x1="0" y1="0" x2="0" y2="-26" />{barbs.map((_, index) => <line key={index} x1="0" y1={-5 - index * 5} x2="10" y2={-10 - index * 5} />)}{hasHalf && <line x1="0" y1={-5 - barbs.length * 5} x2="6" y2={-8 - barbs.length * 5} />}</g>; })}</g><g className="sounding-hodograph"><text x={hodo.x} y={25} textAnchor="middle">Hodograph</text>{[20, 40].map((speed) => <circle key={speed} cx={hodo.x} cy={hodo.y} r={speed * 2.1} />)}<line x1={hodo.x - hodo.radius} x2={hodo.x + hodo.radius} y1={hodo.y} y2={hodo.y} /><line x1={hodo.x} x2={hodo.x} y1={hodo.y - hodo.radius} y2={hodo.y + hodo.radius} /><path d={hodoPath} />{windBarbs.map((level) => { const point = hodoPoint(level); return <g key={level.pressureHpa}><circle cx={point.x} cy={point.y} r="3.5" /><text x={point.x + 6} y={point.y - 5}>{level.pressureHpa}</text></g>; })}</g><text className="sounding-axis-label" x={15} y={height / 2} transform={`rotate(-90 15 ${height / 2})`} textAnchor="middle">Pressure (hPa)</text><text className="sounding-axis-label" x={plotRight + 48} y={height - 15} textAnchor="middle">wind</text><text className="sounding-axis-label" x={(margin.left + plotRight) / 2} y={height - 1} textAnchor="middle">Temperature (°C)</text></svg></figure>;
}

function VerticalProfileChart({ profile }: { profile: ModelSounding["profiles"][number] }) {
  const levels = profile.levels.filter((level) => level.temperatureF !== null && level.geopotentialHeightM !== null);
  const width = 900;
  const height = 430;
  const margin = { top: 28, right: 58, bottom: 45, left: 60 };
  const right = width - margin.right;
  const bottom = height - margin.bottom;
  const maxHeight = Math.max(16000, ...levels.map((level) => level.geopotentialHeightM ?? 0));
  const minTemperature = Math.floor((Math.min(...levels.map((level) => level.temperatureF ?? 100)) - 8) / 10) * 10;
  const maxTemperature = Math.ceil((Math.max(...levels.map((level) => level.temperatureF ?? -100)) + 8) / 10) * 10;
  const x = (temperature: number) => margin.left + ((temperature - minTemperature) / Math.max(1, maxTemperature - minTemperature)) * (right - margin.left);
  const y = (heightM: number) => bottom - (heightM / maxHeight) * (bottom - margin.top);
  const dewpoint = (level: typeof levels[number]) => dewpointFromTemperatureAndRh(level.temperatureF, level.relativeHumidity);
  const path = (values: (number | null)[]) => levels.map((level, index) => {
    const value = values[index];
    return value === null ? null : `${index === 0 || values[index - 1] === null ? "M" : "L"}${x(value).toFixed(1)},${y(level.geopotentialHeightM as number).toFixed(1)}`;
  }).filter(Boolean).join(" ");
  const temperatureTicks = Array.from({ length: Math.floor((maxTemperature - minTemperature) / 10) + 1 }, (_, index) => minTemperature + index * 10);
  const heightTicks = [0, 1500, 3000, 6000, 9000, 12000, 15000].filter((value) => value <= maxHeight);
  const windLevels = levels.filter((level) => level.windMph !== null && level.windDirection !== null);
  return <figure className="vertical-profile-chart"><figcaption><span>Model vertical profile</span><small>Temperature and dew point against geopotential height · this is intentionally not labeled as a Skew‑T</small></figcaption><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Model vertical temperature and dew point profile for Athens"><rect x={margin.left} y={margin.top} width={right - margin.left} height={bottom - margin.top} rx="6" />{heightTicks.map((heightM) => <g className="profile-grid" key={heightM}><line x1={margin.left} x2={right} y1={y(heightM)} y2={y(heightM)} /><text x={margin.left - 9} y={y(heightM) + 4} textAnchor="end">{heightM / 1000} km</text></g>)}{temperatureTicks.map((temperature) => <g className="profile-grid" key={temperature}><line x1={x(temperature)} x2={x(temperature)} y1={margin.top} y2={bottom} /><text x={x(temperature)} y={height - 17} textAnchor="middle">{temperature}°</text></g>)}<path className="profile-temperature" d={path(levels.map((level) => level.temperatureF))} /><path className="profile-dewpoint" d={path(levels.map(dewpoint))} />{windLevels.map((level) => { const speedKt = Math.round((level.windMph ?? 0) / 1.15078 / 5) * 5; const flags = Math.floor(speedKt / 10); return <g className="profile-wind" key={level.pressureHpa} transform={`translate(${right - 14} ${y(level.geopotentialHeightM as number)}) rotate(${(level.windDirection ?? 0) + 180})`}><line x1="0" y1="0" x2="0" y2="-24" />{Array.from({ length: flags }, (_, index) => <line key={index} x1="0" y1={-5 - index * 5} x2="9" y2={-10 - index * 5} />)}</g>; })}<text className="profile-axis-label" x={18} y={height / 2} transform={`rotate(-90 18 ${height / 2})`} textAnchor="middle">Geopotential height (km MSL)</text><text className="profile-axis-label" x={(margin.left + right) / 2} y={height - 2} textAnchor="middle">Temperature / dew point (°F) · wind barbs at right</text></svg><div className="profile-legend"><span><i className="temperature" />Temperature</span><span><i className="dewpoint" />Dew point (derived from model RH)</span><small>Use the official KFFC panel for observed parcel diagnostics, hodograph, and storm parameters.</small></div></figure>;
}

function SkewTChart({ profile }: { profile: ModelSounding["profiles"][number] }) {
  const levels = profile.levels.filter((level) => level.temperatureF !== null);
  const width = 920;
  const height = 500;
  const margin = { top: 28, right: 270, bottom: 44, left: 58 };
  const right = width - margin.right;
  const bottom = height - margin.bottom;
  const logarithmicHeight = Math.log(1000 / 100);
  const pressureToY = (pressure: number) => margin.top + (Math.log(1000 / pressure) / logarithmicHeight) * (bottom - margin.top);
  // Standard Skew-T transform: x is temperature plus a fixed multiple of log pressure.
  // Constant temperatures are diagonal; isobars stay horizontal on the log-pressure axis.
  const skew = 32;
  const x = (temperatureC: number, pressure: number) => margin.left + ((temperatureC + 70 + skew * Math.log(1000 / pressure)) / 130) * (right - margin.left);
  const toC = (temperatureF: number) => (temperatureF - 32) * 5 / 9;
  const pathFor = (values: (number | null)[]) => levels.map((level, index) => {
    const value = values[index];
    return value === null ? null : `${index === 0 || values[index - 1] === null ? "M" : "L"}${x(toC(value), level.pressureHpa).toFixed(1)},${pressureToY(level.pressureHpa).toFixed(1)}`;
  }).filter(Boolean).join(" ");
  const pressureLines = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100];
  const isotherms = [-70, -60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];
  const dryAdiabats = [250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 420, 440];
  const mixingRatios = [0.2, 0.4, 1, 2, 4, 8, 12, 16];
  const dryAdiabatPath = (theta: number) => Array.from({ length: 50 }, (_, index) => 1000 - index * (900 / 49)).map((pressure, index) => {
    const temperatureC = theta * Math.pow(pressure / 1000, 0.2854) - 273.15;
    return `${index === 0 ? "M" : "L"}${x(temperatureC, pressure).toFixed(1)},${pressureToY(pressure).toFixed(1)}`;
  }).join(" ");
  const dewpointForMixingRatio = (mixingRatioGkg: number, pressure: number) => {
    const mixingRatio = mixingRatioGkg / 1000;
    const vaporPressure = (mixingRatio * pressure) / (0.622 + mixingRatio);
    const ln = Math.log(vaporPressure / 6.112);
    return (243.5 * ln) / (17.67 - ln);
  };
  const mixingRatioPath = (mixingRatio: number) => Array.from({ length: 35 }, (_, index) => 1000 - index * (600 / 34)).map((pressure, index) => `${index === 0 ? "M" : "L"}${x(dewpointForMixingRatio(mixingRatio, pressure), pressure).toFixed(1)},${pressureToY(pressure).toFixed(1)}`).join(" ");
  const dewpoints = levels.map((level) => dewpointFromTemperatureAndRh(level.temperatureF, level.relativeHumidity));
  const windLevels = levels.filter((level) => level.windMph !== null && level.windDirection !== null);
  const hodo = { x: right + 145, y: 187, scale: 2.15, radius: 96 };
  const hodoPoint = (level: typeof windLevels[number]) => { const speedKt = (level.windMph ?? 0) / 1.15078; const radians = ((level.windDirection ?? 0) * Math.PI) / 180; return { x: hodo.x - speedKt * Math.sin(radians) * hodo.scale, y: hodo.y + speedKt * Math.cos(radians) * hodo.scale }; };
  const hodoPath = windLevels.map((level, index) => { const point = hodoPoint(level); return `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`; }).join(" ");
  return <figure className="skewt-chart"><figcaption><div><span>Skew‑T / log‑P model profile</span><small>Thermodynamic projection with standard log-pressure, skewed-temperature geometry</small></div><small>Model guidance only · no parcel diagnostics are inferred</small></figcaption><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Skew-T log-P model profile with temperature, dew point, pressure, winds, and hodograph"><defs><clipPath id="skewt-plot"><rect x={margin.left} y={margin.top} width={right - margin.left} height={bottom - margin.top} /></clipPath></defs><rect x={margin.left} y={margin.top} width={right - margin.left} height={bottom - margin.top} rx="5" /><g className="skewt-grid">{pressureLines.map((pressure) => <g key={pressure}><line className="isobar" x1={margin.left} x2={right} y1={pressureToY(pressure)} y2={pressureToY(pressure)} /><text x={margin.left - 8} y={pressureToY(pressure) + 4} textAnchor="end">{pressure}</text></g>)}{isotherms.map((temperature) => <g key={temperature}><line className="isotherm" x1={x(temperature, 1000)} x2={x(temperature, 100)} y1={pressureToY(1000)} y2={pressureToY(100)} /><text x={x(temperature, 1000)} y={height - 15} textAnchor="middle">{temperature}°</text></g>)}<g clipPath="url(#skewt-plot)">{dryAdiabats.map((theta) => <path className="dry-adiabat" key={theta} d={dryAdiabatPath(theta)} />)}{mixingRatios.map((ratio) => <path className="mixing-ratio" key={ratio} d={mixingRatioPath(ratio)} />)}<path className="skewt-temperature" d={pathFor(levels.map((level) => level.temperatureF))} /><path className="skewt-dewpoint" d={pathFor(dewpoints)} /></g></g><g className="skewt-winds">{windLevels.map((level) => { const speedKt = Math.round((level.windMph ?? 0) / 1.15078 / 5) * 5; const flags = Math.floor(speedKt / 10); return <g key={level.pressureHpa} transform={`translate(${right + 44} ${pressureToY(level.pressureHpa)}) rotate(${(level.windDirection ?? 0) + 180})`}><line x1="0" y1="0" x2="0" y2="-25" />{Array.from({ length: flags }, (_, index) => <line key={index} x1="0" y1={-5 - index * 5} x2="9" y2={-10 - index * 5} />)}</g>; })}</g><g className="skewt-hodograph"><text x={hodo.x} y={35} textAnchor="middle">Hodograph</text>{[20, 40].map((speed) => <circle key={speed} cx={hodo.x} cy={hodo.y} r={speed * hodo.scale} />)}<line x1={hodo.x - hodo.radius} x2={hodo.x + hodo.radius} y1={hodo.y} y2={hodo.y} /><line x1={hodo.x} x2={hodo.x} y1={hodo.y - hodo.radius} y2={hodo.y + hodo.radius} /><path d={hodoPath} />{windLevels.filter((level) => [1000, 850, 700, 500, 300].includes(level.pressureHpa)).map((level) => { const point = hodoPoint(level); return <g key={level.pressureHpa}><circle cx={point.x} cy={point.y} r="3" /><text x={point.x + 5} y={point.y - 5}>{level.pressureHpa}</text></g>; })}</g><text className="skewt-axis" x={16} y={height / 2} transform={`rotate(-90 16 ${height / 2})`} textAnchor="middle">Pressure (hPa)</text><text className="skewt-axis" x={right + 44} y={height - 15} textAnchor="middle">wind</text></svg><div className="skewt-legend"><span><i className="temperature" />Temperature</span><span><i className="dewpoint" />Dew point (from model RH)</span><span><i className="dry" />Dry adiabats</span><span><i className="mixing" />Mixing ratio</span></div></figure>;
}

// Do not label a hand-drawn projection as a Skew-T. This intentionally uses
// a simple, auditable vertical coordinate until the app has a validated Skew-T renderer.
function ModelSoundingChart({ profile }: { profile: ModelSounding["profiles"][number] }) {
  return <><SkewTChart profile={profile} /><ModelEnvironmentSummary profile={profile} /></>;
}

function ModelEnvironmentSummary({ profile }: { profile: ModelSounding["profiles"][number] }) {
  const surface = profile.levels.find((level) => level.pressureHpa === 1000) ?? profile.levels[0];
  const midLevel = profile.levels.find((level) => level.pressureHpa === 500);
  const windVector = (level: typeof surface | undefined) => {
    if (!level || level.windMph === null || level.windDirection === null) return null;
    const radians = level.windDirection * Math.PI / 180;
    return { u: -level.windMph * Math.sin(radians), v: -level.windMph * Math.cos(radians) };
  };
  const surfaceWind = windVector(surface);
  const midWind = windVector(midLevel);
  const deepLayerShear = surfaceWind && midWind ? Math.round(Math.hypot(midWind.u - surfaceWind.u, midWind.v - surfaceWind.v)) : null;
  const lapseRate = surface?.temperatureF != null && midLevel?.temperatureF != null && surface?.geopotentialHeightM != null && midLevel?.geopotentialHeightM != null
    ? Math.round((((surface.temperatureF - midLevel.temperatureF) * 5 / 9) / ((midLevel.geopotentialHeightM - surface.geopotentialHeightM) / 1000)) * 10) / 10
    : null;
  return <section className="model-environment"><div><span>Surface CAPE</span><strong>{profile.diagnostics.cape ?? "—"} J/kg</strong><small>model-provided</small></div><div><span>CIN</span><strong>{profile.diagnostics.cin ?? "—"} J/kg</strong><small>model-provided</small></div><div><span>Freezing level</span><strong>{profile.diagnostics.freezingLevelHeightM === null ? "—" : `${Math.round(profile.diagnostics.freezingLevelHeightM * 3.28084).toLocaleString()} ft`}</strong><small>model-provided</small></div><div><span>0–6 km shear</span><strong>{deepLayerShear ?? "—"} mph</strong><small>derived from 1000–500 hPa winds</small></div><div><span>1000–500 lapse rate</span><strong>{lapseRate ?? "—"} °C/km</strong><small>derived from the profile</small></div></section>;
}

function EnsembleTable({ guidance }: { guidance: EnsembleGuidance }) {
  return <div className="guidance-table-wrap"><table className="guidance-table ensemble-table"><thead><tr><th>Valid</th><th>Temp range / mean</th><th>Spread</th><th>Precip range</th><th>Wind range / mean</th></tr></thead><tbody>{guidance.rows.filter((_, index) => index % 3 === 0).slice(0, 24).map((row) => <tr key={row.time}><th>{modelTimestamp(row.time)}</th><td>{row.temperature.min ?? "—"}–{row.temperature.max ?? "—"}° / {row.temperature.mean ?? "—"}°</td><td>±{row.temperature.spread ?? "—"}°</td><td>{row.precipitation.min ?? "—"}–{row.precipitation.max ?? "—"} in</td><td>{row.wind.min ?? "—"}–{row.wind.max ?? "—"} / {row.wind.mean ?? "—"} mph</td></tr>)}</tbody></table></div>;
}

function savedReferences(value: unknown): ReferenceItem[] {
  return Array.isArray(value) ? value.filter((item): item is ReferenceItem => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.label === "string" && typeof item.detail === "string")) : [];
}

function automaticPeriodScore(forecastTemperature: string, rainChance: string, actual: ActualPeriod, useHigh: boolean) {
  const predictedTemperature = Number.parseFloat(forecastTemperature);
  const actualTemperature = useHigh ? actual.highF : actual.lowF;
  if (!actual.observationCount || !Number.isFinite(predictedTemperature) || actualTemperature === null) return null;
  const temperaturePoints = Math.max(0, 70 - Math.abs(predictedTemperature - actualTemperature) * 10);
  const predictedRain = Number.parseFloat(rainChance) >= 50;
  const precipitationPoints = predictedRain === actual.precipitationObserved ? 30 : 0;
  return Math.round(temperaturePoints + precipitationPoints);
}

function temperatureErrorLabel(forecastTemperature: string, actual: ActualPeriod, useHigh: boolean) {
  const forecast = Number.parseFloat(forecastTemperature);
  const observed = useHigh ? actual.highF : actual.lowF;
  if (!actual.complete) return "Awaiting period end";
  if (!Number.isFinite(forecast) || observed === null) return "Temperature unavailable";
  return `${Math.abs(forecast - observed)}°F temperature error`;
}

function scoreLabel(score: number | null | undefined, actual: ActualPeriod | undefined) {
  if (!actual?.observationCount) return "Pending";
  if (!actual.complete) return score === null || score === undefined ? "Pending" : `${score}% preliminary`;
  return score === null || score === undefined ? "Needs value" : `${score}%`;
}

function archiveRecordsFromRun(run: CloudRunRow): SavedForecast[] {
  const byDate = new Map<string, CloudRunRow["forecast_periods"]>();
  run.forecast_periods.forEach((period) => byDate.set(period.valid_date, [...(byDate.get(period.valid_date) ?? []), period]));
  return [...byDate.entries()].map(([targetDate, periods], index) => {
    const day = periods.find((period) => period.period === "day");
    const night = periods.find((period) => period.period === "night");
    const dayData = day?.forecast_data ?? emptyPeriod("day");
    const nightData = night?.forecast_data ?? emptyPeriod("night");
    const status: SavedForecast["status"] = ["draft", "submitted", "revised", "verified", "withdrawn"].includes(run.status) ? run.status as SavedForecast["status"] : "submitted";
    return {
      id: `${run.id}:${targetDate}`, runId: run.id, periodIds: { day: day?.id, night: night?.id }, savedAt: run.created_at, label: archiveTitle({ savedAt: run.created_at }), targetDate, status, versionNumber: index + 1,
      day: { high: dayData.highLow, conditions: dayData.conditions, rainChance: dayData.rainChance, timing: dayData.timing, hazards: dayData.hazards, reasoning: dayData.reasoning, references: savedReferences(dayData.references) },
      night: { low: nightData.highLow, conditions: nightData.conditions, rainChance: nightData.rainChance, timing: nightData.timing, hazards: nightData.hazards, reasoning: nightData.reasoning, references: savedReferences(nightData.references) },
      evidence: day?.evidence_snapshot ?? night?.evidence_snapshot ?? { observation: "No observation snapshot", forecast: "No NWS snapshot", alerts: "No alert snapshot" },
    };
  });
}

function ForecasterNotes({ archive }: { archive: SavedForecast }) {
  return <section className="saved-reasoning"><h3>Forecaster notes</h3><div><article><strong>Day reasoning</strong><p>{archive.day.reasoning || "No day reasoning was saved with this forecast."}</p></article><article><strong>Night reasoning</strong><p>{archive.night.reasoning || "No night reasoning was saved with this forecast."}</p></article></div></section>;
}

function ForecastCalendarBoard({ archives, verifications, selectedArchiveId, weekStart, onShift, onSelect }: { archives: SavedForecast[]; verifications: Record<string, AutomaticVerification>; selectedArchiveId: string | null; weekStart: string; onShift: (days: number) => void; onSelect: (id: string) => void }) {
  const dates = Array.from({ length: 4 }, (_, index) => addDays(new Date(`${weekStart}T12:00:00`), index));
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set());
  return <section className="weekly-calendar" aria-label="Forecast archive calendar"><div className="weekly-calendar-heading"><div><p className="eyebrow">Forecast archive</p><h3>Forecast target dates</h3></div><div><button type="button" aria-label="Previous four days" onClick={() => onShift(-4)}>←</button><button type="button" aria-label="Next four days" onClick={() => onShift(4)}>→</button></div></div><div className="weekly-calendar-grid">{dates.map((targetDate) => { const records = archives.filter((archive) => archive.targetDate === targetDate).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()); const expanded = expandedDates.has(targetDate); const shownRecords = expanded ? records : records.slice(0, 3); return <article key={targetDate}><header><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))}</strong><small>{records.length} forecast{records.length === 1 ? "" : "s"}</small></header><div>{shownRecords.map((record) => { const score = verifications[record.id]?.dayScore; return <button type="button" key={record.id} className={record.id === selectedArchiveId ? "active" : ""} onClick={() => onSelect(record.id)}><strong>V{record.versionNumber} · {record.status}</strong><span>H {record.day.high} · L {record.night.low}</span><span>PoP {record.day.rainChance}/{record.night.rainChance}</span><small>You · {score === null || score === undefined ? "Unscored" : `Day ${score}%`}</small></button>; })}{records.length > 3 && <button type="button" className="more-records" onClick={() => setExpandedDates((current) => { const next = new Set(current); if (next.has(targetDate)) next.delete(targetDate); else next.add(targetDate); return next; })}>{expanded ? "Show fewer" : `+ ${records.length - 3} more forecasts`}</button>}{records.length === 0 && <p>No forecast</p>}</div></article>; })}</div></section>;
}

export default function Home() {
  const [dataPanel, setDataPanel] = useState<DataPanel>("nbm");
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("dashboard");
  const [radarExpanded, setRadarExpanded] = useState(false);
  const [radarLoop, setRadarLoop] = useState(false);
  const [radarFrames, setRadarFrames] = useState<RadarTimelineFrame[]>([]);
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [radarTimelineStatus, setRadarTimelineStatus] = useState("Loading radar timeline…");
  const [radarMapView, setRadarMapView] = useState<RadarMapView>("composite");
  const [showNwsAlerts, setShowNwsAlerts] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(72);
  const [radarRefreshToken, setRadarRefreshToken] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionToken, setSubmissionToken] = useState("");
  const [liveWeather, setLiveWeather] = useState<LiveWeather | null>(null);
  const [weatherError, setWeatherError] = useState("");
  const [nbmText, setNbmText] = useState("");
  const [nbmStatus, setNbmStatus] = useState("Loading latest KAHN NBM bulletin…");
  const [soundingText, setSoundingText] = useState("");
  const [soundingStatus, setSoundingStatus] = useState("Loading latest observed FFC sounding…");
  const [openMeteoGuidance, setOpenMeteoGuidance] = useState<OpenMeteoGuidance | null>(null);
  const [openMeteoStatus, setOpenMeteoStatus] = useState("Loading Open-Meteo guidance…");
  const [guidanceGroup, setGuidanceGroup] = useState<GuidanceGroup>("high-res");
  const [openMeteoModel, setOpenMeteoModel] = useState<OpenMeteoModel>("best_match");
  const [openMeteoView, setOpenMeteoView] = useState<"hourly" | "daily" | "compare">("hourly");
  const [comparisonLeftModel, setComparisonLeftModel] = useState<OpenMeteoModel>("hrrr_conus");
  const [comparisonRightModel, setComparisonRightModel] = useState<OpenMeteoModel>("nbm_conus");
  const [comparisonView, setComparisonView] = useState<"hourly" | "daily">("hourly");
  const [modelComparison, setModelComparison] = useState<Partial<Record<OpenMeteoModel, OpenMeteoGuidance>>>({});
  const [comparisonStatus, setComparisonStatus] = useState("");
  const [ensembleGuidance, setEnsembleGuidance] = useState<EnsembleGuidance | null>(null);
  const [ensembleStatus, setEnsembleStatus] = useState("Loading ensemble guidance…");
  const [soundingModel, setSoundingModel] = useState<"hrrr" | "gfs">("hrrr");
  const [soundingRunOffset, setSoundingRunOffset] = useState(0);
  const [modelSounding, setModelSounding] = useState<ModelSounding | null>(null);
  const [modelSoundingStatus, setModelSoundingStatus] = useState("Loading model sounding…");
  const [soundingProfileIndex, setSoundingProfileIndex] = useState(0);
  const [archives, setArchives] = useState<SavedForecast[]>([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [archiveDateFilter, setArchiveDateFilter] = useState("");
  const [archiveStatusFilter, setArchiveStatusFilter] = useState<"all" | SavedForecast["status"]>("all");
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveFiltersOpen, setArchiveFiltersOpen] = useState(false);
  const [recordWindowStart, setRecordWindowStart] = useState(() => addDays(new Date(), -1));
  const [recordFocusDate, setRecordFocusDate] = useState(() => addDays(new Date(), 0));
  const [session, setSession] = useState<WeatherDeskSession | null>(null);
  const [role, setRole] = useState("student");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [authMessage, setAuthMessage] = useState("");
  const [loginMenuOpen, setLoginMenuOpen] = useState(false);
  const [forecastRun, setForecastRun] = useState<ForecastRunDraft>(() => ({ id: crypto.randomUUID(), initialHorizonDays: 1, days: [createForecastDay(addDays(new Date(), 0))] }));
  const [selectedForecastDay, setSelectedForecastDay] = useState(0);
  const [tabMenuIndex, setTabMenuIndex] = useState<number | null>(null);
  const [tabMenuMessage, setTabMenuMessage] = useState("");
  const [tabMenuPosition, setTabMenuPosition] = useState({ left: 0, top: 0 });
  const [archiveMenuId, setArchiveMenuId] = useState<string | null>(null);
  const [archiveMenuPosition, setArchiveMenuPosition] = useState({ left: 0, top: 0 });
  const [automaticVerifications, setAutomaticVerifications] = useState<Record<string, AutomaticVerification>>({});
  const [verificationMessage, setVerificationMessage] = useState("");
  const [collectingArchiveId, setCollectingArchiveId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileMessage, setProfileMessage] = useState("");

  useEffect(() => {
    let isActive = true;
    const loadWeather = () => fetch("/api/weather", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load live data");
        if (isActive) {
          setLiveWeather(data);
          setWeatherError("");
        }
      })
      .catch((error: Error) => isActive && setWeatherError(error.message));
    loadWeather();
    const refreshId = window.setInterval(loadWeather, 60_000);
    return () => {
      isActive = false;
      window.clearInterval(refreshId);
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    const loadRadarTimeline = () => fetch("/api/radar/frames", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load radar frames");
        if (isActive) {
          const frames = data.frames as RadarTimelineFrame[];
          setRadarFrames(frames);
          setRadarFrameIndex(Math.max(0, frames.length - 1));
          setRadarTimelineStatus(`${frames.length} frames · RainViewer`);
        }
      })
      .catch((error: Error) => isActive && setRadarTimelineStatus(error.message));
    loadRadarTimeline();
    const refreshId = window.setInterval(loadRadarTimeline, 300_000);
    return () => { isActive = false; window.clearInterval(refreshId); };
  }, []);

  useEffect(() => {
    if (!radarLoop || !radarPlaying || radarFrames.length < 2) return;
    const playId = window.setInterval(() => setRadarFrameIndex((index) => (index + 1) % radarFrames.length), 650);
    return () => window.clearInterval(playId);
  }, [radarLoop, radarPlaying, radarFrames.length]);

  useEffect(() => {
    const storedDraft = window.localStorage.getItem(forecastDraftStorageKey);
    if (!storedDraft) return;
    try {
      const parsed = JSON.parse(storedDraft) as ForecastRunDraft;
      if (parsed.days?.length) setForecastRun({ ...parsed, days: parsed.days.map((day) => ({ ...day, date: fallbackForecastDate(day.date), day: { ...emptyPeriod("day"), ...day.day, references: savedReferences(day.day.references) }, night: { ...emptyPeriod("night"), ...day.night, references: savedReferences(day.night.references) } })) });
    } catch {
      window.localStorage.removeItem(forecastDraftStorageKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(forecastDraftStorageKey, JSON.stringify(forecastRun));
  }, [forecastRun]);

  useEffect(() => {
    const savedSession = window.localStorage.getItem(sessionStorageKey) ?? window.sessionStorage.getItem(sessionStorageKey);
    if (savedSession) {
      const persistent = Boolean(window.localStorage.getItem(sessionStorageKey));
      try {
        const parsed = JSON.parse(savedSession) as WeatherDeskSession;
        setRememberMe(persistent);
        if (!parsed.refresh_token || !supabaseUrl || !supabaseKey) { setSession(parsed); return; }
        fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: parsed.refresh_token }) })
          .then(async (response) => {
            const data = await response.json();
            if (!response.ok || !data.access_token) throw new Error("Session expired");
            const refreshed = { access_token: data.access_token, refresh_token: data.refresh_token ?? parsed.refresh_token, user: data.user ?? parsed.user } as WeatherDeskSession;
            if (persistent) window.localStorage.setItem(sessionStorageKey, JSON.stringify(refreshed)); else window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(refreshed));
            setSession(refreshed);
          })
          .catch(() => { window.localStorage.removeItem(sessionStorageKey); window.sessionStorage.removeItem(sessionStorageKey); });
      } catch { window.localStorage.removeItem(sessionStorageKey); window.sessionStorage.removeItem(sessionStorageKey); }
    }
  }, []);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    Promise.all([
      fetch(`${supabaseUrl}/rest/v1/forecast_runs?select=id,created_at,status,forecast_periods(id,valid_date,period,forecast_data,evidence_snapshot,forecast_verifications(observed_data,score_data))&status=neq.withdrawn&order=created_at.desc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/forecasts?select=id,created_at,forecast_data,evidence_snapshot&status=neq.withdrawn&order=created_at.desc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/forecast_verifications?select=forecast_period_id,observed_data,score_data`, { headers }),
    ]).then(async ([runResponse, legacyResponse, verificationResponse]) => {
      if (!runResponse.ok || !legacyResponse.ok || !verificationResponse.ok) throw new Error("Unable to load cloud archives");
      const runs = await runResponse.json() as CloudRunRow[];
      const legacyRows = await legacyResponse.json() as { id: string; created_at: string; forecast_data: Omit<SavedForecast, "id" | "savedAt">; evidence_snapshot: SavedForecast["evidence"] }[];
      const verificationRows = await verificationResponse.json() as VerificationRow[];
      const runArchives = runs.flatMap(archiveRecordsFromRun);
      const legacyArchives = legacyRows.map((row) => ({ ...row.forecast_data, id: row.id, savedAt: row.created_at, evidence: row.evidence_snapshot })) as SavedForecast[];
      const olderOnly = legacyArchives.filter((legacy) => !runArchives.some((run) => run.targetDate === legacy.targetDate && Math.abs(new Date(run.savedAt).getTime() - new Date(legacy.savedAt).getTime()) < 1000));
      const cloudArchives = [...runArchives, ...olderOnly].sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
      setArchives(cloudArchives);
      setSelectedArchiveId(cloudArchives[0]?.id ?? null);
      const verificationByPeriod = new Map(verificationRows.map((row) => [row.forecast_period_id, row]));
      const restoredVerifications = Object.fromEntries(runArchives.flatMap((archive) => {
        const day = archive.periodIds?.day ? verificationByPeriod.get(archive.periodIds.day) : undefined;
        const night = archive.periodIds?.night ? verificationByPeriod.get(archive.periodIds.night) : undefined;
        if (!day || !night) return [];
        return [[archive.id, { station: "KAHN", fetchedAt: archive.savedAt, day: day.observed_data, night: night.observed_data, dayScore: day.score_data?.automaticScore ?? null, nightScore: night.score_data?.automaticScore ?? null } satisfies AutomaticVerification]];
      }));
      setAutomaticVerifications(restoredVerifications);
    }).catch((error: Error) => setAuthMessage(`Signed in, but cloud archives could not load: ${error.message}`));
  }, [session]);

  useEffect(() => {
    if (!session || role !== "admin" || !supabaseUrl || !supabaseKey) return;
    fetch(`${supabaseUrl}/rest/v1/profiles?select=id,email,role&order=created_at.asc`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Unable to load users")))
      .then((rows: Profile[]) => setProfiles(rows))
      .catch((error: Error) => setProfileMessage(error.message));
  }, [session, role]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey) return;
    fetch(`${supabaseUrl}/rest/v1/profiles?select=role&id=eq.${session.user.id}`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : [])
      .then((rows: { role: string }[]) => setRole(rows[0]?.role ?? "student"));
  }, [session]);

  useEffect(() => {
    fetch("/api/sounding")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Sounding data unavailable");
        setSoundingText(`Observed radiosonde · ${data.station} · ${data.cycle}\n\n${data.text}`);
        setSoundingStatus("");
      })
      .catch((error: Error) => setSoundingStatus(error.message));
  }, []);

  useEffect(() => {
    fetch("/api/nbm")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "NBM data unavailable");
        setNbmText(`NBM hourly bulletin · ${data.station} · ${data.cycle}\n\n${data.text}`);
        setNbmStatus("");
      })
      .catch((error: Error) => setNbmStatus(error.message));
  }, []);

  useEffect(() => {
    setOpenMeteoStatus("Loading Open-Meteo guidance…");
    fetch(`/api/open-meteo?model=${openMeteoModel}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Open-Meteo guidance is unavailable");
        setOpenMeteoGuidance(data as OpenMeteoGuidance);
        setOpenMeteoStatus("");
      })
      .catch((error: Error) => setOpenMeteoStatus(error.message));
  }, [openMeteoModel]);

  useEffect(() => {
    if (dataPanel !== "models" || openMeteoView !== "compare") return;
    const models = [...new Set([comparisonLeftModel, comparisonRightModel])];
    let active = true;
    setComparisonStatus("Loading model comparison…");
    Promise.all(models.map(async (model) => {
      const response = await fetch(`/api/open-meteo?model=${model}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Unable to load ${model}`);
      return [model, data as OpenMeteoGuidance] as const;
    }))
      .then((entries) => {
        if (!active) return;
        setModelComparison(Object.fromEntries(entries));
        setComparisonStatus("");
      })
      .catch((error: Error) => active && setComparisonStatus(error.message));
    return () => { active = false; };
  }, [dataPanel, openMeteoView, comparisonLeftModel, comparisonRightModel]);

  useEffect(() => {
    if (dataPanel !== "ensembles") return;
    let active = true;
    setEnsembleStatus("Loading GFS ensemble guidance…");
    fetch("/api/ensembles")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Ensemble guidance is unavailable");
        if (active) {
          setEnsembleGuidance(data as EnsembleGuidance);
          setEnsembleStatus("");
        }
      })
      .catch((error: Error) => active && setEnsembleStatus(error.message));
    return () => { active = false; };
  }, [dataPanel]);

  useEffect(() => {
    let active = true;
    setModelSounding(null);
    setModelSoundingStatus("Loading model sounding…");
    fetch(`/api/model-sounding?model=${soundingModel}&runOffset=${soundingRunOffset}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Model sounding is unavailable");
        if (active) {
          setModelSounding(data as ModelSounding);
          setSoundingProfileIndex(0);
          setModelSoundingStatus("");
        }
      })
      .catch((error: Error) => active && setModelSoundingStatus(error.message));
    return () => { active = false; };
  }, [soundingModel, soundingRunOffset]);

  useEffect(() => {
    const storedArchives = window.localStorage.getItem(archiveStorageKey);
    if (!storedArchives) return;
    try {
      const parsed = JSON.parse(storedArchives) as SavedForecast[];
      setArchives(parsed);
      setSelectedArchiveId(parsed[0]?.id ?? null);
    } catch {
      window.localStorage.removeItem(archiveStorageKey);
    }
  }, []);

  const observedAt = liveWeather
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(liveWeather.observation.observedAt))
    : "Loading live NWS data…";
  const selectedArchive = archives.find((archive) => archive.id === selectedArchiveId) ?? null;
  const filteredArchives = archives.filter((archive) => {
    const matchingDate = !archiveDateFilter || archive.targetDate === archiveDateFilter;
    const matchingStatus = archiveStatusFilter === "all" || archive.status === archiveStatusFilter;
    const searchText = `${forecastTargetTitle(archive.targetDate)} ${archive.day.conditions} ${archive.night.conditions}`.toLowerCase();
    return matchingDate && matchingStatus && (!archiveSearch.trim() || searchText.includes(archiveSearch.trim().toLowerCase()));
  });
  const recordWindowDates = Array.from({ length: 7 }, (_, index) => addDays(new Date(`${recordWindowStart}T12:00:00`), index));
  const archiveForDate = (targetDate: string) => filteredArchives.filter((archive) => archive.targetDate === targetDate).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())[0] ?? null;
  const selectedReferences = selectedArchive ? [
    ...savedReferences(selectedArchive.day.references).map((reference) => ({ ...reference, period: "Day" })),
    ...savedReferences(selectedArchive.night.references).map((reference) => ({ ...reference, period: "Night" })),
  ] : [];
  const selectedAutomaticVerification = selectedArchive ? automaticVerifications[selectedArchive.id] : null;
  const radarFrame = radarFrames[radarFrameIndex] ?? null;
  const radarFrameTime = radarFrame ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(radarFrame.time * 1000)) : "Timeline unavailable";
  const focusedDateRecords = filteredArchives.filter((archive) => archive.targetDate === recordFocusDate).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

  useEffect(() => {
    if (selectedArchive) setRecordFocusDate(selectedArchive.targetDate);
  }, [selectedArchiveId]);

  useEffect(() => {
    setRecordFocusDate(addDays(new Date(`${recordWindowStart}T12:00:00`), 1));
  }, [recordWindowStart]);
  const selectedDay = forecastRun.days[selectedForecastDay] ?? forecastRun.days[0];
  const archiveMenu = archives.find((archive) => archive.id === archiveMenuId) ?? null;
  const outlook = liveWeather?.forecastPeriods.reduce<{ date: string; label: string; high: number | null; low: number | null; shortForecast: string; precipitationChance: number | null }[]>((days, period) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(period.startTime));
    const existing = days.find((day) => day.date === date);
    const label = new Intl.DateTimeFormat("en-US", { weekday: "short" , timeZone: "America/New_York" }).format(new Date(period.startTime));
    if (existing) {
      existing.high = existing.high === null ? period.temperature : Math.max(existing.high, period.temperature);
      existing.low = existing.low === null ? period.temperature : Math.min(existing.low, period.temperature);
      existing.precipitationChance = Math.max(existing.precipitationChance ?? 0, period.precipitationChance ?? 0);
    } else if (days.length < 7) {
      days.push({ date, label, high: period.temperature, low: period.temperature, shortForecast: period.shortForecast, precipitationChance: period.precipitationChance });
    }
    return days;
  }, []) ?? [];
  const referenceOptions: ReferenceItem[] = [
    { id: "nws-observation", label: "Current NWS observation", detail: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F · ${liveWeather.observation.description} · ${liveWeather.observation.station} · ${observedAt}` : "Live observation was unavailable when attached." },
    { id: "nws-guidance", label: "Current NWS forecast", detail: liveWeather?.forecast ? `${liveWeather.forecast.period}: ${liveWeather.forecast.detailedForecast}` : "NWS forecast was unavailable when attached." },
    { id: "nbm", label: "NBM KAHN bulletin", detail: nbmText || nbmStatus },
    { id: "sounding", label: "Observed FFC sounding", detail: soundingText || soundingStatus },
    { id: "nws-alerts", label: "NWS alerts", detail: liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => `${alert.event}: ${alert.headline ?? ""}`).join("\n") : liveWeather?.alertsAvailable === false ? "NWS alert status could not be confirmed." : "No active NWS alerts at the time this reference was attached." },
  ];

  function updatePeriod(period: "day" | "night", field: Exclude<keyof PeriodDraft, "references">, value: string) {
    setForecastRun((run) => ({
      ...run,
      days: run.days.map((day, index) => index === selectedForecastDay
        ? { ...day, [period]: { ...day[period], [field]: value } }
        : day),
    }));
  }

  function toggleReference(period: "day" | "night", item: ReferenceItem) {
    setForecastRun((run) => ({ ...run, days: run.days.map((day, index) => {
      if (index !== selectedForecastDay) return day;
      const references = day[period].references.some((reference) => reference.id === item.id)
        ? day[period].references.filter((reference) => reference.id !== item.id)
        : [...day[period].references, item];
      return { ...day, [period]: { ...day[period], references } };
    }) }));
  }

  function attachDeskReference(reference: ReferenceItem, targetDate?: string) {
    if (!session) {
      setSaveMessage("Log in before pinning reference data to a forecast.");
      return;
    }
    const date = validForecastDate(targetDate) ? targetDate : selectedDay.date;
    const existingIndex = forecastRun.days.findIndex((day) => day.date === date);
    const nextDays = existingIndex >= 0
      ? forecastRun.days
      : [...forecastRun.days, createForecastDay(date)].sort((a, b) => a.date.localeCompare(b.date));
    const nextIndex = nextDays.findIndex((day) => day.date === date);
    setForecastRun((run) => {
      const days = existingIndex >= 0 ? run.days : [...run.days, createForecastDay(date)].sort((a, b) => a.date.localeCompare(b.date));
      const resolvedIndex = days.findIndex((day) => day.date === date);
      return { ...run, days: days.map((day, index) => index !== resolvedIndex ? day : {
        ...day,
        day: { ...day.day, references: day.day.references.some((item) => item.id === reference.id) ? day.day.references : [...day.day.references, reference] },
        night: { ...day.night, references: day.night.references.some((item) => item.id === reference.id) ? day.night.references : [...day.night.references, reference] },
      }) };
    });
    setSelectedForecastDay(nextIndex);
    setSaveMessage(`${reference.label} pinned to ${forecastTargetTitle(date)} day and night.`);
  }

  function attachGuidanceSeries(guidance: OpenMeteoGuidance, view: "hourly" | "daily") {
    if (!session) {
      setSaveMessage("Log in before pinning reference data to a forecast.");
      return;
    }
    const referencesByDate = new Map<string, ReferenceItem>();
    if (view === "daily") {
      guidance.days.forEach((day) => referencesByDate.set(day.date, {
        id: `model-daily-${guidance.model}-${day.date}-${guidance.fetchedAt}`,
        label: `${guidance.model} daily guidance`,
        detail: `${forecastTargetTitle(day.date)} · High ${day.highF ?? "—"}°F / low ${day.lowF ?? "—"}°F · ${openMeteoWeatherLabel(day.weatherCode)} · PoP ${day.precipitationProbability ?? "—"}% · Wind ${day.windMph ?? "—"}/${day.gustMph ?? "—"} mph`,
      }));
    } else {
      const byDate = new Map<string, typeof guidance.nextHours>();
      guidance.nextHours.forEach((hour) => {
        const date = hour.time.slice(0, 10);
        byDate.set(date, [...(byDate.get(date) ?? []), hour]);
      });
      byDate.forEach((hours, date) => referencesByDate.set(date, {
        id: `model-hourly-${guidance.model}-${date}-${guidance.fetchedAt}`,
        label: `${guidance.model} hourly guidance`,
        detail: hours.map((hour) => `${modelTimestamp(hour.time)} · Temp/dew ${hour.temperatureF ?? "—"}°/${hour.dewpointF ?? "—"}°F · PoP ${hour.precipitationProbability ?? "—"}% · Wind ${hour.windMph ?? "—"}/${hour.gustMph ?? "—"} mph · CAPE ${hour.cape ?? "—"} J/kg`).join("\n"),
      }));
    }
    const targetDates = [...referencesByDate.keys()];
    setForecastRun((run) => {
      const existingDates = new Set(run.days.map((day) => day.date));
      const days = [...run.days, ...targetDates.filter((date) => !existingDates.has(date)).map(createForecastDay)]
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        ...run,
        days: days.map((day) => {
          const reference = referencesByDate.get(day.date);
          if (!reference) return day;
          const add = (period: PeriodDraft) => period.references.some((item) => item.id === reference.id) ? period.references : [...period.references, reference];
          return { ...day, day: { ...day.day, references: add(day.day) }, night: { ...day.night, references: add(day.night) } };
        }),
      };
    });
    setSaveMessage(`${guidance.model} ${view} guidance pinned to ${targetDates.length} matching forecast day${targetDates.length === 1 ? "" : "s"}.`);
  }

  function pinCurrentDeskPanel() {
    const snippet = (value: string, maxLength = 5000) => value.length > maxLength ? `${value.slice(0, maxLength)}\n\n[Source snapshot truncated for archive storage.]` : value;
    if (dataPanel === "nbm") {
      attachDeskReference({ id: `nbm-${Date.now()}`, label: "NBM KAHN bulletin", detail: snippet(nbmText || nbmStatus) });
      return;
    }
    if (dataPanel === "sounding") {
      attachDeskReference({ id: `observed-kffc-${Date.now()}`, label: "Observed KFFC sounding", detail: snippet(soundingText || soundingStatus) });
      return;
    }
    if (dataPanel === "ensembles") {
      const firstRow = ensembleGuidance?.rows[0];
      attachDeskReference({ id: `gfs-ensemble-${ensembleGuidance?.fetchedAt ?? Date.now()}`, label: "GFS ensemble guidance", detail: firstRow ? `${modelTimestamp(firstRow.time)} · ${firstRow.temperature.members} members · Temperature ${firstRow.temperature.min ?? "—"}–${firstRow.temperature.max ?? "—"}°F (mean ${firstRow.temperature.mean ?? "—"}°F) · Wind ${firstRow.wind.min ?? "—"}–${firstRow.wind.max ?? "—"} mph` : ensembleStatus }, firstRow?.time.slice(0, 10));
      return;
    }
    if (dataPanel === "model-sounding") {
      const profile = modelSounding?.profiles[soundingProfileIndex];
      attachDeskReference({ id: `model-sounding-${modelSounding?.model ?? soundingModel}-${profile?.time ?? Date.now()}`, label: `${modelSounding?.model ?? soundingModel.toUpperCase()} model sounding`, detail: profile ? `${modelTimestamp(profile.time)} · run ${runTimestamp(modelSounding?.runTime ?? profile.time)} · CAPE ${profile.diagnostics.cape ?? "—"} J/kg · CIN ${profile.diagnostics.cin ?? "—"} J/kg · Freezing level ${profile.diagnostics.freezingLevelHeightM === null ? "—" : `${Math.round(profile.diagnostics.freezingLevelHeightM * 3.28084).toLocaleString()} ft`}` : modelSoundingStatus }, profile?.time.slice(0, 10));
    }
  }

  async function saveForecast(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (!session || !supabaseUrl || !supabaseKey) {
      setSaveMessage("Sign in before submitting so this forecast can be archived safely.");
      return;
    }
    setIsSubmitting(true);
    setSubmissionToken("");
    const savedAt = new Date().toISOString();
    const nextArchives = forecastRun.days.map((day) => {
      const versionNumber = archives.filter((archive) => archive.targetDate === day.date).length + 1;
      return {
      id: crypto.randomUUID(), savedAt, label: archiveTitle({ savedAt }), targetDate: day.date,
      status: "submitted" as const, versionNumber,
      day: { high: day.day.highLow, conditions: day.day.conditions, rainChance: day.day.rainChance, timing: day.day.timing, hazards: day.day.hazards, reasoning: day.day.reasoning, references: day.day.references },
      night: { low: day.night.highLow, conditions: day.night.conditions, rainChance: day.night.rainChance, timing: day.night.timing, hazards: day.night.hazards, reasoning: day.night.reasoning, references: day.night.references },
      evidence: {
        observation: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F, ${liveWeather.observation.description}; ${liveWeather.observation.station} at ${observedAt}` : "No live observation available when saved",
        forecast: liveWeather?.forecast ? `${liveWeather.forecast.period}: ${liveWeather.forecast.shortForecast}; ${liveWeather.forecast.precipitationChance ?? 0}% precipitation chance` : "No NWS forecast available when saved",
        alerts: liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => alert.event).join(", ") : liveWeather?.alertsAvailable === false ? "NWS alert feed unavailable when saved" : "No active NWS alerts when saved",
      },
    } satisfies SavedForecast;
    });
    try {
      const cloudRecord = await saveForecastRunToCloud(savedAt);
      const cloudArchives = nextArchives.map((archive) => ({
        ...archive,
        id: `${cloudRecord.runId}:${archive.targetDate}`,
        runId: cloudRecord.runId,
        periodIds: cloudRecord.periodIdsByDate[archive.targetDate],
      }));
      const combinedArchives = [...cloudArchives, ...archives].slice(0, 50);
      setArchives(combinedArchives);
      setSelectedArchiveId(cloudArchives[0]?.id ?? null);
      window.localStorage.setItem(archiveStorageKey, JSON.stringify(combinedArchives));
      const detail = `${cloudArchives.length}-day forecast submitted · archive token ${cloudRecord.runId.slice(0, 8).toUpperCase()}`;
      setSaveMessage(`${detail}.`);
      setSubmissionToken(detail);
    } catch (error) {
      setSaveMessage(`Forecast was not submitted: ${error instanceof Error ? error.message : "Cloud storage could not be reached."}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveForecastRunToCloud(submittedAt: string) {
    if (!session || !supabaseUrl || !supabaseKey) throw new Error("Sign in is required to save this forecast.");
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" };
    const runResponse = await fetch(`${supabaseUrl}/rest/v1/forecast_runs`, {
      method: "POST", headers,
      body: JSON.stringify({ user_id: session.user.id, location_name: "Athens, GA", latitude: 33.9519, longitude: -83.3576, initial_horizon_days: forecastRun.days.length, status: "submitted", submitted_at: submittedAt }),
    });
    const runRows = await runResponse.json().catch(() => []);
    if (!runResponse.ok || !runRows[0]?.id) throw new Error("Forecast run storage is not ready. Confirm the forecast-runs SQL migration was run.");
    const evidence = {
      observation: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F, ${liveWeather.observation.description}; ${liveWeather.observation.station} at ${observedAt}` : "No live observation available when saved",
      forecast: liveWeather?.forecast ? `${liveWeather.forecast.period}: ${liveWeather.forecast.shortForecast}; ${liveWeather.forecast.precipitationChance ?? 0}% precipitation chance` : "No NWS forecast available when saved",
      alerts: liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => alert.event).join(", ") : liveWeather?.alertsAvailable === false ? "NWS alert feed unavailable when saved" : "No active NWS alerts when saved",
    };
    const periods = forecastRun.days.flatMap((day) => ([
      { run_id: runRows[0].id, valid_date: day.date, period: "day", forecast_data: day.day, evidence_snapshot: evidence },
      { run_id: runRows[0].id, valid_date: day.date, period: "night", forecast_data: day.night, evidence_snapshot: evidence },
    ]));
    const periodResponse = await fetch(`${supabaseUrl}/rest/v1/forecast_periods`, { method: "POST", headers, body: JSON.stringify(periods) });
    const periodRows = await periodResponse.json().catch(() => []);
    if (!periodResponse.ok) throw new Error("Forecast run was created, but its day/night periods could not be saved.");
    const periodIdsByDate = Object.fromEntries(forecastRun.days.map((day) => {
      const dayPeriod = periodRows.find((period: { valid_date: string; period: string }) => period.valid_date === day.date && period.period === "day");
      const nightPeriod = periodRows.find((period: { valid_date: string; period: string }) => period.valid_date === day.date && period.period === "night");
      if (!dayPeriod?.id || !nightPeriod?.id) throw new Error("Forecast was saved, but its archive links were incomplete. Refresh before collecting actuals.");
      return [day.date, { day: dayPeriod.id as string, night: nightPeriod.id as string }];
    }));
    return { runId: runRows[0].id as string, periodIdsByDate };
  }

  function reviseArchive(archive: SavedForecast) {
    const targetDate = fallbackForecastDate(archive.targetDate);
    setForecastRun({ id: crypto.randomUUID(), initialHorizonDays: 1, days: [{ date: targetDate, day: { ...emptyPeriod("day"), highLow: archive.day.high, conditions: archive.day.conditions, rainChance: archive.day.rainChance, timing: archive.day.timing, hazards: archive.day.hazards, reasoning: archive.day.reasoning ?? "", references: savedReferences(archive.day.references) }, night: { ...emptyPeriod("night"), highLow: archive.night.low, conditions: archive.night.conditions, rainChance: archive.night.rainChance, timing: archive.night.timing, hazards: archive.night.hazards, reasoning: archive.night.reasoning ?? "", references: savedReferences(archive.night.references) } }] });
    setSelectedForecastDay(0); setArchiveMenuId(null); setSaveMessage(`Revision draft opened for ${targetDate}. Submit creates a new, auditable version.`); setActiveSection("forecast");
  }

  function deleteArchive(archive: SavedForecast) {
    if (archive.status !== "draft") return;
    const nextArchives = archives.filter((item) => item.id !== archive.id);
    setArchives(nextArchives); setSelectedArchiveId(nextArchives[0]?.id ?? null); setArchiveMenuId(null);
    window.localStorage.setItem(archiveStorageKey, JSON.stringify(nextArchives));
    if (session && supabaseUrl && supabaseKey) {
      const target = archive.runId ? `forecast_runs?id=eq.${archive.runId}` : `forecasts?id=eq.${archive.id}`;
      fetch(`${supabaseUrl}/rest/v1/${target}`, { method: "DELETE", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } });
    }
  }

  function withdrawArchive(archive: SavedForecast) {
    if (archive.status === "draft") { deleteArchive(archive); return; }
    const nextArchives = archives.filter((item) => item.id !== archive.id);
    setArchives(nextArchives); setSelectedArchiveId(nextArchives[0]?.id ?? null); setArchiveMenuId(null);
    window.localStorage.setItem(archiveStorageKey, JSON.stringify(nextArchives));
    setSaveMessage("Submission withdrawn. It is hidden from your working archive and excluded from grading, but retained in the protected audit history.");
    if (session && supabaseUrl && supabaseKey) fetch(`${supabaseUrl}/rest/v1/${archive.runId ? "forecast_runs" : "forecasts"}?id=eq.${archive.runId ?? archive.id}`, {
      method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "withdrawn" }),
    }).then((response) => { if (!response.ok) throw new Error("Unable to withdraw cloud record"); }).catch((error: Error) => setSaveMessage(`Removed from this browser, but cloud withdrawal failed: ${error.message}`));
  }

  async function collectActuals(archive: SavedForecast) {
    if (collectingArchiveId === archive.id) return;
    if (!archive.periodIds?.day || !archive.periodIds?.night) {
      setVerificationMessage("This forecast is still being linked to its cloud archive. Refresh once, then collect actuals.");
      return;
    }
    setCollectingArchiveId(archive.id);
    setVerificationMessage("Collecting KAHN observations and calculating automated scores…");
    try {
      const response = await fetch(`/api/verify?date=${archive.targetDate}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to collect observations");
      const verification: AutomaticVerification = {
        station: data.station, fetchedAt: data.fetchedAt, day: data.day, night: data.night,
        dayScore: automaticPeriodScore(archive.day.high, archive.day.rainChance, data.day, true),
        nightScore: automaticPeriodScore(archive.night.low, archive.night.rainChance, data.night, false),
      };
      setAutomaticVerifications((all) => ({ ...all, [archive.id]: verification }));
      if (session && supabaseUrl && supabaseKey && archive.periodIds?.day && archive.periodIds?.night) {
        const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates, return=representation" };
        const saved = await Promise.all([
          fetch(`${supabaseUrl}/rest/v1/forecast_verifications?on_conflict=forecast_period_id`, { method: "POST", headers, body: JSON.stringify({ forecast_period_id: archive.periodIds.day, observed_data: data.day, score_data: { automaticScore: verification.dayScore, method: "temperature (70) + precipitation occurrence (30)" } }) }),
          fetch(`${supabaseUrl}/rest/v1/forecast_verifications?on_conflict=forecast_period_id`, { method: "POST", headers, body: JSON.stringify({ forecast_period_id: archive.periodIds.night, observed_data: data.night, score_data: { automaticScore: verification.nightScore, method: "temperature (70) + precipitation occurrence (30)" } }) }),
        ]);
        const failedSave = saved.find((response) => !response.ok);
        if (failedSave) {
          const detail = await failedSave.text().catch(() => "");
          throw new Error(`Actuals were shown, but cloud verification could not be saved (${failedSave.status}${detail ? `: ${detail}` : ""}).`);
        }
        if (data.day.complete && data.night.complete && archive.runId) {
          await fetch(`${supabaseUrl}/rest/v1/forecast_runs?id=eq.${archive.runId}`, { method: "PATCH", headers, body: JSON.stringify({ status: "verified" }) });
        }
      }
      setVerificationMessage(data.day.complete && data.night.complete ? "Automatic score calculated from completed periods." : "Observations collected. A final score will appear after each period ends.");
    } catch (error) { setVerificationMessage(error instanceof Error ? error.message : "Unable to collect observations."); }
    finally { setCollectingArchiveId(null); }
  }

  async function setProfileRole(profile: Profile, nextRole: Profile["role"]) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setProfileMessage("Saving role…");
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${profile.id}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ role: nextRole }) });
    if (!response.ok) { setProfileMessage("Role could not be updated."); return; }
    setProfiles((all) => all.map((item) => item.id === profile.id ? { ...item, role: nextRole } : item));
    setProfileMessage("Role saved.");
  }

  async function authenticate(mode: "signin" | "signup") {
    if (!supabaseUrl || !supabaseKey) { setAuthMessage("Supabase is not configured yet. Restart the development server after saving .env.local."); return; }
    setAuthMessage(mode === "signup" ? "Creating account…" : "Signing in…");
    const path = mode === "signup" ? "signup" : "token?grant_type=password";
    const response = await fetch(`${supabaseUrl}/auth/v1/${path}`, { method: "POST", headers: { apikey: supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: authEmail, password: authPassword }) });
    const data = await response.json();
    if (!response.ok) { setAuthMessage(data.error_description || data.msg || "Unable to sign in."); return; }
    if (!data.access_token) { setAuthMessage("Check your email to confirm the new account, then sign in."); return; }
    const nextSession = { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user } as WeatherDeskSession;
    window.localStorage.removeItem(sessionStorageKey);
    window.sessionStorage.removeItem(sessionStorageKey);
    if (rememberMe) window.localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession)); else window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
    setSession(nextSession);
    setLoginMenuOpen(false);
    setAuthMessage(`Signed in as ${data.user.email}.`);
  }

  return (
    <main className={radarExpanded ? "app radar-expanded" : "app"}>
      <header className="header">
        <div><p className="eyebrow">Human-first forecasting workspace</p><h1>The Weather Desk</h1></div>
        <div className="header-meta"><div className="location">Athens, GA <span>Student workspace</span></div><div className="header-account">{session ? <><span>{session.user.email}</span><button type="button" onClick={() => { window.localStorage.removeItem(sessionStorageKey); window.sessionStorage.removeItem(sessionStorageKey); setSession(null); setAuthMessage("Signed out."); }}>Sign out</button></> : <div className="login-menu-wrap"><button type="button" onClick={() => setLoginMenuOpen((open) => !open)}>Log in</button>{loginMenuOpen && <form className="login-menu" onSubmit={(event) => { event.preventDefault(); authenticate("signin"); }}><strong>Weather Desk account</strong><input aria-label="Email" type="email" placeholder="Email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /><input aria-label="Password" type="password" placeholder="Password (6+ characters)" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /><label className="remember-me"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> Remember me on this browser</label><div><button type="submit">Sign in</button><button type="button" onClick={() => authenticate("signup")}>Create account</button></div>{authMessage && <small>{authMessage}</small>}</form>}</div>}</div></div>
      </header>

      <nav aria-label="Main navigation" className="navigation">
        <button className={activeSection === "dashboard" ? "active" : ""} onClick={() => setActiveSection("dashboard")}>Dashboard</button>
        <button className={activeSection === "forecast" ? "active" : ""} onClick={() => setActiveSection("forecast")}>Forecast</button>
        <button className={activeSection === "verify" ? "active" : ""} onClick={() => setActiveSection("verify")}>Verify</button>
        {session && role === "admin" && <button className={activeSection === "control" ? "active" : ""} onClick={() => setActiveSection("control")}>Control center</button>}
      </nav>

      {activeSection === "dashboard" && <>
      <section className="outlook-strip" aria-label="Seven-day NWS guidance">
        <div className="outlook-heading"><div><h2>7-day guidance</h2><p>NWS reference forecast · not a student submission</p></div><span>Live guidance</span></div>
        <div className="outlook-cards">{outlook.length ? outlook.map((day) => <article key={day.date}><strong>{day.label}</strong><b aria-hidden="true">{weatherIcon(day.shortForecast)}</b><span>{day.shortForecast}</span><em>{day.high}° / {day.low}°</em><small>{day.precipitationChance ?? 0}% PoP</small></article>) : <p>Loading 7-day NWS guidance…</p>}</div>
      </section>
      <section className="dashboard-grid">
        <article className="radar-card">
          <div className="card-heading"><div><h2>Radar</h2><p>{radarMapView === "composite" ? "Live composite reflectivity · centered on Athens" : "OpenWeather map layer · centered on Athens"}</p></div><div className="actions"><button onClick={() => { if (radarMapView !== "composite") { setRadarMapView("composite"); window.dispatchEvent(new CustomEvent("weather-desk-radar-layer", { detail: "none" })); setRadarLoop(true); } else { setRadarLoop((value) => !value); } setRadarPlaying(false); }}>{radarLoop && radarMapView === "composite" ? "Interactive map" : "Radar timeline"}</button><button onClick={() => setRadarRefreshToken((value) => value + 1)}>Refresh</button><button onClick={() => setRadarExpanded((value) => !value)}>{radarExpanded ? "Exit expanded view" : "Expand radar"}</button></div></div>
          <div className="radar"><details className="radar-tools"><summary aria-label="Open radar controls">☰</summary><div><label>Map view<select value={radarMapView} onChange={(event) => { const view = event.target.value as RadarMapView; setRadarMapView(view); window.dispatchEvent(new CustomEvent("weather-desk-radar-layer", { detail: view === "composite" || view === "base" ? "none" : view })); if (view !== "composite") setRadarLoop(false); event.currentTarget.closest("details")?.removeAttribute("open"); }}><option value="composite">Composite reflectivity</option><option value="precipitation_new">Precipitation</option><option value="clouds_new">Cloud cover</option><option value="pressure_new">Pressure</option><option value="wind_new">Wind speed</option><option value="temp_new">Temperature</option><option value="base">Base map only</option></select></label><label className="alert-overlay-toggle"><input type="checkbox" checked={showNwsAlerts} onChange={(event) => { setShowNwsAlerts(event.target.checked); window.dispatchEvent(new CustomEvent("weather-desk-alert-overlay", { detail: event.target.checked })); event.currentTarget.closest("details")?.removeAttribute("open"); }} /> NWS watches &amp; warnings</label><label>Opacity <input type="range" min="20" max="100" value={radarOpacity} onChange={(event) => setRadarOpacity(Number(event.target.value))} /> <span>{radarOpacity}%</span></label><small>{radarMapView === "composite" ? (radarLoop ? radarTimelineStatus : "NOAA composite reflectivity · interactive map") : "OpenWeather weather-map layer · exclusive view"}</small></div></details>{radarLoop && radarMapView === "composite" && <div className="radar-playback"><button type="button" aria-label="Previous radar frame" disabled={!radarFrames.length} onClick={() => { setRadarPlaying(false); setRadarFrameIndex((index) => Math.max(0, index - 1)); }}>‹</button><button type="button" disabled={radarFrames.length < 2} onClick={() => setRadarPlaying((playing) => !playing)}>{radarPlaying ? "Pause" : "Play"}</button><button type="button" aria-label="Next radar frame" disabled={!radarFrames.length} onClick={() => { setRadarPlaying(false); setRadarFrameIndex((index) => Math.min(radarFrames.length - 1, index + 1)); }}>›</button><span>{radarFrameTime}</span></div>}<RadarMap opacity={radarOpacity / 100} showReflectivity={radarMapView === "composite"} refreshToken={radarRefreshToken} timelineTileUrl={radarLoop && radarMapView === "composite" ? radarFrame?.tileUrl : null} /></div>
          <div className="card-footer radar-footer"><RadarLegendStrip view={radarMapView} /></div>
        </article>

        <aside className="quick-data" aria-label="Quick weather reference">
          {weatherError && <div><strong className="alert">Live data unavailable</strong><span>{weatherError}</span></div>}
          {!liveWeather && !weatherError && <div><strong>Loading Athens weather…</strong><span>Contacting the National Weather Service</span></div>}
          {liveWeather && <><div><strong>{liveWeather.observation.temperatureF ?? "—"}°F · {liveWeather.observation.description}</strong><span>{liveWeather.observation.temperatureSource === "forecast estimate" ? "NWS forecast estimate · " : ""}Dew point {liveWeather.observation.dewpointF ?? "—"}°F · {liveWeather.observation.windDirection ?? "—"} {liveWeather.observation.windMph ?? "—"} mph</span></div>
          {liveWeather.forecast && <div><strong>NWS {liveWeather.forecast.period}: {liveWeather.forecast.shortForecast}</strong><span>{liveWeather.forecast.temperature}°{liveWeather.forecast.temperatureUnit} · {liveWeather.forecast.precipitationChance ?? 0}% rain chance</span></div>}
          <div><strong>{liveWeather.alerts[0] ? liveWeather.alerts[0].event : liveWeather.alertsAvailable ? "No active NWS alerts" : "NWS alerts temporarily unavailable"}</strong><span>{liveWeather.alerts[0]?.headline ?? (liveWeather.alertsAvailable ? "No watches, warnings, or advisories reported for this point." : "Alert status could not be confirmed; check official NWS alerts before making a warning-sensitive decision.")}</span></div>
          <div><strong>Observation: {liveWeather.observation.station}</strong><span>{liveWeather.observation.stationName} · {observedAt}</span></div></>}
        </aside>
      </section>

      <section className="data-desk">
        <div className="section-heading"><div><h2>Forecast data desk</h2><p>Full source data for analysis. Quick values remain beside radar.</p></div><span>Archive-ready</span></div>
        <div className="tabs" role="tablist" aria-label="Forecast data sources">
          <button className={dataPanel === "nbm" ? "active" : ""} onClick={() => setDataPanel("nbm")}>NBM full text</button>
          <button className={dataPanel === "sounding" ? "active" : ""} onClick={() => setDataPanel("sounding")}>Sounding</button>
          <button className={dataPanel === "models" ? "active" : ""} onClick={() => setDataPanel("models")}>Other models</button>
          <button className={dataPanel === "ensembles" ? "active" : ""} onClick={() => setDataPanel("ensembles")}>Ensembles</button>
          <button className={dataPanel === "model-sounding" ? "active" : ""} onClick={() => setDataPanel("model-sounding")}>Model sounding</button>
        </div>
        {dataPanel === "nbm" && <section className="source-bulletin"><div className="model-guidance-heading"><div><strong>National Blend of Models bulletin</strong><span>Full NBM source text for Athens-area forecast analysis</span></div><small>{nbmText ? "Latest bulletin loaded" : nbmStatus}</small></div><details><summary>Open full NBM bulletin</summary><pre className="model-text">{nbmText || nbmStatus}</pre></details></section>}
        {dataPanel === "sounding" && <section className="observed-sounding-panel"><div className="model-guidance-heading"><div><strong>Latest observed KFFC sounding</strong><span>Peachtree City, GA · official SPC analysis panel</span></div><a href="https://www.weather.gov/bmx/latestffcsounding" target="_blank" rel="noreferrer">Open NWS source</a></div><img src={officialFfcSoundingImageUrl} alt="Latest observed KFFC upper-air sounding from the Storm Prediction Center" /><details><summary>Raw KFFC sounding text</summary><pre className="model-text">{soundingText || soundingStatus}</pre></details></section>}
        {dataPanel === "models" && <section className="model-workspace">
          <div className="model-desk-controls"><div><span>Open-Meteo model guidance</span><div className="guidance-scope-toggle"><button type="button" className={guidanceGroup === "high-res" ? "active" : ""} onClick={() => { setGuidanceGroup("high-res"); if (!guidanceModels["high-res"].some(([id]) => id === openMeteoModel)) setOpenMeteoModel("hrrr_conus"); }}>High-res</button><button type="button" className={guidanceGroup === "global" ? "active" : ""} onClick={() => { setGuidanceGroup("global"); if (!guidanceModels.global.some(([id]) => id === openMeteoModel)) setOpenMeteoModel("gfs_global"); }}>Global</button></div></div><div className="model-view-toggle"><button type="button" className={openMeteoView === "hourly" ? "active" : ""} onClick={() => setOpenMeteoView("hourly")}>Hourly</button><button type="button" className={openMeteoView === "daily" ? "active" : ""} onClick={() => setOpenMeteoView("daily")}>Daily</button><button type="button" className={openMeteoView === "compare" ? "active" : ""} onClick={() => { const left = openMeteoModel === "best_match" ? "hrrr_conus" : openMeteoModel; setComparisonLeftModel(left); setComparisonRightModel(guidanceGroup === "global" ? "ecmwf_ifs" : "nbm_conus"); setOpenMeteoView("compare"); }}>Compare</button></div></div>
          {openMeteoView !== "compare" && (openMeteoGuidance ? <><article className="single-model-table"><header><div className="model-picker">{guidanceModels[guidanceGroup].map(([id, label]) => <button type="button" key={id} className={openMeteoModel === id ? "active" : ""} onClick={() => setOpenMeteoModel(id)}>{label}</button>)}</div><strong>{openMeteoGuidance.model} · Athens, GA</strong><small>{openMeteoGuidance.current ? `${openMeteoGuidance.current.temperatureF ?? "—"}°F · feels ${openMeteoGuidance.current.feelsLikeF ?? "—"}°F · ${openMeteoWeatherLabel(openMeteoGuidance.current.weatherCode)}` : "Current model guidance unavailable"}</small></header><ModelGuidanceTable guidance={openMeteoGuidance} view={openMeteoView} /><div className="table-reference-action"><small>Save this displayed guidance to the matching dated forecast tabs.</small><button type="button" onClick={() => attachGuidanceSeries(openMeteoGuidance, openMeteoView)}>Add {openMeteoGuidance.model} guidance</button></div></article><p className="model-attribution">Model data: <a href={openMeteoGuidance.source} target="_blank" rel="noreferrer">Open-Meteo</a>. High-res guidance is for near-term detail; global models are for pattern and range.</p></> : <p className="empty">{openMeteoStatus}</p>)}
          {openMeteoView === "compare" && <section className="model-compare" aria-busy={Boolean(comparisonStatus)}>{comparisonStatus && <p className="model-loading" role="status">{comparisonStatus}</p>}<div className="comparison-columns">{[comparisonLeftModel, comparisonRightModel].map((id, index) => { const guidance = modelComparison[id]; const selectedModel = index === 0 ? comparisonLeftModel : comparisonRightModel; return <article key={index}><header><div className="model-picker">{guidanceModels[guidanceGroup].filter(([model]) => model !== "best_match").map(([model, label]) => <button type="button" key={model} className={selectedModel === model ? "active" : ""} onClick={() => { if (index === 0) { if (model === comparisonRightModel) setComparisonRightModel(comparisonLeftModel); setComparisonLeftModel(model); setOpenMeteoModel(model); } else { if (model === comparisonLeftModel) setComparisonLeftModel(comparisonRightModel); setComparisonRightModel(model); } }}>{label}</button>)}</div><div className="comparison-table-title"><strong>{guidance?.model ?? "Loading model…"}</strong><div className="model-view-toggle"><button type="button" className={comparisonView === "hourly" ? "active" : ""} onClick={() => setComparisonView("hourly")}>Hourly</button><button type="button" className={comparisonView === "daily" ? "active" : ""} onClick={() => setComparisonView("daily")}>Daily</button></div></div></header>{guidance ? <><ModelGuidanceTable guidance={guidance} view={comparisonView} compact /><div className="table-reference-action"><small>Save this model to matching forecast dates.</small><button type="button" onClick={() => attachGuidanceSeries(guidance, comparisonView)}>Add {guidance.model}</button></div></> : <p className="empty">Loading model guidance…</p>}</article>; })}</div></section>}
        </section>}
        {dataPanel === "ensembles" && <section className="ensemble-panel"><div className="model-guidance-heading"><div><strong>Global ensemble guidance</strong><span>NOAA GFS ensemble · range and spread for Athens, GA</span></div><small>Uncertainty is forecast information—not a single deterministic answer.</small></div>{ensembleGuidance ? <><div className="ensemble-summary"><article><span>Members</span><strong>{ensembleGuidance.rows[0]?.temperature.members ?? "—"}</strong><small>available at the selected point</small></article><article><span>Temperature spread</span><strong>±{ensembleGuidance.rows[0]?.temperature.spread ?? "—"}°F</strong><small>at the first valid hour</small></article><article><span>Forecast horizon</span><strong>10 days</strong><small>GFS ensemble point guidance</small></article></div><EnsembleTable guidance={ensembleGuidance} /><p className="model-attribution">Ensemble data: <a href={ensembleGuidance.source} target="_blank" rel="noreferrer">Open-Meteo Ensemble API</a>. Individual members quantify plausible outcomes; this summary intentionally emphasizes range and spread.</p></> : <p className="empty">{ensembleStatus}</p>}</section>}
        {dataPanel === "model-sounding" && <section className="model-sounding-panel"><div className="model-desk-controls"><div><span>Forecast profile for Athens, GA</span><div className="model-picker"><button type="button" className={soundingModel === "hrrr" ? "active" : ""} onClick={() => { setSoundingModel("hrrr"); setSoundingRunOffset(0); }}>HRRR</button><button type="button" className={soundingModel === "gfs" ? "active" : ""} onClick={() => { setSoundingModel("gfs"); setSoundingRunOffset(0); }}>GFS</button></div></div>{modelSounding?.profiles.length ? <label className="model-time-select">Valid time<select value={soundingProfileIndex} onChange={(event) => setSoundingProfileIndex(Number(event.target.value))}>{modelSounding.profiles.map((profile, index) => <option key={profile.time} value={index}>{modelTimestamp(profile.time)}</option>)}</select></label> : null}</div><div className="model-run-controls"><button type="button" onClick={() => setSoundingRunOffset((offset) => offset + 1)}>‹ Older run</button><div><span>Archived model run</span><strong>{modelSounding ? runTimestamp(modelSounding.runTime) : "Loading run…"}</strong><small>{modelSounding ? `${modelSounding.cadenceHours}-hour cycle · reproducible run` : "Run selection will remain available"}</small></div><button type="button" disabled={soundingRunOffset === 0} onClick={() => setSoundingRunOffset((offset) => Math.max(0, offset - 1))}>Newer run ›</button></div>{modelSounding?.profiles[soundingProfileIndex] ? <><div className="model-guidance-heading"><div><strong>{modelSounding.model} model sounding · {modelTimestamp(modelSounding.profiles[soundingProfileIndex].time)}</strong><span>Pressure-level forecast profile · not an observed radiosonde</span></div><small>Temperature, moisture, and wind by level</small></div><ModelSoundingChart profile={modelSounding.profiles[soundingProfileIndex]} /><div className="guidance-table-wrap"><table className="guidance-table sounding-table"><thead><tr><th>Pressure</th><th>Height</th><th>Temperature</th><th>RH</th><th>Wind</th></tr></thead><tbody>{modelSounding.profiles[soundingProfileIndex].levels.map((level) => <tr key={level.pressureHpa}><th>{level.pressureHpa} hPa</th><td>{level.geopotentialHeightM ?? "—"} m</td><td>{level.temperatureF ?? "—"}°F</td><td>{level.relativeHumidity ?? "—"}%</td><td>{level.windMph ?? "—"} mph @ {level.windDirection ?? "—"}°</td></tr>)}</tbody></table></div><p className="model-attribution">Profile data: <a href={modelSounding.source} target="_blank" rel="noreferrer">Open-Meteo Single Runs API</a>. Each run is archived and selected by initialization time; compare it with the observed KFFC sounding.</p></> : <p className="empty">{modelSoundingStatus}</p>}</section>}
        {dataPanel !== "models" && <div className="desk-reference-action"><div><strong>Save this reference with your forecast</strong><small>It will be captured in the active forecast day. Time-specific ensemble and model-sounding data use their matching forecast date.</small></div><button type="button" onClick={pinCurrentDeskPanel}>Pin reference to forecast</button></div>}
      </section>
      </>}

      {activeSection === "forecast" && !session && <section className="workspace-card access-wall"><h2>Log in to forecast</h2><p>The dashboard is available to explore, while forecasts, references, and archive work stay private to your account.</p><button type="button" onClick={() => setLoginMenuOpen(true)}>Open login</button></section>}
      {activeSection === "forecast" && session && <section className="workspace-card">
        <div className="section-heading forecast-title"><div><h2>Forecast workspace</h2><p>Each tab is one dated Day/Night forecast.</p></div><div className="horizon-actions"><button type="button" onClick={() => { const start = new Date(); setForecastRun({ id: crypto.randomUUID(), initialHorizonDays: 3, days: [0, 1, 2].map((offset) => createForecastDay(addDays(start, offset))) }); setSelectedForecastDay(0); }}>New 3-day</button><button type="button" onClick={() => { const start = new Date(); setForecastRun({ id: crypto.randomUUID(), initialHorizonDays: 7, days: Array.from({ length: 7 }, (_, offset) => createForecastDay(addDays(start, offset))) }); setSelectedForecastDay(0); }}>New 7-day</button></div></div>
        <div className="day-tabs" role="tablist" aria-label="Forecast days">{forecastRun.days.map((day, index) => <button type="button" key={`${day.date}-${index}`} className={index === selectedForecastDay ? "active" : ""} onClick={() => setSelectedForecastDay(index)} onContextMenu={(event) => { event.preventDefault(); setTabMenuIndex(index); setTabMenuPosition({ left: event.clientX, top: event.clientY }); setTabMenuMessage(""); }}>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day.date}T12:00:00`))}</button>)}<button className="add-day" type="button" aria-label="Add next forecast day" onClick={() => setForecastRun((run) => ({ ...run, days: [...run.days, createForecastDay(addDays(new Date(`${run.days.at(-1)?.date}T12:00:00`), 1))] }))}>+</button></div>
        <input type="hidden" name="target-date" form="forecast-form" value={selectedDay.date} />
        {tabMenuIndex !== null && <div className="tab-menu" style={{ left: tabMenuPosition.left, top: tabMenuPosition.top }}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${forecastRun.days[tabMenuIndex].date}T12:00:00`))}</strong><label>Change date<input type="date" value={forecastRun.days[tabMenuIndex].date} onChange={(event) => { const nextDate = event.target.value; if (forecastRun.days.some((day, index) => index !== tabMenuIndex && day.date === nextDate)) { setTabMenuMessage("That date already has a forecast tab."); return; } setForecastRun((run) => ({ ...run, days: run.days.map((day, index) => index === tabMenuIndex ? { ...day, date: nextDate } : day) })); setTabMenuMessage(""); }} /></label><div><button type="button" onClick={() => setTabMenuIndex(null)}>Done</button><button type="button" disabled={forecastRun.days.length === 1} onClick={() => { setForecastRun((run) => ({ ...run, days: run.days.filter((_, index) => index !== tabMenuIndex) })); setSelectedForecastDay((current) => Math.max(0, Math.min(current, forecastRun.days.length - 2))); setTabMenuIndex(null); }}>Remove day</button></div>{tabMenuMessage && <small>{tabMenuMessage}</small>}</div>}
        <form id="forecast-form" onSubmit={saveForecast}><div className="forecast-period-columns">
          <fieldset className="forecast-period"><legend>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${selectedDay.date}T12:00:00`))} day <small>7 AM–7 PM</small></legend><div className="forecast-fields">
            <label>High temperature<input inputMode="numeric" value={selectedDay.day.highLow} onChange={(event) => updatePeriod("day", "highLow", event.target.value)} /></label>
            <label>Conditions<select value={selectedDay.day.conditions} onChange={(event) => updatePeriod("day", "conditions", event.target.value)}><option value="sunny">Mostly sunny</option><option value="storms">Partly cloudy; scattered storms</option><option value="cloudy">Cloudy</option></select></label>
            <label>Rain chance<input value={selectedDay.day.rainChance} onChange={(event) => updatePeriod("day", "rainChance", event.target.value)} /></label>
            <label>Likely timing<input value={selectedDay.day.timing} onChange={(event) => updatePeriod("day", "timing", event.target.value)} /></label>
            <label>Wind<input value={selectedDay.day.wind} onChange={(event) => updatePeriod("day", "wind", event.target.value)} /></label>
            <label>Confidence<select value={selectedDay.day.confidence} onChange={(event) => updatePeriod("day", "confidence", event.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<input value={selectedDay.day.hazards} onChange={(event) => updatePeriod("day", "hazards", event.target.value)} /></label>
            <div className="wide-field reference-picker"><span>Attach reference data</span><div>{referenceOptions.map((item) => <button type="button" key={item.id} className={selectedDay.day.references.some((reference) => reference.id === item.id) ? "active" : ""} onClick={() => toggleReference("day", item)}>{selectedDay.day.references.some((reference) => reference.id === item.id) ? "✓ " : "+ "}{item.label}</button>)}</div><small>Attached items are captured with this forecast and shown in Verify.</small></div>
            <label className="wide-field">Day reasoning<textarea value={selectedDay.day.reasoning} onChange={(event) => updatePeriod("day", "reasoning", event.target.value)} /></label>
          </div></fieldset>
          <fieldset className="forecast-period"><legend>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${selectedDay.date}T12:00:00`))} night <small>7 PM–7 AM</small></legend><div className="forecast-fields">
            <label>Low temperature<input inputMode="numeric" value={selectedDay.night.highLow} onChange={(event) => updatePeriod("night", "highLow", event.target.value)} /></label>
            <label>Conditions<select value={selectedDay.night.conditions} onChange={(event) => updatePeriod("night", "conditions", event.target.value)}><option value="showers">Partly cloudy; isolated shower early</option><option value="clear">Mostly clear</option><option value="cloudy">Cloudy</option></select></label>
            <label>Rain chance<input value={selectedDay.night.rainChance} onChange={(event) => updatePeriod("night", "rainChance", event.target.value)} /></label>
            <label>Likely timing<input value={selectedDay.night.timing} onChange={(event) => updatePeriod("night", "timing", event.target.value)} /></label>
            <label>Wind<input value={selectedDay.night.wind} onChange={(event) => updatePeriod("night", "wind", event.target.value)} /></label>
            <label>Confidence<select value={selectedDay.night.confidence} onChange={(event) => updatePeriod("night", "confidence", event.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<input value={selectedDay.night.hazards} onChange={(event) => updatePeriod("night", "hazards", event.target.value)} /></label>
            <div className="wide-field reference-picker"><span>Attach reference data</span><div>{referenceOptions.map((item) => <button type="button" key={item.id} className={selectedDay.night.references.some((reference) => reference.id === item.id) ? "active" : ""} onClick={() => toggleReference("night", item)}>{selectedDay.night.references.some((reference) => reference.id === item.id) ? "✓ " : "+ "}{item.label}</button>)}</div><small>Attached items are captured with this forecast and shown in Verify.</small></div>
            <label className="wide-field">Night reasoning<textarea value={selectedDay.night.reasoning} onChange={(event) => updatePeriod("night", "reasoning", event.target.value)} /></label>
          </div></fieldset></div>
          {submissionToken && <div className="submission-token" role="status"><span>✓</span><div><strong>Forecast archived</strong><small>{submissionToken}</small></div><button type="button" aria-label="Dismiss submission confirmation" onClick={() => setSubmissionToken("")}>×</button></div>}
          <div className="form-actions"><span>{saveMessage || "Draft is saved automatically in this browser. Submitting archives each dated tab as an immutable record."}</span><button type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting forecast…" : "Submit forecast run"}</button></div>
        </form>
      </section>}

      {activeSection === "verify" && !session && <section className="workspace-card access-wall"><h2>Sign in to open your archive</h2><p>Your forecasts, evidence, revisions, and verification history stay private to your account.</p><button onClick={() => setActiveSection("forecast")}>Go to Forecast sign-in</button></section>}
      {activeSection === "verify" && session && <section className="workspace-card">
        <div className="records-toolbar"><div><p className="eyebrow">Forecast records</p><h2>Verify your work</h2><p>Compare each submitted forecast with its saved evidence and observations.</p></div><div><span>{filteredArchives.length} record{filteredArchives.length === 1 ? "" : "s"}</span><button type="button" className={archiveFiltersOpen ? "active" : ""} onClick={() => setArchiveFiltersOpen((open) => !open)}>Filter</button></div></div>
        {archiveFiltersOpen && <div className="archive-filters"><label>Forecast date<input type="date" value={archiveDateFilter} onChange={(event) => setArchiveDateFilter(event.target.value)} /></label><label>Status<select value={archiveStatusFilter} onChange={(event) => setArchiveStatusFilter(event.target.value as "all" | SavedForecast["status"])}><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="verified">Verified</option><option value="revised">Revised</option><option value="draft">Draft</option></select></label><label>Search conditions<input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder="storms, clear…" /></label><button type="button" onClick={() => { setArchiveDateFilter(""); setArchiveStatusFilter("all"); setArchiveSearch(""); }}>Clear</button></div>}
        <section className="record-calendar" aria-label="Forecast record dates"><div className="record-calendar-heading"><div><strong>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" }).format(new Date(`${recordWindowStart}T12:00:00`))}</strong><small>Forecast target dates</small></div><div><button type="button" aria-label="Previous seven days" onClick={() => setRecordWindowStart(addDays(new Date(`${recordWindowStart}T12:00:00`), -7))}>←</button><button type="button" aria-label="Next seven days" onClick={() => setRecordWindowStart(addDays(new Date(`${recordWindowStart}T12:00:00`), 7))}>→</button></div></div><div className="record-calendar-days">{recordWindowDates.map((targetDate) => { const archive = archiveForDate(targetDate); const verification = archive ? automaticVerifications[archive.id] : null; return <button type="button" key={targetDate} className={`${archive?.id === selectedArchiveId ? "active " : ""}${archive ? "has-record" : ""}`} onClick={() => archive && setSelectedArchiveId(archive.id)} disabled={!archive}><span>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))}</span><strong>{new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))}</strong>{archive ? <small>H {archive.day.high} · L {archive.night.low}<br />PoP {archive.day.rainChance}/{archive.night.rainChance}<br />{verification?.dayScore !== null && verification?.dayScore !== undefined ? `Score ${verification.dayScore}%` : "Unscored"}</small> : <small>No forecast</small>}</button>; })}</div></section>
        <section className="date-record-list"><div><strong>{forecastTargetTitle(recordFocusDate)}</strong><small>{focusedDateRecords.length ? `${focusedDateRecords.length} forecast${focusedDateRecords.length === 1 ? "" : "s"} for this date` : "No saved forecasts for this date"}</small></div>{focusedDateRecords.length ? <div>{focusedDateRecords.map((archive) => { const verification = automaticVerifications[archive.id]; return <button type="button" key={archive.id} className={archive.id === selectedArchiveId ? "active" : ""} onClick={() => setSelectedArchiveId(archive.id)}><strong>V{archive.versionNumber} · {archive.status}</strong><span>H {archive.day.high} · L {archive.night.low} · PoP {archive.day.rainChance}/{archive.night.rainChance}</span><small>{archiveSubmissionTitle(archive)} · {verification?.dayScore !== null && verification?.dayScore !== undefined ? `Day score ${verification.dayScore}%` : "Unscored"}</small></button>; })}</div> : <p>Use the arrows above to browse a different forecast date.</p>}</section>
        <ForecastCalendarBoard archives={filteredArchives} verifications={automaticVerifications} selectedArchiveId={selectedArchiveId} weekStart={recordWindowStart} onShift={(days) => setRecordWindowStart(addDays(new Date(`${recordWindowStart}T12:00:00`), days))} onSelect={setSelectedArchiveId} />
        {selectedArchive ? <>{verificationMessage && <p className="empty">{verificationMessage}</p>}
        <div className="verification-grid"><div><div className="record-heading"><div><p className="eyebrow">Selected forecast</p><h2>{archiveVersionTitle(selectedArchive)}</h2><p>Athens, GA · {archiveSubmissionTitle(selectedArchive)}</p></div><div className="verification-score"><strong>{selectedArchive.status === "draft" ? "Draft" : selectedAutomaticVerification?.day.complete && selectedAutomaticVerification?.night.complete ? "Verified" : "Pending"}</strong><span>{selectedArchive.status === "draft" ? "not graded" : "automatic verification"}</span><button type="button" disabled={collectingArchiveId === selectedArchive.id} onClick={() => collectActuals(selectedArchive)}>{collectingArchiveId === selectedArchive.id ? "Collecting…" : "Collect actuals"}</button></div></div><div className="record-score-bar"><div><span>Day automatic score</span><i><b style={{ width: `${selectedAutomaticVerification?.dayScore ?? 0}%` }} /></i><strong>{scoreLabel(selectedAutomaticVerification?.dayScore, selectedAutomaticVerification?.day)}</strong></div><div><span>Night automatic score</span><i><b style={{ width: `${selectedAutomaticVerification?.nightScore ?? 0}%` }} /></i><strong>{scoreLabel(selectedAutomaticVerification?.nightScore, selectedAutomaticVerification?.night)}</strong></div></div><h3>Day · 7 AM–7 PM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>Saved guidance</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>{selectedArchive.day.high}°F</td><td>{selectedArchive.evidence.forecast}</td><td>{selectedAutomaticVerification?.day.highF ?? "Awaiting period end"}</td></tr><tr><td>Conditions</td><td>{selectedArchive.day.conditions}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.day.conditions.join("; ") || "Awaiting period end"}</td></tr><tr><td>Rain chance</td><td>{selectedArchive.day.rainChance}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification ? selectedAutomaticVerification.day.precipitationObserved ? "Precipitation observed" : "No precipitation observed" : "Awaiting period end"}</td></tr><tr><td>Timing / hazards</td><td>{selectedArchive.day.timing} · {selectedArchive.day.hazards}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.day.maxWindMph ? `Max wind ${selectedAutomaticVerification.day.maxWindMph} mph` : "Awaiting period end"}</td></tr></tbody></table>
        <h3>Night · 7 PM–7 AM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>Saved guidance</th><th>Observed</th></tr></thead><tbody><tr><td>Low temperature</td><td>{selectedArchive.night.low}°F</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.night.lowF ?? "Awaiting period end"}</td></tr><tr><td>Conditions</td><td>{selectedArchive.night.conditions}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.night.conditions.join("; ") || "Awaiting period end"}</td></tr><tr><td>Rain chance</td><td>{selectedArchive.night.rainChance}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification ? selectedAutomaticVerification.night.precipitationObserved ? "Precipitation observed" : "No precipitation observed" : "Awaiting period end"}</td></tr><tr><td>Timing / hazards</td><td>{selectedArchive.night.timing} · {selectedArchive.night.hazards}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.night.maxWindMph ? `Max wind ${selectedAutomaticVerification.night.maxWindMph} mph` : "Awaiting period end"}</td></tr></tbody></table>
        <div className="verification-notes"><div><span>Observation snapshot</span><strong>Captured</strong><small>{selectedArchive.evidence.observation}</small></div><div><span>NWS guidance snapshot</span><strong>Captured</strong><small>{selectedArchive.evidence.forecast}</small></div><div><span>Alert snapshot</span><strong>Captured</strong><small>{selectedArchive.evidence.alerts}</small></div></div><section className="saved-references"><h3>Attached reference data</h3><p>These are the source snapshots selected when this forecast was submitted.</p>{selectedReferences.length ? selectedReferences.map((reference) => <article key={`${reference.period}-${reference.id}`}><strong>{reference.period} · {reference.label}</strong><pre>{reference.detail}</pre></article>) : <p className="empty">No reference sources were attached to this older record.</p>}</section></div><aside className="history"><h3>Forecast history</h3><p>Open a saved forecast and its captured evidence. Right-click a record for actions.</p>{filteredArchives.map((archive) => { const verification = automaticVerifications[archive.id]; const dayScore = verification?.dayScore; const nightScore = verification?.nightScore; return <button key={archive.id} className={archive.id === selectedArchiveId ? "active" : ""} onClick={() => setSelectedArchiveId(archive.id)} onContextMenu={(event) => { event.preventDefault(); setArchiveMenuId(archive.id); setArchiveMenuPosition({ left: event.clientX, top: event.clientY }); }}>Forecast: {forecastTargetTitle(archive.targetDate)}<div className="archive-score-bars"><span><i style={{ width: `${dayScore ?? 0}%` }} /></span><small>Day {dayScore ?? "pending"}</small><span><i style={{ width: `${nightScore ?? 0}%` }} /></span><small>Night {nightScore ?? "pending"}</small></div><small>{archiveSubmissionTitle(archive)} · V{archive.versionNumber ?? 1} · {archive.status}</small></button>})}{filteredArchives.length === 0 && <p className="empty">No forecasts match these filters.</p>}<button onClick={() => setSelectedArchiveId(null)}>Example · Jul 13<small>Sample verification layout</small></button></aside></div></>
        : <div className="verification-grid"><div><div className="section-heading"><div><h2>Verification · Monday, July 13</h2><p>Example forecast · Asheville Regional Airport</p></div><div className="verification-score"><strong>3 / 4</strong><span>metrics verified</span></div></div><h3>Day · 7 AM–7 PM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>NBM</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>85°F</td><td>83°F</td><td>84°F</td></tr><tr><td>Rain chance</td><td>70%</td><td>62%</td><td>Rain observed</td></tr><tr><td>Rain timing</td><td>4–7 PM</td><td>3–8 PM</td><td>5:12 PM</td></tr><tr><td>Thunderstorm risk</td><td>Scattered</td><td>Possible</td><td>One storm nearby</td></tr></tbody></table><div className="verification-notes"><div><span>Temperature error</span><strong>1°F</strong><small>Your forecast was closer</small></div><div><span>Timing error</span><strong>0:12</strong><small>Rain began 12 min later</small></div><div><span>Reflection</span><strong>Good call</strong><small>Storm coverage was limited</small></div></div></div><aside className="history"><h3>Forecast history</h3><p>Save a forecast to create an archive here.</p>{filteredArchives.map((archive) => <button key={archive.id} onClick={() => setSelectedArchiveId(archive.id)}>Forecast: {forecastTargetTitle(archive.targetDate)}<small>{archiveSubmissionTitle(archive)} · Day + night</small></button>)}</aside></div>}
      </section>}
      {archiveMenu && <div className="tab-menu" style={{ left: archiveMenuPosition.left, top: archiveMenuPosition.top }}><strong>{archiveVersionTitle(archiveMenu)}</strong><small>{archiveMenu.status === "draft" ? "Draft records may be permanently removed." : archiveMenu.runId ? "Withdrawal removes this entire forecast run from your working archive while retaining an audit record." : "Withdrawal removes this submission from your working archive while retaining an audit record."}</small><div><button type="button" onClick={() => { setSelectedArchiveId(archiveMenu.id); setArchiveMenuId(null); setActiveSection("verify"); }}>Open</button><button type="button" onClick={() => reviseArchive(archiveMenu)}>Revise</button></div><button type="button" onClick={() => archiveMenu.status === "draft" ? deleteArchive(archiveMenu) : withdrawArchive(archiveMenu)}>{archiveMenu.status === "draft" ? "Delete draft" : archiveMenu.runId ? "Withdraw forecast run" : "Withdraw submission"}</button></div>}
      {activeSection === "control" && session && role === "admin" && <section className="workspace-card"><div className="section-heading"><div><h2>Control center</h2><p>Administration for linked Weather Desk apps.</p></div><span>Admin</span></div><div className="verification-notes"><div><span>Publishing</span><strong>Protected</strong><small>Student drafts never feed a public-facing forecast.</small></div><div><span>Automated grading</span><strong>Private</strong><small>Scores are currently visible only in each student archive.</small></div><div><span>Audit history</span><strong>Active</strong><small>Submission, revision, withdrawal, and verification records are retained.</small></div></div><section className="role-manager"><h3>Users and roles</h3><p>Roles control access to training, review, administration, and future publishing tools.</p>{profiles.map((profile) => <div key={profile.id}><span>{profile.email ?? profile.id}</span><select value={profile.role} onChange={(event) => setProfileRole(profile, event.target.value as Profile["role"])}><option value="student">Student</option><option value="forecaster">Forecaster</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select></div>)}{profileMessage && <small>{profileMessage}</small>}</section></section>}
      {activeSection === "verify" && session && selectedArchive && <section className="workspace-card record-notes-card"><ForecasterNotes archive={selectedArchive} /><div className="record-actions"><div><strong>Archive actions</strong><small>Revisions create a new auditable forecast. Removing a submitted forecast withdraws it from your working archive while retaining its protected history.</small></div><div><button type="button" onClick={() => reviseArchive(selectedArchive)}>Revise forecast</button><button type="button" className="danger" onClick={() => selectedArchive.status === "draft" ? deleteArchive(selectedArchive) : withdrawArchive(selectedArchive)}>{selectedArchive.status === "draft" ? "Delete draft" : "Withdraw forecast"}</button></div></div></section>}
    </main>
  );
}
