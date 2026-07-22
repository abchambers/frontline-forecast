"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { defaultWeatherDeskLocation, weatherDeskLocation, weatherDeskLocations } from "@/lib/locations";
import { automaticForecastScore, type ForecastPeriodActual } from "@/lib/forecast-verification";

const RadarMap = dynamic(() => import("./radar-map"), {
  ssr: false,
  loading: () => <div className="radar-loading">Loading live radar…</div>,
});

type DataPanel = "nbm" | "sounding" | "models" | "maps" | "ensembles" | "model-sounding";
type GuidanceGroup = "high-res" | "global";
type RadarMapView = "composite" | "satellite" | "base" | "precipitation_new" | "clouds_new" | "pressure_new" | "wind_new" | "temp_new" | "ndfd_maxt" | "ndfd_pop12" | "ndfd_windspd";
type RadarLegend = { title: string; left: string; middle: string; right: string; unit: string; gradient: string };
type OpenMeteoModel = "best_match" | "hrrr_conus" | "nbm_conus" | "nam_conus" | "gfs_global" | "ecmwf_ifs" | "icon_global" | "gem_global";
type WorkspaceSection = "dashboard" | "radar" | "forecast" | "verify" | "classroom" | "control";
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
  locationId?: string;
  locationName?: string;
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
type ReferencePreview =
  | { kind: "model-sounding"; profile: ModelSounding["profiles"][number] }
  | { kind: "guidance"; columns: string[]; rows: string[][] }
  | { kind: "model-guidance"; guidance: OpenMeteoGuidance; view: "hourly" | "daily" }
  | { kind: "ensemble"; guidance: EnsembleGuidance }
  | { kind: "observed-sounding"; station: string; imageUrl: string }
  | { kind: "metrics"; items: { label: string; value: string }[] };
type ReferenceItem = { id: string; label: string; detail: string; preview?: ReferencePreview };
type PeriodDraft = { highLow: string; conditions: string; rainChance: string; timing: string; wind: string; confidence: string; hazards: string; reasoning: string; references: ReferenceItem[] };
type ForecastDayDraft = { date: string; day: PeriodDraft; night: PeriodDraft };
type ForecastRunDraft = { id: string; days: ForecastDayDraft[]; initialHorizonDays: number };
type CloudRunRow = { id: string; created_at: string; status: string; location_name?: string | null; forecast_periods: { id: string; valid_date: string; period: "day" | "night"; forecast_data: PeriodDraft; evidence_snapshot: SavedForecast["evidence"]; forecast_verifications?: { observed_data: ActualPeriod; score_data: { automaticScore?: number | null } }[] }[] };
type ActualPeriod = ForecastPeriodActual;
type AutomaticVerification = { station: string; fetchedAt: string; day: ActualPeriod; night: ActualPeriod; dayScore: number | null; nightScore: number | null };
type VerificationRow = { forecast_period_id: string; observed_data: ActualPeriod; score_data: { automaticScore?: number | null } | null };
type WorkspaceRole = "owner" | "admin" | "instructor" | "reviewer" | "forecaster" | "student" | "member";
type Profile = { id: string; email: string | null; role: WorkspaceRole; display_name: string | null; person_type: "employee" | "student" | "instructor" | "other" | null; employee_id: string | null; student_id: string | null; title: string | null };
type WorkspaceContext = { key: string; kind: "personal" | "all" | "organization" | "classroom"; label: string; detail: string; organizationId?: string; classroomId?: string; role?: string };
type OrganizationMembershipRow = { organization_id: string; role: string; organizations: { id: string; name: string; kind: string } | null };
type ClassroomMembershipRow = { classroom_id: string; role: string; classrooms: { id: string; name: string; term: string | null; organization_id: string; organizations: { name: string } | null } | null };
type OrganizationRow = { id: string; name: string; kind: string };
type ClassroomRow = { id: string; name: string; term: string | null; organization_id: string; organizations: { name: string } | null };
type OrganizationWorkspace = { id: string; name: string; kind: "company" | "school" | "personal" };
type ClassroomWorkspace = { id: string; name: string; term: string | null; organization_id: string };
type OrganizationMember = { id: string; organization_id: string; user_id: string; role: WorkspaceRole; status: "active" | "invited" | "suspended"; profiles: Pick<Profile, "id" | "email" | "display_name" | "person_type"> | null };
type ClassroomMember = { id: string; classroom_id: string; user_id: string; role: "instructor" | "student" | "assistant"; status: "active" | "invited" | "suspended"; profiles: Pick<Profile, "id" | "email" | "display_name" | "person_type"> | null };
type ReviewTarget = { userId: string; label: string; organizationId: string; classroomId?: string };
type AcademicRosterMember = ReviewTarget & { role: string; email: string | null; personType: Profile["person_type"] };
type InstructorForecastSnapshot = { saved_at: string; location_name: string; days: ForecastDayDraft[] };
type ClassroomAssignment = { id: string; classroom_id: string; title: string; instructions: string | null; target_date: string; due_at: string | null; status: "draft" | "open" | "closed"; instructor_forecast: InstructorForecastSnapshot | null; instructor_forecast_updated_at: string | null; created_at: string };
type ReviewRun = { id: string; user_id: string; created_at: string; status: string; location_name: string | null; forecast_periods: { id: string; valid_date: string; period: "day" | "night"; forecast_data: PeriodDraft; forecast_verifications: { score_data: { automaticScore?: number | null } | null }[] }[] };
type ForecastReview = { id: string; run_id: string; reviewer_id: string; comment: string | null; manual_score: number | null; created_at: string };
type WorkspacePreferences = { defaultLocationId: string; radarMapView: RadarMapView; radarOpacity: number; showNwsAlerts: boolean; defaultForecastDays: 1 | 3 | 7 };

const archiveStorageKey = "weather-desk-forecast-archives";
const forecastDraftStorageKey = "weather-desk-active-forecast-draft";
const sessionStorageKey = "weather-desk-supabase-session";
const locationStorageKey = "weather-desk-location";
const themeStorageKey = "weather-desk-theme";
const workspaceSettingsStorageKey = "weather-desk-workspace-settings";
const workspaceContextStoragePrefix = "weather-desk-active-workspace";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
function officialSoundingImageUrl(station: string) { return `https://www.spc.noaa.gov/exper/soundings/LATEST/${station}.gif`; }
const guidanceModels = {
  "high-res": [["best_match", "Auto"], ["hrrr_conus", "HRRR"], ["nam_conus", "NAM"], ["nbm_conus", "NBM blend"]],
  global: [["gfs_global", "GFS"], ["ecmwf_ifs", "ECMWF"], ["icon_global", "ICON"], ["gem_global", "GEM"]],
} as const satisfies Record<GuidanceGroup, readonly (readonly [OpenMeteoModel, string])[]>;

function addDays(date: Date, amount: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day") + amount)).toISOString().slice(0, 10);
}

function nextForecastDate() {
  return addDays(new Date(), 1);
}

function workspaceDeskLabel(workspace: WorkspaceContext | undefined) {
  if (!workspace || workspace.kind === "personal") return "Personal Desk";
  if (workspace.kind === "all") return "The Weather Desk";
  return /desk$/i.test(workspace.label) ? workspace.label : `${workspace.label} Desk`;
}

function validForecastDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function fallbackForecastDate(value: unknown) {
  return validForecastDate(value) ? value : addDays(new Date(), 0);
}

function emptyPeriod(period: "day" | "night"): PeriodDraft {
  return { highLow: "", conditions: "", rainChance: "", timing: "", wind: "", confidence: "moderate", hazards: "", reasoning: "", references: [] };
}

function createForecastDay(date: string): ForecastDayDraft { return { date, day: emptyPeriod("day"), night: emptyPeriod("night") }; }

const conditionOptions = [
  ["clear", "Clear"], ["mostly-sunny", "Mostly sunny"], ["partly-cloudy", "Partly cloudy"], ["mostly-cloudy", "Mostly cloudy"], ["cloudy", "Cloudy"], ["haze", "Haze or smoke"],
  ["fog", "Fog"], ["drizzle", "Drizzle"], ["showers", "Showers"], ["rain", "Rain"], ["storms", "Thunderstorms"], ["isolated-storms", "Isolated thunderstorms"], ["scattered-storms", "Scattered thunderstorms"],
  ["severe-storms", "Severe thunderstorms"], ["windy", "Windy"], ["hot-humid", "Hot and humid"], ["snow", "Snow"], ["sleet", "Sleet"], ["wintry-mix", "Wintry mix"], ["freezing-rain", "Freezing rain"],
] as const;

function conditionLabel(value: string) {
  const legacy: Record<string, string> = { sunny: "Mostly sunny", storms: "Partly cloudy; scattered storms" };
  return conditionOptions.find(([key]) => key === value)?.[1] ?? legacy[value] ?? (value.replace(/[-_]/g, " ") || "—");
}

function displayForecastTemperature(value: string) {
  const clean = value.trim().replace(/°\s*(?:F)?/gi, "");
  return clean ? `${clean}°F` : "—";
}

function displayForecastChance(value: string) {
  const clean = value.trim().replace(/%/g, "");
  return clean ? `${clean}%` : "—";
}

function temperatureInputValue(value: string) {
  const cleaned = value.replace(/[^0-9.-]/g, "");
  const negative = cleaned.startsWith("-") ? "-" : "";
  const body = cleaned.replace(/-/g, "");
  const [whole = "", ...decimal] = body.split(".");
  return `${negative}${whole}${decimal.length ? `.${decimal.join("")}` : ""}`;
}

function percentInputValue(value: string) {
  return value.replace(/\D/g, "").slice(0, 3);
}

function unitInputStyle(value: string, placeholderLength: number) {
  return { "--unit-position": `${Math.max(value.length || placeholderLength, 1)}ch` } as React.CSSProperties;
}

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

function nearestModelProfileIndex(profiles: ModelSounding["profiles"]) {
  if (!profiles.length) return 0;
  const now = Date.now();
  return profiles.reduce((nearestIndex, profile, index) => {
    const nearestDistance = Math.abs(new Date(profiles[nearestIndex].time).getTime() - now);
    const candidateDistance = Math.abs(new Date(profile.time).getTime() - now);
    return candidateDistance < nearestDistance ? index : nearestIndex;
  }, 0);
}

function runTimestamp(time: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(`${time}:00Z`));
}

const radarLegends: Record<RadarMapView, RadarLegend | null> = {
  composite: { title: "Base reflectivity", left: "0", middle: "35", right: "70+", unit: "dBZ", gradient: "linear-gradient(90deg,#6fb7ff 0 7%,#3bd8e9 7% 14%,#35ca8a 14% 22%,#36b84d 22% 30%,#a9d337 30% 38%,#efe23a 38% 46%,#ffbf25 46% 54%,#ff8027 54% 62%,#ec3e32 62% 70%,#be1f57 70% 78%,#9b2678 78% 86%,#dbdce5 86% 100%)" },
  satellite: null,
  ndfd_maxt: { title: "NDFD maximum temperature", left: "Cooler", middle: "Seasonal", right: "Warmer", unit: "NWS forecast map", gradient: "linear-gradient(90deg,#5543ad 0%,#4a9de0 22%,#66c96b 48%,#f0d544 68%,#f48635 84%,#d84242 100%)" },
  ndfd_pop12: { title: "NDFD 12-hour precipitation chance", left: "0%", middle: "50%", right: "100%", unit: "NWS forecast map", gradient: "linear-gradient(90deg,#f3f5f6 0%,#8ad7df 25%,#4db8c7 45%,#4bb95d 64%,#e4ce36 82%,#c63d52 100%)" },
  ndfd_windspd: { title: "NDFD sustained wind speed", left: "Light", middle: "Breezy", right: "Strong", unit: "NWS forecast map", gradient: "linear-gradient(90deg,#c3f0ff 0%,#49bce8 24%,#48c46e 48%,#f0c42f 70%,#e65742 88%,#a72777 100%)" },
  precipitation_new: { title: "Precipitation intensity", left: "Light", middle: "Moderate", right: "Heavy", unit: "OpenWeather", gradient: "linear-gradient(90deg,#77b7ff 0%,#38c5d5 22%,#38bf68 44%,#e2d42f 65%,#ff8d21 82%,#d7263d 100%)" },
  clouds_new: { title: "Cloud cover", left: "0%", middle: "50%", right: "100%", unit: "OpenWeather", gradient: "linear-gradient(90deg,#eef5fa 0%,#bfcbd8 35%,#748293 68%,#263544 100%)" },
  pressure_new: { title: "Surface pressure", left: "Lower", middle: "Typical", right: "Higher", unit: "OpenWeather", gradient: "linear-gradient(90deg,#5061bf 0%,#77b0db 30%,#d9df6e 55%,#e79239 78%,#b33447 100%)" },
  wind_new: { title: "Wind speed", left: "Light", middle: "Breezy", right: "Strong", unit: "OpenWeather", gradient: "linear-gradient(90deg,#b3ecff 0%,#4ab8f0 24%,#46c76e 48%,#f0c42f 70%,#e65642 88%,#a72777 100%)" },
  temp_new: { title: "Temperature", left: "Colder", middle: "Mild", right: "Warmer", unit: "OpenWeather", gradient: "linear-gradient(90deg,#5148a8 0%,#4a9de0 22%,#65c86b 48%,#f0d544 68%,#f48635 84%,#d84242 100%)" },
  base: null,
};

const radarLegendBands: Record<Exclude<RadarMapView, "base" | "satellite">, { label: string; description: string }[]> = {
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
  ndfd_maxt: [{ label: "Cooler", description: "Lower forecast maximum temperatures." }, { label: "Seasonal", description: "Middle forecast maximum temperatures." }, { label: "Warmer", description: "Higher forecast maximum temperatures." }],
  ndfd_pop12: [{ label: "0–25%", description: "Lower chance of measurable precipitation." }, { label: "25–75%", description: "Meaningful precipitation potential." }, { label: "75–100%", description: "High precipitation chance." }],
  ndfd_windspd: [{ label: "Light", description: "Lighter forecast sustained winds." }, { label: "Breezy", description: "Breezy forecast sustained winds." }, { label: "Strong", description: "Stronger forecast sustained winds." }],
};

function RadarLegendStrip({ view }: { view: RadarMapView }) {
  const legend = radarLegends[view];
  const [hoveredBand, setHoveredBand] = useState<{ label: string; description: string } | null>(null);
  if (view === "satellite") return <span className="radar-source-note">GOES-East GeoColor · visible daytime / infrared nighttime · refreshes about every 10 min</span>;
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
  // A conventional Skew-T plot ends at 100 hPa. Keeping the data and every
  // thermodynamic family in this same domain prevents the graphic from
  // turning into a generic diagonal-line profile above the sounding panel.
  const levels = profile.levels
    .filter((level) => level.temperatureF !== null && level.pressureHpa >= 100 && level.pressureHpa <= 1000)
    .sort((a, b) => b.pressureHpa - a.pressureHpa);
  const width = 920;
  const height = 500;
  const margin = { top: 28, right: 250, bottom: 44, left: 58 };
  const right = width - margin.right;
  const bottom = height - margin.bottom;
  const logarithmicHeight = Math.log(1000 / 100);
  // Pressure decreases with height: 1000 hPa belongs at the bottom and
  // 100 hPa at the top. Keep this transform as the one source of truth for
  // every grid family, profile point, and wind barb.
  const pressureToY = (pressure: number) => bottom - (Math.log(1000 / pressure) / logarithmicHeight) * (bottom - margin.top);
  // A Skew-T uses a logarithmic pressure axis with straight, gently tilted
  // isotherms.  Keep the skew in screen pixels rather than temperature units:
  // the former preserves the same geometry for every trace and prevents upper
  // levels from shearing out of the plotting window.
  // Include the full upper-air range returned by the models, while preserving
  // readable 10-degree isotherm spacing across the panel. The displayed
  // surface scale runs from -80 to +50 C.
  const temperatureMin = -80;
  const temperatureRange = 130;
  // The upper-air offset keeps cold temperatures inside the plot. With the
  // corrected pressure orientation, it grows upward, so traces slope toward
  // the colder upper-left portion of the diagram as in an operational Skew-T.
  const skewPixels = 300;
  const x = (temperatureC: number, pressure: number) => {
    const verticalFraction = (bottom - pressureToY(pressure)) / (bottom - margin.top);
    return margin.left + ((temperatureC - temperatureMin) / temperatureRange) * (right - margin.left) + verticalFraction * skewPixels;
  };
  const toC = (temperatureF: number) => (temperatureF - 32) * 5 / 9;
  const pathFor = (values: (number | null)[]) => levels.map((level, index) => {
    const value = values[index];
    return value === null ? null : `${index === 0 || values[index - 1] === null ? "M" : "L"}${x(toC(value), level.pressureHpa).toFixed(1)},${pressureToY(level.pressureHpa).toFixed(1)}`;
  }).filter(Boolean).join(" ");
  const pressureLines = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100];
  const isotherms = [-90, -80, -70, -60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60];
  const dryAdiabats = [250, 260, 270, 280, 290, 300, 310, 320, 330, 340, 350, 360, 370, 380, 390, 400, 420, 440];
  const moistAdiabats = [0, 5, 10, 15, 20, 25, 30, 35, 40];
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
  const saturationMixingRatio = (temperatureK: number, pressureHpa: number) => {
    const temperatureC = temperatureK - 273.15;
    const vaporPressure = Math.min(pressureHpa * 0.99, 6.112 * Math.exp((17.67 * temperatureC) / (temperatureC + 243.5)));
    return (0.622 * vaporPressure) / Math.max(0.01, pressureHpa - vaporPressure);
  };
  // Integrate a saturated pseudo-adiabat upward in 10 hPa steps. This gives
  // the curved moist-adiabat family visible on operational Skew-T charts.
  const moistAdiabatPath = (startingTemperatureC: number) => {
    const points: string[] = [];
    let temperatureK = startingTemperatureC + 273.15;
    for (let pressure = 1000; pressure >= 100; pressure -= 10) {
      points.push(`${pressure === 1000 ? "M" : "L"}${x(temperatureK - 273.15, pressure).toFixed(1)},${pressureToY(pressure).toFixed(1)}`);
      const mixingRatio = saturationMixingRatio(temperatureK, pressure);
      const rd = 287.05;
      const rv = 461.5;
      const cp = 1004;
      const latentHeat = 2.5e6;
      const pressurePa = pressure * 100;
      const dTemperatureDPressure = ((rd * temperatureK / pressurePa) * (1 + (latentHeat * mixingRatio) / (rd * temperatureK)))
        / (cp + (latentHeat ** 2 * mixingRatio * 0.622) / (rv * temperatureK ** 2));
      temperatureK -= dTemperatureDPressure * 1000;
    }
    return points.join(" ");
  };
  const mixingRatioPath = (mixingRatio: number) => Array.from({ length: 35 }, (_, index) => 1000 - index * (600 / 34)).map((pressure, index) => `${index === 0 ? "M" : "L"}${x(dewpointForMixingRatio(mixingRatio, pressure), pressure).toFixed(1)},${pressureToY(pressure).toFixed(1)}`).join(" ");
  const dewpoints = levels.map((level) => dewpointFromTemperatureAndRh(level.temperatureF, level.relativeHumidity));
  const windLevels = levels.filter((level) => level.windMph !== null && level.windDirection !== null && [1000, 925, 850, 700, 500, 400, 300, 250, 200, 150, 100].includes(level.pressureHpa));
  const hodo = { x: right + 145, y: 187, scale: 2.15, radius: 96 };
  const hodoPoint = (level: typeof windLevels[number]) => { const speedKt = (level.windMph ?? 0) / 1.15078; const radians = ((level.windDirection ?? 0) * Math.PI) / 180; return { x: hodo.x - speedKt * Math.sin(radians) * hodo.scale, y: hodo.y + speedKt * Math.cos(radians) * hodo.scale }; };
  const hodoPath = windLevels.map((level, index) => { const point = hodoPoint(level); return `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`; }).join(" ");
  const windBarb = (speedKt: number) => {
    let remaining = Math.max(0, Math.round(speedKt / 5) * 5);
    const flags = Math.floor(remaining / 50); remaining -= flags * 50;
    const fullBarbs = Math.floor(remaining / 10); remaining -= fullBarbs * 10;
    const halfBarb = remaining >= 5;
    return <><line x1="0" y1="0" x2="0" y2="-28" />{Array.from({ length: flags }, (_, index) => <path key={`flag-${index}`} d={`M0 ${-4 - index * 7} L10 ${-8 - index * 7} L0 ${-11 - index * 7} Z`} />)}{Array.from({ length: fullBarbs }, (_, index) => { const offset = flags * 7 + index * 5; return <line key={`barb-${index}`} x1="0" y1={-5 - offset} x2="10" y2={-10 - offset} />; })}{halfBarb && <line x1="0" y1={-5 - flags * 7 - fullBarbs * 5} x2="5" y2={-7.5 - flags * 7 - fullBarbs * 5} />}</>;
  };
  return <figure className="skewt-chart"><figcaption><div><span>Skew‑T / log‑P model profile</span><small>Thermodynamic projection with standard log-pressure, skewed-temperature geometry</small></div><small>Model guidance only · no parcel diagnostics are inferred</small></figcaption><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Skew-T log-P model profile with temperature, dew point, pressure, winds, and hodograph"><defs><clipPath id="skewt-plot"><rect x={margin.left} y={margin.top} width={right - margin.left} height={bottom - margin.top} /></clipPath></defs><rect x={margin.left} y={margin.top} width={right - margin.left} height={bottom - margin.top} rx="5" /><g className="skewt-grid"><g clipPath="url(#skewt-plot)">{pressureLines.map((pressure) => <line className="isobar" key={pressure} x1={margin.left} x2={right} y1={pressureToY(pressure)} y2={pressureToY(pressure)} />)}{isotherms.map((temperature) => <line className="isotherm" key={temperature} x1={x(temperature, 1000)} x2={x(temperature, 100)} y1={pressureToY(1000)} y2={pressureToY(100)} />)}{dryAdiabats.map((theta) => <path className="dry-adiabat" key={theta} d={dryAdiabatPath(theta)} />)}{moistAdiabats.map((temperature) => <path className="moist-adiabat" key={temperature} d={moistAdiabatPath(temperature)} />)}{mixingRatios.map((ratio) => <path className="mixing-ratio" key={ratio} d={mixingRatioPath(ratio)} />)}<path className="skewt-temperature" d={pathFor(levels.map((level) => level.temperatureF))} /><path className="skewt-dewpoint" d={pathFor(dewpoints)} /></g>{pressureLines.map((pressure) => <text key={pressure} x={margin.left - 8} y={pressureToY(pressure) + 4} textAnchor="end">{pressure}</text>)}{isotherms.map((temperature) => { const labelX = x(temperature, 1000); return labelX >= margin.left && labelX <= right ? <text key={temperature} x={labelX} y={height - 15} textAnchor="middle">{temperature}°</text> : null; })}</g><g className="skewt-winds">{windLevels.map((level) => <g key={level.pressureHpa} transform={`translate(${right + 44} ${pressureToY(level.pressureHpa)}) rotate(${(level.windDirection ?? 0) + 180})`}>{windBarb((level.windMph ?? 0) / 1.15078)}</g>)}</g><g className="skewt-hodograph"><text x={hodo.x} y={35} textAnchor="middle">Hodograph</text>{[20, 40].map((speed) => <circle key={speed} cx={hodo.x} cy={hodo.y} r={speed * hodo.scale} />)}<line x1={hodo.x - hodo.radius} x2={hodo.x + hodo.radius} y1={hodo.y} y2={hodo.y} /><line x1={hodo.x} x2={hodo.x} y1={hodo.y - hodo.radius} y2={hodo.y + hodo.radius} /><path d={hodoPath} />{windLevels.filter((level) => [1000, 850, 700, 500, 300].includes(level.pressureHpa)).map((level) => { const point = hodoPoint(level); return <g key={level.pressureHpa}><circle cx={point.x} cy={point.y} r="3" /><text x={point.x + 5} y={point.y - 5}>{level.pressureHpa}</text></g>; })}</g><text className="skewt-axis" x={16} y={height / 2} transform={`rotate(-90 16 ${height / 2})`} textAnchor="middle">Pressure (hPa)</text><text className="skewt-axis" x={right + 44} y={height - 15} textAnchor="middle">wind</text></svg><div className="skewt-legend"><span><i className="temperature" />Temperature</span><span><i className="dewpoint" />Dew point (from model RH)</span><span><i className="dry" />Dry adiabats</span><span><i className="moist" />Moist adiabats</span><span><i className="mixing" />Mixing ratio</span><small>Wind barbs: half = 5 kt · full = 10 kt · pennant = 50 kt</small></div></figure>;
}

// The model panel uses an explicit Skew-T / log-P projection. It remains
// clearly labeled as model guidance; observed parcel diagnostics stay on the
// official SPC KFFC panel shown beside the raw observed sounding.
function ModelSoundingChart({ profile }: { profile: ModelSounding["profiles"][number] }) {
  return <><SkewTChart profile={profile} /><ModelEnvironmentSummary profile={profile} /></>;
}

function ArchivedReferencePreview({ reference }: { reference: ReferenceItem }) {
  const snapshotLines = reference.detail.split(/\n+/).filter(Boolean);
  const legacyGuidanceRows = /hourly guidance/i.test(reference.label) && snapshotLines.length > 1
    ? snapshotLines.map((line) => {
      const parts = line.split(" · ");
      const valueFor = (label: string) => parts.find((part) => part.startsWith(label))?.slice(label.length).trim() ?? "—";
      return [parts[0] ?? "—", valueFor("Temp/dew"), valueFor("PoP"), valueFor("Wind"), valueFor("CAPE")];
    })
    : null;
  const legacyObservedStation = reference.label.match(/observed\s+k?([a-z0-9]{3,4})\s+sounding/i)?.[1]?.toUpperCase();
  const observedPreview = reference.preview?.kind === "observed-sounding"
    ? reference.preview
    : legacyObservedStation ? { kind: "observed-sounding" as const, station: legacyObservedStation, imageUrl: officialSoundingImageUrl(legacyObservedStation) } : null;
  if (reference.preview?.kind === "model-sounding") {
    return <div className="archived-reference-preview model-reference-preview"><ModelSoundingChart profile={reference.preview.profile} /><details><summary>Saved source details</summary><ul>{snapshotLines.map((line, index) => <li key={`${reference.id}-${index}`}>{line}</li>)}</ul></details></div>;
  }
  if (reference.preview?.kind === "model-guidance") {
    return <div className="archived-reference-preview"><div className="archived-model-heading"><strong>{reference.preview.guidance.model} · {reference.preview.guidance.location}</strong><small>Saved {reference.preview.view} guidance for this forecast date</small></div><ModelGuidanceTable guidance={reference.preview.guidance} view={reference.preview.view} /><details><summary>Show saved source details</summary><pre>{reference.detail}</pre></details></div>;
  }
  if (reference.preview?.kind === "ensemble") {
    return <div className="archived-reference-preview"><div className="archived-model-heading"><strong>{reference.preview.guidance.model} ensemble · {reference.preview.guidance.location}</strong><small>Saved ensemble range and spread available at attachment time</small></div><EnsembleTable guidance={reference.preview.guidance} /><details><summary>Show saved source details</summary><pre>{reference.detail}</pre></details></div>;
  }
  if (observedPreview) {
    return <div className="archived-reference-preview observed-reference-preview"><figure><img src={observedPreview.imageUrl} alt={`Official SPC upper-air sounding chart for ${observedPreview.station}`} /><figcaption><strong>Official K{observedPreview.station} upper-air analysis</strong><small>The archived text below is the saved record; the official graphic is the current SPC panel.</small></figcaption></figure><details><summary>Saved source details</summary><pre>{reference.detail}</pre></details></div>;
  }
  if (reference.preview?.kind === "guidance") {
    return <div className="archived-reference-preview"><div className="reference-table-wrap"><table><thead><tr>{reference.preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{reference.preview.rows.map((row, index) => <tr key={`${reference.id}-${index}`}>{row.map((value, cellIndex) => <td key={`${index}-${cellIndex}`}>{value}</td>)}</tr>)}</tbody></table></div><details><summary>Saved source details</summary><ul>{snapshotLines.map((line, index) => <li key={`${reference.id}-${index}`}>{line}</li>)}</ul></details></div>;
  }
  if (reference.preview?.kind === "metrics") {
    return <div className="archived-reference-preview"><div className="reference-metric-grid">{reference.preview.items.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div><details><summary>Saved source details</summary><pre>{reference.detail}</pre></details></div>;
  }
  if (legacyGuidanceRows) {
    return <div className="archived-reference-preview"><div className="reference-table-wrap"><table><thead><tr><th>Valid</th><th>Temp / dew</th><th>PoP</th><th>Wind / gust</th><th>CAPE</th></tr></thead><tbody>{legacyGuidanceRows.map((row, index) => <tr key={`${reference.id}-${index}`}>{row.map((value, cellIndex) => <td key={`${index}-${cellIndex}`}>{value}</td>)}</tr>)}</tbody></table></div><details><summary>Show saved source details</summary><pre>{reference.detail}</pre></details></div>;
  }
  return <div className="archived-reference-preview"><div className="reference-text-card"><span>Saved source snapshot</span><p>{snapshotLines[0] ?? "No source detail was saved."}</p>{snapshotLines.length > 1 && <small>{snapshotLines.length - 1} additional source line{snapshotLines.length === 2 ? "" : "s"} retained below</small>}</div><details><summary>Show saved source details</summary><pre>{reference.detail}</pre></details></div>;
}

function ModelEnvironmentSummary({ profile }: { profile: ModelSounding["profiles"][number] }) {
  const surface = profile.levels.find((level) => level.pressureHpa === 1000) ?? profile.levels[0];
  const sixKmLevel = profile.levels.filter((level) => level.geopotentialHeightM !== null).sort((a, b) => Math.abs((a.geopotentialHeightM ?? 0) - 6000) - Math.abs((b.geopotentialHeightM ?? 0) - 6000))[0];
  const midLevel = profile.levels.find((level) => level.pressureHpa === 500);
  const windVector = (level: typeof surface | undefined) => {
    if (!level || level.windMph === null || level.windDirection === null) return null;
    const radians = level.windDirection * Math.PI / 180;
    return { u: -level.windMph * Math.sin(radians), v: -level.windMph * Math.cos(radians) };
  };
  const surfaceWind = windVector(surface);
  const sixKmWind = windVector(sixKmLevel);
  const deepLayerShear = surfaceWind && sixKmWind ? Math.round(Math.hypot(sixKmWind.u - surfaceWind.u, sixKmWind.v - surfaceWind.v)) : null;
  const lapseRate = surface?.temperatureF != null && midLevel?.temperatureF != null && surface?.geopotentialHeightM != null && midLevel?.geopotentialHeightM != null
    ? Math.round((((surface.temperatureF - midLevel.temperatureF) * 5 / 9) / ((midLevel.geopotentialHeightM - surface.geopotentialHeightM) / 1000)) * 10) / 10
    : null;
  const surfaceDewpoint = dewpointFromTemperatureAndRh(surface?.temperatureF ?? null, surface?.relativeHumidity ?? null);
  const lclMeters = surface?.temperatureF !== null && surface?.temperatureF !== undefined && surfaceDewpoint !== null
    ? Math.round(125 * ((surface.temperatureF - 32) * 5 / 9 - (surfaceDewpoint - 32) * 5 / 9))
    : null;
  return <section className="model-environment" aria-label="Model sounding interpretation"><div><span>Surface T / Td</span><strong>{surface?.temperatureF ?? "—"}° / {surfaceDewpoint ?? "—"}°F</strong><small>temperature / derived dew point</small></div><div><span>LCL</span><strong>{lclMeters === null ? "—" : `${Math.round(lclMeters * 3.28084).toLocaleString()} ft`}</strong><small>approximate model-derived</small></div><div><span>Surface CAPE / CIN</span><strong>{profile.diagnostics.cape ?? "—"} / {profile.diagnostics.cin ?? "—"}</strong><small>J/kg · model-provided</small></div><div><span>Freezing level</span><strong>{profile.diagnostics.freezingLevelHeightM === null ? "—" : `${Math.round(profile.diagnostics.freezingLevelHeightM * 3.28084).toLocaleString()} ft`}</strong><small>model-provided</small></div><div><span>0–6 km shear</span><strong>{deepLayerShear ?? "—"} mph</strong><small>{sixKmLevel?.geopotentialHeightM ? `surface to ${Math.round(sixKmLevel.geopotentialHeightM / 100) / 10} km MSL` : "profile-derived"}</small></div><div><span>1000–500 lapse rate</span><strong>{lapseRate ?? "—"} °C/km</strong><small>derived from the profile</small></div></section>;
}

function EnsembleTable({ guidance }: { guidance: EnsembleGuidance }) {
  return <div className="guidance-table-wrap"><table className="guidance-table ensemble-table"><thead><tr><th>Valid</th><th>Temp range / mean</th><th>Spread</th><th>Precip range</th><th>Wind range / mean</th></tr></thead><tbody>{guidance.rows.filter((_, index) => index % 3 === 0).slice(0, 24).map((row) => <tr key={row.time}><th>{modelTimestamp(row.time)}</th><td>{row.temperature.min ?? "—"}–{row.temperature.max ?? "—"}° / {row.temperature.mean ?? "—"}°</td><td>±{row.temperature.spread ?? "—"}°</td><td>{row.precipitation.min ?? "—"}–{row.precipitation.max ?? "—"} in</td><td>{row.wind.min ?? "—"}–{row.wind.max ?? "—"} / {row.wind.mean ?? "—"} mph</td></tr>)}</tbody></table></div>;
}

function savedReferences(value: unknown): ReferenceItem[] {
  return Array.isArray(value) ? value.filter((item): item is ReferenceItem => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.label === "string" && typeof item.detail === "string")) : [];
}

function readableEvidence(value: string) {
  return value.replace(/;\s*undefined\s+at\b/i, "; NWS observation station at");
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

function locationForArchive(archive: Pick<SavedForecast, "locationId" | "locationName">) {
  const knownLocation = archive.locationId
    ? weatherDeskLocation(archive.locationId)
    : weatherDeskLocations.find((location) => location.name === archive.locationName);
  return knownLocation ?? defaultWeatherDeskLocation;
}

function archiveRecordsFromRun(run: CloudRunRow): SavedForecast[] {
  const runLocation = weatherDeskLocations.find((location) => location.name === run.location_name) ?? defaultWeatherDeskLocation;
  const byDate = new Map<string, CloudRunRow["forecast_periods"]>();
  run.forecast_periods.forEach((period) => byDate.set(period.valid_date, [...(byDate.get(period.valid_date) ?? []), period]));
  return [...byDate.entries()].map(([targetDate, periods]) => {
    const day = periods.find((period) => period.period === "day");
    const night = periods.find((period) => period.period === "night");
    const dayData = day?.forecast_data ?? emptyPeriod("day");
    const nightData = night?.forecast_data ?? emptyPeriod("night");
    const status: SavedForecast["status"] = ["draft", "submitted", "revised", "verified", "withdrawn"].includes(run.status) ? run.status as SavedForecast["status"] : "submitted";
    return {
      id: `${run.id}:${targetDate}`, runId: run.id, periodIds: { day: day?.id, night: night?.id }, locationId: runLocation.id, locationName: run.location_name ?? runLocation.name, savedAt: run.created_at, label: archiveTitle({ savedAt: run.created_at }), targetDate, status, versionNumber: 1,
      day: { high: dayData.highLow, conditions: dayData.conditions, rainChance: dayData.rainChance, timing: dayData.timing, hazards: dayData.hazards, reasoning: dayData.reasoning, references: savedReferences(dayData.references) },
      night: { low: nightData.highLow, conditions: nightData.conditions, rainChance: nightData.rainChance, timing: nightData.timing, hazards: nightData.hazards, reasoning: nightData.reasoning, references: savedReferences(nightData.references) },
      evidence: day?.evidence_snapshot ?? night?.evidence_snapshot ?? { observation: "No observation snapshot", forecast: "No NWS snapshot", alerts: "No alert snapshot" },
    };
  });
}

function numberArchiveVersions(records: SavedForecast[]) {
  const versionsByDate = new Map<string, number>();
  return [...records]
    .sort((a, b) => new Date(a.savedAt).getTime() - new Date(b.savedAt).getTime() || a.id.localeCompare(b.id))
    .map((record) => {
      const versionNumber = (versionsByDate.get(record.targetDate) ?? 0) + 1;
      versionsByDate.set(record.targetDate, versionNumber);
      return { ...record, versionNumber };
    })
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}

function ForecasterNotes({ archive }: { archive: SavedForecast }) {
  return <section className="saved-reasoning"><h3>Forecaster notes</h3><div><article><strong>Day reasoning</strong><p>{archive.day.reasoning || "No day reasoning was saved with this forecast."}</p></article><article><strong>Night reasoning</strong><p>{archive.night.reasoning || "No night reasoning was saved with this forecast."}</p></article></div></section>;
}

function ForecastCalendarBoard({ archives, verifications, selectedArchiveId, weekStart, onShift, onSelect }: { archives: SavedForecast[]; verifications: Record<string, AutomaticVerification>; selectedArchiveId: string | null; weekStart: string; onShift: (days: number) => void; onSelect: (id: string) => void }) {
  const dates = Array.from({ length: 4 }, (_, index) => addDays(new Date(`${weekStart}T12:00:00`), index));
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set());
  return <section className="weekly-calendar" aria-label="Forecast archive calendar"><div className="weekly-calendar-heading"><div><p className="eyebrow">Forecast archive</p><h3>Forecast target dates</h3></div><div><button type="button" aria-label="Previous four days" onClick={() => onShift(-4)}>←</button><button type="button" aria-label="Next four days" onClick={() => onShift(4)}>→</button></div></div><div className="weekly-calendar-grid">{dates.map((targetDate) => { const records = archives.filter((archive) => archive.targetDate === targetDate).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()); const expanded = expandedDates.has(targetDate); const shownRecords = expanded ? records : records.slice(0, 3); return <article key={targetDate}><header><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))}</strong><small>{records.length} forecast{records.length === 1 ? "" : "s"}</small></header><div>{shownRecords.map((record) => { const score = verifications[record.id]?.dayScore; return <button type="button" key={record.id} className={record.id === selectedArchiveId ? "active" : ""} onClick={() => onSelect(record.id)}><strong>V{record.versionNumber} · {record.status}</strong><span>H {displayForecastTemperature(record.day.high)} · L {displayForecastTemperature(record.night.low)}</span><span>PoP {displayForecastChance(record.day.rainChance)}/{displayForecastChance(record.night.rainChance)}</span><small>You · {score === null || score === undefined ? "Unscored" : `Day ${score}%`}</small></button>; })}{records.length > 3 && <button type="button" className="more-records" onClick={() => setExpandedDates((current) => { const next = new Set(current); if (next.has(targetDate)) next.delete(targetDate); else next.add(targetDate); return next; })}>{expanded ? "Show fewer" : `+ ${records.length - 3} more forecasts`}</button>}{records.length === 0 && <p>No forecast</p>}</div></article>; })}</div></section>;
}

function PeopleDirectory({ profiles, onRoleChange, onProfileSave, message }: { profiles: Profile[]; onRoleChange: (profile: Profile, role: WorkspaceRole) => void; onProfileSave: (profile: Profile, fields: Pick<Profile, "display_name" | "person_type" | "employee_id" | "student_id" | "title">) => void; message: string }) {
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Pick<Profile, "display_name" | "person_type" | "employee_id" | "student_id" | "title">>>({});
  useEffect(() => setDrafts(Object.fromEntries(profiles.map((profile) => [profile.id, { display_name: profile.display_name, person_type: profile.person_type, employee_id: profile.employee_id, student_id: profile.student_id, title: profile.title }]))), [profiles]);
  const shownProfiles = profiles.filter((profile) => `${profile.display_name ?? ""} ${profile.email ?? ""} ${profile.employee_id ?? ""} ${profile.student_id ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="people-directory"><header><div><p className="eyebrow">People</p><h3>User profiles and access</h3><p>Profiles identify people; workspace memberships decide where they can work. Email remains the sign-in identity.</p></div><label>Find a person<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, or ID" /></label></header><div className="people-directory-list">{shownProfiles.map((profile) => { const draft = drafts[profile.id] ?? { display_name: profile.display_name, person_type: profile.person_type, employee_id: profile.employee_id, student_id: profile.student_id, title: profile.title }; return <details key={profile.id}><summary><span><strong>{profile.display_name || profile.email || "Unnamed account"}</strong><small>{profile.email ?? profile.id}</small></span><span>{profile.person_type ?? "member"} · {profile.role}</span></summary><div className="person-profile-fields"><label>Name<input value={draft.display_name ?? ""} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, display_name: event.target.value } }))} placeholder="Display name" /></label><label>Profile type<select value={draft.person_type ?? "other"} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, person_type: event.target.value as Profile["person_type"] } }))}><option value="employee">Employee</option><option value="instructor">Instructor</option><option value="student">Student</option><option value="other">Other</option></select></label><label>Title / program<input value={draft.title ?? ""} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, title: event.target.value } }))} placeholder="Meteorologist, class, department…" /></label><label>Employee ID<input value={draft.employee_id ?? ""} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, employee_id: event.target.value } }))} placeholder="Optional" /></label><label>Student ID<input value={draft.student_id ?? ""} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, student_id: event.target.value } }))} placeholder="Optional" /></label><label>Platform role<select disabled={profile.role === "owner"} value={profile.role} onChange={(event) => onRoleChange(profile, event.target.value as WorkspaceRole)}><option value="owner">Owner (locked)</option><option value="admin">Admin</option><option value="instructor">Instructor</option><option value="reviewer">Reviewer</option><option value="forecaster">Forecaster</option><option value="student">Student</option><option value="member">Member</option></select></label></div><div className="person-profile-actions"><small>{profile.role === "owner" ? "Permanent platform owner. Role cannot be changed here." : "Platform role controls administration; organization/classroom memberships are granted separately."}</small><button type="button" onClick={() => onProfileSave(profile, draft)}>Save profile</button></div></details>; })}</div>{!shownProfiles.length && <p className="empty">No matching user profiles.</p>}{message && <p className="control-message" role="status">{message}</p>}</section>;
}

function AccessManager({ organizations, classrooms, organizationMembers, classroomMembers, profiles, onCreateOrganization, onCreateClassroom, onAddOrganizationMember, onAddClassroomMember, onRemoveOrganizationMember, onRemoveClassroomMember, onReviewMember, message }: { organizations: OrganizationWorkspace[]; classrooms: ClassroomWorkspace[]; organizationMembers: OrganizationMember[]; classroomMembers: ClassroomMember[]; profiles: Profile[]; onCreateOrganization: (name: string, kind: OrganizationWorkspace["kind"]) => void; onCreateClassroom: (organizationId: string, name: string, term: string) => void; onAddOrganizationMember: (organizationId: string, userId: string, role: WorkspaceRole) => void; onAddClassroomMember: (classroomId: string, userId: string, role: ClassroomMember["role"]) => void; onRemoveOrganizationMember: (membership: OrganizationMember) => void; onRemoveClassroomMember: (membership: ClassroomMember) => void; onReviewMember: (target: ReviewTarget) => void; message: string }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [classroomId, setClassroomId] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationKind, setOrganizationKind] = useState<OrganizationWorkspace["kind"]>("company");
  const [classroomName, setClassroomName] = useState("");
  const [classroomTerm, setClassroomTerm] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [organizationRole, setOrganizationRole] = useState<WorkspaceRole>("member");
  const [classroomRole, setClassroomRole] = useState<ClassroomMember["role"]>("student");
  useEffect(() => { if (!organizations.some((organization) => organization.id === organizationId)) setOrganizationId(organizations[0]?.id ?? ""); }, [organizationId, organizations]);
  const organizationClasses = classrooms.filter((classroom) => classroom.organization_id === organizationId);
  useEffect(() => { if (!organizationClasses.some((classroom) => classroom.id === classroomId)) setClassroomId(organizationClasses[0]?.id ?? ""); }, [classroomId, organizationClasses]);
  const organizationRoster = organizationMembers.filter((membership) => membership.organization_id === organizationId);
  const classroomRoster = classroomMembers.filter((membership) => membership.classroom_id === classroomId);
  const personName = (profile: OrganizationMember["profiles"] | ClassroomMember["profiles"]) => profile?.display_name || profile?.email || "Unnamed account";
  return <section className="access-manager"><header><div><p className="eyebrow">Access</p><h3>Organizations and classrooms</h3><p>Membership is scoped. Add a person to only the company, school, or class where they should work.</p></div></header><div className="access-create-grid"><form onSubmit={(event) => { event.preventDefault(); if (organizationName.trim()) { onCreateOrganization(organizationName.trim(), organizationKind); setOrganizationName(""); } }}><strong>Create workspace</strong><input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Organization or school name" /><select value={organizationKind} onChange={(event) => setOrganizationKind(event.target.value as OrganizationWorkspace["kind"])}><option value="company">Company</option><option value="school">School</option><option value="personal">Personal</option></select><button type="submit">Create workspace</button></form><form onSubmit={(event) => { event.preventDefault(); if (organizationId && classroomName.trim()) { onCreateClassroom(organizationId, classroomName.trim(), classroomTerm.trim()); setClassroomName(""); setClassroomTerm(""); } }}><strong>Create classroom</strong><select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.length ? organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>) : <option value="">Create a workspace first</option>}</select><input value={classroomName} onChange={(event) => setClassroomName(event.target.value)} placeholder="Classroom name" disabled={!organizationId} /><input value={classroomTerm} onChange={(event) => setClassroomTerm(event.target.value)} placeholder="Term (optional)" disabled={!organizationId} /><button type="submit" disabled={!organizationId}>Create classroom</button></form></div>{organizations.length > 0 && <><div className="access-context-picker"><label>Workspace<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.kind}</option>)}</select></label><label>Classroom<select value={classroomId} onChange={(event) => setClassroomId(event.target.value)}><option value="">No classroom selected</option>{organizationClasses.map((classroom) => <option key={classroom.id} value={classroom.id}>{classroom.name}{classroom.term ? ` · ${classroom.term}` : ""}</option>)}</select></label></div><div className="access-rosters"><article><header><strong>{organizations.find((organization) => organization.id === organizationId)?.name} roster</strong><small>Organization role controls company/school-level access.</small></header><div className="access-roster-add"><select value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)}><option value="">Select a user</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name || profile.email || profile.id}</option>)}</select><select value={organizationRole} onChange={(event) => setOrganizationRole(event.target.value as WorkspaceRole)}><option value="admin">Admin</option><option value="instructor">Instructor</option><option value="reviewer">Reviewer</option><option value="forecaster">Forecaster</option><option value="student">Student</option><option value="member">Member</option></select><button type="button" disabled={!memberUserId} onClick={() => { onAddOrganizationMember(organizationId, memberUserId, organizationRole); setMemberUserId(""); }}>Add</button></div><div className="access-roster-list">{organizationRoster.map((membership) => <div key={membership.id}><span><strong>{personName(membership.profiles)}</strong><small>{membership.profiles?.email}</small></span><em>{membership.role}</em><button type="button" onClick={() => onReviewMember({ userId: membership.user_id, label: personName(membership.profiles), organizationId })}>Review</button><button type="button" onClick={() => onRemoveOrganizationMember(membership)}>Remove</button></div>)}{!organizationRoster.length && <p>No one has been assigned yet.</p>}</div></article><article><header><strong>{classroomId ? organizationClasses.find((classroom) => classroom.id === classroomId)?.name : "Classroom"} roster</strong><small>Classroom roles support instructor and student workflows.</small></header>{classroomId ? <><div className="access-roster-add"><select value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)}><option value="">Select a user</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.display_name || profile.email || profile.id}</option>)}</select><select value={classroomRole} onChange={(event) => setClassroomRole(event.target.value as ClassroomMember["role"])}><option value="instructor">Instructor</option><option value="assistant">Assistant</option><option value="student">Student</option></select><button type="button" disabled={!memberUserId} onClick={() => { onAddClassroomMember(classroomId, memberUserId, classroomRole); setMemberUserId(""); }}>Add</button></div><div className="access-roster-list">{classroomRoster.map((membership) => <div key={membership.id}><span><strong>{personName(membership.profiles)}</strong><small>{membership.profiles?.email}</small></span><em>{membership.role}</em><button type="button" onClick={() => onReviewMember({ userId: membership.user_id, label: personName(membership.profiles), organizationId, classroomId })}>Review</button><button type="button" onClick={() => onRemoveClassroomMember(membership)}>Remove</button></div>)}{!classroomRoster.length && <p>No one has been assigned yet.</p>}</div></> : <p className="empty">Create or select a classroom to manage its roster.</p>}</article></div></>}{message && <p className="control-message" role="status">{message}</p>}</section>;
}

function AcademicReviewDesk({ workspace, roster, onReviewMember, message }: { workspace: WorkspaceContext; roster: AcademicRosterMember[]; onReviewMember: (target: ReviewTarget) => void; message: string }) {
  const isClassroom = workspace.kind === "classroom";
  const students = roster.filter((member) => member.role === "student");
  const reviewers = roster.filter((member) => member.role !== "student");
  return <section className="academic-review-desk"><header className="section-heading"><div><p className="eyebrow">{isClassroom ? "Classroom workflow" : "Workspace review"}</p><h2>{workspaceDeskLabel(workspace)}</h2><p>{isClassroom ? "Student forecasts stay private. Instructors and assistants can review only this classroom’s submitted work." : "Review access is limited to the selected organization’s non-classroom records."}</p></div><span>{isClassroom ? "Private class" : "Private review"}</span></header><div className="academic-status-grid"><article><span>{isClassroom ? "Students" : "Members"}</span><strong>{students.length || roster.length}</strong><small>{isClassroom ? "Assigned to this classroom" : "Available in this workspace"}</small></article><article><span>Review team</span><strong>{reviewers.length}</strong><small>Instructors, assistants, or reviewers</small></article><article><span>Publication</span><strong>Off</strong><small>Reviews do not publish a forecast</small></article></div><section className="academic-roster"><header><div><h3>{isClassroom ? "Student review queue" : "Forecast review queue"}</h3><p>Select a person to open their private forecast records, automatic scores, and review notes.</p></div></header><div>{roster.map((member) => <article key={`${member.userId}:${member.classroomId ?? member.organizationId}`}><span><strong>{member.label}</strong><small>{member.email ?? "Account profile"}</small></span><em>{member.role}</em><button type="button" onClick={() => onReviewMember(member)}>Review forecasts</button></article>)}{!roster.length && <p className="empty">No active people are available in this workspace yet.</p>}</div></section>{message && <p className="control-message" role="status">{message}</p>}</section>;
}

function ClassroomAssignmentDesk({ assignments, selectedAssignmentId, canManage, onCreate, onOpenForecast, onOpenAssignment, message }: { assignments: ClassroomAssignment[]; selectedAssignmentId: string; canManage: boolean; onCreate: (fields: Pick<ClassroomAssignment, "title" | "instructions" | "target_date" | "due_at" | "status">) => void; onOpenForecast: () => void; onOpenAssignment: (assignment: ClassroomAssignment) => void; message: string }) {
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState(nextForecastDate());
  const [dueAt, setDueAt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [status, setStatus] = useState<ClassroomAssignment["status"]>("open");
  const selectedAssignment = assignments.find((assignment) => assignment.id === selectedAssignmentId) ?? null;
  const instructorForecast = selectedAssignment?.instructor_forecast ?? null;
  return <section className="assignment-desk"><header><div><p className="eyebrow">Forecast assignments</p><h3>Class work</h3><p>Assignments link a student’s submitted forecast to a target date without making student work public.</p></div><button type="button" onClick={onOpenForecast}>Open forecast</button></header>{canManage && <form onSubmit={(event) => { event.preventDefault(); if (!title.trim() || !targetDate) return; onCreate({ title: title.trim(), instructions: instructions.trim() || null, target_date: targetDate, due_at: dueAt ? new Date(dueAt).toISOString() : null, status }); setTitle(""); setInstructions(""); setDueAt(""); }}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Assignment title" /><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /><select value={status} onChange={(event) => setStatus(event.target.value as ClassroomAssignment["status"])}><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></select><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional direction or grading focus" /><button type="submit">Create assignment</button></form>}<div className="assignment-list">{assignments.map((assignment) => <button type="button" key={assignment.id} className={assignment.id === selectedAssignmentId ? "active" : ""} onClick={() => onOpenAssignment(assignment)}><span><strong>{assignment.title}</strong><small>{forecastTargetTitle(assignment.target_date)}{assignment.due_at ? ` · due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(assignment.due_at))}` : ""}</small>{assignment.instructions && <em>{assignment.instructions}</em>}</span><b>{assignment.id === selectedAssignmentId ? "Selected" : "Open"}</b></button>)}{!assignments.length && <p className="empty">No class assignments are open yet.</p>}</div>{selectedAssignment && <section className="assignment-instructor-forecast"><header><div><p className="eyebrow">Instructor forecast</p><h4>{instructorForecast ? "Published class example" : "No class example yet"}</h4><p>{instructorForecast ? `Captured ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(instructorForecast.saved_at))} · ${instructorForecast.location_name}` : canManage ? "Open this assignment and submit a forecast as the instructor example." : "Your instructor has not posted a class example yet."}</p></div></header>{instructorForecast && <div className="assignment-forecast-grid">{instructorForecast.days.filter((day) => day.date === selectedAssignment.target_date).map((day) => <div key={day.date}><article><span>Day</span><strong>H {displayForecastTemperature(day.day.highLow)}</strong><small>{conditionLabel(day.day.conditions)} · PoP {displayForecastChance(day.day.rainChance)}</small><p>{[day.day.timing, day.day.hazards].filter(Boolean).join(" · ") || "No timing or hazards entered."}</p></article><article><span>Night</span><strong>L {displayForecastTemperature(day.night.highLow)}</strong><small>{conditionLabel(day.night.conditions)} · PoP {displayForecastChance(day.night.rainChance)}</small><p>{[day.night.timing, day.night.hazards].filter(Boolean).join(" · ") || "No timing or hazards entered."}</p></article></div>)}</div>}</section>}{message && <p className="control-message" role="status">{message}</p>}</section>;
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
  const [radarRecenterToken, setRadarRecenterToken] = useState(0);
  const [locationId, setLocationId] = useState(defaultWeatherDeskLocation.id);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [defaultLocationId, setDefaultLocationId] = useState(defaultWeatherDeskLocation.id);
  const [defaultForecastDays, setDefaultForecastDays] = useState<1 | 3 | 7>(1);
  const [settingsReady, setSettingsReady] = useState(false);
  const [controlMessage, setControlMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [workspaceNotice, setWorkspaceNotice] = useState<{ message: string; targetDate?: string } | null>(null);
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
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [forecastRun, setForecastRun] = useState<ForecastRunDraft>(() => ({ id: crypto.randomUUID(), initialHorizonDays: 1, days: [createForecastDay(nextForecastDate())] }));
  const [selectedForecastDay, setSelectedForecastDay] = useState(0);
  const [tabMenuIndex, setTabMenuIndex] = useState<number | null>(null);
  const [tabMenuMessage, setTabMenuMessage] = useState("");
  const [tabMenuPosition, setTabMenuPosition] = useState({ left: 0, top: 0 });
  const [archiveMenuId, setArchiveMenuId] = useState<string | null>(null);
  const [archiveMenuPosition, setArchiveMenuPosition] = useState({ left: 0, top: 0 });
  const [pendingArchiveRemovalId, setPendingArchiveRemovalId] = useState<string | null>(null);
  const [automaticVerifications, setAutomaticVerifications] = useState<Record<string, AutomaticVerification>>({});
  const [verificationMessage, setVerificationMessage] = useState("");
  const [collectingArchiveId, setCollectingArchiveId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profileMessage, setProfileMessage] = useState("");
  const [workspaceContexts, setWorkspaceContexts] = useState<WorkspaceContext[]>([{ key: "personal", kind: "personal", label: "Personal desk", detail: "Private forecasts and drafts" }]);
  const [activeWorkspaceKey, setActiveWorkspaceKey] = useState("personal");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceContextStatus, setWorkspaceContextStatus] = useState("");
  const [managedOrganizations, setManagedOrganizations] = useState<OrganizationWorkspace[]>([]);
  const [managedClassrooms, setManagedClassrooms] = useState<ClassroomWorkspace[]>([]);
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [classroomMembers, setClassroomMembers] = useState<ClassroomMember[]>([]);
  const [accessMessage, setAccessMessage] = useState("");
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewRuns, setReviewRuns] = useState<ReviewRun[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, ForecastReview[]>>({});
  const [selectedReviewRunId, setSelectedReviewRunId] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewManualScore, setReviewManualScore] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [academicRoster, setAcademicRoster] = useState<AcademicRosterMember[]>([]);
  const [academicMessage, setAcademicMessage] = useState("");
  const [classroomAssignments, setClassroomAssignments] = useState<ClassroomAssignment[]>([]);
  const [selectedClassroomAssignmentId, setSelectedClassroomAssignmentId] = useState("");
  const [publishInstructorForecast, setPublishInstructorForecast] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const selectedLocation = weatherDeskLocation(locationId);
  const hasControlAccess = role === "admin" || role === "owner";
  const activeWorkspace = workspaceContexts.find((workspace) => workspace.key === activeWorkspaceKey) ?? workspaceContexts[0];
  const workspaceRoleCanReview = ["owner", "admin", "instructor", "reviewer", "assistant"].includes(activeWorkspace?.role ?? "");
  const hasAcademicReviewAccess = Boolean(session && (hasControlAccess || (activeWorkspace?.kind !== "personal" && activeWorkspace?.kind !== "all" && workspaceRoleCanReview)));
  const canManageActiveClassroom = Boolean(session && activeWorkspace?.kind === "classroom" && (hasControlAccess || ["instructor", "assistant"].includes(activeWorkspace.role ?? "")));
  const selectedClassroomAssignment = classroomAssignments.find((assignment) => assignment.id === selectedClassroomAssignmentId) ?? null;
  const createNewForecastRun = (days = defaultForecastDays) => {
    const start = new Date(`${nextForecastDate()}T12:00:00`);
    return { id: crypto.randomUUID(), initialHorizonDays: days, days: Array.from({ length: days }, (_, offset) => createForecastDay(addDays(start, offset))) };
  };
  const openClassroomAssignment = (assignment: ClassroomAssignment) => {
    setSelectedClassroomAssignmentId(assignment.id);
    setPublishInstructorForecast(canManageActiveClassroom);
    const existingIndex = forecastRun.days.findIndex((day) => day.date === assignment.target_date);
    if (existingIndex >= 0) setSelectedForecastDay(existingIndex);
    else {
      const days = [...forecastRun.days, createForecastDay(assignment.target_date)].sort((a, b) => a.date.localeCompare(b.date));
      setForecastRun({ ...forecastRun, days });
      setSelectedForecastDay(days.findIndex((day) => day.date === assignment.target_date));
    }
    setAssignmentMessage(`Opened “${assignment.title}” for ${forecastTargetTitle(assignment.target_date)}. Your existing draft was kept.`);
    setActiveSection("forecast");
  };

  useEffect(() => {
    const storedLocation = window.localStorage.getItem(locationStorageKey);
    if (storedLocation) setLocationId(weatherDeskLocation(storedLocation).id);
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    if (storedTheme === "dark" || storedTheme === "light") setTheme(storedTheme);
    try {
      const settings = JSON.parse(window.localStorage.getItem(workspaceSettingsStorageKey) ?? "{}") as Partial<WorkspacePreferences>;
      if (settings.defaultLocationId) {
        const nextDefault = weatherDeskLocation(settings.defaultLocationId).id;
        setDefaultLocationId(nextDefault);
        if (!storedLocation) setLocationId(nextDefault);
      }
      if (settings.radarMapView && ["composite", "satellite", "base", "precipitation_new", "clouds_new", "pressure_new", "wind_new", "temp_new", "ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(settings.radarMapView)) setRadarMapView(settings.radarMapView);
      if (typeof settings.radarOpacity === "number" && settings.radarOpacity >= 20 && settings.radarOpacity <= 100) setRadarOpacity(settings.radarOpacity);
      if (typeof settings.showNwsAlerts === "boolean") setShowNwsAlerts(settings.showNwsAlerts);
      if (settings.defaultForecastDays === 1 || settings.defaultForecastDays === 3 || settings.defaultForecastDays === 7) setDefaultForecastDays(settings.defaultForecastDays);
    } catch { window.localStorage.removeItem(workspaceSettingsStorageKey); }
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(locationStorageKey, locationId);
  }, [locationId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    if (!settingsReady) return;
    window.localStorage.setItem(workspaceSettingsStorageKey, JSON.stringify({ defaultLocationId, radarMapView, radarOpacity, showNwsAlerts, defaultForecastDays } satisfies WorkspacePreferences));
  }, [defaultForecastDays, defaultLocationId, radarMapView, radarOpacity, settingsReady, showNwsAlerts]);

  useEffect(() => {
    if (!workspaceNotice) return;
    const timeout = window.setTimeout(() => setWorkspaceNotice(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [workspaceNotice]);

  useEffect(() => {
    let isActive = true;
    const loadWeather = () => fetch(`/api/weather?location=${encodeURIComponent(locationId)}`, { cache: "no-store" })
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
  }, [locationId]);

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
    const workspaceFilter = activeWorkspace?.kind === "organization"
      ? `&organization_id=eq.${activeWorkspace.organizationId}`
      : activeWorkspace?.kind === "classroom"
        ? `&classroom_id=eq.${activeWorkspace.classroomId}`
        : activeWorkspace?.kind === "personal"
          ? "&organization_id=is.null&classroom_id=is.null"
          : "";
    Promise.all([
      fetch(`${supabaseUrl}/rest/v1/forecast_runs?select=id,created_at,status,location_name,forecast_periods(id,valid_date,period,forecast_data,evidence_snapshot,forecast_verifications(observed_data,score_data))&status=neq.withdrawn${workspaceFilter}&order=created_at.desc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/forecasts?select=id,created_at,forecast_data,evidence_snapshot&status=neq.withdrawn&order=created_at.desc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/forecast_verifications?select=forecast_period_id,observed_data,score_data`, { headers }),
    ]).then(async ([runResponse, legacyResponse, verificationResponse]) => {
      if (!runResponse.ok || !legacyResponse.ok || !verificationResponse.ok) throw new Error("Unable to load cloud archives");
      const runs = await runResponse.json() as CloudRunRow[];
      const legacyRows = await legacyResponse.json() as { id: string; created_at: string; forecast_data: Omit<SavedForecast, "id" | "savedAt">; evidence_snapshot: SavedForecast["evidence"] }[];
      const verificationRows = await verificationResponse.json() as VerificationRow[];
      const runArchives = runs.flatMap(archiveRecordsFromRun);
      const legacyArchives = legacyRows.map((row) => ({ ...row.forecast_data, id: row.id, savedAt: row.created_at, evidence: row.evidence_snapshot })) as SavedForecast[];
      const includeLegacy = activeWorkspace?.kind === "personal" || activeWorkspace?.kind === "all" || !activeWorkspace;
      const olderOnly = includeLegacy ? legacyArchives.filter((legacy) => !runArchives.some((run) => run.targetDate === legacy.targetDate && Math.abs(new Date(run.savedAt).getTime() - new Date(legacy.savedAt).getTime()) < 1000)) : [];
      const cloudArchives = numberArchiveVersions([...runArchives, ...olderOnly]);
      setArchives(cloudArchives);
      setSelectedArchiveId(cloudArchives[0]?.id ?? null);
      const verificationByPeriod = new Map(verificationRows.map((row) => [row.forecast_period_id, row]));
      const restoredVerifications = Object.fromEntries(runArchives.flatMap((archive) => {
        const day = archive.periodIds?.day ? verificationByPeriod.get(archive.periodIds.day) : undefined;
        const night = archive.periodIds?.night ? verificationByPeriod.get(archive.periodIds.night) : undefined;
        if (!day || !night) return [];
        return [[archive.id, { station: locationForArchive(archive).observationStation, fetchedAt: archive.savedAt, day: day.observed_data, night: night.observed_data, dayScore: day.score_data?.automaticScore ?? null, nightScore: night.score_data?.automaticScore ?? null } satisfies AutomaticVerification]];
      }));
      setAutomaticVerifications(restoredVerifications);
    }).catch((error: Error) => setAuthMessage(`Signed in, but cloud archives could not load: ${error.message}`));
  }, [activeWorkspaceKey, session]);

  useEffect(() => {
    if (!session || !hasControlAccess || !supabaseUrl || !supabaseKey) return;
    fetch(`${supabaseUrl}/rest/v1/profiles?select=id,email,role,display_name,person_type,employee_id,student_id,title&order=created_at.asc`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Unable to load users")))
      .then((rows: Profile[]) => setProfiles(rows))
      .catch((error: Error) => setProfileMessage(error.message));
  }, [session, role]);

  function loadAccessManagement() {
    if (!session || !hasControlAccess || !supabaseUrl || !supabaseKey) return;
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    Promise.all([
      fetch(`${supabaseUrl}/rest/v1/organizations?select=id,name,kind&order=name.asc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/classrooms?select=id,name,term,organization_id&order=name.asc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/organization_memberships?select=id,organization_id,user_id,role,status&order=created_at.asc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/classroom_memberships?select=id,classroom_id,user_id,role,status&order=created_at.asc`, { headers }),
    ]).then(async ([organizationResponse, classroomResponse, organizationMemberResponse, classroomMemberResponse]) => {
      if (![organizationResponse, classroomResponse, organizationMemberResponse, classroomMemberResponse].every((response) => response.ok)) throw new Error("Workspace access data could not be loaded.");
      const peopleById = new Map(profiles.map((profile) => [profile.id, profile]));
      setManagedOrganizations(await organizationResponse.json() as OrganizationWorkspace[]);
      setManagedClassrooms(await classroomResponse.json() as ClassroomWorkspace[]);
      setOrganizationMembers((await organizationMemberResponse.json() as Omit<OrganizationMember, "profiles">[]).map((membership) => ({ ...membership, profiles: peopleById.get(membership.user_id) ?? null })));
      setClassroomMembers((await classroomMemberResponse.json() as Omit<ClassroomMember, "profiles">[]).map((membership) => ({ ...membership, profiles: peopleById.get(membership.user_id) ?? null })));
    }).catch((error: Error) => setAccessMessage(error.message));
  }

  useEffect(() => { loadAccessManagement(); }, [session, role, profiles]);

  useEffect(() => {
    if (!session || !hasAcademicReviewAccess || !supabaseUrl || !supabaseKey || !activeWorkspace || (activeWorkspace.kind !== "classroom" && activeWorkspace.kind !== "organization")) {
      setAcademicRoster([]);
      setAcademicMessage("");
      return;
    }
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    const isClassroom = activeWorkspace.kind === "classroom";
    const membershipUrl = isClassroom
      ? `${supabaseUrl}/rest/v1/classroom_memberships?select=user_id,role&classroom_id=eq.${activeWorkspace.classroomId}&status=eq.active&order=created_at.asc`
      : `${supabaseUrl}/rest/v1/organization_memberships?select=user_id,role&organization_id=eq.${activeWorkspace.organizationId}&status=eq.active&order=created_at.asc`;
    setAcademicMessage("Loading authorized workspace members…");
    fetch(membershipUrl, { headers }).then(async (membershipResponse) => {
      if (!membershipResponse.ok) throw new Error("Workspace roster is not available to this account.");
      const memberships = await membershipResponse.json() as { user_id: string; role: string }[];
      if (!memberships.length) { setAcademicRoster([]); setAcademicMessage("No active members are assigned yet."); return; }
      const ids = memberships.map((membership) => membership.user_id).join(",");
      const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,email,display_name,person_type&id=in.(${ids})`, { headers });
      if (!profileResponse.ok) throw new Error("Workspace member profiles could not be loaded.");
      const profilesById = new Map((await profileResponse.json() as Pick<Profile, "id" | "email" | "display_name" | "person_type">[]).map((profile) => [profile.id, profile]));
      setAcademicRoster(memberships.map((membership) => {
        const profile = profilesById.get(membership.user_id);
        return { userId: membership.user_id, label: profile?.display_name || profile?.email || "Unnamed account", email: profile?.email ?? null, personType: profile?.person_type ?? null, role: membership.role, organizationId: activeWorkspace.organizationId ?? "", classroomId: isClassroom ? activeWorkspace.classroomId : undefined };
      }));
      setAcademicMessage("");
    }).catch((error: Error) => { setAcademicRoster([]); setAcademicMessage(error.message); });
  }, [activeWorkspaceKey, hasAcademicReviewAccess, session]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey || activeWorkspace?.kind !== "classroom" || !activeWorkspace.classroomId) {
      setClassroomAssignments([]);
      setSelectedClassroomAssignmentId("");
      setAssignmentMessage("");
      return;
    }
    setAssignmentMessage("Loading class assignments…");
    fetch(`${supabaseUrl}/rest/v1/classroom_assignments?select=id,classroom_id,title,instructions,target_date,due_at,status,instructor_forecast,instructor_forecast_updated_at,created_at&classroom_id=eq.${activeWorkspace.classroomId}&order=target_date.asc`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Class assignments could not be loaded. Apply the academic assignments migration, then refresh.")))
      .then((assignments: ClassroomAssignment[]) => { setClassroomAssignments(assignments); setSelectedClassroomAssignmentId((selected) => assignments.some((assignment) => assignment.id === selected) ? selected : assignments.find((assignment) => assignment.status === "open")?.id ?? ""); setAssignmentMessage(""); })
      .catch((error: Error) => { setClassroomAssignments([]); setAssignmentMessage(error.message); });
  }, [activeWorkspaceKey, session]);

  useEffect(() => {
    if (!reviewTarget || !session || !supabaseUrl || !supabaseKey) return;
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    const contextFilter = reviewTarget.classroomId ? `&classroom_id=eq.${reviewTarget.classroomId}` : `&organization_id=eq.${reviewTarget.organizationId}`;
    setReviewMessage("Loading authorized forecast records…");
    fetch(`${supabaseUrl}/rest/v1/forecast_runs?select=id,user_id,created_at,status,location_name,forecast_periods(id,valid_date,period,forecast_data,forecast_verifications(score_data))&user_id=eq.${reviewTarget.userId}${contextFilter}&status=neq.withdrawn&order=created_at.desc`, { headers })
      .then(async (response) => {
        if (!response.ok) throw new Error("Forecast records are not available for review yet.");
        const runs = await response.json() as ReviewRun[];
        setReviewRuns(runs); setSelectedReviewRunId(runs[0]?.id ?? null);
        if (!runs.length) { setReviewNotes({}); setReviewMessage("No submitted forecasts in this workspace yet."); return; }
        const reviewResponse = await fetch(`${supabaseUrl}/rest/v1/forecast_reviews?select=id,run_id,reviewer_id,comment,manual_score,created_at&run_id=in.(${runs.map((run) => run.id).join(",")})&order=created_at.desc`, { headers });
        const notes = reviewResponse.ok ? await reviewResponse.json() as ForecastReview[] : [];
        setReviewNotes(notes.reduce<Record<string, ForecastReview[]>>((grouped, note) => ({ ...grouped, [note.run_id]: [...(grouped[note.run_id] ?? []), note] }), {}));
        setReviewMessage("");
      }).catch((error: Error) => { setReviewRuns([]); setReviewNotes({}); setReviewMessage(error.message); });
  }, [reviewTarget, session]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey) return;
    fetch(`${supabaseUrl}/rest/v1/profiles?select=role&id=eq.${session.user.id}`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : [])
      .then((rows: { role: string }[]) => setRole(rows[0]?.role ?? "student"));
  }, [session]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey) {
      setWorkspaceContexts([{ key: "personal", kind: "personal", label: "Personal desk", detail: "Private forecasts and drafts" }]);
      setActiveWorkspaceKey("personal");
      return;
    }
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    const isOwner = role === "owner";
    const organizationRequest = isOwner
      ? fetch(`${supabaseUrl}/rest/v1/organizations?select=id,name,kind&order=name.asc`, { headers })
      : fetch(`${supabaseUrl}/rest/v1/organization_memberships?select=organization_id,role,organizations(id,name,kind)&user_id=eq.${session.user.id}&status=eq.active`, { headers });
    const classroomRequest = isOwner
      ? fetch(`${supabaseUrl}/rest/v1/classrooms?select=id,name,term,organization_id,organizations(name)&order=name.asc`, { headers })
      : fetch(`${supabaseUrl}/rest/v1/classroom_memberships?select=classroom_id,role,classrooms(id,name,term,organization_id,organizations(name))&user_id=eq.${session.user.id}&status=eq.active`, { headers });
    Promise.all([organizationRequest, classroomRequest]).then(async ([organizationResponse, classroomResponse]) => {
      if (!organizationResponse.ok || !classroomResponse.ok) throw new Error("Your workspace list could not be loaded.");
      const organizationRows = await organizationResponse.json() as (OrganizationRow | OrganizationMembershipRow)[];
      const classroomRows = await classroomResponse.json() as (ClassroomRow | ClassroomMembershipRow)[];
      const organizations = organizationRows.flatMap((row) => {
        const organization = "organizations" in row ? row.organizations : row;
        if (!organization) return [];
        return [{ key: `organization:${organization.id}`, kind: "organization" as const, organizationId: organization.id, label: organization.name, detail: `${organization.kind} workspace`, role: "role" in row ? row.role : undefined }];
      });
      const classrooms = classroomRows.flatMap((row) => {
        const classroom = "classrooms" in row ? row.classrooms : row;
        if (!classroom) return [];
        return [{ key: `classroom:${classroom.id}`, kind: "classroom" as const, classroomId: classroom.id, organizationId: classroom.organization_id, label: classroom.name, detail: `${classroom.organizations?.name ?? "School"}${classroom.term ? ` · ${classroom.term}` : ""}`, role: "role" in row ? row.role : undefined }];
      });
      const contexts: WorkspaceContext[] = [
        ...(isOwner ? [{ key: "all", kind: "all" as const, label: "All workspaces", detail: "Owner view across the platform" }] : []),
        { key: "personal", kind: "personal", label: "Personal desk", detail: "Private forecasts and drafts" },
        ...organizations,
        ...classrooms,
      ];
      setWorkspaceContexts(contexts);
      const storedKey = window.localStorage.getItem(`${workspaceContextStoragePrefix}:${session.user.id}`);
      const defaultKey = isOwner ? "all" : "personal";
      setActiveWorkspaceKey(contexts.some((workspace) => workspace.key === storedKey) ? storedKey! : defaultKey);
      setWorkspaceContextStatus(organizations.length || classrooms.length ? "" : "No shared workspaces are assigned to this account yet.");
    }).catch((error: Error) => {
      setWorkspaceContextStatus(error.message);
      setWorkspaceContexts([{ key: "personal", kind: "personal", label: "Personal desk", detail: "Private forecasts and drafts" }]);
    });
  }, [role, session]);

  useEffect(() => {
    if (!session || !activeWorkspace) return;
    window.localStorage.setItem(`${workspaceContextStoragePrefix}:${session.user.id}`, activeWorkspace.key);
  }, [activeWorkspace, session]);

  useEffect(() => {
    fetch(`/api/sounding?location=${encodeURIComponent(locationId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Sounding data unavailable");
        setSoundingText(`Observed radiosonde · ${data.station} · ${data.cycle}\n\n${data.text}`);
        setSoundingStatus("");
      })
      .catch((error: Error) => setSoundingStatus(error.message));
  }, [locationId]);

  useEffect(() => {
    fetch(`/api/nbm?location=${encodeURIComponent(locationId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "NBM data unavailable");
        setNbmText(`NBM hourly bulletin · ${data.station} · ${data.cycle}\n\n${data.text}`);
        setNbmStatus("");
      })
      .catch((error: Error) => setNbmStatus(error.message));
  }, [locationId]);

  useEffect(() => {
    setOpenMeteoStatus("Loading Open-Meteo guidance…");
    fetch(`/api/open-meteo?model=${openMeteoModel}&location=${encodeURIComponent(locationId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Open-Meteo guidance is unavailable");
        setOpenMeteoGuidance(data as OpenMeteoGuidance);
        setOpenMeteoStatus("");
      })
      .catch((error: Error) => setOpenMeteoStatus(error.message));
  }, [openMeteoModel, locationId]);

  useEffect(() => {
    if (dataPanel !== "models" || openMeteoView !== "compare") return;
    const models = [...new Set([comparisonLeftModel, comparisonRightModel])];
    let active = true;
    setComparisonStatus("Loading model comparison…");
    Promise.all(models.map(async (model) => {
      const response = await fetch(`/api/open-meteo?model=${model}&location=${encodeURIComponent(locationId)}`);
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
  }, [dataPanel, openMeteoView, comparisonLeftModel, comparisonRightModel, locationId]);

  useEffect(() => {
    if (dataPanel !== "ensembles") return;
    let active = true;
    setEnsembleStatus("Loading GFS ensemble guidance…");
    fetch(`/api/ensembles?location=${encodeURIComponent(locationId)}`)
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
  }, [dataPanel, locationId]);

  useEffect(() => {
    let active = true;
    setModelSounding(null);
    setModelSoundingStatus("Loading model sounding…");
    fetch(`/api/model-sounding?model=${soundingModel}&runOffset=${soundingRunOffset}&location=${encodeURIComponent(locationId)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Model sounding is unavailable");
        if (active) {
          const sounding = data as ModelSounding;
          setModelSounding(sounding);
          // Start on the nearest valid model hour, not the beginning of the
          // archived response (which can be yesterday's data).
          setSoundingProfileIndex(nearestModelProfileIndex(sounding.profiles));
          setModelSoundingStatus("");
        }
      })
      .catch((error: Error) => active && setModelSoundingStatus(error.message));
    return () => { active = false; };
  }, [soundingModel, soundingRunOffset, locationId]);

  useEffect(() => {
    const storedArchives = window.localStorage.getItem(archiveStorageKey);
    if (!storedArchives) return;
    try {
      const parsed = numberArchiveVersions(JSON.parse(storedArchives) as SavedForecast[]);
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
  const selectedReviewRun = reviewRuns.find((run) => run.id === selectedReviewRunId) ?? reviewRuns[0] ?? null;
  const filteredArchives = archives.filter((archive) => {
    const matchingDate = !archiveDateFilter || archive.targetDate === archiveDateFilter;
    const matchingStatus = archiveStatusFilter === "all" || archive.status === archiveStatusFilter;
    const searchText = `${forecastTargetTitle(archive.targetDate)} ${archive.day.conditions} ${archive.night.conditions}`.toLowerCase();
    return matchingDate && matchingStatus && (!archiveSearch.trim() || searchText.includes(archiveSearch.trim().toLowerCase()));
  });
  const recordWindowDates = Array.from({ length: 7 }, (_, index) => addDays(new Date(`${recordWindowStart}T12:00:00`), index));
  const archiveForDate = (targetDate: string) => filteredArchives.filter((archive) => archive.targetDate === targetDate).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())[0] ?? null;
  const selectedReferences = selectedArchive ? [
    ...savedReferences(selectedArchive.day.references).map((reference) => ({ reference, period: "Day" })),
    ...savedReferences(selectedArchive.night.references).map((reference) => ({ reference, period: "Night" })),
  ].reduce<{ reference: ReferenceItem; periods: string[] }[]>((groups, item) => {
    const existing = groups.find((group) => group.reference.label === item.reference.label && group.reference.detail === item.reference.detail);
    if (existing) existing.periods.push(item.period);
    else groups.push({ reference: item.reference, periods: [item.period] });
    return groups;
  }, []) : [];
  const selectedAutomaticVerification = selectedArchive ? automaticVerifications[selectedArchive.id] : null;
  const selectedVerificationIsFinal = Boolean(
    selectedAutomaticVerification?.day.complete
      && selectedAutomaticVerification?.night.complete
      && selectedAutomaticVerification.dayScore !== null
      && selectedAutomaticVerification.nightScore !== null,
  );
  const radarFrame = radarFrames[radarFrameIndex] ?? null;
  const soundingProfiles = modelSounding?.profiles ?? [];
  const nearestSoundingProfileIndex = nearestModelProfileIndex(soundingProfiles);
  const soundingWindowStart = Math.max(0, Math.min(soundingProfileIndex - 1, Math.max(0, soundingProfiles.length - 4)));
  const soundingProfileWindow = soundingProfiles.slice(soundingWindowStart, soundingWindowStart + 4);
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
  const pendingArchiveRemoval = archives.find((archive) => archive.id === pendingArchiveRemovalId) ?? null;
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
    { id: "nws-observation", label: "Current NWS observation", detail: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F · ${liveWeather.observation.description} · ${liveWeather.observation.station || liveWeather.observation.stationName || "NWS observation station"} · ${observedAt}` : "Live observation was unavailable when attached.", preview: liveWeather ? { kind: "metrics", items: [{ label: "Temperature", value: `${liveWeather.observation.temperatureF ?? "—"}°F` }, { label: "Dew point", value: `${liveWeather.observation.dewpointF ?? "—"}°F` }, { label: "Wind", value: liveWeather.observation.windMph === null ? "—" : `${liveWeather.observation.windDirection ?? ""} ${liveWeather.observation.windMph} mph`.trim() }, { label: "Station", value: liveWeather.observation.station || liveWeather.observation.stationName || "NWS observation station" }] } : undefined },
    { id: "nws-guidance", label: "Current NWS forecast", detail: liveWeather?.forecast ? `${liveWeather.forecast.period}: ${liveWeather.forecast.detailedForecast}` : "NWS forecast was unavailable when attached.", preview: liveWeather?.forecast ? { kind: "metrics", items: [{ label: "Period", value: liveWeather.forecast.period }, { label: "Temperature", value: `${liveWeather.forecast.temperature}°${liveWeather.forecast.temperatureUnit}` }, { label: "Precipitation", value: `${liveWeather.forecast.precipitationChance ?? "—"}%` }, { label: "Conditions", value: liveWeather.forecast.shortForecast }] } : undefined },
    { id: "nbm", label: `NBM ${selectedLocation.observationStation} bulletin`, detail: nbmText || nbmStatus },
    { id: "sounding", label: `Observed ${selectedLocation.upperAirStation} sounding`, detail: soundingText || soundingStatus, preview: { kind: "observed-sounding", station: selectedLocation.upperAirStation, imageUrl: officialSoundingImageUrl(selectedLocation.upperAirStation) } },
    { id: "nws-alerts", label: "NWS alerts", detail: liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => `${alert.event}: ${alert.headline ?? ""}`).join("\n") : liveWeather?.alertsAvailable === false ? "NWS alert status could not be confirmed." : "No active NWS alerts at the time this reference was attached.", preview: { kind: "metrics", items: [{ label: "Alerts", value: liveWeather?.alertsAvailable === false ? "Feed unavailable" : `${liveWeather?.alerts.length ?? 0} active` }, { label: "Status", value: liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => alert.event).join(", ") : "No active alerts" }] } },
  ];

  function updatePeriod(period: "day" | "night", field: Exclude<keyof PeriodDraft, "references">, value: string) {
    setForecastRun((run) => ({
      ...run,
      days: run.days.map((day, index) => index === selectedForecastDay
        ? { ...day, [period]: { ...day[period], [field]: value } }
        : day),
    }));
  }

  function formatPeriodField(period: "day" | "night", field: "highLow" | "rainChance" | "timing") {
    const value = selectedDay[period][field].trim();
    if (!value) return;
    if (field === "highLow") {
      const number = temperatureInputValue(value);
      updatePeriod(period, field, number ? number.replace(/\.0+$/, "") : "");
      return;
    }
    if (field === "rainChance") {
      const number = Number.parseInt(percentInputValue(value), 10);
      updatePeriod(period, field, Number.isFinite(number) ? String(Math.max(0, Math.min(100, number))) : "");
      return;
    }
    const normalized = value.replace(/\s*(a\.?m\.?|p\.?m\.?)\b/gi, (_, meridiem: string) => ` ${meridiem[0].toUpperCase()}M`).replace(/\s*-\s*/g, "–");
    updatePeriod(period, field, /\b(?:AM|PM)\b/.test(normalized) ? normalized : `${normalized} PM`);
  }

  function addFreshReference(period: "day" | "night", item: ReferenceItem) {
    const freshReference = { ...item, id: `${item.id}-${crypto.randomUUID()}` };
    setForecastRun((run) => ({ ...run, days: run.days.map((day, index) => {
      if (index !== selectedForecastDay) return day;
      return { ...day, [period]: { ...day[period], references: [...day[period].references, freshReference] } };
    }) }));
    setSaveMessage(`${item.label} added as a fresh ${period} reference snapshot.`);
  }

  function advanceForecastEntry(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
    event.preventDefault();
    const fields = [...event.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])")];
    const currentIndex = fields.indexOf(target);
    fields[currentIndex + 1]?.focus();
  }

  function removeReference(period: "day" | "night", referenceId: string) {
    setForecastRun((run) => ({
      ...run,
      days: run.days.map((day, index) => index !== selectedForecastDay ? day : {
        ...day,
        [period]: { ...day[period], references: day[period].references.filter((reference) => reference.id !== referenceId) },
      }),
    }));
  }

  function attachDeskReference(reference: ReferenceItem, targetDate?: string) {
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
    const message = `${reference.label} added to ${forecastTargetTitle(date)} day and night.`;
    setSaveMessage(session ? message : `${message} Sign in before submitting the forecast.`);
    setWorkspaceNotice({ message: session ? message : `${message} It is saved in this browser until you sign in and submit.`, targetDate: date });
  }

  function attachGuidanceSeries(guidance: OpenMeteoGuidance, view: "hourly" | "daily") {
    const referencesByDate = new Map<string, ReferenceItem>();
    if (view === "daily") {
      guidance.days.forEach((day) => {
        const snapshot = { ...guidance, days: [day], nextHours: guidance.nextHours.filter((hour) => hour.time.slice(0, 10) === day.date) };
        referencesByDate.set(day.date, {
        id: `model-daily-${guidance.model}-${day.date}-${guidance.fetchedAt}`,
        label: `${guidance.model} daily guidance`,
        detail: `${forecastTargetTitle(day.date)} · High ${day.highF ?? "—"}°F / low ${day.lowF ?? "—"}°F · ${openMeteoWeatherLabel(day.weatherCode)} · PoP ${day.precipitationProbability ?? "—"}% · Wind ${day.windMph ?? "—"}/${day.gustMph ?? "—"} mph`,
        preview: { kind: "model-guidance", guidance: snapshot, view: "daily" },
      });
      });
    } else {
      const byDate = new Map<string, typeof guidance.nextHours>();
      guidance.nextHours.forEach((hour) => {
        const date = hour.time.slice(0, 10);
        byDate.set(date, [...(byDate.get(date) ?? []), hour]);
      });
      byDate.forEach((hours, date) => {
        const snapshot = { ...guidance, days: guidance.days.filter((day) => day.date === date), nextHours: hours };
        referencesByDate.set(date, {
        id: `model-hourly-${guidance.model}-${date}-${guidance.fetchedAt}`,
        label: `${guidance.model} hourly guidance`,
        detail: hours.map((hour) => `${modelTimestamp(hour.time)} · Temp/dew ${hour.temperatureF ?? "—"}°/${hour.dewpointF ?? "—"}°F · PoP ${hour.precipitationProbability ?? "—"}% · Wind ${hour.windMph ?? "—"}/${hour.gustMph ?? "—"} mph · CAPE ${hour.cape ?? "—"} J/kg`).join("\n"),
        preview: { kind: "model-guidance", guidance: snapshot, view: "hourly" },
      });
      });
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
    const message = `${guidance.model} ${view} guidance added to ${targetDates.length} matching forecast day${targetDates.length === 1 ? "" : "s"}.`;
    setSaveMessage(session ? message : `${message} Sign in before submitting the forecast.`);
    setWorkspaceNotice({ message: session ? message : `${message} It is saved in this browser until you sign in and submit.`, targetDate: targetDates[0] });
  }

  function modelSoundingReference(): ReferenceItem {
    const profile = modelSounding?.profiles[soundingProfileIndex];
    const model = modelSounding?.model ?? soundingModel.toUpperCase();
    if (!profile) return { id: `model-sounding-${model}-unavailable`, label: `${model} model sounding`, detail: modelSoundingStatus };
    const surface = profile.levels.find((level) => level.pressureHpa === 1000) ?? profile.levels[0];
    const dewpoint = dewpointFromTemperatureAndRh(surface?.temperatureF ?? null, surface?.relativeHumidity ?? null);
    return {
      id: `model-sounding-${model}-${profile.time}`,
      label: `${model} model sounding · ${modelTimestamp(profile.time)}`,
      detail: `Valid ${modelTimestamp(profile.time)} · run ${runTimestamp(modelSounding?.runTime ?? profile.time)}\nSurface ${surface?.temperatureF ?? "—"}°F / Td ${dewpoint ?? "—"}°F · CAPE ${profile.diagnostics.cape ?? "—"} J/kg · CIN ${profile.diagnostics.cin ?? "—"} J/kg · Freezing level ${profile.diagnostics.freezingLevelHeightM === null ? "—" : `${Math.round(profile.diagnostics.freezingLevelHeightM * 3.28084).toLocaleString()} ft`}\nSource: ${modelSounding?.source ?? "Open-Meteo Single Runs API"}`,
      preview: { kind: "model-sounding", profile },
    };
  }

  function pinCurrentDeskPanel() {
    const snippet = (value: string, maxLength = 5000) => value.length > maxLength ? `${value.slice(0, maxLength)}\n\n[Source snapshot truncated for archive storage.]` : value;
    if (dataPanel === "nbm") {
      attachDeskReference({ id: `nbm-${Date.now()}`, label: `NBM ${selectedLocation.observationStation} bulletin`, detail: snippet(nbmText || nbmStatus) });
      return;
    }
    if (dataPanel === "sounding") {
      attachDeskReference({ id: `observed-${selectedLocation.upperAirStation.toLowerCase()}-${Date.now()}`, label: `Observed K${selectedLocation.upperAirStation} sounding`, detail: snippet(soundingText || soundingStatus), preview: { kind: "observed-sounding", station: selectedLocation.upperAirStation, imageUrl: officialSoundingImageUrl(selectedLocation.upperAirStation) } });
      return;
    }
    if (dataPanel === "ensembles") {
      const firstRow = ensembleGuidance?.rows[0];
      attachDeskReference({ id: `gfs-ensemble-${ensembleGuidance?.fetchedAt ?? Date.now()}`, label: "GFS ensemble guidance", detail: firstRow ? `${modelTimestamp(firstRow.time)} · ${firstRow.temperature.members} members · Temperature ${firstRow.temperature.min ?? "—"}–${firstRow.temperature.max ?? "—"}°F (mean ${firstRow.temperature.mean ?? "—"}°F) · Wind ${firstRow.wind.min ?? "—"}–${firstRow.wind.max ?? "—"} mph` : ensembleStatus, preview: ensembleGuidance ? { kind: "ensemble", guidance: ensembleGuidance } : undefined }, firstRow?.time.slice(0, 10));
      return;
    }
    if (dataPanel === "model-sounding") {
      const profile = modelSounding?.profiles[soundingProfileIndex];
      attachDeskReference(modelSoundingReference(), profile?.time.slice(0, 10));
    }
  }

  async function saveForecast(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (!session || !supabaseUrl || !supabaseKey) {
      setSaveMessage("Sign in before submitting so this forecast can be archived safely.");
      return;
    }
    if (selectedClassroomAssignment && !forecastRun.days.some((day) => day.date === selectedClassroomAssignment.target_date)) {
      setSaveMessage(`This worksheet does not include ${forecastTargetTitle(selectedClassroomAssignment.target_date)}, the target date for “${selectedClassroomAssignment.title}.” Add or change that forecast day before submitting.`);
      return;
    }
    setIsSubmitting(true);
    setSubmissionToken("");
    const savedAt = new Date().toISOString();
    const nextArchives = forecastRun.days.map((day) => {
      const versionNumber = archives.filter((archive) => archive.targetDate === day.date).length + 1;
      return {
      id: crypto.randomUUID(), locationId: selectedLocation.id, locationName: selectedLocation.name, savedAt, label: archiveTitle({ savedAt }), targetDate: day.date,
      status: "submitted" as const, versionNumber,
      day: { high: day.day.highLow, conditions: day.day.conditions, rainChance: day.day.rainChance, timing: day.day.timing, hazards: day.day.hazards, reasoning: day.day.reasoning, references: day.day.references },
      night: { low: day.night.highLow, conditions: day.night.conditions, rainChance: day.night.rainChance, timing: day.night.timing, hazards: day.night.hazards, reasoning: day.night.reasoning, references: day.night.references },
      evidence: {
        observation: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F, ${liveWeather.observation.description}; ${liveWeather.observation.station || liveWeather.observation.stationName || "NWS observation station"} at ${observedAt}` : "No live observation available when saved",
        forecast: liveWeather?.forecast ? `${liveWeather.forecast.period}: ${liveWeather.forecast.shortForecast}; ${liveWeather.forecast.precipitationChance ?? 0}% precipitation chance` : "No NWS forecast available when saved",
        alerts: liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => alert.event).join(", ") : liveWeather?.alertsAvailable === false ? "NWS alert feed unavailable when saved" : "No active NWS alerts when saved",
      },
    } satisfies SavedForecast;
    });
    try {
      const cloudRecord = await saveForecastRunToCloud(savedAt);
      let instructorExamplePublished = false;
      if (publishInstructorForecast && selectedClassroomAssignmentId) {
        try {
          await publishInstructorForecastSnapshot(selectedClassroomAssignmentId, savedAt);
          instructorExamplePublished = true;
        } catch (error) {
          setAssignmentMessage(error instanceof Error ? error.message : "The forecast saved, but the instructor example could not be published.");
        }
      }
      const cloudArchives = nextArchives.map((archive) => ({
        ...archive,
        id: `${cloudRecord.runId}:${archive.targetDate}`,
        runId: cloudRecord.runId,
        periodIds: cloudRecord.periodIdsByDate[archive.targetDate],
      }));
      const combinedArchives = numberArchiveVersions([...cloudArchives, ...archives].slice(0, 50));
      setArchives(combinedArchives);
      setSelectedArchiveId(cloudArchives[0]?.id ?? null);
      window.localStorage.setItem(archiveStorageKey, JSON.stringify(combinedArchives));
      const detail = `${cloudArchives.length}-day forecast submitted${instructorExamplePublished ? " · instructor example published" : ""} · archive token ${cloudRecord.runId.slice(0, 8).toUpperCase()}`;
      setSaveMessage(`${detail}.`);
      setSubmissionToken(detail);
      // A submitted forecast is immutable in the archive. Start a clean
      // worksheet for the same target date so a deliberate re-submission is a
      // new version rather than an accidental copy of stale values.
      const nextTargetDate = forecastRun.days[selectedForecastDay]?.date ?? nextForecastDate();
      const freshRun = createNewForecastRun();
      freshRun.days[0] = { ...freshRun.days[0], date: nextTargetDate };
      setForecastRun(freshRun);
      setSelectedForecastDay(0);
      setPublishInstructorForecast(false);
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
      body: JSON.stringify({ user_id: session.user.id, location_name: selectedLocation.name, latitude: selectedLocation.latitude, longitude: selectedLocation.longitude, organization_id: activeWorkspace?.organizationId ?? null, classroom_id: activeWorkspace?.classroomId ?? null, assignment_id: selectedClassroomAssignmentId || null, publication_scope: "private", initial_horizon_days: forecastRun.days.length, status: "submitted", submitted_at: submittedAt }),
    });
    const runRows = await runResponse.json().catch(() => []);
    if (!runResponse.ok || !runRows[0]?.id) throw new Error("Forecast run storage is not ready. Confirm the forecast-runs SQL migration was run.");
    const evidence = {
      observation: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F, ${liveWeather.observation.description}; ${liveWeather.observation.station || liveWeather.observation.stationName || "NWS observation station"} at ${observedAt}` : "No live observation available when saved",
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
    const archiveLocation = locationForArchive(archive);
    setLocationId(archiveLocation.id);
    setForecastRun({ id: crypto.randomUUID(), initialHorizonDays: 1, days: [{ date: targetDate, day: { ...emptyPeriod("day"), highLow: archive.day.high, conditions: archive.day.conditions, rainChance: archive.day.rainChance, timing: archive.day.timing, hazards: archive.day.hazards, reasoning: archive.day.reasoning ?? "", references: savedReferences(archive.day.references) }, night: { ...emptyPeriod("night"), highLow: archive.night.low, conditions: archive.night.conditions, rainChance: archive.night.rainChance, timing: archive.night.timing, hazards: archive.night.hazards, reasoning: archive.night.reasoning ?? "", references: savedReferences(archive.night.references) } }] });
    setSelectedForecastDay(0); setArchiveMenuId(null); setSaveMessage(`Revision draft opened for ${targetDate} at ${archiveLocation.name}. Submit creates a new, auditable version.`); setActiveSection("forecast");
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

  function requestArchiveRemoval(archive: SavedForecast) {
    setArchiveMenuId(null);
    setPendingArchiveRemovalId(archive.id);
  }

  async function collectActuals(archive: SavedForecast) {
    if (collectingArchiveId === archive.id) return;
    if (!archive.periodIds?.day || !archive.periodIds?.night) {
      setVerificationMessage("This forecast is still being linked to its cloud archive. Refresh once, then collect actuals.");
      return;
    }
    const archiveLocation = locationForArchive(archive);
    setCollectingArchiveId(archive.id);
    setVerificationMessage(`Collecting ${archiveLocation.observationStation} observations and calculating automated scores…`);
    try {
      const response = await fetch(`/api/verify?date=${archive.targetDate}&location=${encodeURIComponent(archiveLocation.id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to collect observations");
      const verification: AutomaticVerification = {
        station: data.station, fetchedAt: data.fetchedAt, day: data.day, night: data.night,
        dayScore: automaticForecastScore(archive.day.high, archive.day.rainChance, data.day, true),
        nightScore: automaticForecastScore(archive.night.low, archive.night.rainChance, data.night, false),
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
    if (profile.role === "owner") { setProfileMessage("The permanent owner role cannot be changed here."); return; }
    setProfileMessage("Saving role…");
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${profile.id}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ role: nextRole }) });
    if (!response.ok) { setProfileMessage("Role could not be updated."); return; }
    setProfiles((all) => all.map((item) => item.id === profile.id ? { ...item, role: nextRole } : item));
    setProfileMessage("Role saved.");
  }

  async function saveProfileDetails(profile: Profile, fields: Pick<Profile, "display_name" | "person_type" | "employee_id" | "student_id" | "title">) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setProfileMessage("Saving profile…");
    const clean = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, typeof value === "string" && !value.trim() ? null : value]));
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${profile.id}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(clean) });
    const rows = await response.json().catch(() => []);
    if (!response.ok) { setProfileMessage("Profile could not be updated. Apply the profile migration, then try again."); return; }
    setProfiles((all) => all.map((item) => item.id === profile.id ? { ...item, ...(rows[0] ?? clean) } : item));
    setProfileMessage("Profile saved.");
  }

  async function createOrganization(name: string, kind: OrganizationWorkspace["kind"]) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${Math.random().toString(36).slice(2, 7)}`;
    setAccessMessage("Creating workspace…");
    const response = await fetch(`${supabaseUrl}/rest/v1/organizations`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ name, slug, kind, created_by: session.user.id }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]?.id) { setAccessMessage("Workspace could not be created."); return; }
    const membershipResponse = await fetch(`${supabaseUrl}/rest/v1/organization_memberships`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ organization_id: rows[0].id, user_id: session.user.id, role: "owner", status: "active" }) });
    setAccessMessage(membershipResponse.ok ? `${name} was created.` : `${name} was created, but your membership needs attention.`);
    loadAccessManagement();
  }

  async function createClassroom(organizationId: string, name: string, term: string) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setAccessMessage("Creating classroom…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classrooms`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ organization_id: organizationId, name, term: term || null, created_by: session.user.id }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]?.id) { setAccessMessage("Classroom could not be created."); return; }
    await fetch(`${supabaseUrl}/rest/v1/classroom_memberships`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ classroom_id: rows[0].id, user_id: session.user.id, role: "instructor", status: "active" }) });
    setAccessMessage(`${name} was created.`);
    loadAccessManagement();
  }

  async function addOrganizationMember(organizationId: string, userId: string, nextRole: WorkspaceRole) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const response = await fetch(`${supabaseUrl}/rest/v1/organization_memberships?on_conflict=organization_id,user_id`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ organization_id: organizationId, user_id: userId, role: nextRole, status: "active" }) });
    setAccessMessage(response.ok ? "Organization access saved." : "Organization access could not be saved.");
    if (response.ok) loadAccessManagement();
  }

  async function addClassroomMember(classroomId: string, userId: string, nextRole: ClassroomMember["role"]) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_memberships?on_conflict=classroom_id,user_id`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ classroom_id: classroomId, user_id: userId, role: nextRole, status: "active" }) });
    setAccessMessage(response.ok ? "Classroom access saved." : "Classroom access could not be saved.");
    if (response.ok) loadAccessManagement();
  }

  async function removeOrganizationMember(membership: OrganizationMember) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const response = await fetch(`${supabaseUrl}/rest/v1/organization_memberships?id=eq.${membership.id}`, { method: "DELETE", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } });
    setAccessMessage(response.ok ? "Organization access removed." : "Organization access could not be removed.");
    if (response.ok) loadAccessManagement();
  }

  async function removeClassroomMember(membership: ClassroomMember) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_memberships?id=eq.${membership.id}`, { method: "DELETE", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } });
    setAccessMessage(response.ok ? "Classroom access removed." : "Classroom access could not be removed.");
    if (response.ok) loadAccessManagement();
  }

  async function createClassroomAssignment(fields: Pick<ClassroomAssignment, "title" | "instructions" | "target_date" | "due_at" | "status">) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom || !activeWorkspace?.classroomId) return;
    setAssignmentMessage("Creating assignment…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_assignments`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ ...fields, classroom_id: activeWorkspace.classroomId, created_by: session.user.id }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setAssignmentMessage("Assignment could not be created."); return; }
    setClassroomAssignments((assignments) => [...assignments, rows[0] as ClassroomAssignment].sort((a, b) => a.target_date.localeCompare(b.target_date)));
    setSelectedClassroomAssignmentId(rows[0].id as string);
    setAssignmentMessage("Assignment created. It remains private to this classroom.");
  }

  async function publishInstructorForecastSnapshot(assignmentId: string, savedAt: string) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom) return;
    const instructor_forecast: InstructorForecastSnapshot = { saved_at: savedAt, location_name: selectedLocation.name, days: forecastRun.days.map((day) => ({ ...day, day: { ...day.day, references: [...day.day.references] }, night: { ...day.night, references: [...day.night.references] } })) };
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_assignments?id=eq.${assignmentId}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ instructor_forecast, instructor_forecast_updated_at: savedAt }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) throw new Error("The forecast submitted, but the instructor example could not be published. Run the latest classroom SQL migration, then submit it again.");
    setClassroomAssignments((assignments) => assignments.map((assignment) => assignment.id === assignmentId ? rows[0] as ClassroomAssignment : assignment));
  }

  async function saveForecastReview(runId: string) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const manualScore = reviewManualScore.trim() === "" ? null : Number(reviewManualScore);
    if (!reviewComment.trim() && manualScore === null) { setReviewMessage("Add a comment or a manual score before saving."); return; }
    if (manualScore !== null && (!Number.isFinite(manualScore) || manualScore < 0 || manualScore > 100)) { setReviewMessage("Manual score must be between 0 and 100."); return; }
    const response = await fetch(`${supabaseUrl}/rest/v1/forecast_reviews`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ run_id: runId, reviewer_id: session.user.id, comment: reviewComment.trim() || null, manual_score: manualScore }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setReviewMessage("Review could not be saved."); return; }
    setReviewNotes((all) => ({ ...all, [runId]: [rows[0] as ForecastReview, ...(all[runId] ?? [])] }));
    setReviewComment(""); setReviewManualScore(""); setReviewMessage("Review saved.");
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

  function selectRadarView(view: RadarMapView) {
    setRadarMapView(view);
    window.dispatchEvent(new CustomEvent("weather-desk-radar-layer", { detail: view === "composite" || view === "base" || view === "satellite" ? "none" : view }));
    if (view !== "composite") setRadarLoop(false);
    window.requestAnimationFrame(() => document.querySelectorAll<HTMLDetailsElement>(".radar-tools[open]").forEach((controls) => controls.removeAttribute("open")));
  }

  return (
    <main className={radarExpanded ? "app radar-expanded" : "app"}>
      <header className="header">
        <div className="brand-lockup"><img src="/brand/weather-desk-mark.svg" alt="" /><div><p className="eyebrow">Human-first forecasting workspace</p><h1>The Weather Desk</h1></div></div>
        <div className="header-meta">
          {session && <div className="workspace-menu-wrap"><button type="button" className="workspace-trigger" aria-expanded={workspaceMenuOpen} onClick={() => setWorkspaceMenuOpen((open) => !open)}><strong>{workspaceDeskLabel(activeWorkspace)}</strong><i aria-hidden="true">⌄</i></button>{workspaceMenuOpen && <div className="workspace-menu"><strong>Available workspaces</strong><small>Switch the forecasts and records you are working in. Your location stays available across workspaces.</small><div>{workspaceContexts.map((workspace) => <button type="button" key={workspace.key} className={workspace.key === activeWorkspaceKey ? "active" : ""} onClick={() => { setActiveWorkspaceKey(workspace.key); setWorkspaceMenuOpen(false); setWorkspaceContextStatus(`${workspaceDeskLabel(workspace)} is now active.`); }}><strong>{workspaceDeskLabel(workspace)}</strong><span>{workspace.detail}{workspace.role ? ` · ${workspace.role}` : ""}</span></button>)}</div>{workspaceContextStatus && <em>{workspaceContextStatus}</em>}</div>}</div>}
          <div className="location-menu-wrap"><button type="button" className="location-trigger" aria-expanded={locationMenuOpen} onClick={() => setLocationMenuOpen((open) => !open)}><span>Location</span><strong>{selectedLocation.name}</strong><i aria-hidden="true">⌄</i></button>{locationMenuOpen && <div className="location-menu"><strong>Workspace location</strong><small>Radar, observations, model guidance, and new forecasts update together.</small><div>{weatherDeskLocations.map((location) => <button type="button" key={location.id} className={location.id === locationId ? "active" : ""} onClick={() => { setLocationId(location.id); setLocationMenuOpen(false); }}><strong>{location.name}</strong><span>{location.observationStation} observation · K{location.upperAirStation} upper air</span></button>)}</div></div>}</div>
          <div className="header-account"><button type="button" className="theme-toggle" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}>{theme === "light" ? "Dark mode" : "Light mode"}</button>{session ? <><span>{session.user.email}</span><button type="button" onClick={() => { window.localStorage.removeItem(sessionStorageKey); window.sessionStorage.removeItem(sessionStorageKey); setSession(null); setAuthMessage("Signed out."); }}>Sign out</button></> : <div className="login-menu-wrap"><button type="button" onClick={() => setLoginMenuOpen((open) => !open)}>Log in</button>{loginMenuOpen && <form className="login-menu" onSubmit={(event) => { event.preventDefault(); authenticate("signin"); }}><strong>Weather Desk account</strong><input aria-label="Email" type="email" placeholder="Email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /><input aria-label="Password" type="password" placeholder="Password (6+ characters)" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /><label className="remember-me"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> Remember me on this browser</label><div><button type="submit">Sign in</button><button type="button" onClick={() => authenticate("signup")}>Create account</button></div>{authMessage && <small>{authMessage}</small>}</form>}</div>}</div>
        </div>
      </header>

      <nav aria-label="Main navigation" className="navigation">
        <button className={activeSection === "dashboard" ? "active" : ""} onClick={() => setActiveSection("dashboard")}>Dashboard</button>
        <button className={activeSection === "radar" ? "active" : ""} onClick={() => setActiveSection("radar")}>Radar</button>
        <button className={activeSection === "forecast" ? "active" : ""} onClick={() => setActiveSection("forecast")}>Forecast</button>
        <button className={activeSection === "verify" ? "active" : ""} onClick={() => setActiveSection("verify")}>Verify</button>
        {session && activeWorkspace?.kind === "classroom" && <button className={activeSection === "classroom" ? "active" : ""} onClick={() => setActiveSection("classroom")}>Classroom</button>}
        {hasAcademicReviewAccess && <button className={activeSection === "control" ? "active" : ""} onClick={() => setActiveSection("control")}>{hasControlAccess ? "Control center" : "Review desk"}</button>}
      </nav>
      {workspaceNotice && <aside className="workspace-notice" role="status"><div><strong>Reference data added</strong><span>{workspaceNotice.message}</span></div><div>{workspaceNotice.targetDate && <button type="button" onClick={() => { const index = forecastRun.days.findIndex((day) => day.date === workspaceNotice.targetDate); if (index >= 0) setSelectedForecastDay(index); setActiveSection("forecast"); setWorkspaceNotice(null); }}>View forecast</button>}<button type="button" aria-label="Dismiss confirmation" onClick={() => setWorkspaceNotice(null)}>×</button></div></aside>}

      {activeSection === "dashboard" && <>
      <section className="outlook-strip" aria-label="Seven-day NWS guidance">
        <div className="outlook-heading"><div><h2>7-day guidance</h2><p>NWS reference forecast · not a student submission</p></div><span>Live guidance</span></div>
        <div className="outlook-cards">{outlook.length ? outlook.map((day) => <article key={day.date}><strong>{day.label}</strong><b aria-hidden="true">{weatherIcon(day.shortForecast)}</b><span>{day.shortForecast}</span><em>{day.high}° / {day.low}°</em><small>{day.precipitationChance ?? 0}% PoP</small></article>) : <p>Loading 7-day NWS guidance…</p>}</div>
      </section>
      <section className="dashboard-grid">
        <article className="radar-card">
          <div className="card-heading"><div><h2>{radarMapView === "satellite" ? "Satellite" : ["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(radarMapView) ? "Forecast map" : "Radar"}</h2><p>{radarMapView === "composite" ? `Live composite reflectivity · centered on ${selectedLocation.name}` : radarMapView === "satellite" ? `GOES-East GeoColor · current CONUS picture for ${selectedLocation.name}` : ["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(radarMapView) ? `NWS gridded forecast map · centered on ${selectedLocation.name}` : `OpenWeather map layer · centered on ${selectedLocation.name}`}</p></div><div className="actions">{radarMapView === "composite" && <button onClick={() => { setRadarLoop((value) => !value); setRadarPlaying(false); }}>{radarLoop ? "Interactive map" : "Radar timeline"}</button>}<button onClick={() => setRadarRecenterToken((value) => value + 1)}>Recenter</button><button onClick={() => setRadarRefreshToken((value) => value + 1)}>Refresh</button><button onClick={() => setRadarExpanded((value) => !value)}>{radarExpanded ? "Exit expanded view" : "Expand radar"}</button></div></div>
          <div className="radar"><details className="radar-tools"><summary aria-label="Open radar controls">☰</summary><div><div className="radar-product-picker"><span>Data layer</span><div><button type="button" className={radarMapView === "composite" ? "active" : ""} onClick={() => selectRadarView("composite")}>Radar</button><button type="button" className={radarMapView === "satellite" ? "active" : ""} onClick={() => selectRadarView("satellite")}>Satellite</button><button type="button" className={["precipitation_new", "clouds_new", "pressure_new", "wind_new", "temp_new"].includes(radarMapView) ? "active" : ""} onClick={() => selectRadarView("precipitation_new")}>Weather fields</button><button type="button" className={["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(radarMapView) ? "active" : ""} onClick={() => selectRadarView("ndfd_maxt")}>Forecast maps</button></div></div>{radarMapView !== "satellite" && <><label className="alert-overlay-toggle"><input type="checkbox" checked={showNwsAlerts} onChange={(event) => { setShowNwsAlerts(event.target.checked); window.dispatchEvent(new CustomEvent("weather-desk-alert-overlay", { detail: event.target.checked })); event.currentTarget.closest("details")?.removeAttribute("open"); }} /> NWS watches &amp; warnings</label><label>Opacity <input type="range" min="20" max="100" value={radarOpacity} onChange={(event) => setRadarOpacity(Number(event.target.value))} /> <span>{radarOpacity}%</span></label></>}<small>{radarMapView === "satellite" ? "Official NOAA GOES-East GeoColor · visible by day and infrared overnight" : radarMapView === "composite" ? (radarLoop ? radarTimelineStatus : `NOAA composite reflectivity · ${selectedLocation.radarSite}`) : ["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(radarMapView) ? "NWS National Digital Forecast Database · gridded forecast field" : "Weather fields are an OpenWeather layer; choose the field below."}</small>{["precipitation_new", "clouds_new", "pressure_new", "wind_new", "temp_new"].includes(radarMapView) && <div className="radar-field-picker">{(["precipitation_new", "clouds_new", "pressure_new", "wind_new", "temp_new"] as RadarMapView[]).map((view) => <button type="button" key={view} className={radarMapView === view ? "active" : ""} onClick={() => selectRadarView(view)}>{({ precipitation_new: "Precip", clouds_new: "Cloud", pressure_new: "Pressure", wind_new: "Wind", temp_new: "Temp" } as Record<string, string>)[view]}</button>)}</div>}{["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(radarMapView) && <div className="radar-field-picker">{(["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"] as RadarMapView[]).map((view) => <button type="button" key={view} className={radarMapView === view ? "active" : ""} onClick={() => selectRadarView(view)}>{({ ndfd_maxt: "High temp", ndfd_pop12: "PoP", ndfd_windspd: "Wind" } as Record<string, string>)[view]}</button>)}</div>}</div></details>{radarLoop && radarMapView === "composite" && <div className="radar-playback"><button type="button" aria-label="Previous radar frame" disabled={!radarFrames.length} onClick={() => { setRadarPlaying(false); setRadarFrameIndex((index) => Math.max(0, index - 1)); }}>‹</button><button type="button" disabled={radarFrames.length < 2} onClick={() => setRadarPlaying((playing) => !playing)}>{radarPlaying ? "Pause" : "Play"}</button><button type="button" aria-label="Next radar frame" disabled={!radarFrames.length} onClick={() => { setRadarPlaying(false); setRadarFrameIndex((index) => Math.min(radarFrames.length - 1, index + 1)); }}>›</button><span>{radarFrameTime}</span></div>}{radarMapView === "satellite" ? <figure className="satellite-view"><img src={`https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/1250x750.jpg?refresh=${radarRefreshToken}`} alt="Latest NOAA GOES-East GeoColor image for the continental United States" /><figcaption>GOES-East GeoColor · {selectedLocation.name} is within this regional view</figcaption></figure> : <RadarMap location={selectedLocation} opacity={radarOpacity / 100} showReflectivity={radarMapView === "composite"} refreshToken={radarRefreshToken} recenterToken={radarRecenterToken} timelineTileUrl={radarLoop && radarMapView === "composite" ? radarFrame?.tileUrl : null} />}</div>
          <div className="card-footer radar-footer"><RadarLegendStrip view={radarMapView} /></div>
        </article>

        <aside className="quick-data" aria-label="Quick weather reference">
          {weatherError && <div><strong className="alert">Live data unavailable</strong><span>{weatherError}</span></div>}
          {!liveWeather && !weatherError && <div><strong>Loading {selectedLocation.name} weather…</strong><span>Contacting the National Weather Service</span></div>}
          {liveWeather && <><div><strong>{liveWeather.observation.temperatureF ?? "—"}°F · {liveWeather.observation.description}</strong><span>{liveWeather.observation.temperatureSource === "forecast estimate" ? "NWS forecast estimate · " : ""}Dew point {liveWeather.observation.dewpointF ?? "—"}°F · {liveWeather.observation.windDirection ?? "—"} {liveWeather.observation.windMph ?? "—"} mph</span></div>
          {liveWeather.forecast && <div><strong>NWS {liveWeather.forecast.period}: {liveWeather.forecast.shortForecast}</strong><span>{liveWeather.forecast.temperature}°{liveWeather.forecast.temperatureUnit} · {liveWeather.forecast.precipitationChance ?? 0}% rain chance</span></div>}
          <div><strong>{liveWeather.alerts[0] ? liveWeather.alerts[0].event : liveWeather.alertsAvailable ? "No active NWS alerts" : "NWS alerts temporarily unavailable"}</strong><span>{liveWeather.alerts[0]?.headline ?? (liveWeather.alertsAvailable ? "No watches, warnings, or advisories reported for this point." : "Alert status could not be confirmed; check official NWS alerts before making a warning-sensitive decision.")}</span></div>
          <div><strong>Observation: {liveWeather.observation.station}</strong><span>{liveWeather.observation.stationName} · {observedAt}</span></div></>}
        </aside>
      </section>

      <section className="data-desk">
        <div className="section-heading data-desk-heading"><div><h2>Forecast data</h2><p>Reference data for your next forecast.</p></div></div>
        <div className="tabs" role="tablist" aria-label="Forecast data sources">
          <button className={dataPanel === "nbm" ? "active" : ""} onClick={() => setDataPanel("nbm")}>NBM full text</button>
          <button className={dataPanel === "sounding" ? "active" : ""} onClick={() => setDataPanel("sounding")}>Sounding</button>
          <button className={dataPanel === "models" ? "active" : ""} onClick={() => setDataPanel("models")}>Other models</button>
          <button className={dataPanel === "maps" ? "active" : ""} onClick={() => setDataPanel("maps")}>Forecast maps</button>
          <button className={dataPanel === "ensembles" ? "active" : ""} onClick={() => setDataPanel("ensembles")}>Ensembles</button>
          <button className={dataPanel === "model-sounding" ? "active" : ""} onClick={() => setDataPanel("model-sounding")}>Model sounding</button>
        </div>
        {dataPanel === "nbm" && <section className="source-bulletin"><div className="model-guidance-heading"><div><strong>National Blend of Models bulletin</strong><span>Full NBM source text for {selectedLocation.name} forecast analysis</span></div><small>{nbmText ? "Latest bulletin loaded" : nbmStatus}</small></div><details><summary>Open full NBM bulletin</summary><pre className="model-text">{nbmText || nbmStatus}</pre></details></section>}
        {dataPanel === "sounding" && <section className="observed-sounding-panel"><div className="model-guidance-heading"><div><strong>Latest observed K{selectedLocation.upperAirStation} sounding</strong><span>Nearest upper-air site for {selectedLocation.name} · official SPC analysis panel</span></div><a href={`https://www.spc.noaa.gov/exper/soundings/LATEST/${selectedLocation.upperAirStation}.gif`} target="_blank" rel="noreferrer">Open SPC source</a></div><img src={officialSoundingImageUrl(selectedLocation.upperAirStation)} alt={`Latest observed K${selectedLocation.upperAirStation} upper-air sounding from the Storm Prediction Center`} /><details><summary>Raw K{selectedLocation.upperAirStation} sounding text</summary><pre className="model-text">{soundingText || soundingStatus}</pre></details></section>}
        {dataPanel === "models" && <section className="model-workspace">
          <div className="model-desk-controls"><div><span>Open-Meteo model guidance</span><div className="guidance-scope-toggle"><button type="button" className={guidanceGroup === "high-res" ? "active" : ""} onClick={() => { setGuidanceGroup("high-res"); if (!guidanceModels["high-res"].some(([id]) => id === openMeteoModel)) setOpenMeteoModel("hrrr_conus"); }}>High-res</button><button type="button" className={guidanceGroup === "global" ? "active" : ""} onClick={() => { setGuidanceGroup("global"); if (!guidanceModels.global.some(([id]) => id === openMeteoModel)) setOpenMeteoModel("gfs_global"); }}>Global</button></div></div><div className="model-view-toggle"><button type="button" className={openMeteoView === "hourly" ? "active" : ""} onClick={() => setOpenMeteoView("hourly")}>Hourly</button><button type="button" className={openMeteoView === "daily" ? "active" : ""} onClick={() => setOpenMeteoView("daily")}>Daily</button><button type="button" className={openMeteoView === "compare" ? "active" : ""} onClick={() => { const left = openMeteoModel === "best_match" ? "hrrr_conus" : openMeteoModel; setComparisonLeftModel(left); setComparisonRightModel(guidanceGroup === "global" ? "ecmwf_ifs" : "nbm_conus"); setOpenMeteoView("compare"); }}>Compare</button></div></div>
          {openMeteoView !== "compare" && (openMeteoGuidance ? <><article className="single-model-table"><header><div className="model-picker">{guidanceModels[guidanceGroup].map(([id, label]) => <button type="button" key={id} className={openMeteoModel === id ? "active" : ""} onClick={() => setOpenMeteoModel(id)}>{label}</button>)}</div><strong>{openMeteoGuidance.model} · {selectedLocation.name}</strong><small>{openMeteoGuidance.current ? `${openMeteoGuidance.current.temperatureF ?? "—"}°F · feels ${openMeteoGuidance.current.feelsLikeF ?? "—"}°F · ${openMeteoWeatherLabel(openMeteoGuidance.current.weatherCode)}` : "Current model guidance unavailable"}</small></header><ModelGuidanceTable guidance={openMeteoGuidance} view={openMeteoView} /><div className="table-reference-action"><small>Attach this displayed guidance to matching forecast dates. A confirmation appears when it is saved.</small><button type="button" onClick={() => attachGuidanceSeries(openMeteoGuidance, openMeteoView)}>Add to forecast</button></div></article><p className="model-attribution">Model data: <a href={openMeteoGuidance.source} target="_blank" rel="noreferrer">Open-Meteo</a>. High-res guidance is for near-term detail; global models are for pattern and range.</p></> : <p className="empty">{openMeteoStatus}</p>)}
          {openMeteoView === "compare" && <section className="model-compare" aria-busy={Boolean(comparisonStatus)}>{comparisonStatus && <p className="model-loading" role="status">{comparisonStatus}</p>}<div className="comparison-columns">{[comparisonLeftModel, comparisonRightModel].map((id, index) => { const guidance = modelComparison[id]; const selectedModel = index === 0 ? comparisonLeftModel : comparisonRightModel; return <article key={index}><header><div className="model-picker">{guidanceModels[guidanceGroup].filter(([model]) => model !== "best_match").map(([model, label]) => <button type="button" key={model} className={selectedModel === model ? "active" : ""} onClick={() => { if (index === 0) { if (model === comparisonRightModel) setComparisonRightModel(comparisonLeftModel); setComparisonLeftModel(model); setOpenMeteoModel(model); } else { if (model === comparisonLeftModel) setComparisonLeftModel(comparisonRightModel); setComparisonRightModel(model); } }}>{label}</button>)}</div><div className="comparison-table-title"><strong>{guidance?.model ?? "Loading model…"}</strong><div className="model-view-toggle"><button type="button" className={comparisonView === "hourly" ? "active" : ""} onClick={() => setComparisonView("hourly")}>Hourly</button><button type="button" className={comparisonView === "daily" ? "active" : ""} onClick={() => setComparisonView("daily")}>Daily</button></div></div></header>{guidance ? <><ModelGuidanceTable guidance={guidance} view={comparisonView} compact /><div className="table-reference-action"><small>Attach this model to matching forecast dates.</small><button type="button" onClick={() => attachGuidanceSeries(guidance, comparisonView)}>Add to forecast</button></div></> : <p className="empty">Loading model guidance…</p>}</article>; })}</div></section>}
        </section>}
        {dataPanel === "maps" && <section className="forecast-map-desk"><div className="model-guidance-heading"><div><strong>Forecast maps</strong><span>Spatial guidance around {selectedLocation.name}</span></div></div><div className="forecast-map-options"><article><strong>Maximum temperature</strong><span>Regional high-temperature pattern.</span><button type="button" onClick={() => { selectRadarView("ndfd_maxt"); setActiveSection("radar"); }}>Open map</button></article><article><strong>Precipitation chance</strong><span>Regional precipitation potential.</span><button type="button" onClick={() => { selectRadarView("ndfd_pop12"); setActiveSection("radar"); }}>Open map</button></article><article><strong>Sustained wind</strong><span>Regional wind pattern.</span><button type="button" onClick={() => { selectRadarView("ndfd_windspd"); setActiveSection("radar"); }}>Open map</button></article></div><p className="model-attribution">NWS National Digital Forecast Database</p></section>}
        {dataPanel === "ensembles" && <section className="ensemble-panel"><div className="model-guidance-heading"><div><strong>GFS ensemble</strong><span>Range and spread · {selectedLocation.name}</span></div></div>{ensembleGuidance ? <><div className="ensemble-summary"><article><span>Members</span><strong>{ensembleGuidance.rows[0]?.temperature.members ?? "—"}</strong><small>available members</small></article><article><span>Temperature spread</span><strong>±{ensembleGuidance.rows[0]?.temperature.spread ?? "—"}°F</strong><small>first valid hour</small></article><article><span>Forecast horizon</span><strong>10 days</strong><small>point guidance</small></article></div><EnsembleTable guidance={ensembleGuidance} /><p className="model-attribution">Ensemble data: <a href={ensembleGuidance.source} target="_blank" rel="noreferrer">Open-Meteo Ensemble API</a></p></> : <p className="empty">{ensembleStatus}</p>}</section>}
        {dataPanel === "model-sounding" && <section className="model-sounding-panel">
          {modelSounding?.profiles[soundingProfileIndex] && <div className="model-guidance-heading sounding-result-heading"><div><strong>{modelSounding.model} profile · {modelTimestamp(modelSounding.profiles[soundingProfileIndex].time)}</strong><span>{selectedLocation.name} · forecast guidance</span></div><small>Run {runTimestamp(modelSounding.runTime)}</small></div>}
          <div className="sounding-control-strip"><div className="sounding-model-control"><span>Model</span><div className="model-picker"><button type="button" className={soundingModel === "hrrr" ? "active" : ""} onClick={() => { setSoundingModel("hrrr"); setSoundingRunOffset(0); }}>HRRR</button><button type="button" className={soundingModel === "gfs" ? "active" : ""} onClick={() => { setSoundingModel("gfs"); setSoundingRunOffset(0); }}>GFS</button></div></div>{soundingProfiles.length ? <div className="sounding-valid-picker"><div className="model-picker">{soundingProfileWindow.map((profile, visibleIndex) => { const index = soundingWindowStart + visibleIndex; const isNearest = index === nearestSoundingProfileIndex; return <button type="button" key={profile.time} className={soundingProfileIndex === index ? "active" : ""} onClick={() => setSoundingProfileIndex(index)}><span>{modelTimestamp(profile.time)}</span>{isNearest && <small>Now</small>}</button>; })}</div></div> : null}<div className="sounding-run-picker"><button type="button" aria-label="Open older model run" onClick={() => setSoundingRunOffset((offset) => offset + 1)}>‹</button><span>{modelSounding ? runTimestamp(modelSounding.runTime) : "Loading run…"}</span><button type="button" aria-label="Open newer model run" disabled={soundingRunOffset === 0} onClick={() => setSoundingRunOffset((offset) => Math.max(0, offset - 1))}>›</button></div></div>
          {modelSounding?.profiles[soundingProfileIndex] ? <><ModelSoundingChart profile={modelSounding.profiles[soundingProfileIndex]} /><div className="guidance-table-wrap"><table className="guidance-table sounding-table"><thead><tr><th>Pressure</th><th>Height</th><th>Temperature</th><th>RH</th><th>Wind</th></tr></thead><tbody>{modelSounding.profiles[soundingProfileIndex].levels.map((level) => <tr key={level.pressureHpa}><th>{level.pressureHpa} hPa</th><td>{level.geopotentialHeightM ?? "—"} m</td><td>{level.temperatureF ?? "—"}°F</td><td>{level.relativeHumidity ?? "—"}%</td><td>{level.windMph ?? "—"} mph @ {level.windDirection ?? "—"}°</td></tr>)}</tbody></table></div><p className="model-attribution">Profile data: <a href={modelSounding.source} target="_blank" rel="noreferrer">Open-Meteo Single Runs API</a>. It is saved with your forecast when attached.</p></> : <p className="empty">{modelSoundingStatus}</p>}
        </section>}
        {dataPanel !== "models" && dataPanel !== "maps" && <div className="desk-reference-action"><div><strong>Add to forecast</strong><small>Save this view with the matching forecast date.</small></div><button type="button" onClick={pinCurrentDeskPanel}>Add reference</button></div>}
      </section>
      </>}

      {activeSection === "radar" && <section className="radar-workspace">
        <div className="radar-workspace-heading"><div><p className="eyebrow">Live analysis</p><h2>{radarMapView === "satellite" ? "Satellite" : ["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(radarMapView) ? "Forecast maps" : "Radar"}</h2><p>{selectedLocation.name}</p></div><div><button type="button" onClick={() => setRadarRecenterToken((value) => value + 1)}>Recenter</button><button type="button" onClick={() => setRadarRefreshToken((value) => value + 1)}>Refresh</button><button type="button" onClick={() => setActiveSection("dashboard")}>Desk</button></div></div>
        <div className="radar-workspace-toolbar"><div className="radar-product-picker"><span>Product family</span><div><button type="button" className={radarMapView === "composite" ? "active" : ""} onClick={() => selectRadarView("composite")}>Reflectivity</button><button type="button" className={radarMapView === "satellite" ? "active" : ""} onClick={() => selectRadarView("satellite")}>Satellite</button><button type="button" className={["precipitation_new", "clouds_new", "pressure_new", "wind_new", "temp_new"].includes(radarMapView) ? "active" : ""} onClick={() => selectRadarView("precipitation_new")}>Weather fields</button><button type="button" className={["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(radarMapView) ? "active" : ""} onClick={() => selectRadarView("ndfd_maxt")}>Forecast maps</button></div></div><label className="setting-check"><input type="checkbox" checked={showNwsAlerts} onChange={(event) => { setShowNwsAlerts(event.target.checked); window.dispatchEvent(new CustomEvent("weather-desk-alert-overlay", { detail: event.target.checked })); }} /><span><strong>NWS alerts</strong><small>Overlay active watches, warnings, and advisories.</small></span></label><label className="radar-opacity-control">Overlay opacity <input type="range" min="20" max="100" value={radarOpacity} onChange={(event) => setRadarOpacity(Number(event.target.value))} /><strong>{radarOpacity}%</strong></label></div>
        {radarMapView === "composite" && <div className="radar-workspace-subtools"><strong>Base reflectivity</strong><button type="button" onClick={() => { setRadarLoop((value) => !value); setRadarPlaying(false); }}>{radarLoop ? "Close timeline" : "Timeline"}</button></div>}
        {["precipitation_new", "clouds_new", "pressure_new", "wind_new", "temp_new"].includes(radarMapView) && <div className="radar-workspace-subtools"><strong>Weather field</strong><div className="radar-field-picker">{(["precipitation_new", "clouds_new", "pressure_new", "wind_new", "temp_new"] as RadarMapView[]).map((view) => <button type="button" key={view} className={radarMapView === view ? "active" : ""} onClick={() => selectRadarView(view)}>{({ precipitation_new: "Precip", clouds_new: "Cloud", pressure_new: "Pressure", wind_new: "Wind", temp_new: "Temp" } as Record<string, string>)[view]}</button>)}</div></div>}
        {["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(radarMapView) && <div className="radar-workspace-subtools"><strong>NWS forecast field</strong><div className="radar-field-picker">{(["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"] as RadarMapView[]).map((view) => <button type="button" key={view} className={radarMapView === view ? "active" : ""} onClick={() => selectRadarView(view)}>{({ ndfd_maxt: "High temperature", ndfd_pop12: "Precipitation chance", ndfd_windspd: "Wind speed" } as Record<string, string>)[view]}</button>)}</div></div>}
        <div className="radar radar-workspace-map">{radarLoop && radarMapView === "composite" && <div className="radar-playback"><button type="button" aria-label="Previous radar frame" disabled={!radarFrames.length} onClick={() => { setRadarPlaying(false); setRadarFrameIndex((index) => Math.max(0, index - 1)); }}>‹</button><button type="button" disabled={radarFrames.length < 2} onClick={() => setRadarPlaying((playing) => !playing)}>{radarPlaying ? "Pause" : "Play"}</button><button type="button" aria-label="Next radar frame" disabled={!radarFrames.length} onClick={() => { setRadarPlaying(false); setRadarFrameIndex((index) => Math.min(radarFrames.length - 1, index + 1)); }}>›</button><span>{radarFrameTime}</span></div>}{radarMapView === "satellite" ? <figure className="satellite-view"><img src={`https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/1250x750.jpg?refresh=${radarRefreshToken}`} alt="Latest NOAA GOES-East GeoColor image for the continental United States" /><figcaption>GOES-East GeoColor · {selectedLocation.name} is within this regional view</figcaption></figure> : <RadarMap location={selectedLocation} opacity={radarOpacity / 100} showReflectivity={radarMapView === "composite"} refreshToken={radarRefreshToken} recenterToken={radarRecenterToken} timelineTileUrl={radarLoop && radarMapView === "composite" ? radarFrame?.tileUrl : null} />}</div>
        <div className="radar-workspace-footer"><RadarLegendStrip view={radarMapView} /><p>{radarMapView === "composite" ? `Composite reflectivity · ${selectedLocation.radarSite} · ${radarLoop ? radarTimelineStatus : "live current frame"}` : radarMapView === "satellite" ? "NOAA GOES-East GeoColor imagery" : ["ndfd_maxt", "ndfd_pop12", "ndfd_windspd"].includes(radarMapView) ? "NWS National Digital Forecast Database · first available valid field" : "OpenWeather field overlay"}</p></div>
      </section>}

      {activeSection === "forecast" && !session && <section className="workspace-card access-wall"><h2>Log in to forecast</h2><p>The dashboard is available to explore, while forecasts, references, and archive work stay private to your account.</p><button type="button" onClick={() => setLoginMenuOpen(true)}>Open login</button></section>}
      {activeSection === "forecast" && session && <section className="workspace-card">
        <div className="section-heading forecast-title"><div><h2>Forecast workspace</h2><p>Each tab is one dated Day/Night forecast.</p></div><div className="horizon-actions"><button type="button" onClick={() => { setForecastRun(createNewForecastRun(3)); setSelectedForecastDay(0); }}>New 3-day</button><button type="button" onClick={() => { setForecastRun(createNewForecastRun(7)); setSelectedForecastDay(0); }}>New 7-day</button></div></div>
        {activeWorkspace?.kind === "classroom" && <div className="assignment-linker"><div><strong>Class assignment</strong><small>{selectedClassroomAssignment ? `${selectedClassroomAssignment.title} · ${forecastTargetTitle(selectedClassroomAssignment.target_date)}${selectedClassroomAssignment.due_at ? ` · due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(selectedClassroomAssignment.due_at))}` : ""}` : "Optional: link this forecast run to an open class assignment."}</small>{selectedClassroomAssignment?.instructions && <em>{selectedClassroomAssignment.instructions}</em>}{canManageActiveClassroom && selectedClassroomAssignment && <label className="assignment-instructor-toggle"><input type="checkbox" checked={publishInstructorForecast} onChange={(event) => setPublishInstructorForecast(event.target.checked)} /> <span><strong>Publish as instructor example</strong><small>Students in this classroom can see this assignment snapshot; student submissions remain private.</small></span></label>}</div><select value={selectedClassroomAssignmentId} onChange={(event) => { setSelectedClassroomAssignmentId(event.target.value); setPublishInstructorForecast(false); }}><option value="">No assignment</option>{classroomAssignments.filter((assignment) => assignment.status === "open" || assignment.id === selectedClassroomAssignmentId).map((assignment) => <option key={assignment.id} value={assignment.id}>{assignment.title} · {forecastTargetTitle(assignment.target_date)}</option>)}</select></div>}
        <div className="day-tabs" role="tablist" aria-label="Forecast days">{forecastRun.days.map((day, index) => <button type="button" key={`${day.date}-${index}`} className={index === selectedForecastDay ? "active" : ""} onClick={() => setSelectedForecastDay(index)} onContextMenu={(event) => { event.preventDefault(); setTabMenuIndex(index); setTabMenuPosition({ left: event.clientX, top: event.clientY }); setTabMenuMessage(""); }}>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day.date}T12:00:00`))}</button>)}<button className="add-day" type="button" aria-label="Add next forecast day" onClick={() => setForecastRun((run) => ({ ...run, days: [...run.days, createForecastDay(addDays(new Date(`${run.days.at(-1)?.date}T12:00:00`), 1))] }))}>+</button></div>
        <input type="hidden" name="target-date" form="forecast-form" value={selectedDay.date} />
        {tabMenuIndex !== null && <div className="tab-menu" style={{ left: tabMenuPosition.left, top: tabMenuPosition.top }}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${forecastRun.days[tabMenuIndex].date}T12:00:00`))}</strong><label>Change date<input type="date" value={forecastRun.days[tabMenuIndex].date} onChange={(event) => { const nextDate = event.target.value; if (forecastRun.days.some((day, index) => index !== tabMenuIndex && day.date === nextDate)) { setTabMenuMessage("That date already has a forecast tab."); return; } setForecastRun((run) => ({ ...run, days: run.days.map((day, index) => index === tabMenuIndex ? { ...day, date: nextDate } : day) })); setTabMenuMessage(""); }} /></label><div><button type="button" onClick={() => setTabMenuIndex(null)}>Done</button><button type="button" disabled={forecastRun.days.length === 1} onClick={() => { setForecastRun((run) => ({ ...run, days: run.days.filter((_, index) => index !== tabMenuIndex) })); setSelectedForecastDay((current) => Math.max(0, Math.min(current, forecastRun.days.length - 2))); setTabMenuIndex(null); }}>Remove day</button></div>{tabMenuMessage && <small>{tabMenuMessage}</small>}</div>}
        <form id="forecast-form" onSubmit={saveForecast} onKeyDown={advanceForecastEntry}><div className="forecast-period-columns">
          <fieldset className="forecast-period"><legend>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${selectedDay.date}T12:00:00`))} day <small>7 AM–7 PM</small></legend><div className="forecast-fields">
            <label>High temperature<span className="unit-input" style={unitInputStyle(temperatureInputValue(selectedDay.day.highLow), 2)}><input inputMode="decimal" placeholder="72" value={temperatureInputValue(selectedDay.day.highLow)} onChange={(event) => updatePeriod("day", "highLow", temperatureInputValue(event.target.value))} onBlur={() => formatPeriodField("day", "highLow")} /><i aria-hidden="true">°</i></span></label>
            <label>Conditions<select value={selectedDay.day.conditions} onChange={(event) => updatePeriod("day", "conditions", event.target.value)}><option value="">Choose conditions</option>{conditionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Rain chance<span className="unit-input" style={unitInputStyle(percentInputValue(selectedDay.day.rainChance), 2)}><input inputMode="numeric" placeholder="40" value={percentInputValue(selectedDay.day.rainChance)} onChange={(event) => updatePeriod("day", "rainChance", percentInputValue(event.target.value))} onBlur={() => formatPeriodField("day", "rainChance")} /><i aria-hidden="true">%</i></span></label>
            <label>Likely timing<input placeholder="3–8 PM" value={selectedDay.day.timing} onChange={(event) => updatePeriod("day", "timing", event.target.value)} onBlur={() => formatPeriodField("day", "timing")} /></label>
            <label>Wind<input value={selectedDay.day.wind} onChange={(event) => updatePeriod("day", "wind", event.target.value)} /></label>
            <label>Confidence<select value={selectedDay.day.confidence} onChange={(event) => updatePeriod("day", "confidence", event.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<textarea rows={2} placeholder="Hazards, impacts, or confidence notes" value={selectedDay.day.hazards} onChange={(event) => updatePeriod("day", "hazards", event.target.value)} /></label>
            <div className="wide-field reference-picker"><span>Quick-add current reference data</span><div>{referenceOptions.map((item) => <button type="button" key={item.id} onClick={() => addFreshReference("day", item)}>+ {item.label}</button>)}</div>{selectedDay.day.references.length > 0 && <div className="attached-draft-references"><strong>Added to this day</strong><div className="attached-reference-table"><div className="attached-reference-heading"><span>Reference</span><span>Snapshot</span><span>Action</span></div>{selectedDay.day.references.map((reference) => <div className="attached-reference-row" key={reference.id}><b>{reference.label}</b><small>{reference.detail.split("\n")[0]}</small><button type="button" onClick={() => removeReference("day", reference.id)}>Remove</button></div>)}</div></div>}<small>Each quick-add captures a new current snapshot; previous snapshots stay only in this list.</small></div>
            <label className="wide-field">Day reasoning<textarea value={selectedDay.day.reasoning} onChange={(event) => updatePeriod("day", "reasoning", event.target.value)} /></label>
          </div></fieldset>
          <fieldset className="forecast-period"><legend>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${selectedDay.date}T12:00:00`))} night <small>7 PM–7 AM</small></legend><div className="forecast-fields">
            <label>Low temperature<span className="unit-input" style={unitInputStyle(temperatureInputValue(selectedDay.night.highLow), 2)}><input inputMode="decimal" placeholder="61" value={temperatureInputValue(selectedDay.night.highLow)} onChange={(event) => updatePeriod("night", "highLow", temperatureInputValue(event.target.value))} onBlur={() => formatPeriodField("night", "highLow")} /><i aria-hidden="true">°</i></span></label>
            <label>Conditions<select value={selectedDay.night.conditions} onChange={(event) => updatePeriod("night", "conditions", event.target.value)}><option value="">Choose conditions</option>{conditionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Rain chance<span className="unit-input" style={unitInputStyle(percentInputValue(selectedDay.night.rainChance), 2)}><input inputMode="numeric" placeholder="20" value={percentInputValue(selectedDay.night.rainChance)} onChange={(event) => updatePeriod("night", "rainChance", percentInputValue(event.target.value))} onBlur={() => formatPeriodField("night", "rainChance")} /><i aria-hidden="true">%</i></span></label>
            <label>Likely timing<input placeholder="Before 10 PM" value={selectedDay.night.timing} onChange={(event) => updatePeriod("night", "timing", event.target.value)} onBlur={() => formatPeriodField("night", "timing")} /></label>
            <label>Wind<input value={selectedDay.night.wind} onChange={(event) => updatePeriod("night", "wind", event.target.value)} /></label>
            <label>Confidence<select value={selectedDay.night.confidence} onChange={(event) => updatePeriod("night", "confidence", event.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<textarea rows={2} placeholder="Hazards, impacts, or confidence notes" value={selectedDay.night.hazards} onChange={(event) => updatePeriod("night", "hazards", event.target.value)} /></label>
            <div className="wide-field reference-picker"><span>Quick-add current reference data</span><div>{referenceOptions.map((item) => <button type="button" key={item.id} onClick={() => addFreshReference("night", item)}>+ {item.label}</button>)}</div>{selectedDay.night.references.length > 0 && <div className="attached-draft-references"><strong>Added to this night</strong><div className="attached-reference-table"><div className="attached-reference-heading"><span>Reference</span><span>Snapshot</span><span>Action</span></div>{selectedDay.night.references.map((reference) => <div className="attached-reference-row" key={reference.id}><b>{reference.label}</b><small>{reference.detail.split("\n")[0]}</small><button type="button" onClick={() => removeReference("night", reference.id)}>Remove</button></div>)}</div></div>}<small>Each quick-add captures a new current snapshot; previous snapshots stay only in this list.</small></div>
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
        <section className="record-calendar" aria-label="Forecast record dates"><div className="record-calendar-heading"><div><strong>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" }).format(new Date(`${recordWindowStart}T12:00:00`))}</strong><small>Forecast target dates</small></div><div><button type="button" aria-label="Previous seven days" onClick={() => setRecordWindowStart(addDays(new Date(`${recordWindowStart}T12:00:00`), -7))}>←</button><button type="button" aria-label="Next seven days" onClick={() => setRecordWindowStart(addDays(new Date(`${recordWindowStart}T12:00:00`), 7))}>→</button></div></div><div className="record-calendar-days">{recordWindowDates.map((targetDate) => { const archive = archiveForDate(targetDate); const verification = archive ? automaticVerifications[archive.id] : null; return <button type="button" key={targetDate} className={`${archive?.id === selectedArchiveId ? "active " : ""}${archive ? "has-record" : ""}`} onClick={() => archive && setSelectedArchiveId(archive.id)} disabled={!archive}><span>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))}</span><strong>{new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))}</strong>{archive ? <small>H {displayForecastTemperature(archive.day.high)} · L {displayForecastTemperature(archive.night.low)}<br />PoP {displayForecastChance(archive.day.rainChance)}/{displayForecastChance(archive.night.rainChance)}<br />{verification?.dayScore !== null && verification?.dayScore !== undefined ? `Score ${verification.dayScore}%` : "Unscored"}</small> : <small>No forecast</small>}</button>; })}</div></section>
        <section className="date-record-list"><div><strong>{forecastTargetTitle(recordFocusDate)}</strong><small>{focusedDateRecords.length ? `${focusedDateRecords.length} forecast${focusedDateRecords.length === 1 ? "" : "s"} for this date` : "No saved forecasts for this date"}</small></div>{focusedDateRecords.length ? <div>{focusedDateRecords.map((archive) => { const verification = automaticVerifications[archive.id]; return <button type="button" key={archive.id} className={archive.id === selectedArchiveId ? "active" : ""} onClick={() => setSelectedArchiveId(archive.id)}><strong>V{archive.versionNumber} · {archive.status}</strong><span>H {displayForecastTemperature(archive.day.high)} · L {displayForecastTemperature(archive.night.low)} · PoP {displayForecastChance(archive.day.rainChance)}/{displayForecastChance(archive.night.rainChance)}</span><small>{archiveSubmissionTitle(archive)} · {verification?.dayScore !== null && verification?.dayScore !== undefined ? `Day score ${verification.dayScore}%` : "Unscored"}</small></button>; })}</div> : <p>Use the arrows above to browse a different forecast date.</p>}</section>
        <ForecastCalendarBoard archives={filteredArchives} verifications={automaticVerifications} selectedArchiveId={selectedArchiveId} weekStart={recordWindowStart} onShift={(days) => setRecordWindowStart(addDays(new Date(`${recordWindowStart}T12:00:00`), days))} onSelect={setSelectedArchiveId} />
        {selectedArchive ? <>{verificationMessage && <p className="empty">{verificationMessage}</p>}
        <div className="verification-grid"><div><div className="record-heading"><div><p className="eyebrow">Selected forecast</p><h2>{archiveVersionTitle(selectedArchive)}</h2><p>{locationForArchive(selectedArchive).name} · {archiveSubmissionTitle(selectedArchive)}</p></div><div className="verification-score"><strong>{selectedArchive.status === "draft" ? "Draft" : selectedVerificationIsFinal ? "Verified" : "In progress"}</strong><span>{selectedArchive.status === "draft" ? "not graded" : selectedVerificationIsFinal ? "automatic verification saved" : "observations and scores update as periods finish"}</span><button type="button" disabled={collectingArchiveId === selectedArchive.id} onClick={() => collectActuals(selectedArchive)}>{collectingArchiveId === selectedArchive.id ? "Collecting…" : "Collect actuals"}</button></div></div><div className="record-score-bar"><div><span>Day automatic score</span><i><b style={{ width: `${selectedAutomaticVerification?.dayScore ?? 0}%` }} /></i><strong>{scoreLabel(selectedAutomaticVerification?.dayScore, selectedAutomaticVerification?.day)}</strong></div><div><span>Night automatic score</span><i><b style={{ width: `${selectedAutomaticVerification?.nightScore ?? 0}%` }} /></i><strong>{scoreLabel(selectedAutomaticVerification?.nightScore, selectedAutomaticVerification?.night)}</strong></div></div><h3>Day · 7 AM–7 PM</h3><table className="verification-table"><colgroup><col className="metric-column" /><col className="forecast-column" /><col className="observed-column" /></colgroup><thead><tr><th>Metric</th><th>Your forecast</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>{displayForecastTemperature(selectedArchive.day.high)}</td><td>{selectedAutomaticVerification?.day.highF ?? "Awaiting period end"}</td></tr><tr><td>Conditions</td><td>{conditionLabel(selectedArchive.day.conditions)}</td><td>{selectedAutomaticVerification?.day.conditions.join("; ") || "Awaiting period end"}</td></tr><tr><td>Rain chance</td><td>{displayForecastChance(selectedArchive.day.rainChance)}</td><td>{selectedAutomaticVerification ? selectedAutomaticVerification.day.precipitationObserved ? "Precipitation observed" : "No precipitation observed" : "Awaiting period end"}</td></tr><tr><td>Timing / hazards</td><td>{[selectedArchive.day.timing, selectedArchive.day.hazards].filter(Boolean).join(" · ") || "—"}</td><td>{selectedAutomaticVerification?.day.maxWindMph ? `Max wind ${selectedAutomaticVerification.day.maxWindMph} mph` : "Awaiting period end"}</td></tr></tbody></table>
        <h3>Night · 7 PM–7 AM</h3><table className="verification-table"><colgroup><col className="metric-column" /><col className="forecast-column" /><col className="observed-column" /></colgroup><thead><tr><th>Metric</th><th>Your forecast</th><th>Observed</th></tr></thead><tbody><tr><td>Low temperature</td><td>{displayForecastTemperature(selectedArchive.night.low)}</td><td>{selectedAutomaticVerification?.night.lowF ?? "Awaiting period end"}</td></tr><tr><td>Conditions</td><td>{conditionLabel(selectedArchive.night.conditions)}</td><td>{selectedAutomaticVerification?.night.conditions.join("; ") || "Awaiting period end"}</td></tr><tr><td>Rain chance</td><td>{displayForecastChance(selectedArchive.night.rainChance)}</td><td>{selectedAutomaticVerification ? selectedAutomaticVerification.night.precipitationObserved ? "Precipitation observed" : "No precipitation observed" : "Awaiting period end"}</td></tr><tr><td>Timing / hazards</td><td>{[selectedArchive.night.timing, selectedArchive.night.hazards].filter(Boolean).join(" · ") || "—"}</td><td>{selectedAutomaticVerification?.night.maxWindMph ? `Max wind ${selectedAutomaticVerification.night.maxWindMph} mph` : "Awaiting period end"}</td></tr></tbody></table>
        <section className="submission-evidence"><header><h3>Submission evidence</h3><p>Captured when you submitted this forecast. It documents the information available at that time; it is not a row-by-row model comparison.</p></header><div><article><span>NWS observation at submission</span><small>{readableEvidence(selectedArchive.evidence.observation)}</small></article><article><span>NWS forecast at submission</span><small>{readableEvidence(selectedArchive.evidence.forecast)}</small></article><article><span>Alerts at submission</span><small>{readableEvidence(selectedArchive.evidence.alerts)}</small></article></div></section><section className="saved-references"><h3>Attached reference data</h3><p>Evidence attached to either period is shown once. Open the saved source only when you need the raw record.</p>{selectedReferences.length ? selectedReferences.map(({ reference, periods }) => <article key={reference.id}><strong>{periods.join(" + ")} · {reference.label}</strong><ArchivedReferencePreview reference={reference} /></article>) : <p className="empty">No reference sources were attached to this older record.</p>}</section></div><aside className="history"><h3>Forecast history</h3><p>Open a saved forecast and its captured evidence. Right-click a record for actions.</p>{filteredArchives.map((archive) => { const verification = automaticVerifications[archive.id]; const dayScore = verification?.dayScore; const nightScore = verification?.nightScore; return <button key={archive.id} className={archive.id === selectedArchiveId ? "active" : ""} onClick={() => setSelectedArchiveId(archive.id)} onContextMenu={(event) => { event.preventDefault(); setArchiveMenuId(archive.id); setArchiveMenuPosition({ left: event.clientX, top: event.clientY }); }}>Forecast: {forecastTargetTitle(archive.targetDate)}<div className="archive-score-bars"><span><i style={{ width: `${dayScore ?? 0}%` }} /></span><small>Day {dayScore ?? "pending"}</small><span><i style={{ width: `${nightScore ?? 0}%` }} /></span><small>Night {nightScore ?? "pending"}</small></div><small>{archiveSubmissionTitle(archive)} · V{archive.versionNumber ?? 1} · {archive.status}</small></button>})}{filteredArchives.length === 0 && <p className="empty">No forecasts match these filters.</p>}<button onClick={() => setSelectedArchiveId(null)}>Example · Jul 13<small>Sample verification layout</small></button></aside></div></>
        : <div className="verification-grid"><div><div className="section-heading"><div><h2>Verification · Monday, July 13</h2><p>Example forecast · Asheville Regional Airport</p></div><div className="verification-score"><strong>3 / 4</strong><span>metrics verified</span></div></div><h3>Day · 7 AM–7 PM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>NBM</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>85°F</td><td>83°F</td><td>84°F</td></tr><tr><td>Rain chance</td><td>70%</td><td>62%</td><td>Rain observed</td></tr><tr><td>Rain timing</td><td>4–7 PM</td><td>3–8 PM</td><td>5:12 PM</td></tr><tr><td>Thunderstorm risk</td><td>Scattered</td><td>Possible</td><td>One storm nearby</td></tr></tbody></table><div className="verification-notes"><div><span>Temperature error</span><strong>1°F</strong><small>Your forecast was closer</small></div><div><span>Timing error</span><strong>0:12</strong><small>Rain began 12 min later</small></div><div><span>Reflection</span><strong>Good call</strong><small>Storm coverage was limited</small></div></div></div><aside className="history"><h3>Forecast history</h3><p>Save a forecast to create an archive here.</p>{filteredArchives.map((archive) => <button key={archive.id} onClick={() => setSelectedArchiveId(archive.id)}>Forecast: {forecastTargetTitle(archive.targetDate)}<small>{archiveSubmissionTitle(archive)} · Day + night</small></button>)}</aside></div>}
      </section>}
      {archiveMenu && <div className="tab-menu" style={{ left: archiveMenuPosition.left, top: archiveMenuPosition.top }}><strong>{archiveVersionTitle(archiveMenu)}</strong><small>{archiveMenu.status === "draft" ? "Draft records may be permanently removed." : archiveMenu.runId ? "Withdrawal removes this entire forecast run from your working archive while retaining an audit record." : "Withdrawal removes this submission from your working archive while retaining an audit record."}</small><div><button type="button" onClick={() => { setSelectedArchiveId(archiveMenu.id); setArchiveMenuId(null); setActiveSection("verify"); }}>Open</button><button type="button" onClick={() => reviseArchive(archiveMenu)}>Revise</button></div><button type="button" onClick={() => requestArchiveRemoval(archiveMenu)}>{archiveMenu.status === "draft" ? "Delete draft" : archiveMenu.runId ? "Withdraw forecast run" : "Withdraw submission"}</button></div>}
      {pendingArchiveRemoval && <div className="archive-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="archive-confirmation-title"><div><p className="eyebrow">Confirm archive action</p><h2 id="archive-confirmation-title">{pendingArchiveRemoval.status === "draft" ? "Delete this draft?" : "Withdraw this forecast?"}</h2><p>{pendingArchiveRemoval.status === "draft" ? "This draft will be permanently deleted from your archive." : "This forecast will be hidden from your working archive and excluded from grading. Its protected audit record remains available to administrators."}</p><small>{forecastTargetTitle(pendingArchiveRemoval.targetDate)} · V{pendingArchiveRemoval.versionNumber}</small><div><button type="button" onClick={() => setPendingArchiveRemovalId(null)}>Cancel</button><button type="button" className="danger" onClick={() => { if (pendingArchiveRemoval.status === "draft") deleteArchive(pendingArchiveRemoval); else withdrawArchive(pendingArchiveRemoval); setPendingArchiveRemovalId(null); }}>{pendingArchiveRemoval.status === "draft" ? "Delete draft" : "Withdraw forecast"}</button></div></div></div>}
      {activeSection === "control" && hasAcademicReviewAccess && !hasControlAccess && activeWorkspace && <section className="workspace-card"><AcademicReviewDesk workspace={activeWorkspace} roster={academicRoster} onReviewMember={setReviewTarget} message={academicMessage} /></section>}
      {activeSection === "classroom" && session && activeWorkspace?.kind === "classroom" && <section className="workspace-card classroom-workspace"><div className="section-heading"><div><p className="eyebrow">School workspace</p><h2>{activeWorkspace.label}</h2><p>{canManageActiveClassroom ? "Create assignments, review class context, and move into the forecast workspace." : "Your class assignments and forecast work live here."}</p></div><span>{activeWorkspace.role ?? "member"}</span></div><ClassroomAssignmentDesk assignments={classroomAssignments} selectedAssignmentId={selectedClassroomAssignmentId} canManage={canManageActiveClassroom} onCreate={createClassroomAssignment} onOpenForecast={() => setActiveSection("forecast")} onOpenAssignment={openClassroomAssignment} message={assignmentMessage} /></section>}
      {activeSection === "control" && session && hasControlAccess && <section className="workspace-card control-center"><div className="section-heading"><div><p className="eyebrow">Workspace administration</p><h2>Control center</h2><p>Defaults, delivery status, and access controls in one place.</p></div><span>{role === "owner" ? "Owner" : "Admin"}</span></div><div className="control-status-grid"><article><span>Forecasting</span><strong>{defaultForecastDays}-day default</strong><small>New worksheets begin with this horizon.</small></article><article><span>Verification</span><strong>Automated</strong><small>Daily actuals and preliminary scores are scheduled server-side.</small></article><article><span>Archive</span><strong>Auditable</strong><small>Submitted forecasts retain their evidence and revision history.</small></article></div><div className="control-layout"><section className="control-panel"><header><p className="eyebrow">Workspace</p><h3>Defaults</h3><p>Saved on this browser so your desk opens the way you work.</p></header><div className="settings-grid"><label>Default location<select value={defaultLocationId} onChange={(event) => setDefaultLocationId(weatherDeskLocation(event.target.value).id)}>{weatherDeskLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><small>Used when no workspace location has been saved.</small></label><label>New forecast horizon<select value={defaultForecastDays} onChange={(event) => setDefaultForecastDays(Number(event.target.value) as 1 | 3 | 7)}><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option></select><small>A clean worksheet after submission uses this number of days.</small></label><label>Appearance<select value={theme} onChange={(event) => setTheme(event.target.value as "light" | "dark")}><option value="light">Light mode</option><option value="dark">Dark mode</option></select><small>Applies to this browser immediately.</small></label><label>Default map view<select value={radarMapView} onChange={(event) => selectRadarView(event.target.value as RadarMapView)}><option value="composite">Composite reflectivity</option><option value="satellite">GOES-East satellite</option><option value="precipitation_new">Precipitation</option><option value="clouds_new">Cloud cover</option><option value="pressure_new">Pressure</option><option value="wind_new">Wind speed</option><option value="temp_new">Temperature</option><option value="ndfd_maxt">NWS maximum temperature map</option><option value="ndfd_pop12">NWS precipitation chance map</option><option value="ndfd_windspd">NWS wind speed map</option><option value="base">Base map only</option></select><small>Also updates the live dashboard map.</small></label><label>Radar opacity<input type="range" min="20" max="100" value={radarOpacity} onChange={(event) => setRadarOpacity(Number(event.target.value))} /><strong>{radarOpacity}%</strong><small>Applies to weather-map overlays.</small></label><label className="setting-check"><input type="checkbox" checked={showNwsAlerts} onChange={(event) => { setShowNwsAlerts(event.target.checked); window.dispatchEvent(new CustomEvent("weather-desk-alert-overlay", { detail: event.target.checked })); }} /><span><strong>Show NWS alerts</strong><small>Display active watches, warnings, and advisories on the map.</small></span></label></div><div className="settings-actions"><button type="button" onClick={() => { setLocationId(defaultLocationId); setActiveSection("dashboard"); setControlMessage("Opened your default workspace."); }}>Open default workspace</button><button type="button" onClick={() => { setDefaultLocationId(defaultWeatherDeskLocation.id); setDefaultForecastDays(1); selectRadarView("composite"); setRadarOpacity(72); setShowNwsAlerts(true); setTheme("light"); setControlMessage("Desk defaults restored for this browser."); }}>Restore desk defaults</button></div>{controlMessage && <p className="control-message" role="status">{controlMessage}</p>}</section><aside className="control-panel control-delivery"><header><p className="eyebrow">Operations</p><h3>Delivery and data</h3><p>Production services continue even when this local computer is off.</p></header><div className="control-service-list"><div><span>Public workspace</span><strong>Vercel production</strong><small>Independent of your local Terminal.</small></div><div><span>Account archive</span><strong>{supabaseUrl && supabaseKey ? "Supabase configured" : "Configuration missing"}</strong><small>Auth and cloud forecast records are separate from this device.</small></div><div><span>Live weather sources</span><strong>{liveWeather ? "Responding" : "Checking"}</strong><small>NWS, NOAA, and model sources load when a workspace is opened.</small></div><div><span>Local preferences</span><strong>This browser</strong><small>Theme, map defaults, and draft behavior stay device-specific.</small></div></div></aside></div><PeopleDirectory profiles={profiles} onRoleChange={setProfileRole} onProfileSave={saveProfileDetails} message={profileMessage} /></section>}
      {activeSection === "control" && session && hasControlAccess && <section className="workspace-card"><AccessManager organizations={managedOrganizations} classrooms={managedClassrooms} organizationMembers={organizationMembers} classroomMembers={classroomMembers} profiles={profiles} onCreateOrganization={createOrganization} onCreateClassroom={createClassroom} onAddOrganizationMember={addOrganizationMember} onAddClassroomMember={addClassroomMember} onRemoveOrganizationMember={removeOrganizationMember} onRemoveClassroomMember={removeClassroomMember} onReviewMember={setReviewTarget} message={accessMessage} /></section>}
      {activeSection === "control" && hasAcademicReviewAccess && reviewTarget && <section className="workspace-card review-workspace"><div className="section-heading"><div><p className="eyebrow">Scoped review</p><h2>{reviewTarget.label}</h2><p>{reviewTarget.classroomId ? "Classroom forecast records" : "Organization forecast records"} · private records remain visible only to authorized reviewers.</p></div><button type="button" onClick={() => { setReviewTarget(null); setReviewRuns([]); setReviewNotes({}); }}>Close review</button></div>{reviewRuns.length > 0 && <div className="review-run-list">{reviewRuns.map((run) => { const periods = run.forecast_periods; const day = periods.find((period) => period.period === "day"); const night = periods.find((period) => period.period === "night"); const scores = periods.flatMap((period) => period.forecast_verifications.map((verification) => verification.score_data?.automaticScore)).filter((score): score is number => typeof score === "number"); return <button type="button" key={run.id} className={selectedReviewRun?.id === run.id ? "active" : ""} onClick={() => setSelectedReviewRunId(run.id)}><strong>{forecastTargetTitle(day?.valid_date ?? run.created_at.slice(0, 10))}</strong><span>H {displayForecastTemperature(day?.forecast_data.highLow ?? "")} · L {displayForecastTemperature(night?.forecast_data.highLow ?? "")}</span><small>{scores.length ? `Auto ${Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)}%` : "Unscored"} · {run.status}</small></button>; })}</div>}{selectedReviewRun && <div className="review-detail"><div><strong>{selectedReviewRun.location_name ?? "Weather Desk"}</strong><small>Submitted {archiveTitle({ savedAt: selectedReviewRun.created_at })}</small></div><div className="review-forecast-grid">{(["day", "night"] as const).map((periodName) => { const period = selectedReviewRun.forecast_periods.find((candidate) => candidate.period === periodName); const score = period?.forecast_verifications[0]?.score_data?.automaticScore; return <article key={periodName}><span>{periodName}</span><strong>{displayForecastTemperature(period?.forecast_data.highLow ?? "")}</strong><small>{conditionLabel(period?.forecast_data.conditions ?? "")}</small><small>PoP {displayForecastChance(period?.forecast_data.rainChance ?? "")} · {score === undefined || score === null ? "Automatic score pending" : `Automatic score ${score}%`}</small></article>; })}</div><div className="review-note-form"><label>Instructor / reviewer comment<textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="Feedback visible to the review workflow…" /></label><label>Manual score (optional)<input inputMode="numeric" value={reviewManualScore} onChange={(event) => setReviewManualScore(event.target.value)} placeholder="0–100" /></label><button type="button" onClick={() => saveForecastReview(selectedReviewRun.id)}>Save review</button></div><div className="review-notes"><strong>Saved reviews</strong>{(reviewNotes[selectedReviewRun.id] ?? []).map((note) => <article key={note.id}><span>{note.manual_score === null ? "Comment" : `Manual score ${note.manual_score}%`}</span><p>{note.comment || "No written comment."}</p><small>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(note.created_at))}</small></article>)}{!(reviewNotes[selectedReviewRun.id] ?? []).length && <p>No instructor review has been saved yet.</p>}</div></div>}{reviewMessage && <p className="control-message" role="status">{reviewMessage}</p>}</section>}
      {activeSection === "control" && session && hasControlAccess && <section className="workspace-card source-status-card"><div className="section-heading"><div><h2>Data-source status</h2><p>What is powering the current workspace, and what still needs a provider connection.</p></div><span>Operations</span></div><div><article><strong>NWS observations, alerts, forecast maps</strong><span>Connected</span><small>Official observations, warnings, upper-air source links, and NDFD map fields.</small></article><article><strong>Open-Meteo model and ensemble guidance</strong><span>Connected</span><small>Point guidance, archived HRRR/GFS profiles, and ensemble ranges.</small></article><article><strong>OpenWeather surface-map fields</strong><span>Connected</span><small>Precipitation, cloud, pressure, wind, and temperature overlays.</small></article><article><strong>Level-II radar products</strong><span className="pending">Provider needed</span><small>Velocity, correlation coefficient, and quantitative rainfall require a separate Level-II data pipeline.</small></article></div></section>}
      {activeSection === "control" && session && hasControlAccess && <section className="workspace-card launch-security-card"><div className="section-heading"><div><h2>Launch and security</h2><p>Current safeguards and the few account-level actions that remain outside the app.</p></div><span>Pre-launch</span></div><div className="security-status-grid"><article><span>Search indexing</span><strong>Blocked</strong><small>This deployment sends no-index metadata and disallows crawlers until launch.</small></article><article><span>Browser safeguards</span><strong>Active</strong><small>Framing, MIME sniffing, browser permissions, and referrer exposure are restricted.</small></article><article><span>Secrets</span><strong>Server-only</strong><small>OpenWeather tiles and automated-verification credentials are kept in server environment variables.</small></article><article><span>Production access</span><strong>Account setting</strong><small>Vercel Hobby cannot lock the production URL; enable deployment protection before sharing broadly.</small></article></div><p className="security-note">Before launch: rotate exposed API keys, enable registrar 2FA and domain lock, then enable Vercel deployment protection or move to a protected production plan.</p></section>}

      {activeSection === "verify" && session && selectedArchive && <section className="workspace-card record-notes-card"><ForecasterNotes archive={selectedArchive} /><div className="record-actions"><div><strong>Archive actions</strong><small>Revisions create a new auditable forecast. Removing a submitted forecast withdraws it from your working archive while retaining its protected history.</small></div><div><button type="button" onClick={() => reviseArchive(selectedArchive)}>Revise forecast</button><button type="button" className="danger" onClick={() => requestArchiveRemoval(selectedArchive)}>{selectedArchive.status === "draft" ? "Delete draft" : "Withdraw forecast"}</button></div></div></section>}
    </main>
  );
}
