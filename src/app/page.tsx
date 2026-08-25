"use client";

import { Component, useEffect, useState, type ErrorInfo, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { defaultWeatherDeskLocation, weatherDeskLocation, weatherDeskLocations, type WeatherDeskLocation } from "@/lib/locations";
import { automaticForecastScore, type ForecastPeriodActual } from "@/lib/forecast-verification";
import { hasModelDataAccess, type PersonalTier } from "@/lib/access";
import type { RadarFrameMeta } from "./radar-map";

const RadarMap = dynamic(() => import("./radar-map"), {
  ssr: false,
  loading: () => <div className="radar-loading">Loading live radar…</div>,
});

type DataPanel = "nbm" | "afd" | "mcd" | "alerts" | "sounding" | "models" | "model-radar" | "ensembles" | "model-sounding";
type GuidanceGroup = "high-res" | "global";
type RadarMapView = "composite" | "velocity" | "future_reflectivity" | "satellite";
type RadarLegend = { title: string; left: string; middle: string; right: string; unit: string; gradient: string };
type OpenMeteoModel = "best_match" | "hrrr_conus" | "nbm_conus" | "nam_conus" | "gfs_global" | "ecmwf_ifs" | "icon_global" | "gem_global";
type WorkspaceSection = "dashboard" | "radar" | "about" | "forecast" | "practice" | "verify" | "school" | "classroom" | "control";
type PublicNavigationItem = { id: string; label: string; target: "weather" | "radar" | "about" | "login"; access: "public" | "member" | "staff" | "owner"; enabled: boolean };
type WorkspaceNavigationItem = { id: "weather" | "radar" | "about" | "forecast" | "verify" | "control"; label: string; access: "public" | "member" | "staff" | "owner"; enabled: boolean };
type HomepageContent = { title: string; description: string; primaryAction: string; secondaryAction: string; outlookTitle: string; outlookCaption: string; radarTitle: string; radarCaption: string; referenceTitle: string; referenceCaption: string; showOutlook: boolean; showRadar: boolean; showReferences: boolean };
type AboutContent = { eyebrow: string; title: string; description: string; principles: { title: string; body: string }[] };
type ClassroomHubTab = "assignments" | "outlook" | "progress" | "roster";
type ClassroomRosterMember = { userId: string; label: string; email: string | null; status: "active" | "invited" | "suspended"; enrolledAt: string };
type LiveWeather = {
  location: string;
  observation: { station: string; stationName: string; observedAt: string; description: string; temperatureF: number | null; temperatureSource: "observation" | "forecast estimate"; dewpointF: number | null; windMph: number | null; windDirection: string | null };
  forecast: { period: string; temperature: number; temperatureUnit: string; shortForecast: string; detailedForecast: string; precipitationChance: number | null } | null;
  forecastPeriods: { name: string; startTime: string; temperature: number; temperatureUnit: string; shortForecast: string; precipitationChance: number | null; icon: string | null; windSpeed: string | null; windDirection: string | null }[];
  alerts: { event: string; headline: string | null; severity: string; expires: string | null; effective: string | null; description: string | null; instruction: string | null; areaDesc: string | null; senderName: string | null }[];
  alertsAvailable: boolean;
  fetchedAt: string;
};
// `source`/`inHouseTime` are only ever set for the observed-radar timeline (never the HRRR
// future-radar one, which reuses this same type) — see /api/radar/frames. Absent means "provider
// tile only," identical to this type's original shape.
type RadarTimelineFrame = { time: number; tileUrl: string; source?: "provider" | "nexrad"; inHouseTime?: string };
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
  parentRunId?: string | null;
  authorId?: string;
  assignmentId?: string | null;
  scenarioId?: string | null;
  periodIds?: { day?: string; night?: string };
  locationId?: string;
  locationName?: string;
  savedAt: string;
  label: string;
  targetDate: string;
  status: "draft" | "submitted" | "revised" | "verified" | "withdrawn";
  versionNumber: number;
  day: { high: string; conditions: string; rainChance: string; timing: string; hazards: string; wind?: string; reasoning?: string; references?: ReferenceItem[]; iconCondition?: string };
  night: { low: string; conditions: string; rainChance: string; timing: string; hazards: string; wind?: string; reasoning?: string; references?: ReferenceItem[]; iconCondition?: string };
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
type PeriodDraft = { highLow: string; conditions: string; rainChance: string; timing: string; wind: string; confidence: string; hazards: string; reasoning: string; references: ReferenceItem[]; iconCondition: string };
type ForecastDayDraft = { date: string; day: PeriodDraft; night: PeriodDraft; ready: boolean };
type ForecastRunDraft = { id: string; days: ForecastDayDraft[]; initialHorizonDays: number };
type CloudRunRow = { id: string; user_id: string; parent_run_id?: string | null; scenario_id?: string | null; assignment_id?: string | null; created_at: string; status: string; location_name?: string | null; forecast_periods: { id: string; valid_date: string; period: "day" | "night"; forecast_data: PeriodDraft; evidence_snapshot: SavedForecast["evidence"]; forecast_verifications?: { observed_data: ActualPeriod; score_data: { automaticScore?: number | null } }[] }[] };
type ActualPeriod = ForecastPeriodActual;
type AutomaticVerification = { station: string; fetchedAt: string; day: ActualPeriod; night: ActualPeriod; dayScore: number | null; nightScore: number | null };
type VerificationRow = { forecast_period_id: string; observed_data: ActualPeriod; score_data: { automaticScore?: number | null } | null };
type WorkspaceRole = "owner" | "admin" | "instructor" | "reviewer" | "forecaster" | "student" | "member";
type WeatherIconStyle = "traditional" | "minimal";
type Profile = { id: string; email: string | null; role: WorkspaceRole; display_name: string | null; person_type: "employee" | "student" | "instructor" | "other" | null; employee_id: string | null; student_id: string | null; title: string | null; weather_icon_style: WeatherIconStyle | null; personal_tier: PersonalTier };
type WorkspaceContext = { key: string; kind: "personal" | "all" | "organization" | "classroom"; label: string; detail: string; organizationId?: string; classroomId?: string; role?: string; active?: boolean; classroomStatus?: "active" | "closed" | "archived" };
type OrganizationMembershipRow = { organization_id: string; role: string; organizations: { id: string; name: string; kind: string } | null };
type ClassroomMembershipRow = { classroom_id: string; role: string; status?: "active" | "invited" | "suspended"; classrooms: { id: string; name: string; term: string | null; organization_id: string; status?: "active" | "closed" | "archived"; organizations: { name: string } | null } | null };
type OrganizationRow = { id: string; name: string; kind: string };
type OrganizationBranding = { organization_id: string; school_name: string | null; logo_path: string | null; logo_alt: string | null };
type ClassroomRow = { id: string; name: string; term: string | null; organization_id: string; status?: "active" | "closed" | "archived"; organizations: { name: string } | null };
type OrganizationWorkspace = { id: string; name: string; kind: "company" | "school" | "personal" };
type ClassroomWorkspace = { id: string; name: string; term: string | null; organization_id: string };
type OrganizationMember = { id: string; organization_id: string; user_id: string; role: WorkspaceRole; status: "active" | "invited" | "suspended"; profiles: Pick<Profile, "id" | "email" | "display_name" | "person_type"> | null };
type ClassroomMember = { id: string; classroom_id: string; user_id: string; role: "instructor" | "student" | "assistant"; status: "active" | "invited" | "suspended"; profiles: Pick<Profile, "id" | "email" | "display_name" | "person_type"> | null };
type ClassroomJoinCode = { id: string; classroom_id: string; label: string | null; code_hint: string; active: boolean; expires_at: string | null; max_uses: number | null; use_count: number; created_at: string };
type ReviewTarget = { userId: string; label: string; organizationId: string; classroomId?: string; assignmentId?: string };
type AcademicRosterMember = ReviewTarget & { role: string; email: string | null; personType: Profile["person_type"] };
type InstructorForecastSnapshot = { saved_at: string; location_name: string; days: ForecastDayDraft[] };
type ClassForecastDay = { date: string; submitted_count: number; day: { high_f: number | null; pop: number | null; conditions: string[]; wind: string[] }; night: { low_f: number | null; pop: number | null; conditions: string[]; wind: string[] } };
type ClassForecastSnapshot = { generated_at: string; target_date: string; submitted_count: number; total_students: number; day: { high_f: number | null; pop: number | null; conditions: string[]; wind: string[] }; night: { low_f: number | null; pop: number | null; conditions: string[]; wind: string[] }; days?: ClassForecastDay[] };
type ClassroomOfficialForecast = { classroom_id: string; forecast: ClassForecastSnapshot; updated_by: string; updated_at: string; published_at: string | null };
type ClassroomAssignment = { id: string; classroom_id: string; title: string; instructions: string | null; target_date: string; target_dates?: string[]; scenario_id?: string | null; scenario?: { title: string; summary: string | null; reference_notes: string | null; reference_links: ScenarioReferenceLink[] } | null; due_at: string | null; status: "draft" | "open" | "closed" | "archived"; instructor_forecast: InstructorForecastSnapshot | null; instructor_forecast_updated_at: string | null; class_forecast: ClassForecastSnapshot | null; class_forecast_updated_at: string | null; class_forecast_published_at: string | null; created_at: string };
type ClassroomAssignmentSubmission = { id: string; user_id: string; created_at: string; status: string; assignment_id: string; forecast_periods: { valid_date: string; period: "day" | "night"; forecast_data: PeriodDraft; forecast_verifications: { score_data: { automaticScore?: number | null } | null }[] }[]; forecast_reviews?: ForecastReview[] };
type ReviewRun = { id: string; user_id: string; created_at: string; status: string; location_name: string | null; assignment_id: string | null; forecast_periods: { id: string; valid_date: string; period: "day" | "night"; forecast_data: PeriodDraft; forecast_verifications: { score_data: { automaticScore?: number | null } | null }[] }[] };
type ReviewRubric = { accuracy?: number | null; reasoning?: number | null; communication?: number | null };
type ForecastReview = { id: string; run_id: string; reviewer_id: string; comment: string | null; manual_score: number | null; rubric_scores?: ReviewRubric | null; created_at: string };
// Assignments are deliberately independent of forecast_runs/forecast_reviews
// -- their own reference material, their own lightweight per-day guess
// submission, their own review table. See supabase/migrations/20260823030000.
type AssignmentReferenceKind = "link" | "observation" | "model";
type AssignmentReferenceItem = { id: string; assignment_id: string; classroom_id: string; kind: AssignmentReferenceKind; label: string; url: string | null; detail: Record<string, unknown> | null; created_by: string; created_at: string };
// Mirrors PeriodDraft (the real Forecast page's day/night shape) minus `references` --
// assignments get the same field richness as a real forecast, just never touching
// forecast_runs or automatic verification.
type AssignmentPeriodResponse = { highLow: string; conditions: string; iconCondition: string; rainChance: string; timing: string; wind: string; confidence: string; hazards: string; reasoning: string };
type AssignmentDayResponse = { day: AssignmentPeriodResponse; night: AssignmentPeriodResponse };
type AssignmentSubmission = { id: string; assignment_id: string; classroom_id: string; student_id: string; responses: Record<string, AssignmentDayResponse>; status: "draft" | "submitted"; submitted_at: string | null; created_at: string; updated_at: string };
type AssignmentReview = { id: string; submission_id: string; reviewer_id: string; comment: string | null; manual_score: number | null; created_at: string; updated_at: string };
type AppNotification = { id: string; user_id: string; kind: string; payload: { assignment_id?: string; classroom_id?: string; title?: string; run_id?: string; target_date?: string; day_score?: number; night_score?: number; manual_score?: number | null }; read_at: string | null; created_at: string };
const emptyAssignmentPeriodResponse: AssignmentPeriodResponse = { highLow: "", conditions: "", iconCondition: "", rainChance: "", timing: "", wind: "", confidence: "", hazards: "", reasoning: "" };
const emptyAssignmentDayResponse: AssignmentDayResponse = { day: emptyAssignmentPeriodResponse, night: emptyAssignmentPeriodResponse };
// "auto" is the smart default: in-house NEXRAD first (live and, once the worker's retained-frame
// buffer covers it, past frames too), falling back to the IEM mosaic only when in-house data isn't
// available. "iem" is a deliberate override — like tuning to a specific channel — that skips the
// in-house attempt entirely for BOTH live and past frames, always showing the same provider mosaic
// regardless of what's in-house-available at that moment. Kept in WorkspacePreferences alongside
// the other radar-specific settings (radarOpacity, showNwsAlerts, ...) rather than the theme
// toggle's own separate cross-subdomain-cookie mechanism, since this is radar-only, not shared
// with company-hq or any other subdomain.
type RadarProviderPreference = "auto" | "iem";
type WorkspacePreferences = { defaultLocationId: string; radarMapView: RadarMapView; radarOpacity: number; showNwsAlerts: boolean; showSpcOutlook: boolean; outlookDay?: 1 | 2; showSevereMarkers: boolean; radarProviderPreference: RadarProviderPreference; defaultForecastDays: 1 | 3 | 7 };
type ScenarioReferenceLink = { label: string; detail: string; url: string | null };
type Scenario = { id: string; slug: string; title: string; category: string | null; summary: string | null; event_date: string; target_dates: string[] | null; location_id: string; reference_notes: string | null; reference_links: ScenarioReferenceLink[] };

class ClassroomPanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  render() {
    if (this.state.failed) return <section className="classroom-panel-fallback"><p className="eyebrow">Classroom overview</p><h3>That panel could not load</h3><p>Your forecasts and classroom records are still safe. Return to Today or retry the overview after the current class data finishes loading.</p><button type="button" onClick={() => this.setState({ failed: false })}>Retry overview</button></section>;
    return this.props.children;
  }
}

const radarSourceLabels: Record<"nexrad" | "provider", string> = {
  nexrad: "NEXRAD Level II (in-house)",
  provider: "NWS/NEXRAD (IEM)",
};
// Scoped per signed-in user id -- a flat, unscoped key here would leak one
// person's drafts and submitted-forecast cache to the next person signed in
// on the same browser, which is a real scenario on a shared school computer.
const archiveStorageKeyFor = (userId: string) => `weather-desk-forecast-archives:${userId}`;
const forecastDraftStorageKeyFor = (userId: string) => `weather-desk-active-forecast-draft:${userId}`;
const sessionStorageKey = "weather-desk-supabase-session";
const locationStorageKey = "weather-desk-location";
const customLocationStorageKey = "weather-desk-custom-location";

const assignmentDates = (assignment: ClassroomAssignment) => assignment.target_dates?.length ? assignment.target_dates : [assignment.target_date];
const themeStorageKey = "weather-desk-theme";
const themeCookieKey = "frontline-forecast-theme";

const readSharedTheme = () => document.cookie
  .split("; ")
  .find((value) => value.startsWith(`${themeCookieKey}=`))
  ?.split("=")[1];

const writeSharedTheme = (theme: "light" | "dark") => {
  document.cookie = `${themeCookieKey}=${theme}; Path=/; Domain=.frontline-forecast.com; Max-Age=31536000; SameSite=Lax; Secure`;
};

const schoolLogoUrl = (url: string, path: string) => `${url}/storage/v1/object/public/organization-branding/${path.split("/").map(encodeURIComponent).join("/")}`;

const defaultPublicNavigation: PublicNavigationItem[] = [
  { id: "weather", label: "Home", target: "weather", access: "public", enabled: true },
  { id: "radar", label: "Radar", target: "radar", access: "public", enabled: true },
  { id: "about", label: "About", target: "about", access: "public", enabled: true },
];
const defaultWorkspaceNavigation: WorkspaceNavigationItem[] = [
  { id: "weather", label: "Home", access: "public", enabled: true },
  { id: "radar", label: "Radar", access: "public", enabled: true },
  { id: "about", label: "About", access: "public", enabled: true },
  { id: "forecast", label: "Forecast", access: "member", enabled: true },
  { id: "verify", label: "Verify", access: "member", enabled: true },
  { id: "control", label: "Settings", access: "member", enabled: true },
];
const defaultHomepageContent: HomepageContent = { title: "Forecast with evidence.", description: "Use live observations, radar, guidance, and verification to make better weather decisions.", primaryAction: "View local weather", secondaryAction: "Sign in to forecast", outlookTitle: "7-day outlook", outlookCaption: "Local forecast guidance", radarTitle: "Radar", radarCaption: "Live composite reflectivity", referenceTitle: "Forecast data", referenceCaption: "Reference data for your next forecast.", showOutlook: true, showRadar: true, showReferences: true };
const defaultAboutContent: AboutContent = { eyebrow: "About Frontline Forecast", title: "Weather tools built around context.", description: "Frontline Forecast brings observations, radar, guidance, and verification together so a forecast can show its reasoning—not just its result.", principles: [{ title: "Read the atmosphere", body: "Start with what is happening now, then make the evidence visible." }, { title: "Make the forecast useful", body: "Turn guidance into a clear, time-bound decision for a real place." }, { title: "Learn from the result", body: "Compare the forecast with what happened and keep improving the next call." }] };

function publishedNavigation(value: unknown): PublicNavigationItem[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) return defaultPublicNavigation;
  const validTargets = new Set(["weather", "radar", "about", "login"]);
  const validAccess = new Set(["public", "member", "staff", "owner"]);
  const items = (value as { items: unknown[] }).items.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const fallback = defaultPublicNavigation[index] ?? defaultPublicNavigation[0];
    const rawTarget = typeof record.target === "string" ? record.target === "learn" ? "about" : record.target : typeof record.id === "string" && record.id === "learn" ? "about" : record.id;
    const target = typeof rawTarget === "string" && validTargets.has(rawTarget) ? rawTarget : fallback.target;
    return [{ id: typeof record.id === "string" ? record.id : `tab-${index}`, label: typeof record.label === "string" ? record.label : fallback.label, target, access: typeof record.access === "string" && validAccess.has(record.access) ? record.access : "public", enabled: record.enabled !== false } as PublicNavigationItem];
  });
  return items.length ? items : defaultPublicNavigation;
}
function publishedWorkspaceNavigation(value: unknown): WorkspaceNavigationItem[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) return defaultWorkspaceNavigation;
  const items = (value as { items: unknown[] }).items.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const fallback = defaultWorkspaceNavigation.find((candidate) => candidate.id === record.id);
    if (!fallback) return [];
    const access = typeof record.access === "string" && ["public", "member", "staff", "owner"].includes(record.access) ? record.access as WorkspaceNavigationItem["access"] : fallback.access;
    return [{ ...fallback, label: typeof record.label === "string" ? record.label : fallback.label, access, enabled: record.enabled !== false }];
  });
  return defaultWorkspaceNavigation.map((fallback) => items.find((item) => item.id === fallback.id) ?? fallback);
}
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

function initialsFor(displayName: string | null | undefined, email: string | null | undefined) {
  const firstLetter = (word: string) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "";
  const name = (displayName ?? "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const initials = `${firstLetter(parts[0])}${firstLetter(parts[parts.length - 1])}`.toUpperCase();
      if (initials.length === 2) return initials;
    }
    if (parts.length >= 1) {
      const letters = parts.flatMap((part) => part.match(/[\p{L}\p{N}]/gu) ?? []).slice(0, 2).join("");
      if (letters) return letters.toUpperCase();
    }
  }
  const local = (email ?? "").split("@")[0];
  return local ? local.slice(0, 2).toUpperCase() : "?";
}
function workspaceDeskLabel(workspace: WorkspaceContext | undefined) {
  if (!workspace || workspace.kind === "personal") return "Personal Desk";
  if (workspace.kind === "all") return "Frontline Forecast";
  return /desk$/i.test(workspace.label) ? workspace.label : `${workspace.label} Desk`;
}

function validForecastDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function fallbackForecastDate(value: unknown) {
  return validForecastDate(value) ? value : addDays(new Date(), 0);
}

function emptyPeriod(period: "day" | "night"): PeriodDraft {
  return { highLow: "", conditions: "", rainChance: "", timing: "", wind: "", confidence: "moderate", hazards: "", reasoning: "", references: [], iconCondition: "" };
}

// The 7 icon files that actually exist under /public/weather-icons/{style}/ --
// same set weatherIconCondition() below already derives from live NWS text.
const iconConditionKeys = ["clear", "partly-cloudy", "cloudy", "rain", "snow", "fog", "thunderstorm"] as const;
const iconConditionLabels: Record<(typeof iconConditionKeys)[number], string> = { clear: "Clear", "partly-cloudy": "Partly cloudy", cloudy: "Cloudy", rain: "Rain", snow: "Snow", fog: "Fog", thunderstorm: "Thunderstorm" };
// Sensible default icon for each of the 19 structured Conditions options, so
// the picker starts on a reasonable suggestion -- overridden the moment a
// student actually clicks a different icon (see PeriodDraft.iconCondition).
const conditionKeyToIcon: Record<string, (typeof iconConditionKeys)[number]> = {
  clear: "clear", "mostly-sunny": "clear", "partly-cloudy": "partly-cloudy", "mostly-cloudy": "cloudy", cloudy: "cloudy",
  haze: "fog", fog: "fog", drizzle: "rain", showers: "rain", rain: "rain",
  storms: "thunderstorm", "isolated-storms": "thunderstorm", "scattered-storms": "thunderstorm", "severe-storms": "thunderstorm",
  windy: "clear", "hot-humid": "clear", snow: "snow", sleet: "snow", "wintry-mix": "snow", "freezing-rain": "snow",
};
function periodIconCondition(period: { conditions: string; iconCondition?: string } | undefined | null): (typeof iconConditionKeys)[number] {
  if (period?.iconCondition && (iconConditionKeys as readonly string[]).includes(period.iconCondition)) return period.iconCondition as (typeof iconConditionKeys)[number];
  return conditionKeyToIcon[period?.conditions ?? ""] ?? "clear";
}
function IconPicker({ value, onChange, style }: { value: string; onChange: (next: string) => void; style: WeatherIconStyle }) {
  return <div className="icon-picker" role="radiogroup" aria-label="Choose an icon">{iconConditionKeys.map((key) => <button type="button" key={key} role="radio" aria-checked={value === key} className={value === key ? "active" : ""} title={iconConditionLabels[key]} onClick={() => onChange(key)}><img className="forecast-condition-icon" src={`/weather-icons/${style}/${key}.svg`} alt={iconConditionLabels[key]} /></button>)}</div>;
}

// Caps the quick-add row at 3 chips (current obs, current forecast, NBM --
// the ones worth one click every time) and tucks the rest of the reference
// catalog behind a "more" toggle instead of showing all 8 at once.
function ReferencePicker({ options, references, onAdd, onRemove, addedLabel, recommendedIds = [] }: { options: ReferenceItem[]; references: ReferenceItem[]; onAdd: (item: ReferenceItem) => void; onRemove: (id: string) => void; addedLabel: string; recommendedIds?: string[] }) {
  const [expanded, setExpanded] = useState(false);
  // Quick-add isn't meant to be a full catalog -- it's a shortcut for whatever the student
  // already reached for on the previous day of this same draft, so the habit carries forward
  // without re-browsing. Falls back to a fixed default set on day one, or if the prior day
  // attached nothing.
  const recommended = recommendedIds.map((id) => options.find((option) => option.id === id)).filter((item): item is ReferenceItem => Boolean(item));
  const remainingOptions = options.filter((option) => !recommendedIds.includes(option.id));
  const primary = recommended.length ? recommended : remainingOptions.slice(0, 3);
  const rest = recommended.length ? remainingOptions : remainingOptions.slice(3);
  return <div className="wide-field reference-picker">
    <span>{recommended.length ? "Suggested, based on your last day" : "Quick-add current reference data"}</span>
    <div>{primary.map((item) => <button type="button" key={item.id} onClick={() => onAdd(item)}>+ {item.label}</button>)}{rest.length > 0 && <button type="button" className="reference-picker-more" onClick={() => setExpanded((open) => !open)}>{expanded ? "Fewer references" : `+ ${rest.length} more`}</button>}</div>
    {expanded && rest.length > 0 && <div>{rest.map((item) => <button type="button" key={item.id} onClick={() => onAdd(item)}>+ {item.label}</button>)}</div>}
    {references.length > 0 && <div className="attached-draft-references"><strong>{addedLabel}</strong><div className="attached-reference-table"><div className="attached-reference-heading"><span>Reference</span><span>Snapshot</span><span>Action</span></div>{references.map((reference) => <div className="attached-reference-row" key={reference.id}><b>{reference.label}</b><small>{reference.detail.split("\n")[0]}</small><button type="button" onClick={() => onRemove(reference.id)}>Remove</button></div>)}</div></div>}
    <small>Each quick-add captures a new current snapshot; previous snapshots stay only in this list.</small>
  </div>;
}

function createForecastDay(date: string): ForecastDayDraft { return { date, day: emptyPeriod("day"), night: emptyPeriod("night"), ready: false }; }

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

function weatherIconCondition(description: string) {
  const text = description.toLowerCase();
  if (text.includes("thunder")) return "thunderstorm";
  if (text.includes("snow") || text.includes("sleet")) return "snow";
  if (text.includes("fog") || text.includes("haze") || text.includes("smoke")) return "fog";
  if (text.includes("rain") || text.includes("shower") || text.includes("drizzle")) return "rain";
  if (text.includes("partly") || text.includes("mostly sunny") || text.includes("mostly clear")) return "partly-cloudy";
  if (text.includes("cloud") || text.includes("overcast")) return "cloudy";
  return "clear";
}

function WeatherIcon({ description, style }: { description: string; style: WeatherIconStyle }) {
  return <img className="forecast-condition-icon" src={`/weather-icons/${style}/${weatherIconCondition(description)}.svg`} alt="" />;
}

function alertTone(severity: string) {
  const normalized = severity.toLowerCase();
  if (normalized === "extreme" || normalized === "severe") return "urgent";
  if (normalized === "moderate") return "warning";
  return "advisory";
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
  composite: { title: "Base reflectivity", left: "0", middle: "35", right: "70+", unit: "dBZ", gradient: "linear-gradient(90deg,#00ecec 0 6.67%,#01a0f6 6.67% 13.33%,#0000f6 13.33% 20%,#00ff00 20% 26.67%,#00c800 26.67% 33.33%,#009000 33.33% 40%,#ffff00 40% 46.67%,#e7c000 46.67% 53.33%,#ff9000 53.33% 60%,#ff0000 60% 66.67%,#d60000 66.67% 73.33%,#c00000 73.33% 80%,#ff00ff 80% 86.67%,#9955c9 86.67% 93.33%,#ffffff 93.33% 100%)" },
  velocity: { title: "Base velocity", left: "-30", middle: "0", right: "+30", unit: "m/s · in-house NEXRAD only", gradient: "linear-gradient(90deg,#00441b 0 12%,#00823c 12% 25%,#5abf6e 25% 37%,#c7e9c0 37% 47%,#fdd0c2 53% 63%,#ef6548 63% 75%,#ba1621 75% 88%,#67000d 88% 100%)" },
  future_reflectivity: { title: "HRRR simulated reflectivity", left: "0", middle: "35", right: "70+", unit: "dBZ · forecast", gradient: "linear-gradient(90deg,#6fb7ff 0 7%,#3bd8e9 7% 14%,#35ca8a 14% 22%,#36b84d 22% 30%,#a9d337 30% 38%,#efe23a 38% 46%,#ffbf25 46% 54%,#ff8027 54% 62%,#ec3e32 62% 70%,#be1f57 70% 78%,#9b2678 78% 86%,#dbdce5 86% 100%)" },
  satellite: null,
};

const radarLegendBands: Record<Exclude<RadarMapView, "satellite">, { label: string; description: string }[]> = {
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
  velocity: [
    { label: "-30 to -10", description: "Strong motion toward the radar (green)." },
    { label: "-10 to -2", description: "Light motion toward the radar." },
    { label: "-2 to +2", description: "Near-zero radial motion, or too weak to color." },
    { label: "+2 to +10", description: "Light motion away from the radar." },
    { label: "+10 to +30", description: "Strong motion away from the radar (red). Tight red/green couplets close together can indicate rotation." },
  ],
  future_reflectivity: [
    { label: "0–10", description: "Very light simulated reflectivity: light echoes." },
    { label: "10–20", description: "Light simulated precipitation." },
    { label: "20–30", description: "Steady light to moderate simulated rain." },
    { label: "30–40", description: "Moderate simulated rain; heavier showers may be developing." },
    { label: "40–50", description: "Heavy simulated rain and stronger convective cores." },
    { label: "50–60", description: "Very heavy simulated rain; thunderstorms likely." },
    { label: "60–70", description: "Severe-intensity simulated core; hail is possible." },
    { label: "70+", description: "Extreme simulated reflectivity — model output, not observed." },
  ],
};

// `inline` keeps this in normal document flow below the map (doesn't cover any of the radar
// image) while still using the dark RadarScope-matched palette — verify-overrides.css's base
// `.radar-legend` rule is a dark translucent overlay by default (position:absolute, meant to sit
// on top of the map); the `radar-legend-inline` class overrides just the positioning back to
// static, not the color/border treatment, so the look stays consistent whether it's floating on
// the map or sitting below it. `elevationDeg`/`observedAtLabel` are only ever populated for the
// in-house NEXRAD path (RadarMap's onFrameMeta callback); a null/undefined value from either just
// omits that readout.
function RadarLegendStrip({ view, inline = false, elevationDeg = null, observedAtLabel = null }: { view: RadarMapView; inline?: boolean; elevationDeg?: number | null; observedAtLabel?: string | null }) {
  const legend = radarLegends[view];
  const [hoveredBand, setHoveredBand] = useState<{ label: string; description: string } | null>(null);
  const className = inline ? "radar-legend radar-legend-inline" : "radar-legend";
  const metaText = [elevationDeg != null ? `${elevationDeg.toFixed(1)}°` : null, observedAtLabel].filter(Boolean).join(" · ");
  const meta = metaText ? <small className="radar-legend-meta">{metaText}</small> : null;
  if (view === "satellite") return <div className={className}><span className="radar-source-note">GOES-East GeoColor · visible daytime / infrared nighttime · refreshes about every 10 min</span></div>;
  if (!legend) return <div className={className}><span className="radar-source-note">Base map · pan and zoom to explore</span></div>;
  const bands = radarLegendBands[view];
  return <div className={className} aria-label={`${legend.title} color scale`}><span>{legend.title}</span>{meta}<div className="radar-legend-scale"><i style={{ background: legend.gradient }} />{bands.map((band) => <button type="button" key={band.label} aria-label={`${band.label}: ${band.description}`} onBlur={() => setHoveredBand(null)} onFocus={() => setHoveredBand(band)} onMouseLeave={() => setHoveredBand(null)} onMouseEnter={() => setHoveredBand(band)} />)}</div><div><small>{legend.left}</small><small>{legend.middle}</small><small>{legend.right}</small></div><em>{hoveredBand ? `${hoveredBand.label} · ${hoveredBand.description}` : `${legend.unit} · Hover a color band for guidance`}</em></div>;
}

// Consolidates the radar product picker + overlay toggles + opacity slider into a single on-map
// floating menu (RadarScope keeps its controls as a compact affordance over the map, not external
// buttons/checkboxes above it). Reuses the exact state/handlers the caller already owns — no new
// state logic lives here. `showOutlookToggle`/`showSpcOutlook`/`onToggleOutlook` are only wired by
// the full Radar workspace section; the dashboard card omits them (it never wired an outlook layer).
function RadarControlsMenu({
  radarMapView, onSelectView, reflectivityLabel = "Reflectivity",
  radarProviderPreference, onProviderPreferenceChange,
  showNwsAlerts, onToggleAlerts,
  showOutlookToggle = false, showSpcOutlook = false, onToggleOutlook, outlookDay = 1, onOutlookDayChange,
  showSevereMarkers, onToggleSevereMarkers,
  showStationPicker, onToggleStationPicker,
  radarOpacity, onOpacityChange,
  caption,
}: {
  radarMapView: RadarMapView;
  onSelectView: (view: RadarMapView) => void;
  reflectivityLabel?: string;
  radarProviderPreference: RadarProviderPreference;
  onProviderPreferenceChange: (value: RadarProviderPreference) => void;
  showNwsAlerts: boolean;
  onToggleAlerts: (value: boolean) => void;
  showOutlookToggle?: boolean;
  showSpcOutlook?: boolean;
  onToggleOutlook?: (value: boolean) => void;
  outlookDay?: 1 | 2;
  onOutlookDayChange?: (value: 1 | 2) => void;
  showSevereMarkers: boolean;
  onToggleSevereMarkers: (value: boolean) => void;
  showStationPicker: boolean;
  onToggleStationPicker: (value: boolean) => void;
  radarOpacity: number;
  onOpacityChange: (value: number) => void;
  caption: string;
}) {
  return <details className="radar-tools"><summary aria-label="Open radar controls">☰</summary><div><div className="radar-product-picker"><span>Data layer</span><div><button type="button" className={radarMapView === "composite" ? "active" : ""} onClick={() => onSelectView("composite")}>{reflectivityLabel}</button><button type="button" className={radarMapView === "velocity" ? "active" : ""} onClick={() => onSelectView("velocity")}>Velocity</button><button type="button" className={radarMapView === "satellite" ? "active" : ""} onClick={() => onSelectView("satellite")}>Satellite</button></div></div>{radarMapView !== "satellite" && <><div className="radar-product-picker"><span>Radar source</span><div><button type="button" className={radarProviderPreference === "auto" ? "active" : ""} onClick={() => onProviderPreferenceChange("auto")}>In-house (best)</button><button type="button" className={radarProviderPreference === "iem" ? "active" : ""} onClick={() => onProviderPreferenceChange("iem")}>IEM mosaic</button></div></div><label className="alert-overlay-toggle"><input type="checkbox" checked={showNwsAlerts} onChange={(event) => { onToggleAlerts(event.target.checked); event.currentTarget.closest("details")?.removeAttribute("open"); }} /> NWS watches &amp; warnings</label>{showOutlookToggle && <><label className="alert-overlay-toggle"><input type="checkbox" checked={showSpcOutlook} onChange={(event) => { onToggleOutlook?.(event.target.checked); event.currentTarget.closest("details")?.removeAttribute("open"); }} /> SPC convective outlook</label>{showSpcOutlook && <div className="radar-field-picker outlook-day-picker"><button type="button" className={outlookDay === 1 ? "active" : ""} onClick={() => onOutlookDayChange?.(1)}>Day 1</button><button type="button" className={outlookDay === 2 ? "active" : ""} onClick={() => onOutlookDayChange?.(2)}>Day 2</button></div>}</>}<label className="alert-overlay-toggle"><input type="checkbox" checked={showSevereMarkers} onChange={(event) => { onToggleSevereMarkers(event.target.checked); event.currentTarget.closest("details")?.removeAttribute("open"); }} /> Storm tracks &amp; severe markers</label><label className="alert-overlay-toggle"><input type="checkbox" checked={showStationPicker} onChange={(event) => { onToggleStationPicker(event.target.checked); event.currentTarget.closest("details")?.removeAttribute("open"); }} /> Show radar stations</label><label>Opacity <input type="range" min="20" max="100" value={radarOpacity} onChange={(event) => onOpacityChange(Number(event.target.value))} /> <span>{radarOpacity}%</span></label></>}<small>{caption}</small></div></details>;
}

function ModelAccessUpsell({ label, onOpenAccount }: { label: string; onOpenAccount: () => void }) {
  return <section className="model-access-upsell"><p className="eyebrow">Personal+</p><h3>{label} is a Personal+ feature</h3><p>Model data, ensembles, and simulated reflectivity are part of the paid personal tier — free accounts see live observations, radar, and the forecast workspace. School accounts already have this included.</p><button type="button" onClick={onOpenAccount}>View your account</button></section>;
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
      id: `${run.id}:${targetDate}`, runId: run.id, parentRunId: run.parent_run_id ?? null, authorId: run.user_id, assignmentId: run.assignment_id ?? null, scenarioId: run.scenario_id ?? null, periodIds: { day: day?.id, night: night?.id }, locationId: runLocation.id, locationName: run.location_name ?? runLocation.name, savedAt: run.created_at, label: archiveTitle({ savedAt: run.created_at }), targetDate, status, versionNumber: 1,
      day: { high: dayData.highLow, conditions: dayData.conditions, rainChance: dayData.rainChance, timing: dayData.timing, hazards: dayData.hazards, wind: dayData.wind, reasoning: dayData.reasoning, references: savedReferences(dayData.references), iconCondition: dayData.iconCondition },
      night: { low: nightData.highLow, conditions: nightData.conditions, rainChance: nightData.rainChance, timing: nightData.timing, hazards: nightData.hazards, wind: nightData.wind, reasoning: nightData.reasoning, references: savedReferences(nightData.references), iconCondition: nightData.iconCondition },
      evidence: day?.evidence_snapshot ?? night?.evidence_snapshot ?? { observation: "No observation snapshot", forecast: "No NWS snapshot", alerts: "No alert snapshot" },
    };
  });
}

function numberArchiveVersions(records: SavedForecast[]) {
  const runs = new Map<string, { parentRunId?: string | null; savedAt: string }>();
  records.forEach((record) => { if (record.runId && !runs.has(record.runId)) runs.set(record.runId, { parentRunId: record.parentRunId, savedAt: record.savedAt }); });
  const versionByRun = new Map<string, number>();
  [...runs.entries()].sort(([, left], [, right]) => new Date(left.savedAt).getTime() - new Date(right.savedAt).getTime()).forEach(([runId, run]) => {
    versionByRun.set(runId, run.parentRunId && versionByRun.has(run.parentRunId) ? (versionByRun.get(run.parentRunId) ?? 0) + 1 : 1);
  });
  return records.map((record) => ({ ...record, versionNumber: record.runId ? versionByRun.get(record.runId) ?? 1 : record.versionNumber ?? 1 })).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
}

function ForecasterNotes({ archive }: { archive: SavedForecast }) {
  return <section className="saved-reasoning"><h3>Forecaster notes</h3><div><article><strong>Day reasoning</strong><p>{archive.day.reasoning || "No day reasoning was saved with this forecast."}</p></article><article><strong>Night reasoning</strong><p>{archive.night.reasoning || "No night reasoning was saved with this forecast."}</p></article></div></section>;
}

function forecastAuthorLabel(archive: SavedForecast, profiles: Profile[], currentUserId?: string) {
  if (!archive.authorId || archive.authorId === currentUserId) return "You";
  const profile = profiles.find((candidate) => candidate.id === archive.authorId);
  return profile?.display_name || profile?.email || "Team member";
}

// deprecated: superseded by the record-calendar + date-record-list sections
// (a 7-day day-outlook-cards picker + a per-date version list), which now
// matches the day-picker style used everywhere else on the site instead of
// this component's own 4-day plain-box grid. Kept for reference.
/* function ForecastCalendarBoard({ archives, verifications, profiles, currentUserId, selectedArchiveId, weekStart, onShift, onSelect, weatherIconStyle }: { archives: SavedForecast[]; verifications: Record<string, AutomaticVerification>; profiles: Profile[]; currentUserId?: string; selectedArchiveId: string | null; weekStart: string; onShift: (days: number) => void; onSelect: (id: string) => void; weatherIconStyle: WeatherIconStyle }) {
  const dates = Array.from({ length: 4 }, (_, index) => addDays(new Date(`${weekStart}T12:00:00`), index));
  const [expandedDates, setExpandedDates] = useState<Set<string>>(() => new Set());
  return <section className="weekly-calendar" aria-label="Forecast archive calendar"><div className="weekly-calendar-heading"><div><p className="eyebrow">Forecast archive</p><h3>Forecast target dates</h3></div><div><button type="button" aria-label="Previous four days" onClick={() => onShift(-4)}>←</button><button type="button" aria-label="Next four days" onClick={() => onShift(4)}>→</button></div></div><div className="weekly-calendar-grid">{dates.map((targetDate) => { const records = archives.filter((archive) => archive.targetDate === targetDate).sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()); const expanded = expandedDates.has(targetDate); const shownRecords = expanded ? records : records.slice(0, 3); return <article key={targetDate} className={records.length === 0 ? "empty" : undefined}><header><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))}</strong>{records.length > 0 && <small>{records.length} forecast{records.length === 1 ? "" : "s"}</small>}</header>{records.length === 0 ? <p className="empty-day-note">No forecast</p> : <div>{shownRecords.map((record) => { const score = verifications[record.id]?.dayScore; return <button type="button" key={record.id} className={record.id === selectedArchiveId ? "active" : ""} onClick={() => onSelect(record.id)}><span className="record-icon-row"><img className="forecast-condition-icon" src={`/weather-icons/${weatherIconStyle}/${periodIconCondition(record.day)}.svg`} alt="" /><strong>V{record.versionNumber} · {record.status}</strong></span><span>H {displayForecastTemperature(record.day.high)} · L {displayForecastTemperature(record.night.low)}</span><span>PoP {displayForecastChance(record.day.rainChance)}/{displayForecastChance(record.night.rainChance)}</span><small>{forecastAuthorLabel(record, profiles, currentUserId)} · {score === null || score === undefined ? "Unscored" : `Day ${score}%`}</small></button>; })}{records.length > 3 && <button type="button" className="more-records" onClick={() => setExpandedDates((current) => { const next = new Set(current); if (next.has(targetDate)) next.delete(targetDate); else next.add(targetDate); return next; })}>{expanded ? "Show fewer" : `+ ${records.length - 3} more forecasts`}</button>}</div>}</article>; })}</div></section>;
} */

function PeopleDirectory({ profiles, onRoleChange, onProfileSave, message }: { profiles: Profile[]; onRoleChange: (profile: Profile, role: WorkspaceRole) => void; onProfileSave: (profile: Profile, fields: Pick<Profile, "display_name" | "person_type" | "employee_id" | "student_id" | "title">) => void; message: string }) {
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Pick<Profile, "display_name" | "person_type" | "employee_id" | "student_id" | "title">>>({});
  useEffect(() => setDrafts(Object.fromEntries(profiles.map((profile) => [profile.id, { display_name: profile.display_name, person_type: profile.person_type, employee_id: profile.employee_id, student_id: profile.student_id, title: profile.title }]))), [profiles]);
  const shownProfiles = profiles.filter((profile) => `${profile.display_name ?? ""} ${profile.email ?? ""} ${profile.employee_id ?? ""} ${profile.student_id ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="people-directory"><header><div><p className="eyebrow">People</p><h3>User profiles and access</h3><p>Profiles identify people; workspace memberships decide where they can work. Email remains the sign-in identity.</p></div><label>Find a person<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, or ID" /></label></header><div className="people-directory-list">{shownProfiles.map((profile) => { const draft = drafts[profile.id] ?? { display_name: profile.display_name, person_type: profile.person_type, employee_id: profile.employee_id, student_id: profile.student_id, title: profile.title }; return <details key={profile.id}><summary><span><strong>{profile.display_name || profile.email || "Unnamed account"}</strong><small>{profile.email ?? profile.id}</small></span><span>{profile.person_type ?? "member"} · {profile.role}</span></summary><div className="person-profile-fields"><label>Name<input value={draft.display_name ?? ""} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, display_name: event.target.value } }))} placeholder="Display name" /></label><label>Profile type<select value={draft.person_type ?? "other"} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, person_type: event.target.value as Profile["person_type"] } }))}><option value="employee">Employee</option><option value="instructor">Instructor</option><option value="student">Student</option><option value="other">Other</option></select></label><label>Title / program<input value={draft.title ?? ""} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, title: event.target.value } }))} placeholder="Meteorologist, class, department…" /></label><label>Employee ID<input value={draft.employee_id ?? ""} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, employee_id: event.target.value } }))} placeholder="Optional" /></label><label>Student ID<input value={draft.student_id ?? ""} onChange={(event) => setDrafts((all) => ({ ...all, [profile.id]: { ...draft, student_id: event.target.value } }))} placeholder="Optional" /></label><label>Platform role<select disabled={profile.role === "owner"} value={profile.role} onChange={(event) => onRoleChange(profile, event.target.value as WorkspaceRole)}><option value="owner">Owner (locked)</option><option value="admin">Admin</option><option value="instructor">Instructor</option><option value="reviewer">Reviewer</option><option value="forecaster">Forecaster</option><option value="student">Student</option><option value="member">Member</option></select></label></div><div className="person-profile-actions"><small>{profile.role === "owner" ? "Permanent platform owner. Role cannot be changed here." : "Platform role controls administration; organization/classroom memberships are granted separately."}</small><button type="button" onClick={() => onProfileSave(profile, draft)}>Save profile</button></div></details>; })}</div>{!shownProfiles.length && <p className="empty">No matching user profiles.</p>}{message && <p className="control-message" role="status">{message}</p>}</section>;
}

// deprecated: never rendered anywhere; superseded by SchoolDesk/ClassroomSettings/ClassroomCodeManager. Kept for reference.
/* function AccessManager({ organizations, classrooms, organizationMembers, classroomMembers, profiles, onCreateOrganization, onCreateClassroom, onAddOrganizationMember, onAddClassroomMember, onRemoveOrganizationMember, onRemoveClassroomMember, onReviewMember, message }: { organizations: OrganizationWorkspace[]; classrooms: ClassroomWorkspace[]; organizationMembers: OrganizationMember[]; classroomMembers: ClassroomMember[]; profiles: Profile[]; onCreateOrganization: (name: string, kind: OrganizationWorkspace["kind"]) => void; onCreateClassroom: (organizationId: string, name: string, term: string) => void; onAddOrganizationMember: (organizationId: string, userId: string, role: WorkspaceRole) => void; onAddClassroomMember: (classroomId: string, userId: string, role: ClassroomMember["role"]) => void; onRemoveOrganizationMember: (membership: OrganizationMember) => void; onRemoveClassroomMember: (membership: ClassroomMember) => void; onReviewMember: (target: ReviewTarget) => void; message: string }) {
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
} */

function AcademicReviewDesk({ workspace, roster, onReviewMember, message }: { workspace: WorkspaceContext; roster: AcademicRosterMember[]; onReviewMember: (target: ReviewTarget) => void; message: string }) {
  const isClassroom = workspace.kind === "classroom";
  const students = roster.filter((member) => member.role === "student");
  const reviewers = roster.filter((member) => member.role !== "student");
  return <section className="academic-review-desk"><header className="section-heading"><div><p className="eyebrow">{isClassroom ? "Classroom workflow" : "Workspace review"}</p><h2>{workspaceDeskLabel(workspace)}</h2><p>{isClassroom ? "Student forecasts stay private. Instructors and assistants can review only this classroom’s submitted work." : "Review access is limited to the selected organization’s non-classroom records."}</p></div><span>{isClassroom ? "Private class" : "Private review"}</span></header><div className="academic-status-grid"><article><span>{isClassroom ? "Students" : "Members"}</span><strong>{students.length || roster.length}</strong><small>{isClassroom ? "Assigned to this classroom" : "Available in this workspace"}</small></article><article><span>Review team</span><strong>{reviewers.length}</strong><small>Instructors, assistants, or reviewers</small></article><article><span>Publication</span><strong>Off</strong><small>Reviews do not publish a forecast</small></article></div><section className="academic-roster"><header><div><h3>{isClassroom ? "Student review queue" : "Forecast review queue"}</h3><p>Select a person to open their private forecast records, automatic scores, and review notes.</p></div></header><div>{roster.map((member) => <article key={`${member.userId}:${member.classroomId ?? member.organizationId}`}><span><strong>{member.label}</strong><small>{member.email ?? "Account profile"}</small></span><em>{member.role}</em><button type="button" onClick={() => onReviewMember(member)}>Review forecasts</button></article>)}{!roster.length && <p className="empty">No active people are available in this workspace yet.</p>}</div></section>{message && <p className="control-message" role="status">{message}</p>}</section>;
}

function averageForecastValue(values: string[]) {
  const numeric = values.map((value) => Number.parseFloat(value)).filter(Number.isFinite);
  return numeric.length ? Math.round(numeric.reduce((sum, value) => sum + value, 0) / numeric.length) : null;
}

function buildClassForecastSnapshot(assignment: ClassroomAssignment, submissions: ClassroomAssignmentSubmission[], students: AcademicRosterMember[]): ClassForecastSnapshot {
  const studentIds = new Set(students.filter((member) => member.role === "student").map((member) => member.userId));
  const latestByStudent = new Map<string, ClassroomAssignmentSubmission>();
  submissions.filter((submission) => submission.assignment_id === assignment.id && submission.status !== "withdrawn" && studentIds.has(submission.user_id)).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).forEach((submission) => { if (!latestByStudent.has(submission.user_id)) latestByStudent.set(submission.user_id, submission); });
  const latest = [...latestByStudent.values()];
  const commonConditions = (periods: PeriodDraft[]) => [...new Set(periods.map((period) => conditionLabel(period.conditions)).filter(Boolean))].slice(0, 3);
  const commonWind = (periods: PeriodDraft[]) => [...new Set(periods.map((period) => period.wind.trim()).filter(Boolean))].slice(0, 3);
  const summaryForDate = (date: string): ClassForecastDay => {
    const periodData = (period: "day" | "night") => latest.map((submission) => submission.forecast_periods.find((entry) => entry.period === period && entry.valid_date === date)?.forecast_data).filter((data): data is PeriodDraft => Boolean(data));
    const day = periodData("day");
    const night = periodData("night");
    return { date, submitted_count: latest.filter((submission) => submission.forecast_periods.some((entry) => entry.valid_date === date)).length, day: { high_f: averageForecastValue(day.map((period) => period.highLow)), pop: averageForecastValue(day.map((period) => period.rainChance)), conditions: commonConditions(day), wind: commonWind(day) }, night: { low_f: averageForecastValue(night.map((period) => period.highLow)), pop: averageForecastValue(night.map((period) => period.rainChance)), conditions: commonConditions(night), wind: commonWind(night) } };
  };
  const days = assignmentDates(assignment).map(summaryForDate);
  const primary = days[0] ?? summaryForDate(assignment.target_date);
  return { generated_at: new Date().toISOString(), target_date: assignment.target_date, submitted_count: latest.length, total_students: studentIds.size, day: primary.day, night: primary.night, days };
}

function buildLiveClassForecastSnapshot(archives: SavedForecast[], activeDates: string[], students: AcademicRosterMember[]): ClassForecastSnapshot {
  const studentIds = new Set(students.filter((member) => member.role === "student").map((member) => member.userId));
  const relevant = archives.filter((archive) => !archive.assignmentId && archive.status !== "withdrawn" && archive.authorId && studentIds.has(archive.authorId) && activeDates.includes(archive.targetDate));
  const latestByStudentDate = new Map<string, SavedForecast>();
  relevant.forEach((archive) => { const key = `${archive.authorId}:${archive.targetDate}`; const existing = latestByStudentDate.get(key); if (!existing || new Date(archive.savedAt).getTime() > new Date(existing.savedAt).getTime()) latestByStudentDate.set(key, archive); });
  const latest = [...latestByStudentDate.values()];
  const commonConditions = (records: SavedForecast[], period: "day" | "night") => [...new Set(records.map((record) => conditionLabel(record[period].conditions)).filter(Boolean))].slice(0, 3);
  const commonWind = (records: SavedForecast[], period: "day" | "night") => [...new Set(records.map((record) => (record[period].wind ?? "").trim()).filter(Boolean))].slice(0, 3);
  const summaryForDate = (date: string): ClassForecastDay => {
    const onDate = latest.filter((record) => record.targetDate === date);
    return { date, submitted_count: onDate.length, day: { high_f: averageForecastValue(onDate.map((record) => record.day.high)), pop: averageForecastValue(onDate.map((record) => record.day.rainChance)), conditions: commonConditions(onDate, "day"), wind: commonWind(onDate, "day") }, night: { low_f: averageForecastValue(onDate.map((record) => record.night.low)), pop: averageForecastValue(onDate.map((record) => record.night.rainChance)), conditions: commonConditions(onDate, "night"), wind: commonWind(onDate, "night") } };
  };
  const days = [...activeDates].sort().map(summaryForDate);
  const primary = days[0];
  return { generated_at: new Date().toISOString(), target_date: primary?.date ?? "", submitted_count: latest.length, total_students: studentIds.size, day: primary?.day ?? { high_f: null, pop: null, conditions: [], wind: [] }, night: primary?.night ?? { low_f: null, pop: null, conditions: [], wind: [] }, days };
}

function ClassroomLiveForecast({ archives, roster, canManage, publicGuidance, message }: { archives: SavedForecast[]; roster: AcademicRosterMember[]; canManage: boolean; publicGuidance: { date: string; label: string; high: number | null; low: number | null; shortForecast: string; precipitationChance: number | null; wind: string | null }[]; message: string }) {
  const students = roster.filter((member) => member.role === "student");
  const activeDates = Array.from({ length: 7 }, (_, index) => addDays(new Date(), index));
  const snapshot = buildLiveClassForecastSnapshot(archives, activeDates, roster);
  const days = snapshot.days ?? [];
  const [selectedDate, setSelectedDate] = useState(days[0]?.date ?? "");
  useEffect(() => { if (days.length && !days.some((day) => day.date === selectedDate)) setSelectedDate(days[0].date); }, [days.length, days[0]?.date]);
  const selectedDay = days.find((day) => day.date === selectedDate) ?? days[0];
  const selectedGuidance = publicGuidance.find((day) => day.date === selectedDay?.date);
  const contributorsForDate = (date: string) => {
    const studentIds = new Set(students.map((member) => member.userId));
    const latestByStudent = new Map<string, SavedForecast>();
    archives.filter((archive) => !archive.assignmentId && archive.status !== "withdrawn" && archive.targetDate === date && archive.authorId && studentIds.has(archive.authorId)).forEach((archive) => { const existing = latestByStudent.get(archive.authorId!); if (!existing || new Date(archive.savedAt).getTime() > new Date(existing.savedAt).getTime()) latestByStudent.set(archive.authorId!, archive); });
    return students.map((student) => ({ student, latest: latestByStudent.get(student.userId) ?? null }));
  };
  return <section className="class-forecast-hub class-forecast-hub-v2 classroom-live-forecast">
    <header className="section-heading"><div><p className="eyebrow">Class forecast</p><h2>Class Forecast</h2><p>Combined class forecast — built from the class's average.</p></div></header>
    <section className="outlook-strip class-outlook-strip" aria-label="Class seven-day outlook"><div className="outlook-heading"><div><h2>Class 7-Day Forecast</h2></div><span>Class</span></div><div className="outlook-cards">{days.map((day) => <button type="button" key={day.date} className={day.date === selectedDay?.date ? "active" : ""} onClick={() => setSelectedDate(day.date)}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(new Date(`${day.date}T12:00:00`))}</strong><b aria-hidden="true"><WeatherIcon description={day.day.conditions[0] || day.night.conditions[0] || "Forecast"} style="traditional" /></b><span>{day.day.conditions[0] || day.night.conditions[0] || "No forecasts yet"}</span><em>{day.day.high_f ?? "—"}° / {day.night.low_f ?? "—"}°</em><small>{day.submitted_count}/{students.length || "—"} submitted</small></button>)}</div></section>
    <section className="outlook-strip class-outlook-strip" aria-label="Local seven-day guidance"><div className="outlook-heading"><div><h2>NWS 7-Day Forecast</h2></div><span>Local</span></div><div className="outlook-cards">{days.map((day) => { const guidance = publicGuidance.find((item) => item.date === day.date); return <button type="button" key={day.date} className={day.date === selectedDay?.date ? "active" : ""} onClick={() => setSelectedDate(day.date)}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(new Date(`${day.date}T12:00:00`))}</strong><b aria-hidden="true"><WeatherIcon description={guidance?.shortForecast ?? "Forecast"} style="traditional" /></b><span>{guidance?.shortForecast ?? "Guidance unavailable"}</span><em>{guidance?.high ?? "—"}° / {guidance?.low ?? "—"}°</em><small>{guidance?.precipitationChance ?? "—"}% PoP</small></button>; })}</div></section>
    {selectedDay && <section className="class-outlook-detail"><header><div><p className="eyebrow">Selected day</p><h3>{forecastTargetTitle(selectedDay.date)}</h3><p>{selectedDay.submitted_count} of {students.length || "—"} students represented.</p></div></header><div className="class-outlook-compare"><fieldset><legend>Class forecast</legend><div className="class-outlook-readout"><strong>{selectedDay.day.conditions[0] || selectedDay.night.conditions[0] || "No forecasts yet"}</strong><b>{selectedDay.day.high_f ?? "—"}° / {selectedDay.night.low_f ?? "—"}°</b><span>Day {selectedDay.day.pop ?? "—"}% · Night {selectedDay.night.pop ?? "—"}%</span>{(selectedDay.day.wind.length > 0 || selectedDay.night.wind.length > 0) && <small>Wind: {[...selectedDay.day.wind, ...selectedDay.night.wind].filter((value, index, all) => all.indexOf(value) === index).join(" · ")}</small>}</div></fieldset><fieldset><legend>Local guidance</legend><div className="class-outlook-readout"><strong>{selectedGuidance?.shortForecast ?? "Guidance unavailable"}</strong><b>{selectedGuidance?.high ?? "—"}° / {selectedGuidance?.low ?? "—"}°</b><span>{selectedGuidance?.precipitationChance ?? "—"}% PoP</span>{selectedGuidance?.wind && <small>Wind: {selectedGuidance.wind}</small>}</div></fieldset></div>{canManage && <div className="class-participation-list"><strong>Participation</strong><div>{contributorsForDate(selectedDay.date).map(({ student, latest }) => <article key={student.userId}><span>{student.label}</span>{latest ? <em>V{latest.versionNumber} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(latest.savedAt))}</em> : <em className="not-submitted">Not submitted</em>}</article>)}</div></div>}</section>}
    {message && <p className="control-message" role="status">{message}</p>}
  </section>;
}

function SchoolDesk({ workspace, classrooms, members, codes, entitlement, classroomEnrollment, onOpenClassroom, onCreateClassroom, onRenameClassroom, onAssignInstructor, onCreateCode, onRetireCode, onArchiveClassroom, onRestoreClassroom, onDeleteClassroom, message }: { workspace: WorkspaceContext; classrooms: WorkspaceContext[]; members: OrganizationMember[]; codes: ClassroomJoinCode[]; entitlement: { seat_limit: number; status: string; next_payment_due_at: string | null } | null; classroomEnrollment: Record<string, number>; onOpenClassroom: (workspace: WorkspaceContext) => void; onCreateClassroom: (name: string, term: string, seatLimit?: number) => void; onRenameClassroom: (classroom: WorkspaceContext, name: string, term: string) => void; onAssignInstructor: (classroomId: string, userId: string) => void; onCreateCode: (classroomId: string, label: string, maxUses: number | null, expiresAt: string | null) => Promise<string | null>; onRetireCode: (id: string) => void; onArchiveClassroom: (classroomId: string) => void; onRestoreClassroom: (classroomId: string) => void; onDeleteClassroom: (classroomId: string) => void; message: string }) {
  const [pendingDeletion, setPendingDeletion] = useState<WorkspaceContext | null>(null);
  const canManage = ["owner", "admin", "instructor"].includes(workspace.role ?? "");
  const canCoordinate = ["owner", "admin"].includes(workspace.role ?? "");
  const activeClassrooms = classrooms.filter((classroom) => classroom.classroomStatus !== "archived");
  const archivedClassrooms = classrooms.filter((classroom) => classroom.classroomStatus === "archived");
  const instructionalClasses = activeClassrooms.filter((classroom) => ["owner", "admin", "instructor", "assistant"].includes(classroom.role ?? ""));
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTerm, setNewTerm] = useState("");
  const [newSeatLimit, setNewSeatLimit] = useState("");
  const [openClassroomId, setOpenClassroomId] = useState<string | null>(null);
  const [codeResult, setCodeResult] = useState<Record<string, string>>({});
  const [classMenu, setClassMenu] = useState<{ classroomId: string; left: number; top: number } | null>(null);
  const displayName = (member: OrganizationMember) => member.profiles?.display_name || member.profiles?.email || "School member";
  const readableDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(value)) : "No expiry";
  const totalEnrolled = activeClassrooms.reduce((sum, classroom) => sum + (classroomEnrollment[classroom.classroomId!] ?? 0), 0);
  const planLabel = { trial: "Trial", active: "Active", past_due: "Past due", suspended: "Suspended" }[entitlement?.status ?? ""] ?? "Ended";
  const menuClassroom = classMenu ? classrooms.find((classroom) => classroom.classroomId === classMenu.classroomId) : null;
  return <section className="school-desk"><header className="section-heading"><div><p className="eyebrow">School workspace</p><h2>{workspaceDeskLabel(workspace)}</h2></div>{canManage && <button type="button" className="button primary" onClick={() => setShowCreate((open) => !open)}>{showCreate ? "Close" : "Add class"}</button>}</header>{canManage && entitlement && entitlement.status !== "trial" && entitlement.status !== "active" && <div className={`hazard-banner ${entitlement.status === "past_due" ? "warning" : "urgent"}`} role="status"><span className="hazard-label">{entitlement.status === "past_due" ? "Payment past due" : entitlement.status === "suspended" ? "Access suspended" : "Plan ended"}</span><strong>{entitlement.status === "past_due" ? "Your school's plan is past due" : entitlement.status === "suspended" ? "Student access is currently paused" : "This school's plan has ended"}</strong><p>{entitlement.status === "past_due" ? `Renew by the grace period's end to avoid an interruption. Students see no change yet — this is only visible to staff.` : `Contact us to renew and restore student access.`}{entitlement.next_payment_due_at && ` Payment was due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(entitlement.next_payment_due_at))}.`}</p></div>}<div className="school-status-grid">{canCoordinate && entitlement && <article><span>Students enrolled</span><strong>{totalEnrolled}{entitlement.seat_limit ? `/${entitlement.seat_limit}` : ""}</strong><small>active across all classes</small></article>}<article><span>Classes</span><strong>{activeClassrooms.length}</strong><small>organize as many as you need</small></article><article><span>Teaching access</span><strong>{instructionalClasses.length}</strong><small>classrooms you can run</small></article>{canCoordinate && entitlement && <article><span>Plan</span><strong>{planLabel}</strong><small>{entitlement.next_payment_due_at ? `Renews ${readableDate(entitlement.next_payment_due_at)}` : "No renewal date on file"}</small></article>}</div>{showCreate && <form className="school-class-create" onSubmit={(event) => { event.preventDefault(); if (!newName.trim()) return; onCreateClassroom(newName.trim(), newTerm.trim(), newSeatLimit ? Number(newSeatLimit) : undefined); setNewName(""); setNewTerm(""); setNewSeatLimit(""); setShowCreate(false); }}><label>Class name<input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Meteorology 101" required /></label><label>Term<input value={newTerm} onChange={(event) => setNewTerm(event.target.value)} placeholder="Fall 2026" /></label><label>Seats<input type="number" min="1" value={newSeatLimit} onChange={(event) => setNewSeatLimit(event.target.value)} placeholder="Class capacity" /></label><button type="submit">Create class</button></form>}<section className="school-class-directory"><header><div><p className="eyebrow">Classes</p><h3>Class list</h3><p>Open a class to teach.{canManage && " Right-click a class for more actions."}</p></div></header><div>{activeClassrooms.map((classroom) => { const isOpen = openClassroomId === classroom.classroomId; const classCodes = codes.filter((code) => code.classroom_id === classroom.classroomId); const enrolled = classroomEnrollment[classroom.classroomId!] ?? 0; return <details key={classroom.key} open={isOpen} onToggle={(event) => setOpenClassroomId((event.currentTarget as HTMLDetailsElement).open ? classroom.classroomId! : null)}><summary onContextMenu={canManage ? (event) => { event.preventDefault(); setClassMenu({ classroomId: classroom.classroomId!, left: event.clientX, top: event.clientY }); } : undefined}><span><strong>{workspaceDeskLabel(classroom)}</strong><small>{classroom.detail}</small></span>{canCoordinate && <em className="class-enrollment-count">{enrolled} enrolled</em>}<em>{classroom.role ?? (canCoordinate ? "coordinator" : "member")}</em><b>Manage</b></summary><div className="school-class-detail"><div className="school-class-actions"><button type="button" onClick={() => onOpenClassroom(classroom)}>Open class</button></div>{canManage && <ClassroomSettings classroom={classroom} members={members} canCoordinate={canCoordinate} onRename={onRenameClassroom} onAssignInstructor={onAssignInstructor} displayName={displayName} />}{canManage && <ClassroomCodeManager classroomId={classroom.classroomId!} codes={classCodes} onCreate={onCreateCode} onRetire={onRetireCode} codeResult={codeResult[classroom.classroomId!] ?? ""} onResult={(value) => setCodeResult((all) => ({ ...all, [classroom.classroomId!]: value }))} readableDate={readableDate} />}</div></details>; })}{!activeClassrooms.length && <p className="empty">No classes are assigned to this school workspace yet.</p>}</div>
    {canCoordinate && archivedClassrooms.length > 0 && <details className="history-fold"><summary>Archived · {archivedClassrooms.length}</summary><div className="classroom-roster-list">{archivedClassrooms.map((classroom) => <article key={classroom.key}><span><strong>{workspaceDeskLabel(classroom)}</strong><small>{classroom.detail}</small></span><div><button type="button" onClick={() => onRestoreClassroom(classroom.classroomId!)}>Restore</button><button type="button" className="danger" onClick={() => setPendingDeletion(classroom)}>Delete permanently</button></div></article>)}</div></details>}
    {pendingDeletion && <div className="archive-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="classroom-deletion-title"><div><p className="eyebrow">Confirm permanent deletion</p><h2 id="classroom-deletion-title">Delete {workspaceDeskLabel(pendingDeletion)}?</h2><p>This permanently removes the class, its roster, assignments, submissions, and join codes. Students' own forecast history is kept, just no longer linked to this class. This cannot be undone.</p><div><button type="button" onClick={() => setPendingDeletion(null)}>Cancel</button><button type="button" className="danger" onClick={() => { onDeleteClassroom(pendingDeletion.classroomId!); setPendingDeletion(null); }}>Delete permanently</button></div></div></div>}
  </section>
  {classMenu && menuClassroom && <div className="tab-menu" style={{ left: classMenu.left, top: classMenu.top }}><strong>{workspaceDeskLabel(menuClassroom)}</strong><div><button type="button" onClick={() => { setOpenClassroomId(menuClassroom.classroomId!); setClassMenu(null); }}>Manage</button><button type="button" onClick={() => setClassMenu(null)}>Close</button></div>{canCoordinate && <><small>Archiving keeps the class, its roster, and its records — it just moves out of the active list.</small><button type="button" onClick={() => { onArchiveClassroom(menuClassroom.classroomId!); setClassMenu(null); }}>Archive class</button></>}</div>}
  {message && <p className="control-message" role="status">{message}</p>}</section>;
}

function ClassroomSettings({ classroom, members, canCoordinate, onRename, onAssignInstructor, displayName }: { classroom: WorkspaceContext; members: OrganizationMember[]; canCoordinate: boolean; onRename: (classroom: WorkspaceContext, name: string, term: string) => void; onAssignInstructor: (classroomId: string, userId: string) => void; displayName: (member: OrganizationMember) => string }) {
  const [name, setName] = useState(classroom.label);
  const [term, setTerm] = useState(classroom.detail.split(" · ").slice(1).join(" · "));
  const [instructorId, setInstructorId] = useState("");
  return <section className="classroom-settings"><div><label>Class name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Term<input value={term === classroom.detail ? "" : term} onChange={(event) => setTerm(event.target.value)} placeholder="Optional" /></label><button type="button" onClick={() => onRename(classroom, name.trim(), term.trim())}>Save class details</button></div>{canCoordinate && <div><label>Instructor<select value={instructorId} onChange={(event) => setInstructorId(event.target.value)}><option value="">Choose or promote a school member</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{displayName(member)} · {member.role}</option>)}</select><small>Assigning someone here grants them instructor access to this class.</small></label><button type="button" disabled={!instructorId} onClick={() => { onAssignInstructor(classroom.classroomId!, instructorId); setInstructorId(""); }}>Assign instructor</button></div>}</section>;
}

function ClassroomCodeManager({ classroomId, codes, onCreate, onRetire, codeResult, onResult, readableDate }: { classroomId: string; codes: ClassroomJoinCode[]; onCreate: (classroomId: string, label: string, maxUses: number | null, expiresAt: string | null) => Promise<string | null>; onRetire: (id: string) => void; codeResult: string; onResult: (value: string) => void; readableDate: (value: string | null) => string }) {
  const [label, setLabel] = useState(""); const [maxUses, setMaxUses] = useState(""); const [expiresAt, setExpiresAt] = useState(""); const [busy, setBusy] = useState(false);
  return <section className="classroom-code-manager"><header><div><p className="eyebrow">Enrollment</p><h4>Class codes</h4><p>Codes can add students only while school and class capacity remain.</p></div></header><form onSubmit={async (event) => { event.preventDefault(); setBusy(true); const code = await onCreate(classroomId, label, maxUses ? Number(maxUses) : null, expiresAt || null); setBusy(false); if (code) { onResult(code); setLabel(""); setMaxUses(""); setExpiresAt(""); } }}><label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Period 2 roster" /></label><label>Use limit<input type="number" min="1" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} placeholder="Class capacity" /></label><label>Expires<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><button type="submit" disabled={busy}>{busy ? "Creating…" : "Generate code"}</button></form>{codeResult && <div className="class-code-reveal" role="status"><strong>New code</strong><code>{codeResult}</code><small>Share this once through the school’s approved channel. It will not be shown again.</small></div>}<div className="class-code-list">{codes.map((code) => <article key={code.id}><span><strong>{code.label || `Class code ••••${code.code_hint}`}</strong><small>{code.active ? `${code.use_count}${code.max_uses ? `/${code.max_uses}` : ""} redeemed · ${readableDate(code.expires_at)}` : "Retired"}</small></span><b className={code.active ? "status-ready" : "status-pending"}>{code.active ? "Active" : "Retired"}</b>{code.active && <button type="button" onClick={() => onRetire(code.id)}>Retire</button>}</article>)}{!codes.length && <p className="empty">No class codes have been issued.</p>}</div></section>;
}

// deprecated: superseded by the "Selected assignment" panel in ClassroomAssignmentStudio
// (now on the Practice tab, which is the sole landing tab), which absorbed the scenario
// banner and the Build example/Start assignment action. The redundant "My work" tab that
// rendered this was removed. Kept for reference.
/* function ClassroomToday({ assignment, submissions, roster, canManage, canOpenForecast, onOpenForecast }: { assignment: ClassroomAssignment | null; submissions: ClassroomAssignmentSubmission[]; roster: AcademicRosterMember[]; canManage: boolean; canOpenForecast: boolean; onOpenForecast: () => void }) {
  const students = roster.filter((member) => member.role === "student");
  const studentIds = new Set(students.map((member) => member.userId));
  const studentCount = students.length;
  const submittedCount = assignment ? new Set(submissions.filter((submission) => submission.assignment_id === assignment.id && (!canManage || studentIds.has(submission.user_id))).map((submission) => submission.user_id)).size : 0;
  return <section className="classroom-today"><header><div><p className="eyebrow">My work</p><h3>{assignment?.title ?? "No active assignment"}</h3><p>{assignment ? `${assignmentDates(assignment).map(forecastTargetTitle).join(" · ")}${assignment.due_at ? ` · due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(assignment.due_at))}` : ""}` : "No assignment needs attention right now."}</p></div>{canOpenForecast && <button type="button" onClick={onOpenForecast}>{canManage ? "Build example" : "Start assignment"}</button>}</header>{assignment?.scenario && <div className="assignment-linker scenario-context"><div><strong>Historical scenario</strong><small>This date has already happened — it's a real past event, not a hypothetical.</small>{assignment.scenario.summary && <em>{assignment.scenario.summary}</em>}{(assignment.scenario.reference_notes || assignment.scenario.reference_links.length > 0) && <details className="scenario-reference-details"><summary>Reference data</summary>{assignment.scenario.reference_notes && <p>{assignment.scenario.reference_notes}</p>}{assignment.scenario.reference_links.length > 0 && <ul>{assignment.scenario.reference_links.map((link) => <li key={link.label}>{link.label}{link.detail ? ` — ${link.detail}` : ""}{link.url && <> · <a href={link.url} target="_blank" rel="noreferrer">Open</a></>}</li>)}</ul>}</details>}</div></div>}{assignment && <div className="classroom-today-grid"><article><span>Instructor example</span><strong>{assignment.instructor_forecast ? "Available" : "Not posted"}</strong><small>{assignment.instructor_forecast ? "Open Assignments to review it." : "A shared class reference when posted."}</small></article><article><span>{canManage ? "Submissions" : "Your work"}</span><strong>{canManage ? `${submittedCount}/${studentCount || "—"}` : submittedCount ? "Submitted" : "To do"}</strong><small>{canManage ? "latest student forecasts" : submittedCount ? "This assignment is complete." : "Start the linked forecast when ready."}</small></article></div>}</section>;
} */

function ClassroomProgress({ assignments, submissions, roster, canManage, currentUserId }: { assignments: ClassroomAssignment[]; submissions: AssignmentSubmission[]; roster: AcademicRosterMember[]; canManage: boolean; currentUserId?: string }) {
  const students = roster.filter((member) => member.role === "student");
  const submissionFor = (assignmentId: string, userId: string) => submissions.find((submission) => submission.assignment_id === assignmentId && submission.student_id === userId);
  if (!canManage) {
    return <section className="classroom-progress"><header><p className="eyebrow">My progress</p><h3>Your class work</h3><p>Assignments and instructor feedback are private to you and your teaching team.</p></header><div className="classroom-progress-grid">{assignments.map((assignment) => { const submission = submissionFor(assignment.id, currentUserId ?? ""); return <article key={assignment.id}><span>{assignment.title}</span><strong>{submission?.status === "submitted" ? "Submitted" : submission ? "Draft saved" : "Not started"}</strong><small>{assignmentDates(assignment).map(forecastTargetTitle).join(" · ")}</small></article>; })}{!assignments.length && <p className="empty">No assignments are open for this class.</p>}</div></section>;
  }
  return <section className="classroom-progress"><header><p className="eyebrow">Class progress</p><h3>Submission status</h3></header><div className="classroom-progress-summary"><article><span>Students</span><strong>{students.length}</strong><small>enrolled in this class</small></article><article><span>Assignments</span><strong>{assignments.length}</strong><small>available for review</small></article></div><div className="class-progress-roster">{students.map((student) => { const completed = assignments.filter((assignment) => submissionFor(assignment.id, student.userId)?.status === "submitted"); return <details key={student.userId}><summary><span><strong>{student.label}</strong><small>{student.email ?? "Student account"}</small></span><b>{completed.length}/{assignments.length} submitted</b></summary><div>{assignments.map((assignment) => { const submission = submissionFor(assignment.id, student.userId); return <article key={assignment.id}><header><strong>{assignment.title}</strong><small>{assignmentDates(assignment).map(forecastTargetTitle).join(" · ")}</small></header>{submission ? <div className="assignment-submission-days">{assignmentDates(assignment).map((date) => <AssignmentDayMiniCard key={date} date={date} response={submission.responses[date]} />)}</div> : <p className="empty">No submission yet.</p>}</article>; })}</div></details>; })}{!students.length && <p className="empty">Add students from Control before creating class work.</p>}</div></section>;
}

function ClassroomRosterPanel({ roster, assignments, submissions, reviews, message, onRevoke, onRestore, onInvite }: { roster: ClassroomRosterMember[]; assignments: ClassroomAssignment[]; submissions: AssignmentSubmission[]; reviews: AssignmentReview[]; message: string; onRevoke: (userId: string) => void; onRestore: (userId: string) => void; onInvite: (email: string) => Promise<void> }) {
  const [menu, setMenu] = useState<{ userId: string; left: number; top: number } | null>(null);
  const [query, setQuery] = useState("");
  const [openStudentId, setOpenStudentId] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const matches = (member: ClassroomRosterMember) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return member.label.toLowerCase().includes(term) || (member.email ?? "").toLowerCase().includes(term);
  };
  const active = roster.filter((member) => member.status === "active" && matches(member));
  const revoked = roster.filter((member) => member.status === "suspended" && matches(member));
  const openMenu = (userId: string) => (event: ReactMouseEvent) => { event.preventDefault(); setMenu({ userId, left: event.clientX, top: event.clientY }); };
  const menuMember = menu ? roster.find((member) => member.userId === menu.userId) : null;
  const openStudent = roster.find((member) => member.userId === openStudentId) ?? null;
  const submissionFor = (assignmentId: string, userId: string) => submissions.find((submission) => submission.assignment_id === assignmentId && submission.student_id === userId);
  return <section className="classroom-roster"><header><p className="eyebrow">Roster</p><h3>Enrolled students</h3></header>
    <div className="roster-toolbar"><form className="roster-search" onSubmit={(event) => event.preventDefault()}><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search students by name or email" aria-label="Search students" /><button type="submit">Search</button></form>
      <div className="roster-invite"><button type="button" onClick={() => setInviteOpen((open) => !open)}>Invite student</button>{inviteOpen && <form className="roster-invite-menu" onSubmit={async (event) => { event.preventDefault(); if (!inviteEmail.trim()) return; setInviteBusy(true); await onInvite(inviteEmail.trim()); setInviteBusy(false); setInviteEmail(""); setInviteOpen(false); }}><label>Invite by email<input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="student@school.edu" autoFocus /></label><div><button type="submit" disabled={!inviteEmail.trim() || inviteBusy}>{inviteBusy ? "Inviting…" : "Send invite"}</button><button type="button" onClick={() => setInviteOpen(false)}>Cancel</button></div></form>}</div>
    </div>
    <div className="classroom-roster-list">{active.map((member) => <article key={member.userId} onClick={() => setOpenStudentId(member.userId)} onContextMenu={openMenu(member.userId)}><span><strong>{member.label}</strong><small>{member.email ?? "No email on file"} · enrolled {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(member.enrolledAt))}</small></span><b>View</b></article>)}{!active.length && !message && <p className="empty">{query ? "No students match that search." : "No active students."}</p>}</div>
    {revoked.length > 0 && <details className="history-fold"><summary>Revoked · {revoked.length}</summary><div className="classroom-roster-list">{revoked.map((member) => <article key={member.userId} onClick={() => setOpenStudentId(member.userId)} onContextMenu={openMenu(member.userId)}><span><strong>{member.label}</strong><small>{member.email ?? "No email on file"}</small></span><b>View</b></article>)}</div></details>}
    {menu && menuMember && <div className="tab-menu" style={{ left: menu.left, top: menu.top }}><strong>{menuMember.label}</strong><div><button type="button" onClick={() => { setOpenStudentId(menuMember.userId); setMenu(null); }}>View student</button><button type="button" onClick={() => setMenu(null)}>Close</button></div>{menuMember.status === "active" ? <button type="button" onClick={() => { onRevoke(menuMember.userId); setMenu(null); }}>Revoke access</button> : <button type="button" onClick={() => { onRestore(menuMember.userId); setMenu(null); }}>Restore access</button>}</div>}
    {openStudent && <div className="student-detail-backdrop" onClick={() => setOpenStudentId(null)}><section className="student-detail" onClick={(event) => event.stopPropagation()}>
      <header><div><p className="eyebrow">Student</p><h3>{openStudent.label}</h3><p>{openStudent.email ?? "No email on file"} · enrolled {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(openStudent.enrolledAt))}</p></div><button type="button" onClick={() => setOpenStudentId(null)}>Close</button></header>
      <div className="student-detail-assignments">{assignments.filter((assignment) => assignment.status !== "archived").map((assignment) => { const submission = submissionFor(assignment.id, openStudent.userId); const review = submission ? reviews.find((row) => row.submission_id === submission.id) : undefined; const status = submission?.status === "submitted" ? (review?.manual_score != null ? `${review.manual_score}%` : "Submitted") : submission ? "Draft saved" : "Not submitted"; return <article key={assignment.id}><span><strong>{assignment.title}</strong><small>{assignmentDates(assignment).map(forecastTargetTitle).join(" · ")}</small></span><b className={submission?.status === "submitted" ? "status-ready" : "status-pending"}>{status}</b></article>; })}{!assignments.filter((assignment) => assignment.status !== "archived").length && <p className="empty">No assignments have been created yet.</p>}</div>
      <div className="student-detail-actions">{openStudent.status === "active" ? <button type="button" className="danger" onClick={() => onRevoke(openStudent.userId)}>Revoke access</button> : <button type="button" onClick={() => onRestore(openStudent.userId)}>Restore access</button>}</div>
    </section></div>}
    {message && <p className="control-message" role="status">{message}</p>}
  </section>;
}

function ClassroomInstructorOverview({ assignment, submissions, reviews, roster, reviewOpenId, reviewComment, reviewScore, reviewMessage, onOpenReview, onReviewCommentChange, onReviewScoreChange, onSaveReview }: { assignment: ClassroomAssignment | null; submissions: AssignmentSubmission[]; reviews: AssignmentReview[]; roster: AcademicRosterMember[]; reviewOpenId: string | null; reviewComment: string; reviewScore: string; reviewMessage: string; onOpenReview: (submissionId: string | null) => void; onReviewCommentChange: (value: string) => void; onReviewScoreChange: (value: string) => void; onSaveReview: (submissionId: string) => void }) {
  const students = roster.filter((member) => member.role === "student");
  const submissionFor = (userId: string) => assignment ? submissions.find((submission) => submission.assignment_id === assignment.id && submission.student_id === userId) : undefined;
  const reviewsFor = (submissionId: string) => reviews.filter((review) => review.submission_id === submissionId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const rows = students.map((student) => {
    const submission = submissionFor(student.userId);
    const submissionReviews = submission ? reviewsFor(submission.id) : [];
    return { student, submission, latestReview: submissionReviews[0] ?? null, allReviews: submissionReviews };
  });
  const submitted = rows.filter((row) => row.submission?.status === "submitted").length;
  const reviewedCount = rows.filter((row) => row.latestReview).length;
  return <section className="classroom-instructor-overview"><header><div><p className="eyebrow">Instructor overview</p><h3>{assignment?.title ?? "No active assignment"}</h3><p>{assignment ? "Track completion and leave feedback for this assignment." : "Select or create an assignment to see the class workflow."}</p></div></header>{assignment && <><div className="instructor-overview-metrics"><article><span>Submitted</span><strong>{submitted}/{students.length || "—"}</strong><small>of enrolled students</small></article><article><span>Feedback given</span><strong>{reviewedCount}/{submitted || "—"}</strong><small>reviewed submissions</small></article><article><span>Due status</span><strong>{assignment.due_at && new Date(assignment.due_at).getTime() < Date.now() ? "Closed" : assignment.status}</strong><small>{assignment.due_at ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(assignment.due_at)) : "No due time set"}</small></article></div><section className="instructor-roster-status"><header><div><p className="eyebrow">Student status</p><h4>Review queue</h4><p>Leave a score or written feedback once a student has submitted.</p></div></header><div>{rows.map((row) => <article key={row.student.userId}><div className="review-row-summary"><span><strong>{row.student.label}</strong><small>{row.submission?.submitted_at ? `Submitted ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(row.submission.submitted_at))}` : row.submission ? "Draft saved" : "No submission yet"}</small></span><span><b className={row.submission?.status === "submitted" ? "status-ready" : "status-pending"}>{row.submission?.status === "submitted" ? "Submitted" : row.submission ? "Draft" : "Missing"}</b><em>{row.latestReview?.manual_score != null ? `Score ${row.latestReview.manual_score}%` : row.latestReview ? "Feedback saved" : "No feedback yet"}</em><button type="button" disabled={row.submission?.status !== "submitted"} onClick={() => onOpenReview(reviewOpenId === row.submission?.id ? null : row.submission!.id)}>{reviewOpenId === row.submission?.id ? "Close" : "Review"}</button></span></div>{row.submission && reviewOpenId === row.submission.id && <div className="assignment-review-form"><div className="assignment-submission-days">{assignmentDates(assignment).map((date) => <AssignmentDayMiniCard key={date} date={date} response={row.submission!.responses[date]} />)}</div><label>Feedback<textarea value={reviewComment} onChange={(event) => onReviewCommentChange(event.target.value)} placeholder="Feedback private to this student and the teaching team…" /></label><label>Manual score (optional)<input inputMode="numeric" value={reviewScore} onChange={(event) => onReviewScoreChange(event.target.value)} placeholder="0–100" /></label><button type="button" onClick={() => onSaveReview(row.submission!.id)}>Save review</button>{reviewMessage && <p className="control-message" role="status">{reviewMessage}</p>}{row.allReviews.length > 0 && <div className="review-notes"><strong>Review history</strong>{row.allReviews.map((review) => <article key={review.id}><span>{review.manual_score === null ? "Comment" : `Score ${review.manual_score}%`}</span><p>{review.comment || "No written comment."}</p></article>)}</div>}</div>}</article>)}{!students.length && <p className="empty">Add students in Settings before using this overview.</p>}</div></section></>}</section>;
}

function ClassroomReviewPanel({ target, runs, selectedRun, notes, comment, manualScore, message, onSelectRun, onCommentChange, onManualScoreChange, onSave, onClose }: { target: ReviewTarget; runs: ReviewRun[]; selectedRun: ReviewRun | null; notes: Record<string, ForecastReview[]>; comment: string; manualScore: string; message: string; onSelectRun: (id: string) => void; onCommentChange: (value: string) => void; onManualScoreChange: (value: string) => void; onSave: (id: string) => void; onClose: () => void }) {
  return <section className="classroom-review-panel"><header className="section-heading"><div><p className="eyebrow">Assignment assessment</p><h2>Review {target.label}</h2><p>Private instructor feedback and manual assessment for this classroom only.</p></div><button type="button" onClick={onClose}>Back to assignment</button></header>{runs.length > 0 && <div className="review-run-list">{runs.map((run) => { const periods = Array.isArray(run.forecast_periods) ? run.forecast_periods : []; const day = periods.find((period) => period.period === "day"); const night = periods.find((period) => period.period === "night"); return <button type="button" key={run.id} className={selectedRun?.id === run.id ? "active" : ""} onClick={() => onSelectRun(run.id)}><strong>{forecastTargetTitle(day?.valid_date ?? run.created_at.slice(0, 10))}</strong><span>H {displayForecastTemperature(day?.forecast_data.highLow ?? "")} · L {displayForecastTemperature(night?.forecast_data.highLow ?? "")}</span><small>{run.status}</small></button>; })}</div>}{selectedRun && <section className="classroom-review-detail"><div className="review-forecast-grid">{(["day", "night"] as const).map((name) => { const period = selectedRun.forecast_periods.find((entry) => entry.period === name); const score = period?.forecast_verifications?.[0]?.score_data?.automaticScore; return <article key={name}><span>{name}</span><strong>{displayForecastTemperature(period?.forecast_data.highLow ?? "")}</strong><small>{conditionLabel(period?.forecast_data.conditions ?? "")}</small><small>{score === undefined || score === null ? "Automatic score pending" : `Automatic score ${score}%`}</small></article>; })}</div><div className="review-note-form"><label>Instructor comment<textarea value={comment} onChange={(event) => onCommentChange(event.target.value)} placeholder="Feedback private to this student and the teaching team…" /></label><label>Manual grade (optional)<input inputMode="numeric" value={manualScore} onChange={(event) => onManualScoreChange(event.target.value)} placeholder="0–100" /></label><button type="button" onClick={() => onSave(selectedRun.id)}>Save assessment</button></div><div className="review-notes"><strong>Assessment history</strong>{(notes[selectedRun.id] ?? []).map((note) => <article key={note.id}><span>{note.manual_score === null ? "Comment" : `Manual score ${note.manual_score}%`}</span><p>{note.comment || "No written comment."}</p></article>)}{!(notes[selectedRun.id] ?? []).length && <p>No assessment has been saved yet.</p>}</div></section>}{!runs.length && <p className="empty">No submitted forecasts are available for this student yet.</p>}{message && <p className="control-message" role="status">{message}</p>}</section>;
}

type ReviewRubricInput = { accuracy: string; reasoning: string; communication: string };

function InstructorRubricCard({ rubric, onRubricChange, notes, onSave }: { rubric: ReviewRubricInput; onRubricChange: (update: (scores: ReviewRubricInput) => ReviewRubricInput) => void; notes: ForecastReview[]; onSave: () => void }) {
  return <section className="workspace-card review-rubric-card"><header><div><p className="eyebrow">Instructor rubric</p><h3>Private assessment</h3><p>Optional rubric values complement automatic weather verification; they never replace the automatic score.</p></div></header><div className="review-rubric-grid"><label>Forecast accuracy<input inputMode="numeric" value={rubric.accuracy} onChange={(event) => onRubricChange((scores) => ({ ...scores, accuracy: event.target.value }))} placeholder="0–100" /><small>Judgment beyond the automated score.</small></label><label>Evidence & reasoning<input inputMode="numeric" value={rubric.reasoning} onChange={(event) => onRubricChange((scores) => ({ ...scores, reasoning: event.target.value }))} placeholder="0–100" /><small>Use of guidance, references, and rationale.</small></label><label>Timing & communication<input inputMode="numeric" value={rubric.communication} onChange={(event) => onRubricChange((scores) => ({ ...scores, communication: event.target.value }))} placeholder="0–100" /><small>Clear conditions, timing, hazards, and presentation.</small></label></div><div className="review-rubric-actions"><small>Leave a field blank when it is not part of this assignment. Add written feedback in the review panel above.</small><button type="button" onClick={onSave}>Save rubric</button></div>{notes.some((note) => Object.keys(note.rubric_scores ?? {}).length) && <div className="review-rubric-history">{notes.filter((note) => Object.keys(note.rubric_scores ?? {}).length).map((note) => <span key={note.id}>Accuracy {note.rubric_scores?.accuracy ?? "—"} · Evidence {note.rubric_scores?.reasoning ?? "—"} · Communication {note.rubric_scores?.communication ?? "—"}</span>)}</div>}</section>;
}

// deprecated: single-date, single-form predecessor of ClassroomAssignmentStudio; never rendered. Kept for reference.
/* function LegacyClassroomAssignmentDesk({ assignments, submissions, roster, selectedAssignmentId, canManage, onCreate, onOpenForecast, onOpenAssignment, onSaveClassForecast, onPublishClassForecast, message }: { assignments: ClassroomAssignment[]; submissions: ClassroomAssignmentSubmission[]; roster: AcademicRosterMember[]; selectedAssignmentId: string; canManage: boolean; onCreate: (fields: Pick<ClassroomAssignment, "title" | "instructions" | "target_date" | "due_at" | "status">) => void; onOpenForecast: () => void; onOpenAssignment: (assignment: ClassroomAssignment) => void; onSaveClassForecast: (snapshot: ClassForecastSnapshot) => void; onPublishClassForecast: () => void; message: string }) {
  const [title, setTitle] = useState("");
  const [targetDate, setTargetDate] = useState(nextForecastDate());
  const [dueAt, setDueAt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [status, setStatus] = useState<ClassroomAssignment["status"]>("open");
  const selectedAssignment = assignments.find((assignment) => assignment.id === selectedAssignmentId) ?? null;
  const instructorForecast = selectedAssignment?.instructor_forecast ?? null;
  const latestByStudent = new Map<string, ClassroomAssignmentSubmission>();
  submissions.filter((submission) => submission.assignment_id === selectedAssignmentId && submission.status !== "withdrawn").sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).forEach((submission) => { if (!latestByStudent.has(submission.user_id)) latestByStudent.set(submission.user_id, submission); });
  const latestSubmissions = [...latestByStudent.values()];
  const students = roster.filter((member) => member.role === "student");
  const classForecast = selectedAssignment ? buildClassForecastSnapshot(selectedAssignment, submissions, students) : null;
  const visibleClassForecast = selectedAssignment && (canManage || selectedAssignment.class_forecast_published_at) ? selectedAssignment.class_forecast : null;
  const studentName = (userId: string) => roster.find((member) => member.userId === userId)?.label ?? "Student";
  return <section className="assignment-desk"><header><div><p className="eyebrow">Forecast assignments</p><h3>Class work</h3><p>Assignments link a student’s submitted forecast to a target date without making student work public.</p></div><button type="button" onClick={onOpenForecast}>Open forecast</button></header>{canManage && <form onSubmit={(event) => { event.preventDefault(); if (!title.trim() || !targetDate) return; onCreate({ title: title.trim(), instructions: instructions.trim() || null, target_date: targetDate, due_at: dueAt ? new Date(dueAt).toISOString() : null, status }); setTitle(""); setInstructions(""); setDueAt(""); }}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Assignment title" /><input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /><select value={status} onChange={(event) => setStatus(event.target.value as ClassroomAssignment["status"])}><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></select><textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Optional direction or grading focus" /><button type="submit">Create assignment</button></form>}<div className="assignment-list">{assignments.map((assignment) => <button type="button" key={assignment.id} className={assignment.id === selectedAssignmentId ? "active" : ""} onClick={() => onOpenAssignment(assignment)}><span><strong>{assignment.title}</strong><small>{forecastTargetTitle(assignment.target_date)}{assignment.due_at ? ` · due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(assignment.due_at))}` : ""}</small>{assignment.instructions && <em>{assignment.instructions}</em>}</span><b>{assignment.id === selectedAssignmentId ? "Selected" : "Open"}</b></button>)}{!assignments.length && <p className="empty">No class assignments are open yet.</p>}</div>{selectedAssignment && <section className="assignment-instructor-forecast"><header><div><p className="eyebrow">Instructor forecast</p><h4>{instructorForecast ? "Published class example" : "No class example yet"}</h4><p>{instructorForecast ? `Captured ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(instructorForecast.saved_at))} · ${instructorForecast.location_name}` : canManage ? "Open this assignment and submit a forecast as the instructor example." : "Your instructor has not posted a class example yet."}</p></div></header>{instructorForecast && <div className="assignment-forecast-grid">{instructorForecast.days.filter((day) => day.date === selectedAssignment.target_date).map((day) => <div key={day.date}><article><span>Day</span><strong>H {displayForecastTemperature(day.day.highLow)}</strong><small>{conditionLabel(day.day.conditions)} · PoP {displayForecastChance(day.day.rainChance)}</small><p>{[day.day.timing, day.day.hazards].filter(Boolean).join(" · ") || "No timing or hazards entered."}</p></article><article><span>Night</span><strong>L {displayForecastTemperature(day.night.highLow)}</strong><small>{conditionLabel(day.night.conditions)} · PoP {displayForecastChance(day.night.rainChance)}</small><p>{[day.night.timing, day.night.hazards].filter(Boolean).join(" · ") || "No timing or hazards entered."}</p></article></div>)}</div>}</section>}{selectedAssignment && <section className="assignment-class-forecast"><header><div><p className="eyebrow">Class forecast</p><h4>{visibleClassForecast ? (selectedAssignment.class_forecast_published_at ? "Published to this class" : "Instructor draft") : "Class average"}</h4><p>{canManage ? "Use the live consensus below to create a classroom forecast. Publishing shares it with this class only; it is never public." : visibleClassForecast ? `Class forecast published ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" }).format(new Date(selectedAssignment.class_forecast_published_at ?? visibleClassForecast.generated_at))}.` : "A class forecast has not been published yet."}</p></div></header>{canManage && classForecast && <><div className="class-forecast-summary"><article><span>Submitted</span><strong>{classForecast.submitted_count}/{classForecast.total_students}</strong><small>latest student forecasts</small></article><article><span>Day average</span><strong>{classForecast.day.high_f ?? "—"}° / {classForecast.day.pop ?? "—"}%</strong><small>{classForecast.day.conditions.join(" · ") || "No conditions yet"}</small></article><article><span>Night average</span><strong>{classForecast.night.low_f ?? "—"}° / {classForecast.night.pop ?? "—"}%</strong><small>{classForecast.night.conditions.join(" · ") || "No conditions yet"}</small></article></div><div className="class-forecast-actions"><button type="button" onClick={() => onSaveClassForecast(classForecast)}>Save class average</button><button type="button" disabled={!selectedAssignment.class_forecast} onClick={onPublishClassForecast}>{selectedAssignment.class_forecast_published_at ? "Update class publication" : "Publish to class"}</button></div></>}{visibleClassForecast && <div className="class-forecast-graphic" aria-label="Class forecast graphic"><span style={{ width: `${Math.min(100, Math.max(8, visibleClassForecast.day.pop ?? 0))}%` }}>Day PoP {visibleClassForecast.day.pop ?? "—"}%</span><span style={{ width: `${Math.min(100, Math.max(8, visibleClassForecast.night.pop ?? 0))}%` }}>Night PoP {visibleClassForecast.night.pop ?? "—"}%</span></div>}</section>}{canManage && selectedAssignment && <section className="assignment-submissions"><header><div><p className="eyebrow">Student submissions</p><h4>{latestSubmissions.length} latest submission{latestSubmissions.length === 1 ? "" : "s"}</h4><p>Each student is listed once by their latest submission. Expand a name to inspect the private forecast.</p></div></header><div>{latestSubmissions.map((submission) => { const day = submission.forecast_periods.find((period) => period.valid_date === selectedAssignment.target_date && period.period === "day"); const night = submission.forecast_periods.find((period) => period.valid_date === selectedAssignment.target_date && period.period === "night"); return <details key={submission.id}><summary><span><strong>{studentName(submission.user_id)}</strong><small>Submitted {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(submission.created_at))}</small></span><span>H {displayForecastTemperature(day?.forecast_data.highLow ?? "")} · L {displayForecastTemperature(night?.forecast_data.highLow ?? "")}</span></summary><div><article><strong>Day</strong><span>{conditionLabel(day?.forecast_data.conditions ?? "")} · PoP {displayForecastChance(day?.forecast_data.rainChance ?? "")}</span><p>{[day?.forecast_data.timing, day?.forecast_data.hazards].filter(Boolean).join(" · ") || "No timing or hazards entered."}</p></article><article><strong>Night</strong><span>{conditionLabel(night?.forecast_data.conditions ?? "")} · PoP {displayForecastChance(night?.forecast_data.rainChance ?? "")}</span><p>{[night?.forecast_data.timing, night?.forecast_data.hazards].filter(Boolean).join(" · ") || "No timing or hazards entered."}</p></article></div></details>; })}{!latestSubmissions.length && <p className="empty">No student submissions have been linked to this assignment yet.</p>}</div></section>}{message && <p className="control-message" role="status">{message}</p>}</section>;
} */

type ClassroomAssignmentFields = Pick<ClassroomAssignment, "title" | "instructions" | "due_at" | "status"> & { target_dates: string[] };

function AssignmentDayMiniCard({ date, response }: { date: string; response: AssignmentDayResponse | undefined }) {
  const day = response?.day;
  const night = response?.night;
  const hasAnswer = Boolean(day?.highLow || day?.conditions || night?.highLow || night?.conditions);
  return <article className="assignment-day-mini">
    <header><strong>{forecastTargetTitle(date)}</strong><span>{hasAnswer ? "Answered" : "Not answered"}</span></header>
    <div><span>Day</span><b>H {displayForecastTemperature(day?.highLow ?? "")}</b><small>{conditionLabel(day?.conditions ?? "—")} · {displayForecastChance(day?.rainChance ?? "")}</small></div>
    <div><span>Night</span><b>L {displayForecastTemperature(night?.highLow ?? "")}</b><small>{conditionLabel(night?.conditions ?? "—")} · {displayForecastChance(night?.rainChance ?? "")}</small></div>
  </article>;
}

// deprecated: this was the old per-assignment "class outlook" (an instructor-published
// average of that assignment's submissions) that duplicated, and confusingly co-existed
// with, the real classroom-wide live aggregate (ClassroomLiveForecast). Assignments are
// practice-only now and deliberately do not feed any class-level forecast. Kept for reference.
/* function ClassForecastOutlook({ assignment, snapshot, canManage, onSave, onPublish }: { assignment: ClassroomAssignment; snapshot: ClassForecastSnapshot; canManage: boolean; onSave: () => void; onPublish: () => void }) {
  const days = snapshot.days?.length ? snapshot.days : [{ date: snapshot.target_date, submitted_count: snapshot.submitted_count, day: snapshot.day, night: snapshot.night }];
  const published = Boolean(assignment.class_forecast_published_at);
  return <section className="class-forecast-outlook"><header><div><p className="eyebrow">Class outlook</p><h3>{assignment.title}</h3><p>{snapshot.submitted_count}/{snapshot.total_students || "—"} students represented in this class forecast.</p></div>{canManage && <div><button type="button" onClick={onSave}>Save class outlook</button><button type="button" onClick={onPublish}>{published ? "Update class outlook" : "Publish to class"}</button></div>}</header><div className="class-outlook-cards">{days.map((day) => <article key={day.date}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(`${day.date}T12:00:00`))}</strong><b>{day.day.conditions[0] || day.night.conditions[0] || "Forecast"}</b><em>{day.day.high_f ?? "—"}° / {day.night.low_f ?? "—"}°</em><small>Day {day.day.pop ?? "—"}% · Night {day.night.pop ?? "—"}%</small><span>{[...day.day.conditions, ...day.night.conditions].filter(Boolean).slice(0, 2).join(" · ") || "Awaiting submissions"}</span></article>)}</div>{published && <small className="class-outlook-status">Published for this class · never sent to the public Frontline Forecast.</small>}</section>;
} */

// deprecated: superseded by ClassForecastHubV2; its applyConsensusDay/"generate from guidance" idea
// was ported into V2 (the "Generate from local guidance" button). Kept for reference.
/* function ClassForecastHub({ official, assignment, submissions, roster, publicGuidance, canManage, onSave, onPublish }: { official: ClassroomOfficialForecast | null; assignment: ClassroomAssignment | null; submissions: ClassroomAssignmentSubmission[]; roster: AcademicRosterMember[]; publicGuidance: { date: string; label: string; high: number | null; low: number | null; shortForecast: string; precipitationChance: number | null }[]; canManage: boolean; onSave: (forecast: ClassForecastSnapshot) => void; onPublish: (forecast: ClassForecastSnapshot) => void }) {
  const officialSource = official?.forecast?.days?.length ? official.forecast : emptyOfficialClassForecast();
  const [draft, setDraft] = useState<ClassForecastSnapshot>(officialSource);
  useEffect(() => { setDraft(official?.forecast?.days?.length ? official.forecast : emptyOfficialClassForecast()); }, [official?.updated_at, official?.classroom_id]);
  // Individual assignment consensus remains in Assignments, where instructors review it.
  // The class forecast tab stays focused on the single seven-day class outlook.
  const [showAssignmentConsensus] = useState(false);
  const consensus: ClassForecastSnapshot | null = showAssignmentConsensus && assignment ? buildClassForecastSnapshot(assignment, submissions, roster) : null;
  const days = draft.days ?? [];
  const updateDay = (date: string, period: "day" | "night", field: "temperature" | "pop" | "conditions", value: string) => setDraft((current) => {
    const nextDays = (current.days ?? []).map((day) => day.date !== date ? day : { ...day, [period]: { ...day[period], ...(field === "temperature" ? (period === "day" ? { high_f: value === "" ? null : Number(value) } : { low_f: value === "" ? null : Number(value) }) : field === "pop" ? { pop: value === "" ? null : Number(value) } : { conditions: value ? [value] : [] }) } });
    return { ...current, generated_at: new Date().toISOString(), target_date: nextDays[0]?.date ?? current.target_date, day: nextDays[0]?.day ?? current.day, night: nextDays[0]?.night ?? current.night, days: nextDays };
  });
  const applyConsensusDay = (source: ClassForecastDay) => setDraft((current) => {
    const nextDays = (current.days ?? []).map((day) => day.date === source.date ? { ...source } : day);
    return { ...current, generated_at: new Date().toISOString(), target_date: nextDays[0]?.date ?? current.target_date, day: nextDays[0]?.day ?? current.day, night: nextDays[0]?.night ?? current.night, days: nextDays };
  });
  return <section className="class-forecast-hub"><header className="section-heading"><div><p className="eyebrow">Class forecast</p><h2>Official class outlook</h2><p>One class-owned seven-day forecast. Assignment consensus can be applied to any matching day.</p></div><span>{official?.published_at ? "Published to class" : "Classroom draft"}</span></header><section className="official-class-outlook"><header><div><h3>Class outlook</h3><p>{official?.published_at ? `Published ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "America/New_York" }).format(new Date(official.published_at))}` : "Build this forecast from class discussion and assignment consensus."}</p></div>{canManage && <div><button type="button" onClick={() => onSave(draft)}>Save draft</button><button type="button" onClick={() => onPublish(draft)}>Publish to class</button></div>}</header><div className="official-outlook-grid">{days.map((day) => <article key={day.date}><strong>{forecastTargetTitle(day.date)}</strong>{canManage ? <><label>High<input inputMode="numeric" value={day.day.high_f ?? ""} onChange={(event) => updateDay(day.date, "day", "temperature", event.target.value)} placeholder="—" />°</label><label>Low<input inputMode="numeric" value={day.night.low_f ?? ""} onChange={(event) => updateDay(day.date, "night", "temperature", event.target.value)} placeholder="—" />°</label><label>Day PoP<input inputMode="numeric" value={day.day.pop ?? ""} onChange={(event) => updateDay(day.date, "day", "pop", event.target.value)} placeholder="—" />%</label><label>Night PoP<input inputMode="numeric" value={day.night.pop ?? ""} onChange={(event) => updateDay(day.date, "night", "pop", event.target.value)} placeholder="—" />%</label><label className="wide">Conditions<input value={day.day.conditions[0] ?? ""} onChange={(event) => updateDay(day.date, "day", "conditions", event.target.value)} placeholder="Conditions" /></label></> : <><b>{day.day.conditions[0] || day.night.conditions[0] || "Forecast"}</b><em>{day.day.high_f ?? "—"}° / {day.night.low_f ?? "—"}°</em><small>Day {day.day.pop ?? "—"}% · Night {day.night.pop ?? "—"}%</small></>}</article>)}</div></section><section className="official-guidance-compare"><header><div><p className="eyebrow">Forecast comparison</p><h3>Class outlook vs. local guidance</h3><p>Compare the class’s published approach with the current seven-day weather guidance.</p></div></header><div>{days.map((day) => { const guidance = publicGuidance.find((item) => item.date === day.date); return <article key={day.date}><strong>{forecastTargetTitle(day.date)}</strong><div><span>Class</span><b>{day.day.conditions[0] || "—"}</b><em>{day.day.high_f ?? "—"}° / {day.night.low_f ?? "—"}° · {day.day.pop ?? "—"}%</em></div><div><span>Local</span><b>{guidance?.shortForecast ?? "—"}</b><em>{guidance?.high ?? "—"}° / {guidance?.low ?? "—"}° · {guidance?.precipitationChance ?? "—"}%</em></div></article>; })}</div></section>{consensus && <section className="assignment-consensus"><header><div><p className="eyebrow">Assignment comparison</p><h3>{assignment?.title}</h3><p>Latest student submissions for this assignment. Apply a day only when you want it in the official outlook.</p></div></header><div>{(consensus.days ?? []).map((day) => <article key={day.date}><span><strong>{forecastTargetTitle(day.date)}</strong><small>{day.submitted_count}/{consensus.total_students || "—"} student forecasts</small></span><b>{day.day.conditions[0] || day.night.conditions[0] || "No consensus"}</b><em>{day.day.high_f ?? "—"}° / {day.night.low_f ?? "—"}° · {day.day.pop ?? "—"}%/{day.night.pop ?? "—"}%</em>{canManage && <button type="button" onClick={() => applyConsensusDay(day)}>Use for this day</button>}</article>)}</div></section>}</section>;
} */

// deprecated: superseded by ClassroomLiveForecast, which derives the class outlook automatically
// from student submissions instead of an instructor hand-typed forecast. Kept for reference.
/* function ClassForecastHubV2({ official, publicGuidance, canManage, onSave, onPublish }: { official: ClassroomOfficialForecast | null; publicGuidance: { date: string; label: string; high: number | null; low: number | null; shortForecast: string; precipitationChance: number | null }[]; canManage: boolean; onSave: (forecast: ClassForecastSnapshot) => void; onPublish: (forecast: ClassForecastSnapshot) => void }) {
  const source = official?.forecast?.days?.length ? official.forecast : emptyOfficialClassForecast();
  const [draft, setDraft] = useState<ClassForecastSnapshot>(source);
  const [selectedDate, setSelectedDate] = useState(source.days?.[0]?.date ?? source.target_date);

  useEffect(() => {
    const next = official?.forecast?.days?.length ? official.forecast : emptyOfficialClassForecast();
    setDraft(next);
    setSelectedDate(next.days?.[0]?.date ?? next.target_date);
  }, [official?.updated_at, official?.classroom_id]);

  const days = draft.days ?? [];
  const selectedDay = days.find((day) => day.date === selectedDate) ?? days[0];
  const selectedGuidance = publicGuidance.find((day) => day.date === selectedDay?.date);
  const update = (period: "day" | "night", field: "high_f" | "low_f" | "pop" | "conditions", value: string) => {
    if (!selectedDay) return;
    setDraft((current) => {
      const nextDays = (current.days ?? []).map((day) => {
        if (day.date !== selectedDay.date) return day;
        const periodValues = field === "conditions"
          ? { conditions: value ? [value] : [] }
          : { [field]: value === "" ? null : Number(value) };
        return { ...day, [period]: { ...day[period], ...periodValues } };
      });
      return { ...current, generated_at: new Date().toISOString(), target_date: nextDays[0]?.date ?? current.target_date, day: nextDays[0]?.day ?? current.day, night: nextDays[0]?.night ?? current.night, days: nextDays };
    });
  };
  const applyGuidance = (source: { date: string; high: number | null; low: number | null; shortForecast: string; precipitationChance: number | null }) => ({ date: source.date, submitted_count: 0, day: { high_f: source.high, pop: source.precipitationChance, conditions: source.shortForecast ? [source.shortForecast] : [] }, night: { low_f: source.low, pop: source.precipitationChance, conditions: source.shortForecast ? [source.shortForecast] : [] } });
  const generateFromGuidance = () => setDraft((current) => {
    const nextDays = (current.days ?? []).map((day) => { const guidance = publicGuidance.find((item) => item.date === day.date); return guidance ? applyGuidance(guidance) : day; });
    return { ...current, generated_at: new Date().toISOString(), target_date: nextDays[0]?.date ?? current.target_date, day: nextDays[0]?.day ?? current.day, night: nextDays[0]?.night ?? current.night, days: nextDays };
  });
  const generateDayFromGuidance = (date: string) => setDraft((current) => {
    const guidance = publicGuidance.find((item) => item.date === date);
    if (!guidance) return current;
    const nextDays = (current.days ?? []).map((day) => day.date === date ? applyGuidance(guidance) : day);
    return { ...current, generated_at: new Date().toISOString(), target_date: nextDays[0]?.date ?? current.target_date, day: nextDays[0]?.day ?? current.day, night: nextDays[0]?.night ?? current.night, days: nextDays };
  });

  return <section className="class-forecast-hub class-forecast-hub-v2">
    <header className="section-heading"><div><p className="eyebrow">Class forecast</p><h2>Official class outlook</h2><p>A class-owned seven-day forecast, separate from local Frontline Forecast guidance.</p></div>{canManage && <button type="button" onClick={generateFromGuidance}>Generate from local guidance</button>}<span>{official?.published_at ? "Published to class" : "Classroom draft"}</span></header>
    <section className="outlook-strip class-outlook-strip" aria-label="Class seven-day outlook">
      <div className="outlook-heading"><div><h2>Class 7-day outlook</h2><p>{official?.published_at ? "Published for this class" : "Draft class forecast"}</p></div><span>Class</span></div>
      <div className="outlook-cards">{days.map((day) => <button type="button" key={day.date} className={day.date === selectedDay?.date ? "active" : ""} onClick={() => setSelectedDate(day.date)}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(new Date(`${day.date}T12:00:00`))}</strong><b aria-hidden="true"><WeatherIcon description={day.day.conditions[0] || day.night.conditions[0] || "Forecast"} style="traditional" /></b><span>{day.day.conditions[0] || day.night.conditions[0] || "Forecast not set"}</span><em>{day.day.high_f ?? "—"}° / {day.night.low_f ?? "—"}°</em><small>{day.day.pop ?? "—"}% PoP</small></button>)}</div>
    </section>
    <section className="outlook-strip class-outlook-strip" aria-label="Local seven-day guidance">
      <div className="outlook-heading"><div><h2>NWS 7-Day Forecast</h2></div><span>Local</span></div>
      <div className="outlook-cards">{days.map((day) => { const guidance = publicGuidance.find((item) => item.date === day.date); return <button type="button" key={day.date} className={day.date === selectedDay?.date ? "active" : ""} onClick={() => setSelectedDate(day.date)}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(new Date(`${day.date}T12:00:00`))}</strong><b aria-hidden="true"><WeatherIcon description={guidance?.shortForecast ?? "Forecast"} style="traditional" /></b><span>{guidance?.shortForecast ?? "Guidance unavailable"}</span><em>{guidance?.high ?? "—"}° / {guidance?.low ?? "—"}°</em><small>{guidance?.precipitationChance ?? "—"}% PoP</small></button>; })}</div>
    </section>
    {selectedDay && <section className="class-outlook-detail"><header><div><p className="eyebrow">Selected day</p><h3>{forecastTargetTitle(selectedDay.date)}</h3><p>Review the class forecast and current local guidance for this day.</p></div>{canManage && <div><button type="button" onClick={() => onSave(draft)}>Save draft</button><button type="button" onClick={() => onPublish(draft)}>Publish to class</button></div>}</header><div><fieldset><legend>Class forecast</legend>{canManage ? <div className="class-outlook-fields"><label>High<input inputMode="numeric" value={selectedDay.day.high_f ?? ""} onChange={(event) => update("day", "high_f", event.target.value)} />°</label><label>Low<input inputMode="numeric" value={selectedDay.night.low_f ?? ""} onChange={(event) => update("night", "low_f", event.target.value)} />°</label><label>Day PoP<input inputMode="numeric" value={selectedDay.day.pop ?? ""} onChange={(event) => update("day", "pop", event.target.value)} />%</label><label>Night PoP<input inputMode="numeric" value={selectedDay.night.pop ?? ""} onChange={(event) => update("night", "pop", event.target.value)} />%</label><label className="wide">Conditions<input value={selectedDay.day.conditions[0] ?? ""} onChange={(event) => update("day", "conditions", event.target.value)} placeholder="Conditions" /></label></div> : <div className="class-outlook-readout"><strong>{selectedDay.day.conditions[0] || selectedDay.night.conditions[0] || "Forecast not set"}</strong><b>{selectedDay.day.high_f ?? "—"}° / {selectedDay.night.low_f ?? "—"}°</b><span>Day {selectedDay.day.pop ?? "—"}% · Night {selectedDay.night.pop ?? "—"}%</span></div>}</fieldset><fieldset><legend>Local guidance</legend><div className="class-outlook-readout"><strong>{selectedGuidance?.shortForecast ?? "Guidance unavailable"}</strong><b>{selectedGuidance?.high ?? "—"}° / {selectedGuidance?.low ?? "—"}°</b><span>{selectedGuidance?.precipitationChance ?? "—"}% PoP</span></div>{canManage && selectedGuidance && <button type="button" onClick={() => generateDayFromGuidance(selectedDay.date)}>Use local guidance for this day</button>}</fieldset></div></section>}
  </section>;
} */

function ClassroomAssignmentStudio({ assignments, submissions, references, reviews, roster, selectedAssignmentId, dismissedAssignmentId, canManage, myUserId, weatherIconStyle, draftResponses, saving, referenceOptions, linkLabel, linkUrl, onCreate, onSelectAssignment, onDismissAssignment, onUpdateAssignment, onDraftChange, onFormatDraftField, onSaveDraft, onAddReference, onRemoveReference, onLinkLabelChange, onLinkUrlChange, onAddLinkReference, message }: { assignments: ClassroomAssignment[]; submissions: AssignmentSubmission[]; references: AssignmentReferenceItem[]; reviews: AssignmentReview[]; roster: AcademicRosterMember[]; selectedAssignmentId: string; dismissedAssignmentId: string | null; canManage: boolean; myUserId?: string; weatherIconStyle: WeatherIconStyle; draftResponses: Record<string, AssignmentDayResponse>; saving: boolean; referenceOptions: ReferenceItem[]; linkLabel: string; linkUrl: string; onCreate: (fields: ClassroomAssignmentFields) => void; onSelectAssignment: (assignment: ClassroomAssignment) => void; onDismissAssignment: (assignmentId: string) => void; onUpdateAssignment: (assignmentId: string, fields: Partial<Pick<ClassroomAssignment, "title" | "instructions" | "due_at" | "status">>) => void; onDraftChange: (date: string, period: "day" | "night", field: keyof AssignmentPeriodResponse, value: string) => void; onFormatDraftField: (date: string, period: "day" | "night", field: "highLow" | "rainChance" | "timing") => void; onSaveDraft: (assignment: ClassroomAssignment, submit: boolean) => void; onAddReference: (assignment: ClassroomAssignment, item: ReferenceItem) => void; onRemoveReference: (id: string) => void; onLinkLabelChange: (value: string) => void; onLinkUrlChange: (value: string) => void; onAddLinkReference: (assignment: ClassroomAssignment) => void; message: string }) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(nextForecastDate());
  const [dayCount, setDayCount] = useState(1);
  const [dueAt, setDueAt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [status, setStatus] = useState<ClassroomAssignment["status"]>("open");
  const [assignmentMenu, setAssignmentMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editStatus, setEditStatus] = useState<ClassroomAssignment["status"]>("open");
  const targetDates = Array.from({ length: dayCount }, (_, index) => addDays(new Date(`${startDate}T12:00:00`), index));
  const submissionsFor = (assignmentId: string) => submissions.filter((submission) => submission.assignment_id === assignmentId);
  const toDatetimeLocalValue = (iso: string) => { const date = new Date(iso); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const startEdit = (assignment: ClassroomAssignment) => {
    onSelectAssignment(assignment);
    setEditingId(assignment.id);
    setEditTitle(assignment.title);
    setEditInstructions(assignment.instructions ?? "");
    setEditDueAt(assignment.due_at ? toDatetimeLocalValue(assignment.due_at) : "");
    setEditStatus(assignment.status);
    setAssignmentMenu(null);
  };
  const renderReference = (reference: AssignmentReferenceItem) => {
    if (reference.kind === "link") return <li key={reference.id}><strong>{reference.label}</strong>{reference.url && <> · <a href={reference.url} target="_blank" rel="noreferrer">Open</a></>}</li>;
    const detailText = typeof reference.detail?.text === "string" ? reference.detail.text : "";
    const preview = reference.detail?.preview as ReferencePreview | undefined;
    return <li key={reference.id}><strong>{reference.label}</strong><ArchivedReferencePreview reference={{ id: reference.id, label: reference.label, detail: detailText, preview }} /></li>;
  };
  const visibleAssignments = assignments.filter((assignment) => assignment.status !== "archived");
  const archivedAssignments = assignments.filter((assignment) => assignment.status === "archived");
  const renderAssignment = (assignment: ClassroomAssignment) => {
      const isOpen = assignment.id === selectedAssignmentId && dismissedAssignmentId !== assignment.id;
      const dates = assignmentDates(assignment);
      const assignmentSubmissions = isOpen ? submissionsFor(assignment.id) : [];
      const assignmentReferences = isOpen ? references.filter((reference) => reference.assignment_id === assignment.id) : [];
      const mySubmission = isOpen && myUserId ? assignmentSubmissions.find((submission) => submission.student_id === myUserId) : undefined;
      const myReview = mySubmission ? reviews.find((review) => review.submission_id === mySubmission.id) : undefined;
      const isEditing = isOpen && editingId === assignment.id;
      return <details key={assignment.id} open={isOpen} onToggle={(event) => { const nowOpen = (event.currentTarget as HTMLDetailsElement).open; if (nowOpen) { onSelectAssignment(assignment); } else if (assignment.id === selectedAssignmentId) { onDismissAssignment(assignment.id); if (editingId === assignment.id) setEditingId(null); } }}>
        <summary onContextMenu={canManage ? (event) => { event.preventDefault(); setAssignmentMenu({ id: assignment.id, left: event.clientX, top: event.clientY }); } : undefined}><span><strong>{assignment.title}</strong><small>{dates.map(forecastTargetTitle).join(" · ")}</small></span><b>{assignment.status}</b></summary>
        <div className="assignment-focus">
          {isEditing ? <form className="assignment-composer" onSubmit={(event) => { event.preventDefault(); if (!editTitle.trim()) return; onUpdateAssignment(assignment.id, { title: editTitle.trim(), instructions: editInstructions.trim() || null, due_at: editDueAt ? new Date(editDueAt).toISOString() : null, status: editStatus }); setEditingId(null); }}><div className="assignment-composer-fields"><label>Assignment name<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label>Due time<input type="datetime-local" value={editDueAt} onChange={(event) => setEditDueAt(event.target.value)} /></label><label>Status<select value={editStatus} onChange={(event) => setEditStatus(event.target.value as ClassroomAssignment["status"])}><option value="draft">Draft</option><option value="open">Open to students</option><option value="closed">Closed</option></select></label></div><label>Directions or grading focus<textarea value={editInstructions} onChange={(event) => setEditInstructions(event.target.value)} /></label><div className="settings-actions"><button type="submit" disabled={!editTitle.trim()}>Save changes</button><button type="button" onClick={() => setEditingId(null)}>Cancel</button></div></form> : <header><div><p>{assignment.instructions || "No additional directions were added."}</p><small>{dates.map(forecastTargetTitle).join(" · ")}{assignment.due_at ? ` · due ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(assignment.due_at))}` : ""}</small></div></header>}
          {assignment.scenario && <div className="assignment-linker scenario-context"><div><strong>Historical scenario</strong><small>This date has already happened — it's a real past event, not a hypothetical.</small>{assignment.scenario.summary && <em>{assignment.scenario.summary}</em>}{(assignment.scenario.reference_notes || assignment.scenario.reference_links.length > 0) && <details className="scenario-reference-details"><summary>Reference data</summary>{assignment.scenario.reference_notes && <p>{assignment.scenario.reference_notes}</p>}{assignment.scenario.reference_links.length > 0 && <ul>{assignment.scenario.reference_links.map((link) => <li key={link.label}>{link.label}{link.detail ? ` — ${link.detail}` : ""}{link.url && <> · <a href={link.url} target="_blank" rel="noreferrer">Open</a></>}</li>)}</ul>}</details>}</div></div>}
          {isOpen && canManage && <section className="assignment-reference-editor"><p className="eyebrow">Reference material</p><p className="assignment-reference-hint">Attach observations, model snapshots, or links for students to review before they answer.</p><ReferencePicker options={referenceOptions} references={assignmentReferences.filter((reference) => reference.kind !== "link").map((reference) => ({ id: reference.id, label: reference.label, detail: typeof reference.detail?.text === "string" ? reference.detail.text : "" }))} onAdd={(item) => onAddReference(assignment, item)} onRemove={onRemoveReference} addedLabel="Attached to this assignment" /><form className="assignment-link-form" onSubmit={(event) => { event.preventDefault(); if (!linkLabel.trim() || !linkUrl.trim()) return; onAddLinkReference(assignment); }}><label>Link label<input value={linkLabel} onChange={(event) => onLinkLabelChange(event.target.value)} placeholder="e.g. SPC Day 1 Outlook" /></label><label>URL<input type="url" value={linkUrl} onChange={(event) => onLinkUrlChange(event.target.value)} placeholder="https://…" /></label><button type="submit" disabled={!linkLabel.trim() || !linkUrl.trim()}>Add link</button></form>{assignmentReferences.filter((reference) => reference.kind === "link").length > 0 && <ul className="assignment-link-list">{assignmentReferences.filter((reference) => reference.kind === "link").map((reference) => <li key={reference.id}><strong>{reference.label}</strong> · <a href={reference.url ?? "#"} target="_blank" rel="noreferrer">Open</a> <button type="button" onClick={() => onRemoveReference(reference.id)}>Remove</button></li>)}</ul>}</section>}
          {isOpen && !canManage && assignmentReferences.length > 0 && <section className="assignment-reference-list"><p className="eyebrow">Reference material</p><ul>{assignmentReferences.map(renderReference)}</ul></section>}
          {isOpen && !canManage && <section className="assignment-response-form"><p className="eyebrow">Your forecast</p>{mySubmission?.status === "submitted" && <p className="assignment-submitted-note">Submitted{mySubmission.submitted_at ? ` ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(mySubmission.submitted_at))}` : ""}. You can still update your answer below.</p>}{dates.map((date) => { const response = draftResponses[date] ?? emptyAssignmentDayResponse; return <div key={date} className="forecast-period-columns">
            <fieldset className="forecast-period"><legend>{forecastTargetTitle(date)} day <small>7 AM–7 PM</small></legend><div className="forecast-fields">
              <label>High temperature<span className="unit-input" style={unitInputStyle(temperatureInputValue(response.day.highLow), 2)}><input inputMode="decimal" placeholder="82" value={temperatureInputValue(response.day.highLow)} onChange={(event) => onDraftChange(date, "day", "highLow", temperatureInputValue(event.target.value))} onBlur={() => onFormatDraftField(date, "day", "highLow")} /><i aria-hidden="true">°</i></span></label>
              <label>Conditions<select value={response.day.conditions} onChange={(event) => onDraftChange(date, "day", "conditions", event.target.value)}><option value="">Choose conditions</option>{conditionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="wide-field">Icon<IconPicker value={periodIconCondition({ conditions: response.day.conditions, iconCondition: response.day.iconCondition })} onChange={(next) => onDraftChange(date, "day", "iconCondition", next)} style={weatherIconStyle} /></label>
              <label>Rain chance<span className="unit-input" style={unitInputStyle(percentInputValue(response.day.rainChance), 2)}><input inputMode="numeric" placeholder="40" value={percentInputValue(response.day.rainChance)} onChange={(event) => onDraftChange(date, "day", "rainChance", percentInputValue(event.target.value))} onBlur={() => onFormatDraftField(date, "day", "rainChance")} /><i aria-hidden="true">%</i></span></label>
              <label>Likely timing<input placeholder="3–8 PM" value={response.day.timing} onChange={(event) => onDraftChange(date, "day", "timing", event.target.value)} onBlur={() => onFormatDraftField(date, "day", "timing")} /></label>
              <label>Wind<input value={response.day.wind} onChange={(event) => onDraftChange(date, "day", "wind", event.target.value)} /></label>
              <label>Confidence<select value={response.day.confidence} onChange={(event) => onDraftChange(date, "day", "confidence", event.target.value)}><option value="">Choose confidence</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
              <label className="wide-field">Hazards<textarea rows={2} placeholder="Hazards, impacts, or confidence notes" value={response.day.hazards} onChange={(event) => onDraftChange(date, "day", "hazards", event.target.value)} /></label>
              <label className="wide-field">Day reasoning<textarea value={response.day.reasoning} onChange={(event) => onDraftChange(date, "day", "reasoning", event.target.value)} /></label>
            </div></fieldset>
            <fieldset className="forecast-period"><legend>{forecastTargetTitle(date)} night <small>7 PM–7 AM</small></legend><div className="forecast-fields">
              <label>Low temperature<span className="unit-input" style={unitInputStyle(temperatureInputValue(response.night.highLow), 2)}><input inputMode="decimal" placeholder="61" value={temperatureInputValue(response.night.highLow)} onChange={(event) => onDraftChange(date, "night", "highLow", temperatureInputValue(event.target.value))} onBlur={() => onFormatDraftField(date, "night", "highLow")} /><i aria-hidden="true">°</i></span></label>
              <label>Conditions<select value={response.night.conditions} onChange={(event) => onDraftChange(date, "night", "conditions", event.target.value)}><option value="">Choose conditions</option>{conditionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="wide-field">Icon<IconPicker value={periodIconCondition({ conditions: response.night.conditions, iconCondition: response.night.iconCondition })} onChange={(next) => onDraftChange(date, "night", "iconCondition", next)} style={weatherIconStyle} /></label>
              <label>Rain chance<span className="unit-input" style={unitInputStyle(percentInputValue(response.night.rainChance), 2)}><input inputMode="numeric" placeholder="20" value={percentInputValue(response.night.rainChance)} onChange={(event) => onDraftChange(date, "night", "rainChance", percentInputValue(event.target.value))} onBlur={() => onFormatDraftField(date, "night", "rainChance")} /><i aria-hidden="true">%</i></span></label>
              <label>Likely timing<input placeholder="Before 10 PM" value={response.night.timing} onChange={(event) => onDraftChange(date, "night", "timing", event.target.value)} onBlur={() => onFormatDraftField(date, "night", "timing")} /></label>
              <label>Wind<input value={response.night.wind} onChange={(event) => onDraftChange(date, "night", "wind", event.target.value)} /></label>
              <label>Confidence<select value={response.night.confidence} onChange={(event) => onDraftChange(date, "night", "confidence", event.target.value)}><option value="">Choose confidence</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
              <label className="wide-field">Hazards<textarea rows={2} placeholder="Hazards, impacts, or confidence notes" value={response.night.hazards} onChange={(event) => onDraftChange(date, "night", "hazards", event.target.value)} /></label>
              <label className="wide-field">Night reasoning<textarea value={response.night.reasoning} onChange={(event) => onDraftChange(date, "night", "reasoning", event.target.value)} /></label>
            </div></fieldset>
          </div>; })}<div className="form-actions"><span>{message}</span><div><button type="button" onClick={() => onSaveDraft(assignment, false)} disabled={saving}>Save draft</button><button type="button" onClick={() => onSaveDraft(assignment, true)} disabled={saving}>{saving ? "Submitting…" : "Submit"}</button></div></div>{myReview && <div className="assignment-my-review"><strong>Instructor feedback</strong>{myReview.manual_score != null && <span>Score: {myReview.manual_score}%</span>}<p>{myReview.comment || "No written comment."}</p></div>}</section>}
        </div>
      </details>;
  };
  const menuAssignment = assignmentMenu ? assignments.find((assignment) => assignment.id === assignmentMenu.id) : null;
  return <section className="assignment-studio">
    <header className="section-heading"><div><p className="eyebrow">Assignments</p><h2>Assignments</h2></div>{canManage && <button type="button" onClick={() => setComposerOpen((open) => !open)}>{composerOpen ? "Cancel" : "+ New assignment"}</button>}</header>
    {canManage && composerOpen && <form className="assignment-composer" onSubmit={(event) => { event.preventDefault(); if (!title.trim() || !targetDates.length) return; onCreate({ title: title.trim(), instructions: instructions.trim() || null, target_dates: targetDates, due_at: dueAt ? new Date(dueAt).toISOString() : null, status }); setTitle(""); setInstructions(""); setDueAt(""); setStartDate(nextForecastDate()); setDayCount(1); setComposerOpen(false); }}><div className="assignment-composer-fields"><label>Assignment name<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Early-week convection" /></label><label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>Days<select value={dayCount} onChange={(event) => setDayCount(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6, 7].map((count) => <option key={count} value={count}>{count}</option>)}</select></label><label>Due time<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value as ClassroomAssignment["status"])}><option value="draft">Draft</option><option value="open">Open to students</option><option value="closed">Closed</option></select></label></div><label>Directions or grading focus<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="What should students examine, explain, or practice?" /></label><small className="assignment-composer-hint">Next you'll attach reference data — current observations, model snapshots, or links to NWS/historical data — for students to review before they forecast.</small><button type="submit" disabled={!title.trim() || !targetDates.length}>Create assignment</button></form>}
    <section className="assignment-rail"><header><h3>All assignments</h3>{canManage && <p>Right-click an assignment to edit or archive it.</p>}</header><div>{visibleAssignments.map(renderAssignment)}{!visibleAssignments.length && <p className="empty">No assignments have been created yet.</p>}</div>
      {canManage && archivedAssignments.length > 0 && <details className="history-fold"><summary>Archived · {archivedAssignments.length}</summary><div className="classroom-roster-list">{archivedAssignments.map((assignment) => <article key={assignment.id}><span><strong>{assignment.title}</strong><small>{assignmentDates(assignment).map(forecastTargetTitle).join(" · ")}</small></span><button type="button" onClick={() => onUpdateAssignment(assignment.id, { status: "draft" })}>Restore</button></article>)}</div></details>}
    </section>
    {assignmentMenu && menuAssignment && <div className="tab-menu" style={{ left: assignmentMenu.left, top: assignmentMenu.top }}><strong>{menuAssignment.title}</strong><div><button type="button" onClick={() => startEdit(menuAssignment)}>Edit assignment</button><button type="button" onClick={() => setAssignmentMenu(null)}>Close</button></div><small>Archiving hides it from the active list and from students, but keeps submission history.</small><button type="button" onClick={() => { onUpdateAssignment(menuAssignment.id, { status: "archived" }); setAssignmentMenu(null); }}>Archive assignment</button></div>}
    {!canManage && message && <p className="control-message" role="status">{message}</p>}
  </section>;
}

function ClassroomAssignmentDesk(props: { assignments: ClassroomAssignment[]; submissions: AssignmentSubmission[]; references: AssignmentReferenceItem[]; reviews: AssignmentReview[]; roster: AcademicRosterMember[]; selectedAssignmentId: string; dismissedAssignmentId: string | null; canManage: boolean; myUserId?: string; weatherIconStyle: WeatherIconStyle; draftResponses: Record<string, AssignmentDayResponse>; saving: boolean; referenceOptions: ReferenceItem[]; linkLabel: string; linkUrl: string; onCreate: (fields: ClassroomAssignmentFields) => void; onSelectAssignment: (assignment: ClassroomAssignment) => void; onDismissAssignment: (assignmentId: string) => void; onUpdateAssignment: (assignmentId: string, fields: Partial<Pick<ClassroomAssignment, "title" | "instructions" | "due_at" | "status">>) => void; onDraftChange: (date: string, period: "day" | "night", field: keyof AssignmentPeriodResponse, value: string) => void; onFormatDraftField: (date: string, period: "day" | "night", field: "highLow" | "rainChance" | "timing") => void; onSaveDraft: (assignment: ClassroomAssignment, submit: boolean) => void; onAddReference: (assignment: ClassroomAssignment, item: ReferenceItem) => void; onRemoveReference: (id: string) => void; onLinkLabelChange: (value: string) => void; onLinkUrlChange: (value: string) => void; onAddLinkReference: (assignment: ClassroomAssignment) => void; reviewOpenId: string | null; reviewComment: string; reviewScore: string; reviewMessage: string; onOpenReview: (submissionId: string | null) => void; onReviewCommentChange: (value: string) => void; onReviewScoreChange: (value: string) => void; onSaveReview: (submissionId: string) => void; message: string }) {
  const isDismissed = props.dismissedAssignmentId === props.selectedAssignmentId;
  const assignment = isDismissed ? undefined : props.assignments.find((item) => item.id === props.selectedAssignmentId && item.status !== "archived");
  return <><ClassroomAssignmentStudio assignments={props.assignments} submissions={props.submissions} references={props.references} reviews={props.reviews} roster={props.roster} selectedAssignmentId={props.selectedAssignmentId} dismissedAssignmentId={props.dismissedAssignmentId} canManage={props.canManage} myUserId={props.myUserId} weatherIconStyle={props.weatherIconStyle} draftResponses={props.draftResponses} saving={props.saving} referenceOptions={props.referenceOptions} linkLabel={props.linkLabel} linkUrl={props.linkUrl} onCreate={props.onCreate} onSelectAssignment={props.onSelectAssignment} onDismissAssignment={props.onDismissAssignment} onUpdateAssignment={props.onUpdateAssignment} onDraftChange={props.onDraftChange} onFormatDraftField={props.onFormatDraftField} onSaveDraft={props.onSaveDraft} onAddReference={props.onAddReference} onRemoveReference={props.onRemoveReference} onLinkLabelChange={props.onLinkLabelChange} onLinkUrlChange={props.onLinkUrlChange} onAddLinkReference={props.onAddLinkReference} message={props.message} />{props.canManage && assignment && <ClassroomInstructorOverview assignment={assignment} submissions={props.submissions} reviews={props.reviews} roster={props.roster} reviewOpenId={props.reviewOpenId} reviewComment={props.reviewComment} reviewScore={props.reviewScore} reviewMessage={props.reviewMessage} onOpenReview={props.onOpenReview} onReviewCommentChange={props.onReviewCommentChange} onReviewScoreChange={props.onReviewScoreChange} onSaveReview={props.onSaveReview} />}</>;
}

// deprecated: graded blind, with no automatic score visible. Superseded by ClassroomInstructorOverview + ClassroomReviewPanel. Kept for reference.
/* function AssignmentAssessmentQueue({ assignment, submissions, studentName }: { assignment: ClassroomAssignment; submissions: ClassroomAssignmentSubmission[]; studentName: (userId: string) => string }) {
  const [comments, setComments] = useState<Record<string, string>>({});
  const [scores, setScores] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const dates = assignmentDates(assignment);
  const submit = (runId: string) => window.dispatchEvent(new CustomEvent("weather-desk-save-assignment-review", { detail: { runId, comment: comments[runId] ?? "", manualScore: scores[runId] ?? "", onComplete: (message: string) => { setMessages((all) => ({ ...all, [runId]: message })); if (message.startsWith("Assessment saved")) { setComments((all) => ({ ...all, [runId]: "" })); setScores((all) => ({ ...all, [runId]: "" })); } } } }));
  return <section className="assignment-assessment-queue"><header><div><p className="eyebrow">Assessment queue</p><h3>Student submissions</h3><p>Expand a student to review the exact assigned forecast days, leave feedback, then continue down the list.</p></div><span>{submissions.length} submitted</span></header><div>{submissions.map((submission) => <details key={submission.id}><summary><span><strong>{studentName(submission.user_id)}</strong><small>Submitted {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(submission.created_at))}</small></span><b>{dates.filter((date) => submission.forecast_periods.some((period) => period.valid_date === date)).length}/{dates.length} days</b></summary><div className="assignment-assessment-body"><div className="assignment-submission-days">{dates.map((date) => <ForecastDayMiniCard key={date} date={date} periods={submission.forecast_periods} />)}</div><div className="inline-assessment"><label>Instructor feedback<textarea value={comments[submission.id] ?? ""} onChange={(event) => setComments((all) => ({ ...all, [submission.id]: event.target.value }))} placeholder="Specific feedback for this student…" /></label><label>Manual grade <input inputMode="numeric" value={scores[submission.id] ?? ""} onChange={(event) => setScores((all) => ({ ...all, [submission.id]: event.target.value }))} placeholder="Optional 0–100" /></label><button type="button" onClick={() => submit(submission.id)}>Save assessment</button></div>{submission.forecast_reviews?.length ? <div className="inline-assessment-history"><strong>Previous feedback</strong>{submission.forecast_reviews.map((review) => <p key={review.id}>{review.manual_score === null ? "Comment" : `Grade ${review.manual_score}%`} · {review.comment || "No written feedback."}</p>)}</div> : null}{messages[submission.id] && <p className="control-message" role="status">{messages[submission.id]}</p>}</div></details>)}{!submissions.length && <p className="empty">Student submissions will appear here when they are ready for assessment.</p>}</div></section>;
} */

export default function Home() {
  const [dataPanel, setDataPanel] = useState<DataPanel>("alerts");
  const [activeSection, setActiveSection] = useState<WorkspaceSection>(() => {
    if (typeof window === "undefined") return "dashboard";
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") === "about") return "about";
    if (params.get("class")) return "classroom";
    return "dashboard";
  });
  const [radarFrames, setRadarFrames] = useState<RadarTimelineFrame[]>([]);
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [radarTimelineStatus, setRadarTimelineStatus] = useState("Loading radar timeline…");
  const [futureRadarFrames, setFutureRadarFrames] = useState<RadarTimelineFrame[]>([]);
  const [futureRadarFrameIndex, setFutureRadarFrameIndex] = useState(0);
  const [futureRadarPlaying, setFutureRadarPlaying] = useState(false);
  const [futureRadarStatus, setFutureRadarStatus] = useState("Loading future radar…");
  const [radarMapView, setRadarMapView] = useState<RadarMapView>("composite");
  const [showNwsAlerts, setShowNwsAlerts] = useState(true);
  const [showSpcOutlook, setShowSpcOutlook] = useState(false);
  const [outlookDay, setOutlookDay] = useState<1 | 2>(1);
  const [showSevereMarkers, setShowSevereMarkers] = useState(true);
  // Not persisted like the other overlay toggles above — this is a one-off
  // "let me find my station" action, not an ongoing display preference, so
  // it resets to off each session rather than sticking around.
  const [showStationPicker, setShowStationPicker] = useState(false);
  const [satelliteChannel, setSatelliteChannel] = useState<"geocolor" | "ir" | "wv">("geocolor");
  const [radarOpacity, setRadarOpacity] = useState(72);
  const [radarProviderPreference, setRadarProviderPreference] = useState<RadarProviderPreference>("auto");
  const [radarSource, setRadarSource] = useState<"nexrad" | "provider" | null>(null);
  const [radarFrameMeta, setRadarFrameMeta] = useState<RadarFrameMeta>(null);
  const [radarRefreshToken, setRadarRefreshToken] = useState(0);
  const [radarRecenterToken, setRadarRecenterToken] = useState(0);
  useEffect(() => {
    // Radar always stays fresh on its own now -- no manual "Refresh" button.
    // 5 minutes matches the worker's own prewarm cadence, so this never asks
    // for data faster than new volumes actually arrive.
    const interval = window.setInterval(() => setRadarRefreshToken((value) => value + 1), 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);
  const [clockTick, setClockTick] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setClockTick(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const localTimeLabel = clockTick.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const utcTimeLabel = `${String(clockTick.getUTCHours()).padStart(2, "0")}${String(clockTick.getUTCMinutes()).padStart(2, "0")}Z`;
  const [locationId, setLocationId] = useState(defaultWeatherDeskLocation.id);
  const [customLocation, setCustomLocation] = useState<WeatherDeskLocation | null>(null);
  const [customStationStatus, setCustomStationStatus] = useState("");
  const [locationSearchText, setLocationSearchText] = useState("");
  const [radarStations, setRadarStations] = useState<{ id: string; name: string; latitude: number; longitude: number }[] | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [defaultLocationId, setDefaultLocationId] = useState(defaultWeatherDeskLocation.id);
  const [defaultForecastDays, setDefaultForecastDays] = useState<1 | 3 | 7>(1);
  const [weatherIconStyle, setWeatherIconStyle] = useState<WeatherIconStyle>("traditional");
  const [personalTier, setPersonalTier] = useState<PersonalTier>("free");
  const [settingsReady, setSettingsReady] = useState(false);
  const [controlMessage, setControlMessage] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState("");
  const [tierNote, setTierNote] = useState("");
  const [tierRequestBusy, setTierRequestBusy] = useState(false);
  const [tierRequestMessage, setTierRequestMessage] = useState("");
  const [pendingTierRequest, setPendingTierRequest] = useState<{ id: string; created_at: string } | null>(null);
  const [adminTierRequests, setAdminTierRequests] = useState<{ id: string; user_id: string; note: string | null; created_at: string; profiles: { email: string | null; display_name: string | null } | null }[]>([]);
  const [adminTierMessage, setAdminTierMessage] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [verifyTab, setVerifyTab] = useState<"records" | "scenarios">("records");
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [scenarioMessage, setScenarioMessage] = useState("");
  const [scenarioPickerOpen, setScenarioPickerOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [workspaceNotice, setWorkspaceNotice] = useState<{ message: string; targetDate?: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionToken, setSubmissionToken] = useState("");
  const [liveWeather, setLiveWeather] = useState<LiveWeather | null>(null);
  const [weatherError, setWeatherError] = useState("");
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherSyncedAt, setWeatherSyncedAt] = useState<number | null>(null);
  const [nbmText, setNbmText] = useState("");
  const [nbmStatus, setNbmStatus] = useState("Loading latest KAHN NBM bulletin…");
  const [afdText, setAfdText] = useState("");
  const [afdStatus, setAfdStatus] = useState("Loading latest forecast discussion…");
  const [mcdDiscussions, setMcdDiscussions] = useState<{ id: string; title: string; issuedAt: string | null; imageUrl: string | null; text: string; link: string }[]>([]);
  const [mcdStatus, setMcdStatus] = useState("Loading latest mesoscale discussions…");
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
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState("");
  const [loginMenuOpen, setLoginMenuOpen] = useState(false);
  const [publicNavigation, setPublicNavigation] = useState<PublicNavigationItem[]>(defaultPublicNavigation);
  const [workspaceNavigation, setWorkspaceNavigation] = useState<WorkspaceNavigationItem[]>(defaultWorkspaceNavigation);
  const [homepageContent, setHomepageContent] = useState<HomepageContent>(defaultHomepageContent);
  const [aboutContent, setAboutContent] = useState<AboutContent>(defaultAboutContent);
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
  const [organizationBranding, setOrganizationBranding] = useState<Record<string, OrganizationBranding>>({});
  const [activeWorkspaceKey, setActiveWorkspaceKey] = useState("personal");
  const [soleStudentDeskKey, setSoleStudentDeskKey] = useState<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [deskListOpen, setDeskListOpen] = useState(false);
  const [myDisplayName, setMyDisplayName] = useState<string | null>(null);
  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const dismissIfOutside = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".avatar-menu-wrap")) {
        setWorkspaceMenuOpen(false);
        setDeskListOpen(false);
      }
    };
    document.addEventListener("click", dismissIfOutside);
    return () => document.removeEventListener("click", dismissIfOutside);
  }, [workspaceMenuOpen]);
  const [workspaceContextStatus, setWorkspaceContextStatus] = useState("");
  useEffect(() => {
    if (!locationMenuOpen) return;
    const dismissIfOutside = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest(".location-menu-wrap")) setLocationMenuOpen(false);
    };
    document.addEventListener("click", dismissIfOutside);
    return () => document.removeEventListener("click", dismissIfOutside);
  }, [locationMenuOpen]);
  const [managedOrganizations, setManagedOrganizations] = useState<OrganizationWorkspace[]>([]);
  const [managedClassrooms, setManagedClassrooms] = useState<ClassroomWorkspace[]>([]);
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([]);
  const [classroomMembers, setClassroomMembers] = useState<ClassroomMember[]>([]);
  const [schoolMembers, setSchoolMembers] = useState<OrganizationMember[]>([]);
  const [schoolEntitlement, setSchoolEntitlement] = useState<{ seat_limit: number; status: string; next_payment_due_at: string | null } | null>(null);
  const [classroomEnrollment, setClassroomEnrollment] = useState<Record<string, number>>({});
  const [classroomJoinCodes, setClassroomJoinCodes] = useState<ClassroomJoinCode[]>([]);
  const [accessMessage, setAccessMessage] = useState("");
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
  const [profileRefreshToken, setProfileRefreshToken] = useState(0);
  const [joinPanelOpen, setJoinPanelOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinMessage, setJoinMessage] = useState("");
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewRuns, setReviewRuns] = useState<ReviewRun[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, ForecastReview[]>>({});
  const [selectedReviewRunId, setSelectedReviewRunId] = useState<string | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewManualScore, setReviewManualScore] = useState("");
  const [reviewRubric, setReviewRubric] = useState({ accuracy: "", reasoning: "", communication: "" });
  const [reviewMessage, setReviewMessage] = useState("");
  const [academicRoster, setAcademicRoster] = useState<AcademicRosterMember[]>([]);
  const [classroomRoster, setClassroomRoster] = useState<ClassroomRosterMember[]>([]);
  const [classroomRosterMessage, setClassroomRosterMessage] = useState("");
  const [academicMessage, setAcademicMessage] = useState("");
  const [classroomAssignments, setClassroomAssignments] = useState<ClassroomAssignment[]>([]);
  const [classroomOfficialForecast, setClassroomOfficialForecast] = useState<ClassroomOfficialForecast | null>(null);
  // Assignments are deliberately independent of forecast_runs -- see
  // supabase/migrations/20260823030000_assignment_content_and_notifications.sql.
  const [assignmentSubmissions, setAssignmentSubmissions] = useState<AssignmentSubmission[]>([]);
  const [assignmentSubmissionRefreshToken, setAssignmentSubmissionRefreshToken] = useState(0);
  const [assignmentReferences, setAssignmentReferences] = useState<AssignmentReferenceItem[]>([]);
  const [assignmentReferenceRefreshToken, setAssignmentReferenceRefreshToken] = useState(0);
  const [assignmentReviews, setAssignmentReviews] = useState<AssignmentReview[]>([]);
  const [assignmentDraftResponses, setAssignmentDraftResponses] = useState<Record<string, AssignmentDayResponse>>({});
  const [assignmentSaving, setAssignmentSaving] = useState(false);
  const [assignmentLinkLabel, setAssignmentLinkLabel] = useState("");
  const [assignmentLinkUrl, setAssignmentLinkUrl] = useState("");
  const [assignmentReviewOpenId, setAssignmentReviewOpenId] = useState<string | null>(null);
  const [assignmentReviewComment, setAssignmentReviewComment] = useState("");
  const [assignmentReviewScore, setAssignmentReviewScore] = useState("");
  const [assignmentReviewMessage, setAssignmentReviewMessage] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [selectedClassroomAssignmentId, setSelectedClassroomAssignmentId] = useState("");
  const [dismissedClassroomAssignmentId, setDismissedClassroomAssignmentId] = useState<string | null>(null);
  const [classroomHubTab, setClassroomHubTab] = useState<ClassroomHubTab>(() => {
    if (typeof window === "undefined") return "assignments";
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab === "outlook" || tab === "assignments" || tab === "progress" || tab === "roster" ? tab : "outlook";
  });
  const [revisionParentRunId, setRevisionParentRunId] = useState<string | null>(null);
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const selectedLocation = customLocation ?? weatherDeskLocation(locationId);
  // Every weather-data route needs this same location descriptor; a custom (searched or
  // map-picked) location is already fully resolved client-side, so its fields ride along
  // directly instead of each route re-deriving them from a preset id it wouldn't recognize.
  const locationQuery = customLocation
    ? `lat=${customLocation.latitude}&lon=${customLocation.longitude}&tz=${encodeURIComponent(customLocation.timezone)}&station=${encodeURIComponent(customLocation.observationStation)}&upperAir=${encodeURIComponent(customLocation.upperAirStation)}&radar=${encodeURIComponent(customLocation.radarSite)}&id=${encodeURIComponent(customLocation.id)}&name=${encodeURIComponent(customLocation.name)}`
    : `location=${encodeURIComponent(locationId)}`;
  const liveDataStatus = weatherError
    ? { label: "Not synced", tone: "attention" }
    : weatherLoading || !liveWeather
      ? { label: "Syncing", tone: "loading" }
      : { label: "Live", tone: "healthy" };
  const liveDataTimestamp = weatherSyncedAt
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(weatherSyncedAt)
    : null;
  const hasControlAccess = role === "admin" || role === "owner";
  const hasSchoolMembership = workspaceContexts.some((workspace) => workspace.kind === "classroom" || (workspace.kind === "organization" && workspace.detail === "school workspace"));
  const hasModelAccess = hasModelDataAccess({ personalTier, isPlatformAdmin: hasControlAccess, hasSchoolMembership });
  const openAccountSection = () => setActiveSection("control");
  // "login" is never rendered as a nav tab -- the header already has its own dedicated
  // "Log in" control, so a published nav item targeting "login" would just duplicate it.
  const visiblePublicNavigation = publicNavigation.filter((item) => item.enabled && item.target !== "login" && (item.target !== "about" || !session) && (item.access === "public" || (item.access === "member" && Boolean(session)) || (item.access === "staff" && hasControlAccess) || (item.access === "owner" && role === "owner")));
  const visibleWorkspace = (id: WorkspaceNavigationItem["id"]) => {
    const item = workspaceNavigation.find((candidate) => candidate.id === id);
    if (!item?.enabled) return false;
    return item.access === "public" || (item.access === "member" && Boolean(session)) || (item.access === "staff" && hasControlAccess) || (item.access === "owner" && role === "owner");
  };
  const activeWorkspace = workspaceContexts.find((workspace) => workspace.key === activeWorkspaceKey) ?? workspaceContexts[0];
  const activeSchoolBranding = activeWorkspace?.organizationId ? organizationBranding[activeWorkspace.organizationId] : null;
  const activeSchoolLogoPath = activeSchoolBranding?.logo_path ?? null;
  const workspaceRoleCanReview = ["owner", "admin", "instructor", "reviewer", "assistant"].includes(activeWorkspace?.role ?? "");
  const hasAcademicReviewAccess = Boolean(session && (hasControlAccess || (activeWorkspace?.kind !== "personal" && activeWorkspace?.kind !== "all" && workspaceRoleCanReview)));
  const canManageActiveClassroom = Boolean(session && activeWorkspace?.kind === "classroom" && (hasControlAccess || ["owner", "admin", "instructor", "assistant"].includes(activeWorkspace.role ?? "")));
  const openPublicNavigation = (target: PublicNavigationItem["target"]) => {
    if (target === "weather") { window.history.replaceState({}, "", "/"); setActiveSection("dashboard"); }
    if (target === "radar") { window.history.replaceState({}, "", "/"); setActiveSection("radar"); }
    if (target === "about") { window.history.pushState({}, "", "/?view=about"); setActiveSection("about"); window.scrollTo({ top: 0, behavior: "smooth" }); }
    if (target === "login" && !session) setLoginMenuOpen(true);
  };
  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId) ?? null;
  const myAssignmentSubmission = (assignmentId: string) => session ? assignmentSubmissions.find((submission) => submission.assignment_id === assignmentId && submission.student_id === session.user.id) ?? null : null;
  const hasUnreadNotifications = notifications.some((notification) => !notification.read_at);
  const createNewForecastRun = (days = defaultForecastDays) => {
    const start = new Date(`${nextForecastDate()}T12:00:00`);
    return { id: crypto.randomUUID(), initialHorizonDays: days, days: Array.from({ length: days }, (_, offset) => createForecastDay(addDays(start, offset))) };
  };
  const selectClassroomAssignment = (assignment: ClassroomAssignment) => {
    setSelectedClassroomAssignmentId(assignment.id);
    setDismissedClassroomAssignmentId(null);
    const existing = myAssignmentSubmission(assignment.id);
    const seeded: Record<string, AssignmentDayResponse> = {};
    assignmentDates(assignment).forEach((date) => { seeded[date] = existing?.responses[date] ?? emptyAssignmentDayResponse; });
    setAssignmentDraftResponses(seeded);
    setAssignmentMessage("");
  };

  const dismissClassroomAssignment = (assignmentId: string) => {
    setDismissedClassroomAssignmentId(assignmentId);
    setAssignmentMessage("");
  };

  const switchWorkspace = (workspace: WorkspaceContext) => {
    setActiveWorkspaceKey(workspace.key);
    setWorkspaceMenuOpen(false);
    if (workspace.kind === "classroom") {
      setClassroomHubTab("outlook");
      setActiveSection("classroom");
      return;
    }
    if (workspace.kind === "organization") {
      setActiveSection("school");
      return;
    }
    setActiveSection("dashboard");
  };

  // deprecated: "weather-desk-review-student" had no dispatcher anywhere in the app; classroom review now
  // opens directly via ClassroomInstructorOverview's onReviewStudent callback instead of a window event.
  /* useEffect(() => {
    const openReview = (event: Event) => {
      const target = (event as CustomEvent<ReviewTarget>).detail;
      if (!target?.userId || !target.classroomId) return;
      setReviewTarget(target);
      setClassroomHubTab("assignments");
      setActiveSection("classroom");
    };
    window.addEventListener("weather-desk-review-student", openReview);
    return () => window.removeEventListener("weather-desk-review-student", openReview);
  }, []); */

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const previous = params.toString();
    if (activeSection === "classroom" && activeWorkspace?.kind === "classroom") {
      params.set("class", activeWorkspace.key);
      params.set("tab", classroomHubTab);
      if (selectedClassroomAssignmentId) params.set("assignment", selectedClassroomAssignmentId); else params.delete("assignment");
      if (reviewTarget && reviewTarget.classroomId === activeWorkspace.classroomId) params.set("student", reviewTarget.userId); else params.delete("student");
    } else {
      params.delete("class"); params.delete("tab"); params.delete("assignment"); params.delete("student");
      if (activeSection === "about") params.set("view", "about"); else params.delete("view");
    }
    if (params.toString() === previous) return;
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [activeSection, activeWorkspace, classroomHubTab, selectedClassroomAssignmentId, reviewTarget]);

  useEffect(() => {
    const applyNavigation = (event: Event) => {
      const config = (event as CustomEvent<{ content?: Array<{ content_key: string; value: unknown }> }>).detail;
      const navigation = config?.content?.find((item) => item.content_key === "navigation")?.value;
      const workspaces = config?.content?.find((item) => item.content_key === "workspace-access")?.value;
      const homepage = config?.content?.find((item) => item.content_key === "homepage")?.value;
      const about = config?.content?.find((item) => item.content_key === "about")?.value;
      setPublicNavigation(publishedNavigation(navigation));
      setWorkspaceNavigation(publishedWorkspaceNavigation(workspaces));
      if (homepage && typeof homepage === "object") {
        const value = homepage as Record<string, unknown>;
        setHomepageContent({ title: typeof value.title === "string" ? value.title : defaultHomepageContent.title, description: typeof value.description === "string" ? value.description : defaultHomepageContent.description, primaryAction: typeof value.primaryAction === "string" ? value.primaryAction : defaultHomepageContent.primaryAction, secondaryAction: typeof value.secondaryAction === "string" ? value.secondaryAction : defaultHomepageContent.secondaryAction, outlookTitle: typeof value.outlookTitle === "string" ? value.outlookTitle : defaultHomepageContent.outlookTitle, outlookCaption: typeof value.outlookCaption === "string" ? value.outlookCaption : defaultHomepageContent.outlookCaption, radarTitle: typeof value.radarTitle === "string" ? value.radarTitle : defaultHomepageContent.radarTitle, radarCaption: typeof value.radarCaption === "string" ? value.radarCaption : defaultHomepageContent.radarCaption, referenceTitle: typeof value.referenceTitle === "string" ? value.referenceTitle : defaultHomepageContent.referenceTitle, referenceCaption: typeof value.referenceCaption === "string" ? value.referenceCaption : defaultHomepageContent.referenceCaption, showOutlook: value.showOutlook !== false, showRadar: value.showRadar !== false, showReferences: value.showReferences !== false });
      }
      if (about && typeof about === "object") {
        const value = about as Record<string, unknown>;
        const principles = Array.isArray(value.principles) ? value.principles.flatMap((entry) => entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).title === "string" && typeof (entry as Record<string, unknown>).body === "string" ? [{ title: String((entry as Record<string, unknown>).title), body: String((entry as Record<string, unknown>).body) }] : []) : defaultAboutContent.principles;
        setAboutContent({ eyebrow: typeof value.eyebrow === "string" ? value.eyebrow : defaultAboutContent.eyebrow, title: typeof value.title === "string" ? value.title : defaultAboutContent.title, description: typeof value.description === "string" ? value.description : defaultAboutContent.description, principles: principles.length ? principles : defaultAboutContent.principles });
      }
    };
    window.addEventListener("frontline-site-config", applyNavigation);
    const initial = (window as Window & { __frontlineSiteConfig?: unknown }).__frontlineSiteConfig;
    if (initial) applyNavigation({ detail: initial } as CustomEvent<{ content?: Array<{ content_key: string; value: unknown }> }>);
    return () => window.removeEventListener("frontline-site-config", applyNavigation);
  }, []);

  // deprecated: only consumer was the deprecated AssignmentAssessmentQueue; classroom review now saves
  // through saveForecastReview (which also writes rubric_scores, unlike this handler's always-empty {}).
  /* useEffect(() => {
    const saveInlineAssessment = async (event: Event) => {
      const detail = (event as CustomEvent<{ runId: string; comment: string; manualScore: string; onComplete: (message: string) => void }>).detail;
      if (!detail?.runId || !session || !supabaseUrl || !supabaseKey) { detail?.onComplete("Assessment could not be saved. Please sign in again."); return; }
      const manualScore = detail.manualScore.trim() === "" ? null : Number(detail.manualScore);
      if (!detail.comment.trim() && manualScore === null) { detail.onComplete("Add feedback or a manual grade before saving."); return; }
      if (manualScore !== null && (!Number.isFinite(manualScore) || manualScore < 0 || manualScore > 100)) { detail.onComplete("Manual grade must be between 0 and 100."); return; }
      const response = await fetch(`${supabaseUrl}/rest/v1/forecast_reviews`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ run_id: detail.runId, reviewer_id: session.user.id, comment: detail.comment.trim() || null, manual_score: manualScore, rubric_scores: {} }) });
      const rows = await response.json().catch(() => []);
      if (!response.ok || !rows[0]) { detail.onComplete("Assessment could not be saved."); return; }
      setAssignmentSubmissions((submissions) => submissions.map((submission) => submission.id === detail.runId ? { ...submission, forecast_reviews: [rows[0] as ForecastReview, ...(submission.forecast_reviews ?? [])] } : submission));
      detail.onComplete("Assessment saved. You can continue to the next student.");
    };
    window.addEventListener("weather-desk-save-assignment-review", saveInlineAssessment);
    return () => window.removeEventListener("weather-desk-save-assignment-review", saveInlineAssessment);
  }, [session]); */

  useEffect(() => {
    const storedLocation = window.localStorage.getItem(locationStorageKey);
    if (storedLocation) setLocationId(weatherDeskLocation(storedLocation).id);
    try {
      const storedCustomLocation = JSON.parse(window.localStorage.getItem(customLocationStorageKey) ?? "null") as WeatherDeskLocation | null;
      if (storedCustomLocation?.id && storedCustomLocation.observationStation) setCustomLocation(storedCustomLocation);
    } catch { window.localStorage.removeItem(customLocationStorageKey); }
    const storedTheme = readSharedTheme() ?? window.localStorage.getItem(themeStorageKey);
    if (storedTheme === "dark" || storedTheme === "light") setTheme(storedTheme);
    try {
      const settings = JSON.parse(window.localStorage.getItem(workspaceSettingsStorageKey) ?? "{}") as Partial<WorkspacePreferences>;
      if (settings.defaultLocationId) {
        const nextDefault = weatherDeskLocation(settings.defaultLocationId).id;
        setDefaultLocationId(nextDefault);
        if (!storedLocation) setLocationId(nextDefault);
      }
      if (settings.radarMapView && ["composite", "velocity", "satellite"].includes(settings.radarMapView)) {
        setRadarMapView(settings.radarMapView);
      }
      if (typeof settings.radarOpacity === "number" && settings.radarOpacity >= 20 && settings.radarOpacity <= 100) setRadarOpacity(settings.radarOpacity);
      if (typeof settings.showNwsAlerts === "boolean") setShowNwsAlerts(settings.showNwsAlerts);
      if (typeof settings.showSpcOutlook === "boolean") setShowSpcOutlook(settings.showSpcOutlook);
      if (settings.outlookDay === 1 || settings.outlookDay === 2) setOutlookDay(settings.outlookDay);
      if (typeof settings.showSevereMarkers === "boolean") setShowSevereMarkers(settings.showSevereMarkers);
      if (settings.radarProviderPreference === "auto" || settings.radarProviderPreference === "iem") setRadarProviderPreference(settings.radarProviderPreference);
      if (settings.defaultForecastDays === 1 || settings.defaultForecastDays === 3 || settings.defaultForecastDays === 7) setDefaultForecastDays(settings.defaultForecastDays);
    } catch { window.localStorage.removeItem(workspaceSettingsStorageKey); }
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(locationStorageKey, locationId);
  }, [locationId]);

  useEffect(() => {
    if (customLocation) window.localStorage.setItem(customLocationStorageKey, JSON.stringify(customLocation));
    else window.localStorage.removeItem(customLocationStorageKey);
  }, [customLocation]);

  // Radar site picker (task #31): a radar station ID isn't reliably a valid
  // observation station ID too (many NEXRAD sites, especially rural/mountain
  // installations, don't share an ID with a nearby airport/METAR site), so
  // this resolves by the station's own lat/lon instead of stationId — the
  // same location-lookup path radarSite lookups already use elsewhere, just
  // sourced from real NWS radar-station coordinates rather than a typed code.
  async function selectRadarStation(station: { id: string; name: string; latitude: number; longitude: number }) {
    await resolveCustomLocation(`lat=${station.latitude}&lon=${station.longitude}`, `custom-radar-${station.id.toLowerCase()}`);
  }

  async function searchLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = locationSearchText.trim();
    if (!query) return;
    const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || Date.now().toString();
    await resolveCustomLocation(`q=${encodeURIComponent(query)}`, `custom-search-${slug}`);
    setLocationSearchText("");
  }

  async function resolveCustomLocation(query: string, id: string) {
    setCustomStationStatus("Looking up location…");
    try {
      const response = await fetch(`/api/location-lookup?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to resolve that location.");
      setCustomLocation({
        id,
        name: `${data.city}, ${data.state}`,
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone,
        observationStation: data.observationStation,
        upperAirStation: data.upperAirStation,
        radarSite: data.radarSite,
      });
      setCustomStationStatus("");
      setLocationMenuOpen(false);
    } catch (error) {
      setCustomStationStatus(error instanceof Error ? error.message : "Unable to resolve that location.");
    }
  }

  // Lazy-loaded the first time the location menu opens, not on every page
  // load — most visitors never touch this. Live from NWS (src/app/api/radar
  // /stations), not a hardcoded list, so it stays current with the real
  // 159-site WSR-88D network without needing to be maintained here.
  useEffect(() => {
    if (!locationMenuOpen || radarStations) return;
    fetch("/api/radar/stations")
      .then((response) => response.json())
      .then((data) => { if (Array.isArray(data)) setRadarStations(data); })
      .catch(() => undefined);
  }, [locationMenuOpen, radarStations]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(themeStorageKey, theme);
    writeSharedTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!settingsReady) return;
    window.localStorage.setItem(workspaceSettingsStorageKey, JSON.stringify({ defaultLocationId, radarMapView, radarOpacity, showNwsAlerts, showSpcOutlook, outlookDay, showSevereMarkers, radarProviderPreference, defaultForecastDays } satisfies WorkspacePreferences));
  }, [defaultForecastDays, defaultLocationId, radarMapView, radarOpacity, radarProviderPreference, settingsReady, showNwsAlerts, showSpcOutlook, outlookDay, showSevereMarkers]);

  useEffect(() => {
    if (!workspaceNotice) return;
    const timeout = window.setTimeout(() => setWorkspaceNotice(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [workspaceNotice]);

  useEffect(() => {
    let isActive = true;
    setWeatherLoading(true);
    const loadWeather = () => fetch(`/api/weather?${locationQuery}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load live data");
        if (isActive) {
          setLiveWeather(data);
          setWeatherError("");
          setWeatherLoading(false);
          setWeatherSyncedAt(Date.now());
        }
      })
      .catch((error: Error) => {
        if (!isActive) return;
        setWeatherError(error.message);
        setWeatherLoading(false);
      });
    loadWeather();
    const refreshId = window.setInterval(loadWeather, 60_000);
    return () => {
      isActive = false;
      window.clearInterval(refreshId);
    };
  }, [locationQuery]);

  useEffect(() => {
    if (activeSection !== "radar" && activeSection !== "dashboard") return;
    let isActive = true;
    const loadRadarTimeline = () => fetch(`/api/radar/frames?station=${selectedLocation.radarSite}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load radar frames");
        if (isActive) {
          const frames = data.frames as RadarTimelineFrame[];
          const inHouseCount = frames.filter((frame) => frame.source === "nexrad").length;
          setRadarFrames(frames);
          setRadarFrameIndex(Math.max(0, frames.length - 1));
          setRadarTimelineStatus(inHouseCount ? `${frames.length} frames · ${inHouseCount} in-house NEXRAD, rest via IEM` : `${frames.length} frames · NWS/NEXRAD via IEM`);
        }
      })
      .catch((error: Error) => isActive && setRadarTimelineStatus(error.message));
    loadRadarTimeline();
    const refreshId = window.setInterval(loadRadarTimeline, 300_000);
    return () => { isActive = false; window.clearInterval(refreshId); };
  }, [activeSection, selectedLocation]);

  useEffect(() => {
    if (radarMapView !== "satellite") return;
    // GOES-East imagery updates roughly every 10 minutes, and the CDN occasionally serves a
    // transiently blank frame during a scan transition — refreshing on an interval both keeps the
    // picture current and self-heals a bad frame without the user needing to notice and click Refresh.
    const refreshId = window.setInterval(() => setRadarRefreshToken((value) => value + 1), 300_000);
    return () => window.clearInterval(refreshId);
  }, [radarMapView]);

  useEffect(() => {
    if (activeSection !== "dashboard" || dataPanel !== "model-radar" || !hasModelAccess) return;
    let isActive = true;
    const loadFutureRadar = () => fetch("/api/radar/future-frames", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load future radar frames");
        if (isActive) {
          const frames = data.frames as RadarTimelineFrame[];
          setFutureRadarFrames(frames);
          setFutureRadarFrameIndex(0);
          setFutureRadarStatus(`${frames.length} frames · HRRR simulated reflectivity`);
        }
      })
      .catch((error: Error) => isActive && setFutureRadarStatus(error.message));
    loadFutureRadar();
    const refreshId = window.setInterval(loadFutureRadar, 600_000);
    return () => { isActive = false; window.clearInterval(refreshId); };
  }, [activeSection, dataPanel, hasModelAccess]);

  useEffect(() => {
    if (!futureRadarPlaying || futureRadarFrames.length < 2) return;
    const playId = window.setInterval(() => setFutureRadarFrameIndex((index) => (index + 1) % futureRadarFrames.length), 900);
    return () => window.clearInterval(playId);
  }, [futureRadarPlaying, futureRadarFrames.length]);

  useEffect(() => {
    if (!radarPlaying || radarFrames.length < 2) return;
    // Self-rescheduling setTimeout instead of a uniform setInterval so the loop can pause longer on
    // the most-recent frame before restarting — the standard radar-loop convention (RadarScope, NWS
    // loop viewers) precisely because that's the one frame worth actually reading, not just glancing
    // past on the way back to the oldest one. A flat 650ms advance made every frame equally
    // fleeting, current or 50 minutes old, which was part of what read as "choppy."
    let timeoutId: number;
    const advance = () => {
      setRadarFrameIndex((index) => {
        const next = (index + 1) % radarFrames.length;
        const landedOnMostRecent = next === radarFrames.length - 1;
        timeoutId = window.setTimeout(advance, landedOnMostRecent ? 2200 : 700);
        return next;
      });
    };
    timeoutId = window.setTimeout(advance, 700);
    return () => window.clearTimeout(timeoutId);
  }, [radarPlaying, radarFrames.length]);

  useEffect(() => {
    if (!session) { setForecastRun(createNewForecastRun()); return; }
    const storedDraft = window.localStorage.getItem(forecastDraftStorageKeyFor(session.user.id));
    if (!storedDraft) { setForecastRun(createNewForecastRun()); return; }
    try {
      const parsed = JSON.parse(storedDraft) as ForecastRunDraft;
      if (parsed.days?.length) setForecastRun({ ...parsed, days: parsed.days.map((day) => ({ ...day, date: fallbackForecastDate(day.date), day: { ...emptyPeriod("day"), ...day.day, references: savedReferences(day.day.references) }, night: { ...emptyPeriod("night"), ...day.night, references: savedReferences(day.night.references) } })) });
    } catch {
      window.localStorage.removeItem(forecastDraftStorageKeyFor(session.user.id));
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session) return;
    window.localStorage.setItem(forecastDraftStorageKeyFor(session.user.id), JSON.stringify(forecastRun));
  }, [forecastRun, session?.user?.id]);

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
    // The access token issued at sign-in (or on the mount-time refresh above) expires after
    // Supabase's default 1 hour. Every fetch in this file sends session.access_token directly
    // rather than going through the Supabase SDK, so nothing else refreshes it — a tab left open
    // past that hour starts silently 401ing on every lazily-fetched request (e.g. Verify's
    // Scenarios tab), which reads as missing data rather than an expired session. Proactively
    // refresh well inside that window so a long-lived tab keeps working.
    if (!session?.refresh_token || !supabaseUrl || !supabaseKey) return;
    const intervalId = window.setInterval(() => {
      fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: session.refresh_token }) })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok || !data.access_token) throw new Error("Session expired");
          const refreshed = { access_token: data.access_token, refresh_token: data.refresh_token ?? session.refresh_token, user: data.user ?? session.user } as WeatherDeskSession;
          if (rememberMe) window.localStorage.setItem(sessionStorageKey, JSON.stringify(refreshed)); else window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(refreshed));
          setSession(refreshed);
        })
        .catch(() => {
          window.localStorage.removeItem(sessionStorageKey);
          window.sessionStorage.removeItem(sessionStorageKey);
          setSession(null);
          setAuthMessage("Your session expired. Sign in again to continue.");
        });
    }, 45 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [session, rememberMe]);

  useEffect(() => {
    if (!supabaseUrl || !supabaseKey) return;
    const confirmation = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = confirmation.get("access_token");
    const refreshToken = confirmation.get("refresh_token");
    const errorDescription = confirmation.get("error_description");
    const isRecovery = confirmation.get("type") === "recovery";
    if (errorDescription) {
      setAuthMessage(errorDescription.replaceAll("+", " "));
      setLoginMenuOpen(true);
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      return;
    }
    if (!accessToken || !refreshToken) return;
    let active = true;
    fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Your confirmation link has expired. Please sign in or request a new confirmation email.");
        return response.json() as Promise<WeatherDeskSession["user"]>;
      })
      .then((user) => {
        if (!active) return;
        const confirmedSession = { access_token: accessToken, refresh_token: refreshToken, user } as WeatherDeskSession;
        window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(confirmedSession));
        window.localStorage.removeItem(sessionStorageKey);
        setSession(confirmedSession);
        setLoginMenuOpen(false);
        if (isRecovery) {
          setActiveSection("control");
          setPasswordMessage("Reset link verified. Choose a new password below.");
          setAuthMessage("");
        } else {
          setAuthMessage("Email confirmed. You are signed in on this browser.");
        }
      })
      .catch((error: Error) => {
        if (!active) return;
        setAuthMessage(error.message);
        setLoginMenuOpen(true);
      })
      .finally(() => window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey) return;
    let active = true;
    setArchives([]);
    setSelectedArchiveId(null);
    setAutomaticVerifications({});
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    const workspaceFilter = activeWorkspace?.kind === "organization"
      ? `&organization_id=eq.${activeWorkspace.organizationId}`
      : activeWorkspace?.kind === "classroom"
        ? `&classroom_id=eq.${activeWorkspace.classroomId}`
        : activeWorkspace?.kind === "personal"
          ? "&organization_id=is.null&classroom_id=is.null"
          : "";
    Promise.all([
      fetch(`${supabaseUrl}/rest/v1/forecast_runs?select=id,user_id,parent_run_id,scenario_id,assignment_id,created_at,status,location_name,forecast_periods(id,valid_date,period,forecast_data,evidence_snapshot,forecast_verifications(observed_data,score_data))&status=neq.withdrawn${workspaceFilter}&order=created_at.desc`, { headers }),
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
      if (!active) return;
      setArchives(cloudArchives);
      // In a classroom/school workspace this fetch legitimately pulls every
      // member's forecast_runs too (the live class-average outlook on the
      // Class forecast tab needs everyone's data) -- but the default
      // selection for Verify, a personal record view, must never land on
      // someone else's submission just because it happens to sort first.
      const isSharedWorkspace = activeWorkspace?.kind === "classroom" || activeWorkspace?.kind === "organization";
      const ownArchives = isSharedWorkspace ? cloudArchives.filter((archive) => archive.authorId === session.user.id) : cloudArchives;
      setSelectedArchiveId(ownArchives[0]?.id ?? null);
      const verificationByPeriod = new Map(verificationRows.map((row) => [row.forecast_period_id, row]));
      const restoredVerifications = Object.fromEntries(runArchives.flatMap((archive) => {
        const day = archive.periodIds?.day ? verificationByPeriod.get(archive.periodIds.day) : undefined;
        const night = archive.periodIds?.night ? verificationByPeriod.get(archive.periodIds.night) : undefined;
        if (!day || !night) return [];
        return [[archive.id, { station: locationForArchive(archive).observationStation, fetchedAt: archive.savedAt, day: day.observed_data, night: night.observed_data, dayScore: day.score_data?.automaticScore ?? null, nightScore: night.score_data?.automaticScore ?? null } satisfies AutomaticVerification]];
      }));
      setAutomaticVerifications(restoredVerifications);
    }).catch((error: Error) => { if (active) setAuthMessage(`Signed in, but cloud archives could not load: ${error.message}`); });
    return () => { active = false; };
  }, [activeWorkspaceKey, session]);

  useEffect(() => {
    // Fetched independent of which section is active -- scenarios can now be
    // started from the Forecast page and reviewed from Verify, so both need
    // this list without waiting on the other to have loaded it first.
    if (!session || !supabaseUrl || !supabaseKey) return;
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    fetch(`${supabaseUrl}/rest/v1/scenarios?select=id,slug,title,category,summary,event_date,target_dates,location_id,reference_notes,reference_links&status=eq.published&order=event_date.desc`, { headers })
      .then((response) => response.ok ? response.json() : [])
      .then(setScenarios);
  }, [session, supabaseUrl, supabaseKey]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey || activeWorkspace?.kind !== "classroom" || !activeWorkspace.classroomId) { setClassroomOfficialForecast(null); return; }
    fetch(`${supabaseUrl}/rest/v1/classroom_official_forecasts?select=classroom_id,forecast,updated_by,updated_at,published_at&classroom_id=eq.${activeWorkspace.classroomId}`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Class outlook is not ready. Apply the latest classroom migration.")))
      .then((rows: ClassroomOfficialForecast[]) => setClassroomOfficialForecast(rows[0] ?? null))
      .catch(() => setClassroomOfficialForecast(null));
  }, [activeWorkspaceKey, session]);

  useEffect(() => {
    if (!session || !hasControlAccess || !supabaseUrl || !supabaseKey) return;
    fetch(`${supabaseUrl}/rest/v1/profiles?select=id,email,role,display_name,person_type,employee_id,student_id,title,personal_tier&order=created_at.asc`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
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
    if (!session || !supabaseUrl || !supabaseKey || activeWorkspace?.kind !== "organization" || !activeWorkspace.organizationId) {
      setSchoolMembers([]);
      setClassroomJoinCodes([]);
      setSchoolEntitlement(null);
      setClassroomEnrollment({});
      return;
    }
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    const organizationId = activeWorkspace.organizationId;
    Promise.all([
      fetch(`${supabaseUrl}/rest/v1/organization_memberships?select=id,organization_id,user_id,role,status&organization_id=eq.${organizationId}&status=eq.active&order=created_at.asc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/workspace_join_codes?select=id,classroom_id,label,code_hint,active,expires_at,max_uses,use_count,created_at&organization_id=is.null&order=created_at.desc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/organization_entitlements?select=seat_limit,status,next_payment_due_at&organization_id=eq.${organizationId}`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/classrooms?select=id&organization_id=eq.${organizationId}`, { headers }),
    ]).then(async ([membersResponse, codesResponse, entitlementResponse, classroomIdsResponse]) => {
      if (!membersResponse.ok) throw new Error("School members could not be loaded.");
      const members = await membersResponse.json() as Omit<OrganizationMember, "profiles">[];
      const ids = members.map((member) => member.user_id);
      const profilesResponse = ids.length ? await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,email,display_name,person_type&id=in.(${ids.join(",")})`, { headers }) : null;
      const people = profilesResponse?.ok ? await profilesResponse.json() as Pick<Profile, "id" | "email" | "display_name" | "person_type">[] : [];
      const peopleById = new Map(people.map((profile) => [profile.id, profile]));
      setSchoolMembers(members.map((member) => ({ ...member, profiles: peopleById.get(member.user_id) ?? null })));
      const rawCodes = codesResponse.ok ? await codesResponse.json() as ClassroomJoinCode[] : [];
      setClassroomJoinCodes(rawCodes.filter((code) => Boolean(code.classroom_id)));
      const entitlementRows = entitlementResponse.ok ? await entitlementResponse.json() as { seat_limit: number; status: string; next_payment_due_at: string | null }[] : [];
      setSchoolEntitlement(entitlementRows[0] ?? null);
      const classroomRows = classroomIdsResponse.ok ? await classroomIdsResponse.json() as { id: string }[] : [];
      const classroomIds = classroomRows.map((row) => row.id);
      if (!classroomIds.length) { setClassroomEnrollment({}); return; }
      const enrollmentResponse = await fetch(`${supabaseUrl}/rest/v1/classroom_memberships?select=classroom_id&classroom_id=in.(${classroomIds.join(",")})&role=eq.student&status=eq.active`, { headers });
      const enrollmentRows = enrollmentResponse.ok ? await enrollmentResponse.json() as { classroom_id: string }[] : [];
      const counts: Record<string, number> = {};
      for (const row of enrollmentRows) counts[row.classroom_id] = (counts[row.classroom_id] ?? 0) + 1;
      setClassroomEnrollment(counts);
    }).catch((error: Error) => setAccessMessage(error.message));
  }, [activeWorkspaceKey, session]);

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
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom || activeWorkspace?.kind !== "classroom" || classroomHubTab !== "roster") { setClassroomRoster([]); return; }
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    setClassroomRosterMessage("Loading roster…");
    fetch(`${supabaseUrl}/rest/v1/classroom_memberships?select=user_id,status,created_at&classroom_id=eq.${activeWorkspace.classroomId}&role=eq.student&order=created_at.asc`, { headers })
      .then(async (response) => {
        if (!response.ok) throw new Error("Roster is not available.");
        const memberships = await response.json() as { user_id: string; status: "active" | "invited" | "suspended"; created_at: string }[];
        if (!memberships.length) { setClassroomRoster([]); setClassroomRosterMessage("No students are enrolled yet."); return; }
        const ids = memberships.map((membership) => membership.user_id).join(",");
        const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,email,display_name&id=in.(${ids})`, { headers });
        if (!profileResponse.ok) throw new Error("Student profiles could not be loaded.");
        const profilesById = new Map((await profileResponse.json() as { id: string; email: string | null; display_name: string | null }[]).map((profile) => [profile.id, profile]));
        setClassroomRoster(memberships.map((membership) => {
          const profile = profilesById.get(membership.user_id);
          return { userId: membership.user_id, label: profile?.display_name || profile?.email || "Unnamed account", email: profile?.email ?? null, status: membership.status, enrolledAt: membership.created_at };
        }));
        setClassroomRosterMessage("");
      })
      .catch((error: Error) => { setClassroomRoster([]); setClassroomRosterMessage(error.message); });
  }, [activeWorkspaceKey, classroomHubTab, canManageActiveClassroom, session]);

  async function setClassroomMemberStatus(userId: string, status: "active" | "suspended") {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom || activeWorkspace?.kind !== "classroom") return;
    setClassroomRosterMessage(status === "suspended" ? "Revoking access…" : "Restoring access…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_memberships?classroom_id=eq.${activeWorkspace.classroomId}&user_id=eq.${userId}`, {
      method: "PATCH",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      setClassroomRosterMessage(body?.message || "That change could not be saved.");
      return;
    }
    setClassroomRoster((roster) => roster.map((member) => member.userId === userId ? { ...member, status } : member));
    setClassroomRosterMessage(status === "suspended" ? "Access revoked. Their past forecasts and grades stay on record." : "Access restored.");
  }

  async function inviteClassroomStudent(email: string) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom || activeWorkspace?.kind !== "classroom") return;
    setClassroomRosterMessage("Sending invite…");
    const inviteResponse = await fetch("/api/classroom/invite-student", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ email }) });
    const inviteBody = await inviteResponse.json().catch(() => null) as { userId?: string; invited?: boolean; message?: string } | null;
    if (!inviteResponse.ok || !inviteBody?.userId) { setClassroomRosterMessage(inviteBody?.message || "The invite could not be sent."); return; }
    if (classroomRoster.some((member) => member.userId === inviteBody.userId)) { setClassroomRosterMessage("That student is already on this roster."); return; }
    // A classroom membership requires active school-level access first (the
    // same rule a class-code redemption satisfies for itself) -- mirror that
    // here rather than letting the classroom insert fail on a missing
    // organization_memberships row.
    if (activeWorkspace.organizationId) {
      await fetch(`${supabaseUrl}/rest/v1/organization_memberships?on_conflict=organization_id,user_id`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ organization_id: activeWorkspace.organizationId, user_id: inviteBody.userId, role: "student", status: "active" }) });
    }
    const membershipResponse = await fetch(`${supabaseUrl}/rest/v1/classroom_memberships?on_conflict=classroom_id,user_id`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ classroom_id: activeWorkspace.classroomId, user_id: inviteBody.userId, role: "student", status: "active" }) });
    if (!membershipResponse.ok) {
      const body = await membershipResponse.json().catch(() => null) as { message?: string } | null;
      setClassroomRosterMessage(body?.message || "The student could not be enrolled. Check your class capacity.");
      return;
    }
    setClassroomRoster((roster) => [...roster, { userId: inviteBody.userId!, label: email, email, status: "active", enrolledAt: new Date().toISOString() }]);
    setClassroomRosterMessage(inviteBody.invited ? "Invite sent. They will appear here as soon as they sign in." : "Student added to the class.");
  }

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey || activeWorkspace?.kind !== "classroom" || !activeWorkspace.classroomId) {
      setClassroomAssignments([]);
      setSelectedClassroomAssignmentId("");
      setAssignmentMessage("");
      return;
    }
    setAssignmentMessage("Loading class assignments…");
    fetch(`${supabaseUrl}/rest/v1/classroom_assignments?select=id,classroom_id,title,instructions,target_date,target_dates,due_at,status,scenario_id,scenario:scenarios(title,summary,reference_notes,reference_links),instructor_forecast,instructor_forecast_updated_at,class_forecast,class_forecast_updated_at,class_forecast_published_at,created_at&classroom_id=eq.${activeWorkspace.classroomId}&order=target_date.asc`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Class assignments could not be loaded. Apply the academic assignments migration, then refresh.")))
      .then((assignments: ClassroomAssignment[]) => { setClassroomAssignments(assignments); setSelectedClassroomAssignmentId((selected) => { if (assignments.some((assignment) => assignment.id === selected)) return selected; const urlAssignmentId = new URLSearchParams(window.location.search).get("assignment"); if (urlAssignmentId && assignments.some((assignment) => assignment.id === urlAssignmentId)) return urlAssignmentId; return assignments.find((assignment) => assignment.status === "open")?.id ?? ""; }); setAssignmentMessage(""); })
      .catch((error: Error) => { setClassroomAssignments([]); setAssignmentMessage(error.message); });
  }, [activeWorkspaceKey, session]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey || activeWorkspace?.kind !== "classroom" || !activeWorkspace.classroomId) { setAssignmentSubmissions([]); return; }
    fetch(`${supabaseUrl}/rest/v1/assignment_submissions?select=id,assignment_id,classroom_id,student_id,responses,status,submitted_at,created_at,updated_at&classroom_id=eq.${activeWorkspace.classroomId}&order=updated_at.desc`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Assignment submissions could not be loaded. Apply the assignment content migration, then refresh.")))
      .then((submissions: AssignmentSubmission[]) => setAssignmentSubmissions(submissions))
      .catch(() => setAssignmentSubmissions([]));
  }, [activeWorkspaceKey, assignmentSubmissionRefreshToken, session]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey || !selectedClassroomAssignmentId) { setAssignmentReferences([]); return; }
    fetch(`${supabaseUrl}/rest/v1/assignment_references?select=id,assignment_id,classroom_id,kind,label,url,detail,created_by,created_at&assignment_id=eq.${selectedClassroomAssignmentId}&order=created_at.asc`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Reference material could not be loaded.")))
      .then((references: AssignmentReferenceItem[]) => setAssignmentReferences(references))
      .catch(() => setAssignmentReferences([]));
  }, [selectedClassroomAssignmentId, assignmentReferenceRefreshToken, session]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey || !assignmentSubmissions.length) { setAssignmentReviews([]); return; }
    const ids = assignmentSubmissions.map((submission) => submission.id).join(",");
    fetch(`${supabaseUrl}/rest/v1/assignment_reviews?select=id,submission_id,reviewer_id,comment,manual_score,created_at,updated_at&submission_id=in.(${ids})&order=created_at.desc`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Assignment reviews could not be loaded.")))
      .then((reviews: AssignmentReview[]) => setAssignmentReviews(reviews))
      .catch(() => setAssignmentReviews([]));
  }, [assignmentSubmissions, session]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey) { setNotifications([]); return; }
    let isActive = true;
    const loadNotifications = () => fetch(`${supabaseUrl}/rest/v1/notifications?select=id,user_id,kind,payload,read_at,created_at&order=created_at.desc&limit=20`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : [])
      .then((rows: AppNotification[]) => { if (isActive) setNotifications(rows); })
      .catch(() => {});
    loadNotifications();
    const refreshId = window.setInterval(loadNotifications, 120_000);
    return () => { isActive = false; window.clearInterval(refreshId); };
  }, [session]);

  useEffect(() => {
    if (!reviewTarget || !session || !supabaseUrl || !supabaseKey) return;
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    const contextFilter = reviewTarget.classroomId ? `&classroom_id=eq.${reviewTarget.classroomId}` : `&organization_id=eq.${reviewTarget.organizationId}`;
    setReviewMessage("Loading authorized forecast records…");
    fetch(`${supabaseUrl}/rest/v1/forecast_runs?select=id,user_id,created_at,status,location_name,assignment_id,forecast_periods(id,valid_date,period,forecast_data,forecast_verifications(score_data))&user_id=eq.${reviewTarget.userId}${contextFilter}&status=neq.withdrawn&order=created_at.desc`, { headers })
      .then(async (response) => {
        if (!response.ok) throw new Error("Forecast records are not available for review yet.");
        const runs = await response.json() as ReviewRun[];
        const safeRuns = (Array.isArray(runs) ? runs : []).map((run) => ({ ...run, forecast_periods: (Array.isArray(run.forecast_periods) ? run.forecast_periods : []).map((period) => ({ ...period, forecast_verifications: Array.isArray(period.forecast_verifications) ? period.forecast_verifications : [] })) }));
        const defaultRun = reviewTarget.assignmentId ? safeRuns.find((run) => run.assignment_id === reviewTarget.assignmentId) ?? safeRuns[0] : safeRuns[0];
        setReviewRuns(safeRuns); setSelectedReviewRunId(defaultRun?.id ?? null);
        if (!safeRuns.length) { setReviewNotes({}); setReviewMessage("No submitted forecasts in this workspace yet."); return; }
        const reviewResponse = await fetch(`${supabaseUrl}/rest/v1/forecast_reviews?select=id,run_id,reviewer_id,comment,manual_score,rubric_scores,created_at&run_id=in.(${safeRuns.map((run) => run.id).join(",")})&order=created_at.desc`, { headers });
        const notes = reviewResponse.ok ? await reviewResponse.json() as ForecastReview[] : [];
        setReviewNotes(notes.reduce<Record<string, ForecastReview[]>>((grouped, note) => ({ ...grouped, [note.run_id]: [...(grouped[note.run_id] ?? []), note] }), {}));
        setReviewMessage("");
      }).catch((error: Error) => { setReviewRuns([]); setReviewNotes({}); setReviewMessage(error.message); });
  }, [reviewTarget, session]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey) return;
    fetch(`${supabaseUrl}/rest/v1/profiles?select=role,weather_icon_style,personal_tier,display_name&id=eq.${session.user.id}`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } })
      .then((response) => response.ok ? response.json() : [])
      .then((rows: { role: string; weather_icon_style?: WeatherIconStyle | null; personal_tier?: PersonalTier | null; display_name?: string | null }[]) => {
        setRole(rows[0]?.role ?? "student");
        setWeatherIconStyle(rows[0]?.weather_icon_style === "minimal" ? "minimal" : "traditional");
        setPersonalTier(rows[0]?.personal_tier === "paid" ? "paid" : "free");
        setMyDisplayName(rows[0]?.display_name ?? null);
      });
  }, [session, profileRefreshToken]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey) {
      setWorkspaceContexts([{ key: "personal", kind: "personal", label: "Personal desk", detail: "Private forecasts and drafts" }]);
      setOrganizationBranding({});
      setActiveWorkspaceKey("personal");
      setSoleStudentDeskKey(null);
      return;
    }
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    const isOwner = role === "owner";
    // Always fetch the user's own memberships first, even for a platform
    // owner — an owner account can also be a real member of a school (e.g.
    // testing the instructor experience on a pilot account), and that
    // personal role must never be silently dropped in favor of the unscoped
    // platform-wide view added below. That view is additive, not a
    // replacement: previously an owner's classroom/org role at a school they
    // personally belonged to would vanish (and permission-gated controls
    // with it) the moment `role` resolved to "owner" and this effect swapped
    // to the unscoped queries, which had no per-user role data at all.
    const organizationRequest = fetch(`${supabaseUrl}/rest/v1/organization_memberships?select=organization_id,role,organizations(id,name,kind)&user_id=eq.${session.user.id}&status=eq.active`, { headers });
    organizationRequest.then(async (organizationResponse) => {
      if (!organizationResponse.ok) throw new Error("Your workspace list could not be loaded.");
      const organizationRows = await organizationResponse.json() as OrganizationMembershipRow[];
      // A school coordinator (org role owner/admin) manages every classroom in
      // their school, not just ones they personally belong to — fetch those
      // separately from the personal classroom_memberships list and merge, so
      // e.g. a school owner who never joined a class as an instructor still
      // sees and can manage all of that school's classes.
      const coordinatorOrgIds = [...new Set(organizationRows.flatMap((row) => row.organization_id && (row.role === "owner" || row.role === "admin") ? [row.organization_id] : []))];
      const classroomRequest = fetch(`${supabaseUrl}/rest/v1/classroom_memberships?select=classroom_id,role,status,classrooms(id,name,term,organization_id,status,organizations(name))&user_id=eq.${session.user.id}`, { headers });
      const coordinatedClassroomRequest = coordinatorOrgIds.length
        ? fetch(`${supabaseUrl}/rest/v1/classrooms?select=id,name,term,organization_id,status,organizations(name)&organization_id=in.(${coordinatorOrgIds.join(",")})&order=name.asc`, { headers })
        : null;
      // A platform owner additionally sees every organization/classroom on
      // the whole platform, for the "All workspaces" admin view.
      const allOrganizationsRequest = isOwner ? fetch(`${supabaseUrl}/rest/v1/organizations?select=id,name,kind&order=name.asc`, { headers }) : null;
      const allClassroomsRequest = isOwner ? fetch(`${supabaseUrl}/rest/v1/classrooms?select=id,name,term,organization_id,status,organizations(name)&order=name.asc`, { headers }) : null;
      const [classroomResponse, coordinatedClassroomResponse, allOrganizationsResponse, allClassroomsResponse] = await Promise.all([classroomRequest, coordinatedClassroomRequest ?? Promise.resolve(null), allOrganizationsRequest ?? Promise.resolve(null), allClassroomsRequest ?? Promise.resolve(null)]);
      if (!classroomResponse.ok || (coordinatedClassroomResponse && !coordinatedClassroomResponse.ok) || (allOrganizationsResponse && !allOrganizationsResponse.ok) || (allClassroomsResponse && !allClassroomsResponse.ok)) throw new Error("Your workspace list could not be loaded.");
      const classroomRows = await classroomResponse.json() as ClassroomMembershipRow[];
      const coordinatedClassroomRows = coordinatedClassroomResponse ? await coordinatedClassroomResponse.json() as ClassroomRow[] : [];
      const allOrganizationRows = allOrganizationsResponse ? await allOrganizationsResponse.json() as OrganizationRow[] : [];
      const allClassroomRows = allClassroomsResponse ? await allClassroomsResponse.json() as ClassroomRow[] : [];
      const coordinatorRoleByOrg = new Map(organizationRows.flatMap((row) => row.organization_id ? [[row.organization_id, row.role] as const] : []));
      const membershipClassroomIds = new Set(classroomRows.flatMap((row) => row.classrooms ? [row.classrooms.id] : []));
      const coordinatedOnlyRows: ClassroomMembershipRow[] = coordinatedClassroomRows
        .filter((classroom) => !membershipClassroomIds.has(classroom.id))
        .map((classroom) => ({ classroom_id: classroom.id, role: coordinatorRoleByOrg.get(classroom.organization_id) ?? "admin", status: "active", classrooms: classroom }));
      const knownOrganizationIds = new Set(organizationRows.flatMap((row) => row.organization_id ? [row.organization_id] : []));
      const platformOnlyOrganizationRows: OrganizationMembershipRow[] = allOrganizationRows
        .filter((organization) => !knownOrganizationIds.has(organization.id))
        .map((organization) => ({ organization_id: organization.id, role: "", organizations: organization }));
      const knownClassroomIds = new Set([...membershipClassroomIds, ...coordinatedOnlyRows.map((row) => row.classroom_id)]);
      const platformOnlyClassroomRows: ClassroomMembershipRow[] = allClassroomRows
        .filter((classroom) => !knownClassroomIds.has(classroom.id))
        .map((classroom) => ({ classroom_id: classroom.id, role: "", status: "active", classrooms: classroom }));
      const allOrganizationRowsMerged = [...organizationRows, ...platformOnlyOrganizationRows];
      const allClassroomRowsMerged = [...classroomRows, ...coordinatedOnlyRows, ...platformOnlyClassroomRows];
      const organizations = allOrganizationRowsMerged.flatMap((row) => {
        const organization = row.organizations;
        if (!organization) return [];
        return [{ key: `organization:${organization.id}`, kind: "organization" as const, organizationId: organization.id, label: organization.name, detail: `${organization.kind} workspace`, role: row.role || undefined }];
      });
      const classrooms = allClassroomRowsMerged.flatMap((row) => {
        const classroom = row.classrooms;
        if (!classroom) return [];
        // A membership can be invited (not yet joined — don't show it as a desk),
        // active, or suspended (access revoked, but the desk stays reachable
        // read-only so past forecasts and grades don't disappear).
        const status = row.status;
        if (status === "invited") return [];
        const active = status !== "suspended";
        return [{ key: `classroom:${classroom.id}`, kind: "classroom" as const, classroomId: classroom.id, organizationId: classroom.organization_id, label: classroom.name, detail: `${classroom.organizations?.name ?? "School"}${classroom.term ? ` · ${classroom.term}` : ""}${active ? "" : " · access ended"}`, role: row.role || undefined, active, classroomStatus: classroom.status ?? "active" }];
      });
      const classroomOrganizations = allClassroomRowsMerged.flatMap((row) => {
        const classroom = row.classrooms;
        if (!classroom?.organizations?.name || organizations.some((organization) => organization.organizationId === classroom.organization_id)) return [];
        return [{ key: `organization:${classroom.organization_id}`, kind: "organization" as const, organizationId: classroom.organization_id, label: classroom.organizations.name, detail: "school workspace", role: row.role || "student" }];
      });
      const contexts: WorkspaceContext[] = [
        ...(isOwner ? [{ key: "all", kind: "all" as const, label: "All workspaces", detail: "Owner view across the platform" }] : []),
        { key: "personal", kind: "personal", label: "Personal desk", detail: "Private forecasts and drafts" },
        ...organizations,
        ...classroomOrganizations,
        ...classrooms,
      ];
      const organizationIds = [...new Set(contexts.flatMap((workspace) => workspace.organizationId ? [workspace.organizationId] : []))];
      const brandingResponse = organizationIds.length
        ? await fetch(`${supabaseUrl}/rest/v1/organization_branding?select=organization_id,school_name,logo_path,logo_alt&organization_id=in.(${organizationIds.join(",")})`, { headers })
        : null;
      const brandingRows = brandingResponse?.ok ? await brandingResponse.json() as OrganizationBranding[] : [];
      setOrganizationBranding(brandingRows.reduce<Record<string, OrganizationBranding>>((all, branding) => ({ ...all, [branding.organization_id]: branding }), {}));
      setWorkspaceContexts(contexts);
      const activeClassrooms = classrooms.filter((classroom) => classroom.active !== false);
      const soleKey = !isOwner && organizations.length === 0 && activeClassrooms.length === 1 ? activeClassrooms[0].key : null;
      setSoleStudentDeskKey(soleKey);
      const storedKey = window.localStorage.getItem(`${workspaceContextStoragePrefix}:${session.user.id}`);
      const urlKey = new URLSearchParams(window.location.search).get("class");
      const defaultKey = isOwner ? "all" : soleKey ?? "personal";
      const nextWorkspaceKey = urlKey && contexts.some((workspace) => workspace.key === urlKey) ? urlKey : contexts.some((workspace) => workspace.key === storedKey) ? storedKey! : defaultKey;
      setActiveWorkspaceKey(nextWorkspaceKey);
      // The School/Classroom sections have no fallback UI for a workspace
      // that no longer matches (e.g. a school was archived, or this refresh
      // landed the user back on "personal") — without this they'd render a
      // blank main area under an otherwise-normal header/nav. Bounce back to
      // the dashboard instead of leaving that gap.
      const nextWorkspaceKind = contexts.find((workspace) => workspace.key === nextWorkspaceKey)?.kind;
      setActiveSection((section) => {
        if (section === "school" && nextWorkspaceKind !== "organization") return "dashboard";
        if (section === "classroom" && nextWorkspaceKind !== "classroom") return "dashboard";
        return section;
      });
      setWorkspaceContextStatus(organizations.length || classroomOrganizations.length || classrooms.length ? "" : "No shared workspaces are assigned to this account yet.");
    }).catch((error: Error) => {
      setWorkspaceContextStatus(error.message);
      setWorkspaceContexts([{ key: "personal", kind: "personal", label: "Personal desk", detail: "Private forecasts and drafts" }]);
      setOrganizationBranding({});
      setSoleStudentDeskKey(null);
      setActiveWorkspaceKey("personal");
      setActiveSection((section) => (section === "school" || section === "classroom") ? "dashboard" : section);
    });
  }, [role, session, workspaceRefreshToken]);

  useEffect(() => {
    if (!session || !activeWorkspace) return;
    window.localStorage.setItem(`${workspaceContextStoragePrefix}:${session.user.id}`, activeWorkspace.key);
  }, [activeWorkspace, session]);

  useEffect(() => {
    if (activeSection !== "dashboard" || dataPanel !== "sounding") return;
    fetch(`/api/sounding?${locationQuery}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Sounding data unavailable");
        setSoundingText(`Observed radiosonde · ${data.station} · ${data.cycle}\n\n${data.text}`);
        setSoundingStatus("");
      })
      .catch((error: Error) => setSoundingStatus(error.message));
  }, [activeSection, dataPanel, locationQuery]);

  useEffect(() => {
    if (activeSection !== "dashboard" || dataPanel !== "nbm") return;
    fetch(`/api/nbm?${locationQuery}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "NBM data unavailable");
        setNbmText(`NBM hourly bulletin · ${data.station} · ${data.cycle}\n\n${data.text}`);
        setNbmStatus("");
      })
      .catch((error: Error) => setNbmStatus(error.message));
  }, [activeSection, dataPanel, locationQuery]);

  useEffect(() => {
    if (activeSection !== "dashboard" || dataPanel !== "afd") return;
    fetch(`/api/afd?${locationQuery}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Forecast discussion unavailable");
        setAfdText(`Area Forecast Discussion · ${data.office} · issued ${new Date(data.issuedAt).toLocaleString("en-US", { timeZone: selectedLocation.timezone, dateStyle: "medium", timeStyle: "short" })}\n\n${data.text}`);
        setAfdStatus("");
      })
      .catch((error: Error) => setAfdStatus(error.message));
  }, [activeSection, dataPanel, locationQuery, selectedLocation.timezone]);

  useEffect(() => {
    if (activeSection !== "dashboard" || dataPanel !== "mcd") return;
    fetch("/api/mcd")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Mesoscale discussions unavailable");
        setMcdDiscussions(data.discussions ?? []);
        setMcdStatus(data.discussions?.length ? "" : "No active SPC mesoscale discussions right now.");
      })
      .catch((error: Error) => setMcdStatus(error.message));
  }, [activeSection, dataPanel]);

  useEffect(() => {
    if (activeSection !== "dashboard" || dataPanel !== "models" || !hasModelAccess) return;
    setOpenMeteoStatus("Loading Open-Meteo guidance…");
    fetch(`/api/open-meteo?model=${openMeteoModel}&${locationQuery}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Open-Meteo guidance is unavailable");
        setOpenMeteoGuidance(data as OpenMeteoGuidance);
        setOpenMeteoStatus("");
      })
      .catch((error: Error) => setOpenMeteoStatus(error.message));
  }, [activeSection, dataPanel, openMeteoModel, locationQuery, hasModelAccess]);

  useEffect(() => {
    if (activeSection !== "dashboard" || dataPanel !== "models" || openMeteoView !== "compare" || !hasModelAccess) return;
    const models = [...new Set([comparisonLeftModel, comparisonRightModel])];
    let active = true;
    setComparisonStatus("Loading model comparison…");
    Promise.all(models.map(async (model) => {
      const response = await fetch(`/api/open-meteo?model=${model}&${locationQuery}`);
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
  }, [activeSection, dataPanel, openMeteoView, comparisonLeftModel, comparisonRightModel, locationQuery, hasModelAccess]);

  useEffect(() => {
    if (activeSection !== "dashboard" || dataPanel !== "ensembles" || !hasModelAccess) return;
    let active = true;
    setEnsembleStatus("Loading GFS ensemble guidance…");
    fetch(`/api/ensembles?${locationQuery}`)
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
  }, [activeSection, dataPanel, locationQuery, hasModelAccess]);

  useEffect(() => {
    if (activeSection !== "dashboard" || dataPanel !== "model-sounding" || !hasModelAccess) return;
    let active = true;
    setModelSounding(null);
    setModelSoundingStatus("Loading model sounding…");
    fetch(`/api/model-sounding?model=${soundingModel}&runOffset=${soundingRunOffset}&${locationQuery}`)
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
  }, [activeSection, dataPanel, soundingModel, soundingRunOffset, locationQuery, hasModelAccess]);

  useEffect(() => {
    if (!session) { setArchives([]); setSelectedArchiveId(null); return; }
    const storedArchives = window.localStorage.getItem(archiveStorageKeyFor(session.user.id));
    if (!storedArchives) { setArchives([]); setSelectedArchiveId(null); return; }
    try {
      const parsed = numberArchiveVersions(JSON.parse(storedArchives) as SavedForecast[]);
      setArchives(parsed);
      setSelectedArchiveId(parsed[0]?.id ?? null);
    } catch {
      window.localStorage.removeItem(archiveStorageKeyFor(session.user.id));
    }
  }, [session?.user?.id]);

  const observedAt = liveWeather
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(liveWeather.observation.observedAt))
    : "Loading live NWS data…";
  // Only populated for the in-house NEXRAD path (see RadarMap's onFrameMeta) — the volume's own
  // observation time, not "now", so a stale/cached frame reads honestly on the on-map legend.
  const radarObservedAtLabel = radarFrameMeta?.observedAt
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: selectedLocation.timezone, timeZoneName: "short" }).format(new Date(radarFrameMeta.observedAt))
    : null;
  // Verify is a personal record view. archives itself is scoped broader
  // inside a classroom/school workspace (organization_id/classroom_id, not
  // user_id) because ClassroomLiveForecast's class-wide average needs every
  // member's data -- but Verify must only ever surface the signed-in
  // person's own forecasts here, never a classmate's, even though they
  // share the same underlying fetch.
  const myWorkspaceArchives = (activeWorkspace?.kind === "classroom" || activeWorkspace?.kind === "organization")
    ? archives.filter((archive) => archive.authorId === session?.user.id)
    : archives;
  const selectedArchive = myWorkspaceArchives.find((archive) => archive.id === selectedArchiveId) ?? null;
  const visibleReviewRuns = reviewTarget?.assignmentId ? reviewRuns.filter((run) => run.assignment_id === reviewTarget.assignmentId) : reviewRuns;
  const selectedReviewRun = visibleReviewRuns.find((run) => run.id === selectedReviewRunId) ?? visibleReviewRuns[0] ?? null;
  const filteredArchives = myWorkspaceArchives.filter((archive) => {
    const matchingDate = !archiveDateFilter || archive.targetDate === archiveDateFilter;
    const matchingStatus = archiveStatusFilter === "all" || archive.status === archiveStatusFilter;
    const searchText = `${forecastTargetTitle(archive.targetDate)} ${archive.day.conditions} ${archive.night.conditions}`.toLowerCase();
    return matchingDate && matchingStatus && (!archiveSearch.trim() || searchText.includes(archiveSearch.trim().toLowerCase()));
  });
  const recordWindowDates = Array.from({ length: 7 }, (_, index) => addDays(new Date(`${recordWindowStart}T12:00:00`), index));
  const todayDateString = addDays(new Date(), 0);
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
  const isCurrentRadarFrame = radarFrames.length === 0 || radarFrameIndex === radarFrames.length - 1;
  const soundingProfiles = modelSounding?.profiles ?? [];
  const nearestSoundingProfileIndex = nearestModelProfileIndex(soundingProfiles);
  const soundingWindowStart = Math.max(0, Math.min(soundingProfileIndex - 1, Math.max(0, soundingProfiles.length - 4)));
  const soundingProfileWindow = soundingProfiles.slice(soundingWindowStart, soundingWindowStart + 4);
  const radarFrameTime = radarFrame ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(radarFrame.time * 1000)) : "Timeline unavailable";
  const futureRadarFrame = futureRadarFrames[futureRadarFrameIndex] ?? null;
  const futureRadarFrameTime = futureRadarFrame ? new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(futureRadarFrame.time * 1000)) : "Future radar unavailable";
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
  const outlook = liveWeather?.forecastPeriods.reduce<{ date: string; label: string; high: number | null; low: number | null; shortForecast: string; precipitationChance: number | null; wind: string | null }[]>((days, period) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(period.startTime));
    const existing = days.find((day) => day.date === date);
    const label = new Intl.DateTimeFormat("en-US", { weekday: "short" , timeZone: "America/New_York" }).format(new Date(period.startTime));
    const wind = period.windSpeed ? `${period.windDirection ?? ""} ${period.windSpeed}`.trim() : null;
    if (existing) {
      existing.high = existing.high === null ? period.temperature : Math.max(existing.high, period.temperature);
      existing.low = existing.low === null ? period.temperature : Math.min(existing.low, period.temperature);
      existing.precipitationChance = Math.max(existing.precipitationChance ?? 0, period.precipitationChance ?? 0);
    } else if (days.length < 7) {
      days.push({ date, label, high: period.temperature, low: period.temperature, shortForecast: period.shortForecast, precipitationChance: period.precipitationChance, wind });
    }
    return days;
  }, []) ?? [];
  const referenceOptions: ReferenceItem[] = [
    { id: "nws-observation", label: "Current NWS observation", detail: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F · ${liveWeather.observation.description} · ${liveWeather.observation.station || liveWeather.observation.stationName || "NWS observation station"} · ${observedAt}` : "Live observation was unavailable when attached.", preview: liveWeather ? { kind: "metrics", items: [{ label: "Temperature", value: `${liveWeather.observation.temperatureF ?? "—"}°F` }, { label: "Dew point", value: `${liveWeather.observation.dewpointF ?? "—"}°F` }, { label: "Wind", value: liveWeather.observation.windMph === null ? "—" : `${liveWeather.observation.windDirection ?? ""} ${liveWeather.observation.windMph} mph`.trim() }, { label: "Station", value: liveWeather.observation.station || liveWeather.observation.stationName || "NWS observation station" }] } : undefined },
    { id: "nws-guidance", label: "Current NWS forecast", detail: liveWeather?.forecast ? `${liveWeather.forecast.period}: ${liveWeather.forecast.detailedForecast}` : "NWS forecast was unavailable when attached.", preview: liveWeather?.forecast ? { kind: "metrics", items: [{ label: "Period", value: liveWeather.forecast.period }, { label: "Temperature", value: `${liveWeather.forecast.temperature}°${liveWeather.forecast.temperatureUnit}` }, { label: "Precipitation", value: `${liveWeather.forecast.precipitationChance ?? "—"}%` }, { label: "Conditions", value: liveWeather.forecast.shortForecast }] } : undefined },
    { id: "nbm", label: `NBM ${selectedLocation.observationStation} bulletin`, detail: nbmText || nbmStatus },
    { id: "afd", label: "NWS Area Forecast Discussion", detail: afdText || afdStatus },
    { id: "mcd", label: mcdDiscussions[0] ? `SPC ${mcdDiscussions[0].title}` : "SPC Mesoscale Discussion", detail: mcdDiscussions[0] ? `${mcdDiscussions[0].title}\n\n${mcdDiscussions[0].text}` : mcdStatus },
    { id: "model-radar", label: "HRRR simulated reflectivity", detail: `HRRR simulated reflectivity model guidance for ${selectedLocation.name} · ${futureRadarStatus}` },
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

  // A reference attached via quick-add gets `${sourceId}-${uuid}` as its id (see below), so the
  // source it came from can be recovered without a separate column. Used to recommend the same
  // source types the student reached for on the previous day of this draft -- each recommendation
  // still adds a brand-new snapshot, never the prior day's stale data.
  function recommendedReferenceIds(period: "day" | "night"): string[] {
    const previousDay = forecastRun.days[selectedForecastDay - 1];
    if (!previousDay) return [];
    const ids: string[] = [];
    for (const reference of previousDay[period].references) {
      const sourceId = referenceOptions.find((option) => reference.id === option.id || reference.id.startsWith(`${option.id}-`))?.id;
      if (sourceId && !ids.includes(sourceId)) ids.push(sourceId);
    }
    return ids;
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

  // Assignments are deliberately independent of forecastRun/forecast_runs -- a lightweight
  // per-day day/night forecast (same field set as a real forecast), stored in
  // assignment_submissions, never touches the real forecast archive or its automatic
  // verification.
  function updateAssignmentDraft(date: string, period: "day" | "night", field: keyof AssignmentPeriodResponse, value: string) {
    setAssignmentDraftResponses((current) => {
      const day = current[date] ?? emptyAssignmentDayResponse;
      return { ...current, [date]: { ...day, [period]: { ...day[period], [field]: value } } };
    });
  }

  function formatAssignmentResponseField(date: string, period: "day" | "night", field: "highLow" | "rainChance" | "timing") {
    const value = (assignmentDraftResponses[date] ?? emptyAssignmentDayResponse)[period][field].trim();
    if (!value) return;
    if (field === "highLow") {
      const number = temperatureInputValue(value);
      updateAssignmentDraft(date, period, field, number ? number.replace(/\.0+$/, "") : "");
      return;
    }
    if (field === "rainChance") {
      const number = Number.parseInt(percentInputValue(value), 10);
      updateAssignmentDraft(date, period, field, Number.isFinite(number) ? String(Math.max(0, Math.min(100, number))) : "");
      return;
    }
    const normalized = value.replace(/\s*(a\.?m\.?|p\.?m\.?)\b/gi, (_, meridiem: string) => ` ${meridiem[0].toUpperCase()}M`).replace(/\s*-\s*/g, "–");
    updateAssignmentDraft(date, period, field, /\b(?:AM|PM)\b/.test(normalized) ? normalized : `${normalized} PM`);
  }

  async function saveAssignmentSubmission(assignment: ClassroomAssignment, submit: boolean) {
    if (assignmentSaving || !session || !supabaseUrl || !supabaseKey) return;
    setAssignmentSaving(true);
    setAssignmentMessage(submit ? "Submitting…" : "Saving draft…");
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates" };
    const responses = Object.fromEntries(assignmentDates(assignment).map((date) => [date, assignmentDraftResponses[date] ?? emptyAssignmentDayResponse]));
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/assignment_submissions?on_conflict=assignment_id,student_id`, {
        method: "POST", headers,
        body: JSON.stringify({ assignment_id: assignment.id, classroom_id: assignment.classroom_id, student_id: session.user.id, responses, status: submit ? "submitted" : "draft", submitted_at: submit ? new Date().toISOString() : null }),
      });
      const rows = await response.json().catch(() => []);
      if (!response.ok || !rows[0]) throw new Error("The assignment could not be saved.");
      setAssignmentSubmissions((current) => [rows[0] as AssignmentSubmission, ...current.filter((row) => row.id !== rows[0].id)]);
      setAssignmentMessage(submit ? "Assignment submitted." : "Draft saved.");
    } catch (error) {
      setAssignmentMessage(error instanceof Error ? error.message : "The assignment could not be saved.");
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function addAssignmentReference(assignment: ClassroomAssignment, fields: { kind: AssignmentReferenceKind; label: string; url?: string | null; detail?: Record<string, unknown> | null }) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom) return;
    const response = await fetch(`${supabaseUrl}/rest/v1/assignment_references`, {
      method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ assignment_id: assignment.id, classroom_id: assignment.classroom_id, kind: fields.kind, label: fields.label, url: fields.url ?? null, detail: fields.detail ?? null, created_by: session.user.id }),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setAssignmentMessage("The reference could not be attached."); return; }
    setAssignmentReferences((current) => [...current, rows[0] as AssignmentReferenceItem]);
  }

  async function removeAssignmentReference(referenceId: string) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom) return;
    setAssignmentReferences((current) => current.filter((reference) => reference.id !== referenceId));
    await fetch(`${supabaseUrl}/rest/v1/assignment_references?id=eq.${referenceId}`, { method: "DELETE", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } });
    setAssignmentReferenceRefreshToken((value) => value + 1);
  }

  async function saveAssignmentReview(submissionId: string) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom) return;
    const comment = assignmentReviewComment.trim();
    const score = assignmentReviewScore.trim();
    if (!comment && !score) { setAssignmentReviewMessage("Add a comment or a score before saving."); return; }
    setAssignmentReviewMessage("Saving…");
    const response = await fetch(`${supabaseUrl}/rest/v1/assignment_reviews`, {
      method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ submission_id: submissionId, reviewer_id: session.user.id, comment: comment || null, manual_score: score ? Number(score) : null }),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setAssignmentReviewMessage("The review could not be saved."); return; }
    setAssignmentReviews((current) => [rows[0] as AssignmentReview, ...current]);
    setAssignmentReviewComment("");
    setAssignmentReviewScore("");
    setAssignmentReviewMessage("Review saved.");
  }

  async function markNotificationRead(notification: AppNotification) {
    if (!session || !supabaseUrl || !supabaseKey || notification.read_at) return;
    setNotifications((current) => current.map((row) => row.id === notification.id ? { ...row, read_at: new Date().toISOString() } : row));
    await fetch(`${supabaseUrl}/rest/v1/notifications?id=eq.${notification.id}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ read_at: new Date().toISOString() }) });
  }

  async function markAllNotificationsRead() {
    if (!session || !supabaseUrl || !supabaseKey || !hasUnreadNotifications) return;
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((row) => row.read_at ? row : { ...row, read_at: readAt }));
    await fetch(`${supabaseUrl}/rest/v1/notifications?read_at=is.null`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ read_at: readAt }) });
  }

  function notificationLabel(notification: AppNotification) {
    if (notification.kind === "assignment_created") return `New assignment: ${notification.payload.title ?? ""}`;
    if (notification.kind === "forecast_scored") return `Forecast scored${notification.payload.target_date ? ` · ${forecastTargetTitle(notification.payload.target_date)}` : ""}: ${notification.payload.day_score ?? "—"}% day / ${notification.payload.night_score ?? "—"}% night`;
    if (notification.kind === "assignment_reviewed") return notification.payload.manual_score != null ? `Assignment feedback ready · ${notification.payload.manual_score}%` : "Assignment feedback ready";
    return notification.payload.title ?? "Notification";
  }

  function openNotification(notification: AppNotification) {
    markNotificationRead(notification);
    setNotificationsOpen(false);
    setWorkspaceMenuOpen(false);
    // A scored forecast is always about the student's own record, viewed in Verify -- whether it
    // was submitted from the personal desk or as part of a classroom assignment, never the
    // class-wide aggregate grade.
    if (notification.kind === "forecast_scored" || notification.kind === "assignment_reviewed") {
      if (notification.payload.classroom_id) {
        const workspace = workspaceContexts.find((candidate) => candidate.classroomId === notification.payload.classroom_id);
        if (workspace) setActiveWorkspaceKey(workspace.key);
      } else {
        setActiveWorkspaceKey("personal");
      }
      if (notification.payload.target_date) {
        setRecordFocusDate(notification.payload.target_date);
        setRecordWindowStart(notification.payload.target_date);
        const archive = archiveForDate(notification.payload.target_date);
        if (archive) setSelectedArchiveId(archive.id);
      }
      setActiveSection("verify");
      return;
    }
    if (notification.payload.classroom_id) {
      const workspace = workspaceContexts.find((candidate) => candidate.classroomId === notification.payload.classroom_id);
      if (workspace) setActiveWorkspaceKey(workspace.key);
    }
    if (notification.payload.assignment_id) setSelectedClassroomAssignmentId(notification.payload.assignment_id);
    setClassroomHubTab("assignments");
    setActiveSection("classroom");
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
    if (dataPanel === "afd") {
      attachDeskReference({ id: `afd-${Date.now()}`, label: "NWS Area Forecast Discussion", detail: snippet(afdText || afdStatus) });
      return;
    }
    if (dataPanel === "mcd") {
      const latest = mcdDiscussions[0];
      attachDeskReference({ id: `mcd-${Date.now()}`, label: latest ? `SPC ${latest.title}` : "SPC Mesoscale Discussion", detail: snippet(latest ? `${latest.title}\n\n${latest.text}` : mcdStatus) });
      return;
    }
    if (dataPanel === "alerts") {
      attachDeskReference({ id: `alerts-${Date.now()}`, label: liveWeather?.alerts.length ? `NWS ${liveWeather.alerts[0].event}` : "NWS alert status", detail: snippet(liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => `${alert.event} (${alert.severity})${alert.areaDesc ? ` · ${alert.areaDesc}` : ""}\n${alert.headline ?? ""}\n\n${alert.description ?? ""}`).join("\n\n---\n\n") : "No active NWS alerts at the time this reference was attached.") });
      return;
    }
    if (dataPanel === "model-radar") {
      attachDeskReference({ id: `model-radar-${Date.now()}`, label: "HRRR simulated reflectivity", detail: `HRRR simulated reflectivity model guidance for ${selectedLocation.name} · ${futureRadarStatus}` });
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

  function handleForecastFormSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const readyDays = forecastRun.days.filter((day) => day.ready);
    submitForecastDays(readyDays.length ? readyDays : forecastRun.days);
  }

  async function submitForecastDays(daysToSubmit: ForecastDayDraft[]) {
    if (isSubmitting || !daysToSubmit.length) return;
    if (!session || !supabaseUrl || !supabaseKey) {
      setSaveMessage("Sign in before submitting so this forecast can be archived safely.");
      return;
    }
    setIsSubmitting(true);
    setSubmissionToken("");
    const savedAt = new Date().toISOString();
    const nextArchives = daysToSubmit.map((day) => {
      return {
      id: crypto.randomUUID(), locationId: selectedLocation.id, locationName: selectedLocation.name, savedAt, label: archiveTitle({ savedAt }), targetDate: day.date,
      status: revisionParentRunId ? "revised" as const : "submitted" as const, versionNumber: 1, parentRunId: revisionParentRunId, authorId: session.user.id,
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
      const cloudRecord = await saveForecastRunToCloud(savedAt, daysToSubmit);
      const cloudArchives = nextArchives.map((archive) => ({
        ...archive,
        id: `${cloudRecord.runId}:${archive.targetDate}`,
        runId: cloudRecord.runId,
        parentRunId: revisionParentRunId,
        periodIds: cloudRecord.periodIdsByDate[archive.targetDate],
      }));
      const combinedArchives = numberArchiveVersions([...cloudArchives, ...archives].slice(0, 50));
      setArchives(combinedArchives);
      setSelectedArchiveId(cloudArchives[0]?.id ?? null);
      if (session) window.localStorage.setItem(archiveStorageKeyFor(session.user.id), JSON.stringify(combinedArchives));
      const detail = `${cloudArchives.length}-day forecast submitted · archive token ${cloudRecord.runId.slice(0, 8).toUpperCase()}`;
      setSaveMessage(`${detail}.`);
      setSubmissionToken(detail);
      // A submitted forecast is immutable in the archive. Days not included in
      // this submission (e.g. a single day posted from its card, or days never
      // marked Ready) stay in the draft untouched. If everything was just
      // submitted, start a clean worksheet for the same target date so a
      // deliberate re-submission is a new version rather than a stale copy.
      const submittedDates = new Set(daysToSubmit.map((day) => day.date));
      const previouslySelectedDate = forecastRun.days[selectedForecastDay]?.date;
      const remainingDays = forecastRun.days.filter((day) => !submittedDates.has(day.date));
      if (remainingDays.length) {
        setForecastRun((run) => ({ ...run, days: remainingDays }));
        const nextIndex = remainingDays.findIndex((day) => day.date === previouslySelectedDate);
        setSelectedForecastDay(nextIndex >= 0 ? nextIndex : 0);
      } else {
        const freshRun = createNewForecastRun();
        freshRun.days[0] = { ...freshRun.days[0], date: previouslySelectedDate ?? nextForecastDate() };
        setForecastRun(freshRun);
        setSelectedForecastDay(0);
      }
      setRevisionParentRunId(null);
      setActiveScenarioId(null);
    } catch (error) {
      setSaveMessage(`Forecast was not submitted: ${error instanceof Error ? error.message : "Cloud storage could not be reached."}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function saveForecastRunToCloud(submittedAt: string, daysToSubmit: ForecastDayDraft[]) {
    if (!session || !supabaseUrl || !supabaseKey) throw new Error("Sign in is required to save this forecast.");
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" };
    const runResponse = await fetch(`${supabaseUrl}/rest/v1/forecast_runs`, {
      method: "POST", headers,
      body: JSON.stringify({ user_id: session.user.id, location_name: selectedLocation.name, latitude: selectedLocation.latitude, longitude: selectedLocation.longitude, organization_id: activeWorkspace?.organizationId ?? null, classroom_id: activeWorkspace?.classroomId ?? null, parent_run_id: revisionParentRunId, scenario_id: activeScenarioId, publication_scope: "private", initial_horizon_days: daysToSubmit.length, status: revisionParentRunId ? "revised" : "submitted", submitted_at: submittedAt }),
    });
    const runRows = await runResponse.json().catch(() => []);
    if (!runResponse.ok || !runRows[0]?.id) throw new Error("Forecast run storage is not ready. Confirm the forecast-runs SQL migration was run.");
    const evidence = {
      observation: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F, ${liveWeather.observation.description}; ${liveWeather.observation.station || liveWeather.observation.stationName || "NWS observation station"} at ${observedAt}` : "No live observation available when saved",
      forecast: liveWeather?.forecast ? `${liveWeather.forecast.period}: ${liveWeather.forecast.shortForecast}; ${liveWeather.forecast.precipitationChance ?? 0}% precipitation chance` : "No NWS forecast available when saved",
      alerts: liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => alert.event).join(", ") : liveWeather?.alertsAvailable === false ? "NWS alert feed unavailable when saved" : "No active NWS alerts when saved",
    };
    const periods = daysToSubmit.flatMap((day) => ([
      { run_id: runRows[0].id, valid_date: day.date, period: "day", forecast_data: day.day, evidence_snapshot: evidence },
      { run_id: runRows[0].id, valid_date: day.date, period: "night", forecast_data: day.night, evidence_snapshot: evidence },
    ]));
    const periodResponse = await fetch(`${supabaseUrl}/rest/v1/forecast_periods`, { method: "POST", headers, body: JSON.stringify(periods) });
    const periodRows = await periodResponse.json().catch(() => []);
    if (!periodResponse.ok) throw new Error("Forecast run was created, but its day/night periods could not be saved.");
    const periodIdsByDate = Object.fromEntries(daysToSubmit.map((day) => {
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
    setRevisionParentRunId(archive.runId ?? null);
    setForecastRun({ id: crypto.randomUUID(), initialHorizonDays: 1, days: [{ date: targetDate, ready: false, day: { ...emptyPeriod("day"), highLow: archive.day.high, conditions: archive.day.conditions, rainChance: archive.day.rainChance, timing: archive.day.timing, hazards: archive.day.hazards, reasoning: archive.day.reasoning ?? "", references: savedReferences(archive.day.references) }, night: { ...emptyPeriod("night"), highLow: archive.night.low, conditions: archive.night.conditions, rainChance: archive.night.rainChance, timing: archive.night.timing, hazards: archive.night.hazards, reasoning: archive.night.reasoning ?? "", references: savedReferences(archive.night.references) } }] });
    setSelectedForecastDay(0); setArchiveMenuId(null); setSaveMessage(`Revision draft opened for ${targetDate} at ${archiveLocation.name}. Submit creates a new, auditable version.`); setActiveSection("forecast");
  }

  async function startScenario(scenario: Scenario) {
    const dates = scenario.target_dates?.length ? scenario.target_dates : [scenario.event_date];
    // A scenario's location_id is either one of the preset location ids, or (since
    // real historical events rarely fall in one of those four cities) an NWS
    // station id an HQ author entered — resolved the same way the manual
    // "enter a station ID" location picker resolves one.
    if (weatherDeskLocations.some((location) => location.id === scenario.location_id)) {
      setCustomLocation(null);
      setLocationId(scenario.location_id);
    } else {
      try {
        const response = await fetch(`/api/location-lookup?stationId=${encodeURIComponent(scenario.location_id)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to resolve that station.");
        setCustomLocation({ id: `custom-${scenario.location_id.toLowerCase()}`, name: `${data.city}, ${data.state}`, latitude: data.latitude, longitude: data.longitude, timezone: data.timezone, observationStation: data.observationStation, upperAirStation: data.upperAirStation, radarSite: data.radarSite });
      } catch {
        setSaveMessage(`Forecasting for ${scenario.title}, but its location "${scenario.location_id}" could not be resolved — check the location before forecasting.`);
      }
    }
    setRevisionParentRunId(null);
    setSelectedClassroomAssignmentId("");
    setActiveScenarioId(scenario.id);
    setForecastRun({ id: crypto.randomUUID(), initialHorizonDays: dates.length, days: dates.map((date) => createForecastDay(date)) });
    setSelectedForecastDay(0);
    setSaveMessage(`Forecasting for ${scenario.title}. This date has already passed, so submitting grades it immediately.`);
    setActiveSection("forecast");
  }

  async function assignScenarioToClass(scenario: Scenario) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom || !activeWorkspace?.classroomId) return;
    setScenarioMessage("Assigning to class…");
    const dates = scenario.target_dates?.length ? scenario.target_dates : [scenario.event_date];
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_assignments`, {
      method: "POST",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ title: scenario.title, instructions: scenario.summary, target_date: dates[0], target_dates: dates, status: "open", classroom_id: activeWorkspace.classroomId, created_by: session.user.id, scenario_id: scenario.id }),
    });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setScenarioMessage("This scenario could not be assigned."); return; }
    setClassroomAssignments((assignments) => [...assignments, rows[0] as ClassroomAssignment].sort((a, b) => a.target_date.localeCompare(b.target_date)));
    setScenarioMessage(`${scenario.title} assigned to your class. Find it under that class’s Assignments.`);
  }

  function deleteArchive(archive: SavedForecast) {
    if (archive.status !== "draft") return;
    const nextArchives = archives.filter((item) => item.id !== archive.id);
    setArchives(nextArchives); setSelectedArchiveId(nextArchives[0]?.id ?? null); setArchiveMenuId(null);
    if (session) window.localStorage.setItem(archiveStorageKeyFor(session.user.id), JSON.stringify(nextArchives));
    if (session && supabaseUrl && supabaseKey) {
      const target = archive.runId ? `forecast_runs?id=eq.${archive.runId}` : `forecasts?id=eq.${archive.id}`;
      fetch(`${supabaseUrl}/rest/v1/${target}`, { method: "DELETE", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } });
    }
  }

  function withdrawArchive(archive: SavedForecast) {
    if (archive.status === "draft") { deleteArchive(archive); return; }
    const nextArchives = archives.filter((item) => item.id !== archive.id);
    setArchives(nextArchives); setSelectedArchiveId(nextArchives[0]?.id ?? null); setArchiveMenuId(null);
    if (session) window.localStorage.setItem(archiveStorageKeyFor(session.user.id), JSON.stringify(nextArchives));
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

  async function saveWeatherIconStyle(nextStyle: WeatherIconStyle) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const previousStyle = weatherIconStyle;
    setWeatherIconStyle(nextStyle);
    setControlMessage("Saving weather-symbol preference…");
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}`, {
      method: "PATCH",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify({ weather_icon_style: nextStyle }),
    });
    if (!response.ok) { setWeatherIconStyle(previousStyle); setControlMessage("Weather-symbol preference could not be saved."); return; }
    setControlMessage(`${nextStyle === "traditional" ? "Traditional" : "Minimal"} weather symbols saved to your account.`);
  }

  async function changePassword() {
    if (!session || !supabaseUrl || !supabaseKey) return;
    if (newPassword.length < 8) { setPasswordMessage("Choose a password with at least 8 characters."); return; }
    if (newPassword !== confirmPassword) { setPasswordMessage("Passwords do not match."); return; }
    setPasswordBusy(true);
    setPasswordMessage("Updating password…");
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    });
    setPasswordBusy(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { msg?: string; error_description?: string; message?: string } | null;
      setPasswordMessage(body?.msg || body?.error_description || body?.message || "Password could not be updated.");
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    setPasswordMessage("Password updated.");
  }

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey || activeSection !== "control") { setPendingTierRequest(null); return; }
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    fetch(`${supabaseUrl}/rest/v1/tier_change_requests?select=id,created_at&user_id=eq.${session.user.id}&status=eq.pending&order=created_at.desc&limit=1`, { headers })
      .then((response) => response.ok ? response.json() : [])
      .then((rows: { id: string; created_at: string }[]) => setPendingTierRequest(rows[0] ?? null));
  }, [session, activeSection, supabaseUrl, supabaseKey, tierRequestMessage]);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey || activeSection !== "control" || !hasControlAccess) { setAdminTierRequests([]); return; }
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    fetch(`${supabaseUrl}/rest/v1/tier_change_requests?select=id,user_id,note,created_at,profiles(email,display_name)&status=eq.pending&order=created_at.asc`, { headers })
      .then((response) => response.ok ? response.json() : [])
      .then(setAdminTierRequests);
  }, [session, activeSection, hasControlAccess, supabaseUrl, supabaseKey, adminTierMessage]);

  async function submitTierRequest() {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setTierRequestBusy(true);
    setTierRequestMessage("Sending request…");
    const response = await fetch(`${supabaseUrl}/rest/v1/tier_change_requests`, {
      method: "POST",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: session.user.id, requested_tier: "paid", note: tierNote.trim() || null }),
    });
    setTierRequestBusy(false);
    if (!response.ok) { setTierRequestMessage("Your request could not be sent. Try again shortly."); return; }
    setTierNote("");
    setTierRequestMessage("Request sent — we will follow up by email.");
  }

  async function resolveTierRequest(requestId: string, approve: boolean) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setAdminTierMessage("Saving…");
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_tier_change_request`, {
      method: "POST",
      headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, approve }),
    });
    setAdminTierMessage(response.ok ? (approve ? "Request approved." : "Request denied.") : "That request could not be resolved.");
  }

  async function exportMyData() {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setExportMessage("Preparing your data…");
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    try {
      const [profileResponse, runsResponse, reviewsResponse] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${session.user.id}&select=*`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/forecast_runs?user_id=eq.${session.user.id}&select=*,forecast_periods(*)`, { headers }),
        fetch(`${supabaseUrl}/rest/v1/forecast_reviews?select=*`, { headers }),
      ]);
      if (!profileResponse.ok || !runsResponse.ok) throw new Error("Your data could not be collected.");
      const [profile, forecastRuns, forecastReviews] = await Promise.all([
        profileResponse.json(),
        runsResponse.json(),
        reviewsResponse.ok ? reviewsResponse.json() : [],
      ]);
      const payload = { exportedAt: new Date().toISOString(), profile: profile[0] ?? null, forecastRuns, forecastReviews };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `frontline-forecast-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setExportMessage("Your data export downloaded.");
    } catch {
      setExportMessage("Your data could not be exported. Please try again.");
    }
  }

  async function deleteAccount() {
    if (!session || !supabaseUrl || !supabaseKey) return;
    if (deleteConfirmText.trim().toUpperCase() !== "DELETE") { setDeleteMessage('Type "DELETE" to confirm.'); return; }
    setDeleteBusy(true);
    setDeleteMessage("Deleting your account…");
    try {
      const response = await fetch("/api/account/delete", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) { setDeleteMessage(body?.error || "Your account could not be deleted."); setDeleteBusy(false); return; }
      window.localStorage.removeItem(sessionStorageKey);
      window.sessionStorage.removeItem(sessionStorageKey);
      setSession(null);
      setAuthMessage("Your account has been deleted.");
    } finally {
      setDeleteBusy(false);
    }
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

  async function createClassroom(organizationId: string, name: string, term: string, seatLimit?: number) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setAccessMessage("Creating classroom…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classrooms`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ organization_id: organizationId, name, term: term || null, created_by: session.user.id, ...(seatLimit ? { seat_limit: seatLimit } : {}) }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]?.id) { setAccessMessage(response.status === 400 || response.status === 403 ? "Classroom could not be created. Check the seat count against your school's licensed allocation." : "Classroom could not be created."); return; }
    await fetch(`${supabaseUrl}/rest/v1/classroom_memberships`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ classroom_id: rows[0].id, user_id: session.user.id, role: "instructor", status: "active" }) });
    setAccessMessage(`${name} was created.`);
    loadAccessManagement();
    setWorkspaceRefreshToken((value) => value + 1);
  }

  async function setClassroomStatus(classroomId: string, status: "active" | "archived") {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setAccessMessage(status === "archived" ? "Archiving class…" : "Restoring class…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classrooms?id=eq.${classroomId}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    setAccessMessage(response.ok ? (status === "archived" ? "Class archived. Its records and enrollment stay on file." : "Class restored.") : "Class status could not be changed.");
    if (response.ok) setWorkspaceRefreshToken((value) => value + 1);
  }

  // Only reachable for an already-archived classroom (RLS also enforces this server-side, along
  // with restricting it to an org owner/admin, not an instructor) -- archiving stays the
  // reversible first step, this is the permanent one. Dependent rows (roster, assignments,
  // submissions, join codes) cascade-delete with it; a student's own forecast history survives,
  // just detached from the classroom, same as any personal forecast.
  async function deleteClassroomPermanently(classroomId: string) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setAccessMessage("Deleting class…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classrooms?id=eq.${classroomId}`, { method: "DELETE", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` } });
    setAccessMessage(response.ok ? "Class permanently deleted." : "This class could not be deleted.");
    if (response.ok) setWorkspaceRefreshToken((value) => value + 1);
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

  async function renameSchoolClassroom(classroom: WorkspaceContext, name: string, term: string) {
    if (!session || !supabaseUrl || !supabaseKey || !classroom.classroomId || !name) return;
    setAccessMessage("Saving class details…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classrooms?id=eq.${classroom.classroomId}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ name, term: term || null }) });
    if (!response.ok) { setAccessMessage("Class details could not be saved."); return; }
    setAccessMessage("Class details saved.");
    setWorkspaceRefreshToken((value) => value + 1);
  }

  async function assignSchoolInstructor(classroomId: string, userId: string) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    setAccessMessage("Assigning instructor…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_memberships?on_conflict=classroom_id,user_id`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ classroom_id: classroomId, user_id: userId, role: "instructor", status: "active" }) });
    setAccessMessage(response.ok ? "Instructor assigned." : "Instructor could not be assigned. Confirm they have school access first.");
    if (response.ok) setWorkspaceRefreshToken((value) => value + 1);
  }

  async function createSchoolClassCode(classroomId: string, label: string, maxUses: number | null, expiresAt: string | null) {
    if (!session || !supabaseUrl || !supabaseKey) return null;
    setAccessMessage("Creating class code…");
    const expiration = expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null;
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_classroom_join_code`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ target_classroom: classroomId, code_label: label || null, code_expires_at: expiration, code_max_uses: maxUses }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows?.[0]?.raw_code) { setAccessMessage(rows?.message || "Class code could not be created."); return null; }
    setAccessMessage("Class code created. It is shown once below.");
    setWorkspaceRefreshToken((value) => value + 1);
    return rows[0].raw_code as string;
  }

  async function retireSchoolClassCode(id: string) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const response = await fetch(`${supabaseUrl}/rest/v1/workspace_join_codes?id=eq.${id}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
    setAccessMessage(response.ok ? "Class code retired." : "Class code could not be retired.");
    if (response.ok) setWorkspaceRefreshToken((value) => value + 1);
  }

  async function redeemSchoolOrClassCode() {
    if (!session || !supabaseUrl || !supabaseKey || !joinCode.trim()) return;
    setJoinMessage("Checking code…");
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
    let response = await fetch(`${supabaseUrl}/rest/v1/rpc/redeem_organization_license`, { method: "POST", headers, body: JSON.stringify({ raw_code: joinCode }) });
    if (!response.ok) response = await fetch(`${supabaseUrl}/rest/v1/rpc/redeem_classroom_join_code`, { method: "POST", headers, body: JSON.stringify({ raw_code: joinCode }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok) { setJoinMessage(rows?.message || "This access code could not be redeemed."); return; }
    const record = rows?.[0];
    setJoinMessage(record?.classroom_name ? `Joined ${record.classroom_name}.` : `Joined ${record?.organization_name ?? "the school workspace"}.`);
    setJoinCode("");
    setWorkspaceRefreshToken((value) => value + 1);
  }

  async function createClassroomAssignment(fields: ClassroomAssignmentFields) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom || !activeWorkspace?.classroomId) return;
    setAssignmentMessage("Creating assignment…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_assignments`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ ...fields, target_date: fields.target_dates[0], classroom_id: activeWorkspace.classroomId, created_by: session.user.id }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setAssignmentMessage("Assignment could not be created."); return; }
    setClassroomAssignments((assignments) => [...assignments, rows[0] as ClassroomAssignment].sort((a, b) => a.target_date.localeCompare(b.target_date)));
    setSelectedClassroomAssignmentId(rows[0].id as string);
    setAssignmentMessage("Assignment created — attach reference data below for students to review before they forecast.");
  }

  async function updateClassroomAssignment(assignmentId: string, fields: Partial<Pick<ClassroomAssignment, "title" | "instructions" | "due_at" | "status">>) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom) return;
    const isArchiving = fields.status === "archived";
    setAssignmentMessage(isArchiving ? "Archiving assignment…" : "Saving assignment…");
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_assignments?id=eq.${assignmentId}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(fields) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setAssignmentMessage("Assignment could not be saved."); return; }
    setClassroomAssignments((assignments) => assignments.map((assignment) => assignment.id === assignmentId ? (rows[0] as ClassroomAssignment) : assignment));
    setAssignmentMessage(isArchiving ? "Assignment archived. It stays on record but is hidden from the active list." : "Assignment updated.");
  }

  // deprecated: paired with ClassForecastOutlook, superseded by saveClassroomActiveForecastDates.
  /* async function saveClassForecastSnapshot(snapshot: ClassForecastSnapshot, publish = false) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom || !selectedClassroomAssignmentId) return;
    setAssignmentMessage(publish ? "Publishing class forecast…" : "Saving class average…");
    const timestamp = new Date().toISOString();
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_assignments?id=eq.${selectedClassroomAssignmentId}`, { method: "PATCH", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ class_forecast: snapshot, class_forecast_updated_at: timestamp, ...(publish ? { class_forecast_published_at: timestamp } : {}) }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setAssignmentMessage("Class forecast could not be saved. Apply the latest classroom migration, then try again."); return; }
    setClassroomAssignments((assignments) => assignments.map((assignment) => assignment.id === selectedClassroomAssignmentId ? rows[0] as ClassroomAssignment : assignment));
    setAssignmentMessage(publish ? "Class forecast published to this class. It is not public." : "Class average saved as an instructor draft.");
  } */

  // deprecated: superseded by saveClassroomActiveForecastDates + ClassroomLiveForecast. Kept for reference.
  /* async function saveOfficialClassForecast(snapshot: ClassForecastSnapshot, publish = false) {
    if (!session || !supabaseUrl || !supabaseKey || !canManageActiveClassroom || !activeWorkspace?.classroomId) return;
    setAssignmentMessage(publish ? "Publishing class outlook…" : "Saving class outlook…");
    const timestamp = new Date().toISOString();
    const response = await fetch(`${supabaseUrl}/rest/v1/classroom_official_forecasts?on_conflict=classroom_id`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ classroom_id: activeWorkspace.classroomId, forecast: snapshot, updated_by: session.user.id, updated_at: timestamp, published_at: publish ? timestamp : classroomOfficialForecast?.published_at ?? null }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setAssignmentMessage("Class outlook could not be saved. Apply the latest classroom migration, then try again."); return; }
    setClassroomOfficialForecast(rows[0] as ClassroomOfficialForecast);
    setAssignmentMessage(publish ? "Class outlook published to this class." : "Class outlook saved.");
  } */

  async function saveForecastReview(runId: string) {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const manualScore = reviewManualScore.trim() === "" ? null : Number(reviewManualScore);
    const rubricEntries = Object.entries(reviewRubric).filter(([, value]) => value.trim() !== "").map(([key, value]) => [key, Number(value)] as const);
    const rubricScores = Object.fromEntries(rubricEntries) as ReviewRubric;
    if (!reviewComment.trim() && manualScore === null && !rubricEntries.length) { setReviewMessage("Add a comment, overall score, or rubric score before saving."); return; }
    if (manualScore !== null && (!Number.isFinite(manualScore) || manualScore < 0 || manualScore > 100)) { setReviewMessage("Manual score must be between 0 and 100."); return; }
    if (rubricEntries.some(([, score]) => !Number.isFinite(score) || score < 0 || score > 100)) { setReviewMessage("Rubric scores must each be between 0 and 100."); return; }
    const response = await fetch(`${supabaseUrl}/rest/v1/forecast_reviews`, { method: "POST", headers: { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ run_id: runId, reviewer_id: session.user.id, comment: reviewComment.trim() || null, manual_score: manualScore, rubric_scores: rubricScores }) });
    const rows = await response.json().catch(() => []);
    if (!response.ok || !rows[0]) { setReviewMessage("Review could not be saved."); return; }
    setReviewNotes((all) => ({ ...all, [runId]: [rows[0] as ForecastReview, ...(all[runId] ?? [])] }));
    setReviewComment(""); setReviewManualScore(""); setReviewRubric({ accuracy: "", reasoning: "", communication: "" }); setReviewMessage("Review saved.");
  }

  async function authenticate() {
    if (!supabaseUrl || !supabaseKey) { setAuthMessage("Supabase is not configured yet. Restart the development server after saving .env.local."); return; }
    setAuthMessage("Signing in…");
    const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: authEmail, password: authPassword }),
    });
    const data = await response.json();
    if (!response.ok) { setAuthMessage(data.error_description || data.msg || "Unable to sign in."); return; }
    if (!data.access_token) { setAuthMessage("Unable to sign in."); return; }
    const nextSession = { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user } as WeatherDeskSession;
    window.localStorage.removeItem(sessionStorageKey);
    window.sessionStorage.removeItem(sessionStorageKey);
    if (rememberMe) window.localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession)); else window.sessionStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
    setSession(nextSession);
    setLoginMenuOpen(false);
    setAuthMessage(`Signed in as ${data.user.email}.`);
  }

  async function requestPasswordReset() {
    if (!supabaseUrl || !supabaseKey) { setForgotMessage("Supabase is not configured yet."); return; }
    if (!forgotEmail.trim()) { setForgotMessage("Enter the email on your account."); return; }
    setForgotBusy(true);
    setForgotMessage("Sending reset link…");
    const response = await fetch(`${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(window.location.origin)}`, {
      method: "POST",
      headers: { apikey: supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: forgotEmail.trim() }),
    });
    setForgotBusy(false);
    // Supabase returns 200 whether or not the address has an account, to avoid leaking which emails are registered.
    setForgotMessage(response.ok ? "If that email has an account, a reset link is on its way." : "The reset link could not be sent. Try again shortly.");
  }

  function selectRadarView(view: RadarMapView) {
    setRadarMapView(view);
    window.requestAnimationFrame(() => document.querySelectorAll<HTMLDetailsElement>(".radar-tools[open]").forEach((controls) => controls.removeAttribute("open")));
  }

  return (
    <>
    <main className={`app desk-${activeWorkspace?.kind ?? "public"}`}>
      <header className="header">
        <div className="brand-lockup brand-lockup-wordmark"><span className="theme-brand-lockup"><img className="brand-lockup-light" src="/brand/frontline-forecast-lockup-light.png" alt="Frontline Forecast" /><img className="brand-lockup-dark" src="/brand/frontline-forecast-lockup-dark.png" alt="Frontline Forecast" /></span>{session && activeSchoolBranding && <div className="school-brand-lockup" aria-label={`${activeSchoolBranding.school_name || activeWorkspace.label} school workspace`}><span aria-hidden="true">×</span>{supabaseUrl && activeSchoolLogoPath && <img src={schoolLogoUrl(supabaseUrl, activeSchoolLogoPath)} alt={activeSchoolBranding.logo_alt || `${activeSchoolBranding.school_name || activeWorkspace.label} logo`} />}<strong>{activeSchoolBranding.school_name || activeWorkspace.label}</strong></div>}</div>
        <div className="header-meta">
        <div className="header-meta-row">
          <div className="location-menu-wrap"><button type="button" className="location-trigger" aria-expanded={locationMenuOpen} onClick={() => setLocationMenuOpen((open) => !open)}><span>Location</span><strong>{selectedLocation.name}</strong><i aria-hidden="true">⌄</i></button>{locationMenuOpen && <div className="location-menu"><strong>Workspace location</strong><div className="location-custom-station"><form onSubmit={searchLocation}><input type="text" value={locationSearchText} onChange={(event) => setLocationSearchText(event.target.value)} placeholder="City, state, or ZIP" aria-label="Search for a location" /><button type="submit" disabled={!locationSearchText.trim()}>Find</button></form>{customStationStatus && <span className="location-custom-status">{customStationStatus}</span>}</div><div>{weatherDeskLocations.map((location) => <button type="button" key={location.id} className={!customLocation && location.id === locationId ? "active" : ""} onClick={() => { setCustomLocation(null); setLocationId(location.id); setLocationMenuOpen(false); }}><strong>{location.name}</strong><span>{location.observationStation} observation · K{location.upperAirStation} upper air</span></button>)}{customLocation && <div className="location-menu-custom-active"><strong>{customLocation.name}</strong><span>{customLocation.observationStation} observation · {customLocation.upperAirStation} upper air</span><button type="button" className="location-custom-clear" onClick={() => { setCustomLocation(null); setCustomStationStatus(""); }}>Back to preset locations</button></div>}</div></div>}</div>
          {session ? <div className="avatar-menu-wrap">
            <button type="button" className="avatar-trigger" aria-expanded={workspaceMenuOpen} aria-label="Account menu" onClick={() => setWorkspaceMenuOpen((open) => !open)}><span className="avatar-circle">{initialsFor(myDisplayName, session.user.email)}{hasUnreadNotifications && <i className="avatar-unread-dot" aria-hidden="true" />}</span></button>
            {workspaceMenuOpen && <div className="avatar-menu">
              <div className="avatar-menu-head"><strong>{myDisplayName || session.user.email}</strong>{myDisplayName && <small>{session.user.email}</small>}</div>
              <div className="avatar-menu-notifications"><button type="button" className="avatar-menu-notifications-trigger" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}><span>Notifications{hasUnreadNotifications && <i className="avatar-unread-dot" aria-hidden="true" />}</span><i aria-hidden="true">⌄</i></button>{notificationsOpen && <div className="avatar-menu-notification-list">{hasUnreadNotifications && <button type="button" className="notification-mark-all" onClick={markAllNotificationsRead}>Mark all read</button>}{notifications.length ? notifications.slice(0, 8).map((notification) => <button type="button" key={notification.id} className={notification.read_at ? "" : "unread"} onClick={() => openNotification(notification)}><strong>{notificationLabel(notification)}</strong><small>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(notification.created_at))}</small></button>) : <p className="empty">No notifications yet.</p>}</div>}</div>
              {soleStudentDeskKey && activeWorkspaceKey === soleStudentDeskKey ? <div className="avatar-menu-desk"><span className="avatar-menu-label">Desk</span><button type="button" className="avatar-menu-desk-open" onClick={() => { if (activeWorkspace?.kind === "organization") setActiveSection("school"); else if (activeWorkspace?.kind === "classroom") setActiveSection("classroom"); setWorkspaceMenuOpen(false); }}><strong>{workspaceDeskLabel(activeWorkspace)}</strong></button><button type="button" className="workspace-join-link" onClick={() => { setJoinPanelOpen(true); setWorkspaceMenuOpen(false); }}>Join another class</button></div> : <div className="avatar-menu-desk"><button type="button" className="avatar-menu-desk-trigger" aria-expanded={deskListOpen} onClick={() => setDeskListOpen((open) => !open)}><span>Your desks</span><i aria-hidden="true">⌄</i></button>{deskListOpen && <div className="avatar-menu-desk-list">{workspaceContexts.filter((workspace) => workspace.classroomStatus !== "archived").map((workspace) => <button type="button" key={workspace.key} className={workspace.key === activeWorkspaceKey ? "active" : ""} onClick={() => { switchWorkspace(workspace); setDeskListOpen(false); }}><strong>{workspaceDeskLabel(workspace)}</strong><span>{workspace.detail}{workspace.role ? ` · ${workspace.role}` : ""}</span></button>)}<button type="button" className="workspace-join-action" onClick={() => { setJoinPanelOpen(true); setWorkspaceMenuOpen(false); }}>Join a school or class</button>{workspaceContextStatus && <em>{workspaceContextStatus}</em>}</div>}</div>}
              {visibleWorkspace("control") && <div className="avatar-menu-actions"><button type="button" onClick={() => { setActiveSection("control"); setWorkspaceMenuOpen(false); }}>{workspaceNavigation.find((item) => item.id === "control")?.label || "Settings"}</button></div>}
              <button type="button" className="avatar-menu-theme" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}>{theme === "light" ? "Dark mode" : "Light mode"}</button>
              <button type="button" className="avatar-menu-signout" onClick={() => { window.localStorage.removeItem(sessionStorageKey); window.sessionStorage.removeItem(sessionStorageKey); setSession(null); setWeatherIconStyle("traditional"); setPersonalTier("free"); setAuthMessage("Signed out."); setWorkspaceMenuOpen(false); }}>Sign out</button>
            </div>}
          </div> : <div className="header-account"><button type="button" className="theme-toggle" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")}>{theme === "light" ? "Dark mode" : "Light mode"}</button><div className="login-menu-wrap"><button type="button" onClick={() => setLoginMenuOpen((open) => !open)}>Log in</button>{loginMenuOpen && !forgotPasswordOpen && <form className="login-menu" onSubmit={(event) => { event.preventDefault(); authenticate(); }}><strong>Frontline Forecast account</strong><input aria-label="Email" type="email" placeholder="Email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /><input aria-label="Password" type="password" placeholder="Password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /><label className="remember-me"><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> Remember me on this browser</label><div><button type="submit">Sign in</button></div><button type="button" className="login-menu-link" onClick={() => { setForgotPasswordOpen(true); setForgotEmail(authEmail); setForgotMessage(""); }}>Forgot password?</button>{authMessage && <small>{authMessage}</small>}</form>}{loginMenuOpen && forgotPasswordOpen && <form className="login-menu" onSubmit={(event) => { event.preventDefault(); requestPasswordReset(); }}><strong>Reset your password</strong><input aria-label="Email" type="email" placeholder="Email" value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} /><div><button type="submit" disabled={forgotBusy}>{forgotBusy ? "Sending…" : "Send reset link"}</button></div><button type="button" className="login-menu-link" onClick={() => { setForgotPasswordOpen(false); setForgotMessage(""); }}>Back to sign in</button>{forgotMessage && <small>{forgotMessage}</small>}</form>}</div></div>}
        </div>
        <div className="header-clock" aria-live="polite"><span>Local<strong>{localTimeLabel}</strong></span><span>UTC<strong>{utcTimeLabel}</strong></span></div>
        </div>
      </header>

      <nav aria-label="Main navigation" className="navigation">
        {visiblePublicNavigation.map((item) => <button key={item.id} className={(item.target === "weather" && activeSection === "dashboard") || (item.target === "radar" && activeSection === "radar") || (item.target === "about" && activeSection === "about") ? "active" : ""} onClick={() => openPublicNavigation(item.target)}>{item.label}</button>)}
        {visibleWorkspace("forecast") && <button className={activeSection === "forecast" ? "active" : ""} onClick={() => setActiveSection("forecast")}>{workspaceNavigation.find((item) => item.id === "forecast")?.label || "Forecast"}</button>}
        {visibleWorkspace("verify") && <button className={activeSection === "verify" ? "active" : ""} onClick={() => setActiveSection("verify")}>{workspaceNavigation.find((item) => item.id === "verify")?.label || "Verify"}</button>}
        {session && activeWorkspace?.kind === "organization" && <button className={activeSection === "school" ? "active" : ""} onClick={() => setActiveSection("school")}>School</button>}
        {session && activeWorkspace?.kind === "classroom" && <button className={activeSection === "classroom" ? "active" : ""} onClick={() => setActiveSection("classroom")}>Classroom</button>}
      </nav>
      {workspaceNotice && <aside className="workspace-notice" role="status"><div><strong>Reference data added</strong><span>{workspaceNotice.message}</span></div><div>{workspaceNotice.targetDate && <button type="button" onClick={() => { const index = forecastRun.days.findIndex((day) => day.date === workspaceNotice.targetDate); if (index >= 0) setSelectedForecastDay(index); setActiveSection("forecast"); setWorkspaceNotice(null); }}>View forecast</button>}<button type="button" aria-label="Dismiss confirmation" onClick={() => setWorkspaceNotice(null)}>×</button></div></aside>}

      {activeSection === "about" && <section className="in-app-about"><div><p className="eyebrow">{aboutContent.eyebrow || "About Frontline Forecast"}</p><h2>{aboutContent.title}</h2><p>{aboutContent.description}</p></div><div className="in-app-about-points">{aboutContent.principles.map((principle, index) => <article key={`${principle.title}-${index}`}><span>0{index + 1}</span><h3>{principle.title}</h3><p>{principle.body}</p></article>)}</div></section>}
      {activeSection === "dashboard" && <>
      {liveWeather?.alerts.length ? <section className={`hazard-banner ${alertTone(liveWeather.alerts[0].severity)}`} role="status" aria-label="Active National Weather Service alerts"><button type="button" className="hazard-banner-trigger" onClick={() => { setDataPanel("alerts"); window.requestAnimationFrame(() => document.querySelector(".data-desk")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}><span className="hazard-label">Active NWS alert · tap for details</span><strong>{liveWeather.alerts[0].event}</strong><p>{liveWeather.alerts[0].headline || "An active National Weather Service alert applies to this location."}</p>{liveWeather.alerts[0].expires ? <small>Expires {new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(liveWeather.alerts[0].expires))}</small> : null}</button><a href="https://www.weather.gov/" target="_blank" rel="noreferrer">Official NWS alerts ↗</a></section> : null}
      {homepageContent.showOutlook && <section className="outlook-strip" aria-label="Seven-day NWS guidance">
        <div className="outlook-heading"><div><h2>{homepageContent.outlookTitle}</h2></div><span className={`sync-pill ${liveDataStatus.tone}`} title={weatherError || (liveDataTimestamp ? `Last successful update ${liveDataTimestamp}` : "Checking weather data")}><i aria-hidden="true" />{liveDataStatus.label}</span></div>
        <div className="outlook-cards">{outlook.length ? outlook.map((day) => <article key={day.date}><strong>{day.label}</strong><b aria-hidden="true"><WeatherIcon description={day.shortForecast} style={weatherIconStyle} /></b><span>{day.shortForecast}</span><em>{day.high}° / {day.low}°</em><small>{day.precipitationChance ?? 0}% PoP</small></article>) : <p>Loading 7-day NWS guidance…</p>}</div>
      </section>}
      <section className="dashboard-grid">
        {homepageContent.showRadar && <article className="radar-card">
          <div className="card-heading"><div><h2>{radarMapView === "satellite" ? "Satellite" : `${homepageContent.radarTitle} - ${radarMapView === "velocity" ? "Velocity" : "Composite Reflectivity"}`}</h2></div></div>
          <div className="radar">
            <button type="button" className="radar-recenter-btn" title="Recenter" aria-label="Recenter radar" onClick={() => setRadarRecenterToken((value) => value + 1)}>⌖</button>
            <RadarControlsMenu radarMapView={radarMapView} onSelectView={selectRadarView} radarProviderPreference={radarProviderPreference} onProviderPreferenceChange={setRadarProviderPreference} reflectivityLabel="Radar" showNwsAlerts={showNwsAlerts} onToggleAlerts={setShowNwsAlerts} showSevereMarkers={showSevereMarkers} onToggleSevereMarkers={setShowSevereMarkers} showStationPicker={showStationPicker} onToggleStationPicker={setShowStationPicker} radarOpacity={radarOpacity} onOpacityChange={setRadarOpacity} caption={radarMapView === "satellite" ? "Observed NOAA GOES-East GeoColor imagery" : radarMapView === "velocity" ? `Live base velocity · ${radarSourceLabels[radarSource ?? "provider"]} · ${selectedLocation.radarSite}` : `Live composite reflectivity · ${radarSourceLabels[radarSource ?? "provider"]} · ${selectedLocation.radarSite}`} />
            {radarMapView === "satellite" ? <figure className="satellite-view"><img src={`https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/GEOCOLOR/1250x750.jpg?refresh=${radarRefreshToken}`} alt="Latest NOAA GOES-East GeoColor image for the continental United States" /><figcaption>GOES-East GeoColor · {selectedLocation.name} is within this regional view</figcaption></figure> : <RadarMap location={selectedLocation} opacity={radarOpacity / 100} showReflectivity={radarMapView === "composite" || radarMapView === "velocity"} moment={radarMapView === "velocity" ? "velocity" : "reflectivity"} showAlerts={showNwsAlerts} showSevereMarkers={showSevereMarkers} showStationPicker={showStationPicker} onStationSelect={selectRadarStation} refreshToken={radarRefreshToken} recenterToken={radarRecenterToken} timelineTileUrl={radarMapView === "composite" ? radarFrame?.tileUrl : null} isCurrentFrame={isCurrentRadarFrame} inHouseFrameTime={radarMapView === "composite" ? radarFrame?.inHouseTime ?? null : null} forceProvider={radarProviderPreference === "iem"} theme="dark" onSourceChange={setRadarSource} onFrameMeta={setRadarFrameMeta} />}
          </div>
          <RadarLegendStrip view={radarMapView} inline elevationDeg={radarFrameMeta?.elevationDeg ?? null} observedAtLabel={radarObservedAtLabel} />
          {radarMapView === "composite" && <div className="radar-playback"><button type="button" disabled={radarFrames.length < 2} onClick={() => setRadarPlaying((playing) => !playing)}>{radarPlaying ? "Pause" : "Play"}</button><input type="range" className="radar-scrub" min="0" max={Math.max(0, radarFrames.length - 1)} value={radarFrameIndex} disabled={radarFrames.length < 2} onChange={(event) => { setRadarPlaying(false); setRadarFrameIndex(Number(event.target.value)); }} /><span>{radarFrames.length ? radarFrameTime : radarTimelineStatus}</span></div>}
        </article>}

        <aside className="quick-data" aria-label="Quick weather reference">
          <h2>Current Conditions</h2>
          {weatherError && <div><strong className="alert">Live data unavailable</strong><span>{weatherError}</span></div>}
          {!liveWeather && !weatherError && <div><strong>Loading {selectedLocation.name} weather…</strong><span>Contacting the National Weather Service</span></div>}
          {liveWeather && <><div><strong>{liveWeather.observation.temperatureF ?? "—"}°F · {liveWeather.observation.description}</strong><span>{liveWeather.observation.temperatureSource === "forecast estimate" ? "NWS forecast estimate · " : ""}Dew point {liveWeather.observation.dewpointF ?? "—"}°F · {liveWeather.observation.windDirection ?? "—"} {liveWeather.observation.windMph ?? "—"} mph</span></div>
          {liveWeather.forecast && <div><strong>NWS {liveWeather.forecast.period}: {liveWeather.forecast.shortForecast}</strong><span>{liveWeather.forecast.temperature}°{liveWeather.forecast.temperatureUnit} · {liveWeather.forecast.precipitationChance ?? 0}% rain chance</span></div>}
          <div><strong>{liveWeather.alerts[0] ? liveWeather.alerts[0].event : liveWeather.alertsAvailable ? "No active NWS alerts" : "NWS alerts temporarily unavailable"}</strong><span>{liveWeather.alerts[0]?.headline ?? (liveWeather.alertsAvailable ? "No watches, warnings, or advisories reported for this point." : "Alert status could not be confirmed; check official NWS alerts before making a warning-sensitive decision.")}</span></div>
          <div><strong>Observation: {liveWeather.observation.station}</strong><span>{liveWeather.observation.stationName} · {observedAt}</span></div></>}
        </aside>
      </section>

      {homepageContent.showReferences && <section className="data-desk">
        <div className="section-heading data-desk-heading"><div><h2>{homepageContent.referenceTitle}</h2><p>{homepageContent.referenceCaption}</p></div></div>
        <div className="tabs" role="tablist" aria-label="Forecast data sources">
          <button className={dataPanel === "alerts" ? "active" : ""} onClick={() => setDataPanel("alerts")}>Warnings and statements</button>
          <button className={dataPanel === "afd" ? "active" : ""} onClick={() => setDataPanel("afd")}>Forecast discussion</button>
          <button className={dataPanel === "mcd" ? "active" : ""} onClick={() => setDataPanel("mcd")}>Mesoscale discussions</button>
          <button className={dataPanel === "nbm" ? "active" : ""} onClick={() => setDataPanel("nbm")}>NBM full text</button>
          <button className={dataPanel === "sounding" ? "active" : ""} onClick={() => setDataPanel("sounding")}>Sounding</button>
          <button className={dataPanel === "models" ? "active" : ""} onClick={() => setDataPanel("models")}>Model data</button>
          <button className={dataPanel === "ensembles" ? "active" : ""} onClick={() => setDataPanel("ensembles")}>Ensembles</button>
          <button className={dataPanel === "model-radar" ? "active" : ""} onClick={() => setDataPanel("model-radar")}>Model reflectivity</button>
          <button className={dataPanel === "model-sounding" ? "active" : ""} onClick={() => setDataPanel("model-sounding")}>Model sounding</button>
        </div>
        {dataPanel === "nbm" && <section className="source-bulletin"><div className="model-guidance-heading"><div><strong>National Blend of Models bulletin</strong><span>Full NBM source text for {selectedLocation.name} forecast analysis</span></div><small>{nbmText ? "Latest bulletin loaded" : nbmStatus}</small></div><details><summary>Open full NBM bulletin</summary><pre className="model-text">{nbmText || nbmStatus}</pre></details></section>}
        {dataPanel === "afd" && <section className="source-bulletin"><div className="model-guidance-heading"><div><strong>Area Forecast Discussion</strong><span>The local NWS office's own reasoning behind the {selectedLocation.name} forecast</span></div><small>{afdText ? "Latest discussion loaded" : afdStatus}</small></div><details open><summary>Open full forecast discussion</summary><pre className="model-text">{afdText || afdStatus}</pre></details></section>}
        {dataPanel === "mcd" && <section className="source-bulletin mcd-panel"><div className="model-guidance-heading"><div><strong>SPC Mesoscale Discussions</strong><span>Storm Prediction Center reasoning on evolving severe or winter-weather threats, nationwide</span></div><small>{mcdDiscussions.length ? `${mcdDiscussions.length} active` : mcdStatus}</small></div>{mcdDiscussions.length ? <div className="mcd-list">{mcdDiscussions.map((discussion, index) => <details key={discussion.id} open={index === 0}><summary>{discussion.title}{discussion.issuedAt ? ` · ${new Date(discussion.issuedAt).toLocaleString("en-US", { timeZone: selectedLocation.timezone, dateStyle: "medium", timeStyle: "short" })}` : ""}</summary>{discussion.imageUrl && <img src={discussion.imageUrl} alt={`${discussion.title} graphic`} className="mcd-image" />}<pre className="model-text">{discussion.text}</pre><a href={discussion.link} target="_blank" rel="noreferrer">Open on spc.noaa.gov ↗</a></details>)}</div> : <p className="empty">{mcdStatus}</p>}</section>}
        {dataPanel === "alerts" && <section className="source-bulletin alerts-panel"><div className="model-guidance-heading"><div><strong>Warnings and statements</strong><span>Active NWS watches, warnings, and advisories for {selectedLocation.name}</span></div><small>{liveWeather?.alerts.length ? `${liveWeather.alerts.length} active` : liveWeather?.alertsAvailable === false ? "Feed unavailable" : "No active alerts"}</small></div>{liveWeather?.alerts.length ? <div className="alerts-list">{liveWeather.alerts.map((alert, index) => <details key={`${alert.event}-${index}`} open={index === 0} className={alertTone(alert.severity)}><summary><strong>{alert.event}</strong><span>{alert.severity}{alert.areaDesc ? ` · ${alert.areaDesc}` : ""}</span></summary>{alert.headline && <p className="alert-headline">{alert.headline}</p>}<div className="alert-timing"><span>{alert.effective ? `Effective ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: selectedLocation.timezone, timeZoneName: "short" }).format(new Date(alert.effective))}` : null}</span><span>{alert.expires ? `Expires ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: selectedLocation.timezone, timeZoneName: "short" }).format(new Date(alert.expires))}` : null}</span></div>{alert.description && <pre className="model-text">{alert.description}</pre>}{alert.instruction && <div className="alert-instruction"><strong>Instructions</strong><p>{alert.instruction}</p></div>}<small>{alert.senderName ?? "National Weather Service"}</small></details>)} </div> : <p className="empty">{liveWeather?.alertsAvailable === false ? "NWS alert status could not be confirmed." : "No active NWS alerts for this location right now."}</p>}</section>}
        {dataPanel === "sounding" && <section className="observed-sounding-panel"><div className="model-guidance-heading"><div><strong>Latest observed K{selectedLocation.upperAirStation} sounding</strong><span>Nearest upper-air site for {selectedLocation.name} · official SPC analysis panel</span></div><a href={`https://www.spc.noaa.gov/exper/soundings/LATEST/${selectedLocation.upperAirStation}.gif`} target="_blank" rel="noreferrer">Open SPC source</a></div><img src={officialSoundingImageUrl(selectedLocation.upperAirStation)} alt={`Latest observed K${selectedLocation.upperAirStation} upper-air sounding from the Storm Prediction Center`} /><details><summary>Raw K{selectedLocation.upperAirStation} sounding text</summary><pre className="model-text">{soundingText || soundingStatus}</pre></details></section>}
        {dataPanel === "models" && !hasModelAccess && <ModelAccessUpsell label="Model data" onOpenAccount={openAccountSection} />}
        {dataPanel === "models" && hasModelAccess && <section className="model-workspace">
          <div className="model-desk-controls"><div><span>Open-Meteo model guidance</span><div className="guidance-scope-toggle"><button type="button" className={guidanceGroup === "high-res" ? "active" : ""} onClick={() => { setGuidanceGroup("high-res"); if (!guidanceModels["high-res"].some(([id]) => id === openMeteoModel)) setOpenMeteoModel("hrrr_conus"); }}>High-res</button><button type="button" className={guidanceGroup === "global" ? "active" : ""} onClick={() => { setGuidanceGroup("global"); if (!guidanceModels.global.some(([id]) => id === openMeteoModel)) setOpenMeteoModel("gfs_global"); }}>Global</button></div></div><div className="model-view-toggle"><button type="button" className={openMeteoView === "hourly" ? "active" : ""} onClick={() => setOpenMeteoView("hourly")}>Hourly</button><button type="button" className={openMeteoView === "daily" ? "active" : ""} onClick={() => setOpenMeteoView("daily")}>Daily</button><button type="button" className={openMeteoView === "compare" ? "active" : ""} onClick={() => { const left = openMeteoModel === "best_match" ? "hrrr_conus" : openMeteoModel; setComparisonLeftModel(left); setComparisonRightModel(guidanceGroup === "global" ? "ecmwf_ifs" : "nbm_conus"); setOpenMeteoView("compare"); }}>Compare</button></div></div>
          {openMeteoView !== "compare" && (openMeteoGuidance ? <><article className="single-model-table"><header><div className="model-picker">{guidanceModels[guidanceGroup].map(([id, label]) => <button type="button" key={id} className={openMeteoModel === id ? "active" : ""} onClick={() => setOpenMeteoModel(id)}>{label}</button>)}</div><strong>{openMeteoGuidance.model} · {selectedLocation.name}</strong><small>{openMeteoGuidance.current ? `${openMeteoGuidance.current.temperatureF ?? "—"}°F · feels ${openMeteoGuidance.current.feelsLikeF ?? "—"}°F · ${openMeteoWeatherLabel(openMeteoGuidance.current.weatherCode)}` : "Current model guidance unavailable"}</small></header><ModelGuidanceTable guidance={openMeteoGuidance} view={openMeteoView} /><div className="table-reference-action"><small>Attach this displayed guidance to matching forecast dates. A confirmation appears when it is saved.</small><button type="button" onClick={() => attachGuidanceSeries(openMeteoGuidance, openMeteoView)}>Add to forecast</button></div></article><p className="model-attribution">Model data: <a href={openMeteoGuidance.source} target="_blank" rel="noreferrer">Open-Meteo</a>. High-res guidance is for near-term detail; global models are for pattern and range.</p></> : <p className="empty">{openMeteoStatus}</p>)}
          {openMeteoView === "compare" && <section className="model-compare" aria-busy={Boolean(comparisonStatus)}>{comparisonStatus && <p className="model-loading" role="status">{comparisonStatus}</p>}<div className="comparison-columns">{[comparisonLeftModel, comparisonRightModel].map((id, index) => { const guidance = modelComparison[id]; const selectedModel = index === 0 ? comparisonLeftModel : comparisonRightModel; return <article key={index}><header><div className="model-picker">{guidanceModels[guidanceGroup].filter(([model]) => model !== "best_match").map(([model, label]) => <button type="button" key={model} className={selectedModel === model ? "active" : ""} onClick={() => { if (index === 0) { if (model === comparisonRightModel) setComparisonRightModel(comparisonLeftModel); setComparisonLeftModel(model); setOpenMeteoModel(model); } else { if (model === comparisonLeftModel) setComparisonLeftModel(comparisonRightModel); setComparisonRightModel(model); } }}>{label}</button>)}</div><div className="comparison-table-title"><strong>{guidance?.model ?? "Loading model…"}</strong><div className="model-view-toggle"><button type="button" className={comparisonView === "hourly" ? "active" : ""} onClick={() => setComparisonView("hourly")}>Hourly</button><button type="button" className={comparisonView === "daily" ? "active" : ""} onClick={() => setComparisonView("daily")}>Daily</button></div></div></header>{guidance ? <><ModelGuidanceTable guidance={guidance} view={comparisonView} compact /><div className="table-reference-action"><small>Attach this model to matching forecast dates.</small><button type="button" onClick={() => attachGuidanceSeries(guidance, comparisonView)}>Add to forecast</button></div></> : <p className="empty">Loading model guidance…</p>}</article>; })}</div></section>}
        </section>}
        {dataPanel === "model-radar" && !hasModelAccess && <ModelAccessUpsell label="Model reflectivity" onOpenAccount={openAccountSection} />}
        {dataPanel === "model-radar" && hasModelAccess && <section className="model-radar-panel"><div className="model-guidance-heading"><div><strong>HRRR simulated reflectivity</strong><span>Model guidance styled like radar for {selectedLocation.name} — not an observation</span></div><small>{futureRadarFrames.length ? `${futureRadarFrames.length} forecast hours` : futureRadarStatus}</small></div><div className="radar model-radar-map"><RadarMap location={selectedLocation} opacity={0.8} showReflectivity showAlerts={false} timelineTileUrl={futureRadarFrame?.tileUrl ?? null} isCurrentFrame={false} theme="dark" /></div>{futureRadarFrames.length > 0 && <div className="radar-playback"><button type="button" disabled={futureRadarFrames.length < 2} onClick={() => setFutureRadarPlaying((playing) => !playing)}>{futureRadarPlaying ? "Pause" : "Play"}</button><input type="range" className="radar-scrub" min="0" max={Math.max(0, futureRadarFrames.length - 1)} value={futureRadarFrameIndex} disabled={futureRadarFrames.length < 2} onChange={(event) => { setFutureRadarPlaying(false); setFutureRadarFrameIndex(Number(event.target.value)); }} /><span>{futureRadarFrameTime}</span></div>}<div className="radar-footer"><RadarLegendStrip view="future_reflectivity" /></div><p className="model-attribution">HRRR simulated reflectivity via <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noreferrer">Iowa Environmental Mesonet</a>. This is model guidance styled as a radar view, not an observation — treat it as less certain the further out it goes.</p></section>}
        {dataPanel === "ensembles" && !hasModelAccess && <ModelAccessUpsell label="Ensembles" onOpenAccount={openAccountSection} />}
        {dataPanel === "ensembles" && hasModelAccess && <section className="ensemble-panel"><div className="model-guidance-heading"><div><strong>GFS ensemble</strong><span>Range and spread · {selectedLocation.name}</span></div></div>{ensembleGuidance ? <><div className="ensemble-summary"><article><span>Members</span><strong>{ensembleGuidance.rows[0]?.temperature.members ?? "—"}</strong><small>available members</small></article><article><span>Temperature spread</span><strong>±{ensembleGuidance.rows[0]?.temperature.spread ?? "—"}°F</strong><small>first valid hour</small></article><article><span>Forecast horizon</span><strong>10 days</strong><small>point guidance</small></article></div><EnsembleTable guidance={ensembleGuidance} /><p className="model-attribution">Ensemble data: <a href={ensembleGuidance.source} target="_blank" rel="noreferrer">Open-Meteo Ensemble API</a></p></> : <p className="empty">{ensembleStatus}</p>}</section>}
        {dataPanel === "model-sounding" && !hasModelAccess && <ModelAccessUpsell label="Model sounding" onOpenAccount={openAccountSection} />}
        {dataPanel === "model-sounding" && hasModelAccess && <section className="model-sounding-panel">
          {modelSounding?.profiles[soundingProfileIndex] && <div className="model-guidance-heading sounding-result-heading"><div><strong>{modelSounding.model} profile · {modelTimestamp(modelSounding.profiles[soundingProfileIndex].time)}</strong><span>{selectedLocation.name} · forecast guidance</span></div><small>Run {runTimestamp(modelSounding.runTime)}</small></div>}
          <div className="sounding-control-strip"><div className="sounding-model-control"><span>Model</span><div className="model-picker"><button type="button" className={soundingModel === "hrrr" ? "active" : ""} onClick={() => { setSoundingModel("hrrr"); setSoundingRunOffset(0); }}>HRRR</button><button type="button" className={soundingModel === "gfs" ? "active" : ""} onClick={() => { setSoundingModel("gfs"); setSoundingRunOffset(0); }}>GFS</button></div></div>{soundingProfiles.length ? <div className="sounding-valid-picker"><div className="model-picker">{soundingProfileWindow.map((profile, visibleIndex) => { const index = soundingWindowStart + visibleIndex; const isNearest = index === nearestSoundingProfileIndex; return <button type="button" key={profile.time} className={soundingProfileIndex === index ? "active" : ""} onClick={() => setSoundingProfileIndex(index)}><span>{modelTimestamp(profile.time)}</span>{isNearest && <small>Now</small>}</button>; })}</div></div> : null}<div className="sounding-run-picker"><button type="button" aria-label="Open older model run" onClick={() => setSoundingRunOffset((offset) => offset + 1)}>‹</button><span>{modelSounding ? runTimestamp(modelSounding.runTime) : "Loading run…"}</span><button type="button" aria-label="Open newer model run" disabled={soundingRunOffset === 0} onClick={() => setSoundingRunOffset((offset) => Math.max(0, offset - 1))}>›</button></div></div>
          {modelSounding?.profiles[soundingProfileIndex] ? <><ModelSoundingChart profile={modelSounding.profiles[soundingProfileIndex]} /><div className="guidance-table-wrap"><table className="guidance-table sounding-table"><thead><tr><th>Pressure</th><th>Height</th><th>Temperature</th><th>RH</th><th>Wind</th></tr></thead><tbody>{modelSounding.profiles[soundingProfileIndex].levels.map((level) => <tr key={level.pressureHpa}><th>{level.pressureHpa} hPa</th><td>{level.geopotentialHeightM ?? "—"} m</td><td>{level.temperatureF ?? "—"}°F</td><td>{level.relativeHumidity ?? "—"}%</td><td>{level.windMph ?? "—"} mph @ {level.windDirection ?? "—"}°</td></tr>)}</tbody></table></div><p className="model-attribution">Profile data: <a href={modelSounding.source} target="_blank" rel="noreferrer">Open-Meteo Single Runs API</a>. It is saved with your forecast when attached.</p></> : <p className="empty">{modelSoundingStatus}</p>}
        </section>}
        {dataPanel !== "models" && <div className="desk-reference-action"><div><strong>Add to forecast</strong><small>Save this view with the matching forecast date.</small></div><button type="button" onClick={pinCurrentDeskPanel}>Add reference</button></div>}
      </section>}
      </>}

      {activeSection === "radar" && <section className="radar-workspace">
        <div className="radar-workspace-heading"><div><p className="eyebrow">Radar workspace</p><h2>Observed weather</h2></div></div>
        <div className="radar radar-workspace-map">
          <button type="button" className="radar-recenter-btn" title="Recenter" aria-label="Recenter radar" onClick={() => setRadarRecenterToken((value) => value + 1)}>⌖</button>
          <RadarControlsMenu radarMapView={radarMapView} onSelectView={selectRadarView} radarProviderPreference={radarProviderPreference} onProviderPreferenceChange={setRadarProviderPreference} reflectivityLabel="Reflectivity" showNwsAlerts={showNwsAlerts} onToggleAlerts={setShowNwsAlerts} showOutlookToggle showSpcOutlook={showSpcOutlook} onToggleOutlook={setShowSpcOutlook} outlookDay={outlookDay} onOutlookDayChange={setOutlookDay} showSevereMarkers={showSevereMarkers} onToggleSevereMarkers={setShowSevereMarkers} showStationPicker={showStationPicker} onToggleStationPicker={setShowStationPicker} radarOpacity={radarOpacity} onOpacityChange={setRadarOpacity} caption={radarMapView === "satellite" ? "NOAA GOES-East GeoColor imagery." : radarMapView === "velocity" ? `Live base velocity · ${radarSourceLabels[radarSource ?? "provider"]} · ${selectedLocation.radarSite}.` : `Live composite reflectivity · ${radarSourceLabels[radarSource ?? "provider"]} · ${selectedLocation.radarSite}.`} />
          {radarMapView === "satellite" ? <figure className="satellite-view"><div className="radar-field-picker satellite-channel-picker">{(["geocolor", "ir", "wv"] as const).map((channel) => <button type="button" key={channel} className={satelliteChannel === channel ? "active" : ""} onClick={() => setSatelliteChannel(channel)}>{({ geocolor: "GeoColor", ir: "Infrared", wv: "Water vapor" } as Record<string, string>)[channel]}</button>)}</div><img src={`https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/${{ geocolor: "GEOCOLOR", ir: "13", wv: "08" }[satelliteChannel]}/1250x750.jpg?refresh=${radarRefreshToken}`} alt={`Latest NOAA GOES-East ${{ geocolor: "GeoColor", ir: "clean infrared", wv: "upper-level water vapor" }[satelliteChannel]} image for the continental United States`} /><figcaption>{({ geocolor: "Observed NOAA GOES-East GeoColor", ir: "Observed NOAA GOES-East clean infrared (cloud-top temperature)", wv: "Observed NOAA GOES-East upper-level water vapor" } as Record<string, string>)[satelliteChannel]} · {selectedLocation.name}</figcaption></figure> : <RadarMap location={selectedLocation} opacity={radarOpacity / 100} showReflectivity={radarMapView === "composite" || radarMapView === "velocity"} moment={radarMapView === "velocity" ? "velocity" : "reflectivity"} showAlerts={showNwsAlerts} showOutlook={showSpcOutlook} outlookDay={outlookDay} showSevereMarkers={showSevereMarkers} showStationPicker={showStationPicker} onStationSelect={selectRadarStation} refreshToken={radarRefreshToken} recenterToken={radarRecenterToken} timelineTileUrl={radarMapView === "composite" ? radarFrame?.tileUrl : null} isCurrentFrame={isCurrentRadarFrame} inHouseFrameTime={radarMapView === "composite" ? radarFrame?.inHouseTime ?? null : null} forceProvider={radarProviderPreference === "iem"} theme="dark" scrollZoom onSourceChange={setRadarSource} onFrameMeta={setRadarFrameMeta} />}
        </div>
        <RadarLegendStrip view={radarMapView} inline elevationDeg={radarFrameMeta?.elevationDeg ?? null} observedAtLabel={radarObservedAtLabel} />
        {radarMapView === "composite" && <div className="radar-playback"><button type="button" disabled={radarFrames.length < 2} onClick={() => setRadarPlaying((playing) => !playing)}>{radarPlaying ? "Pause" : "Play"}</button><input type="range" className="radar-scrub" min="0" max={Math.max(0, radarFrames.length - 1)} value={radarFrameIndex} disabled={radarFrames.length < 2} onChange={(event) => { setRadarPlaying(false); setRadarFrameIndex(Number(event.target.value)); }} /><span>{radarFrames.length ? radarFrameTime : radarTimelineStatus}</span></div>}
      </section>}

      {activeSection === "forecast" && !session && <section className="workspace-card access-wall"><h2>Log in to forecast</h2><p>The dashboard is available to explore, while forecasts, references, and archive work stay private to your account.</p><button type="button" onClick={() => setLoginMenuOpen(true)}>Open login</button></section>}
      {activeSection === "forecast" && session && <section className="workspace-card">
        <div className="section-heading forecast-title"><div><h2>Forecast workspace</h2><p>Each tab is one dated Day/Night forecast.</p></div><div className="horizon-actions"><button type="button" onClick={() => { setRevisionParentRunId(null); setForecastRun(createNewForecastRun(3)); setSelectedForecastDay(0); }}>New 3-day</button><button type="button" onClick={() => { setRevisionParentRunId(null); setForecastRun(createNewForecastRun(7)); setSelectedForecastDay(0); }}>New 7-day</button><div className="scenario-picker"><button type="button" onClick={() => setScenarioPickerOpen((open) => !open)}>Scenarios</button>{scenarioPickerOpen && <div className="scenario-picker-menu"><strong>Historical scenarios</strong><p>Forecast a real past event. The target date has already happened, so submitting grades it immediately.</p>{scenarios.length ? scenarios.map((scenario) => <button type="button" key={scenario.id} onClick={() => { startScenario(scenario); setScenarioPickerOpen(false); }}><span>{scenario.title}</span><small>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${scenario.event_date}T12:00:00Z`))}</small></button>) : <p className="empty">No scenarios are published yet.</p>}</div>}</div></div></div>
        {activeScenarioId && <div className="assignment-linker assignment-context scenario-context"><div><strong>{activeScenario?.title ?? "Historical scenario"}</strong><small>This date has already happened — submitting grades it immediately.</small>{activeScenario?.summary && <em>{activeScenario.summary}</em>}{activeScenario && (activeScenario.reference_notes || activeScenario.reference_links.length > 0) && <details className="scenario-reference-details"><summary>Reference data</summary>{activeScenario.reference_notes && <p>{activeScenario.reference_notes}</p>}{activeScenario.reference_links.length > 0 && <ul>{activeScenario.reference_links.map((link) => <li key={link.label}>{link.label}{link.detail ? ` — ${link.detail}` : ""}{link.url && <> · <a href={link.url} target="_blank" rel="noreferrer">Open</a></>}</li>)}</ul>}</details>}</div><button type="button" onClick={() => setActiveScenarioId(null)}>Clear scenario</button></div>}
        <div className="day-outlook-cards" role="tablist" aria-label="Forecast days">{forecastRun.days.map((day, index) => <div key={`${day.date}-${index}`} className={`day-outlook-card${index === selectedForecastDay ? " active" : ""}`}><button type="button" className="day-card-select" onClick={() => setSelectedForecastDay(index)} onContextMenu={(event) => { event.preventDefault(); setTabMenuIndex(index); setTabMenuPosition({ left: event.clientX, top: event.clientY }); setTabMenuMessage(""); }}><span className="dow">{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${day.date}T12:00:00`))}</span><img src={`/weather-icons/${weatherIconStyle}/${periodIconCondition(day.day)}.svg`} alt="" /><em>{displayForecastTemperature(day.day.highLow)} / {displayForecastTemperature(day.night.highLow)}</em><small>{day.day.rainChance ? `${displayForecastChance(day.day.rainChance)} PoP` : "No PoP yet"}</small></button><div className="day-card-footer"><label><input type="checkbox" checked={day.ready} onChange={(event) => { const checked = event.target.checked; setForecastRun((run) => ({ ...run, days: run.days.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ready: checked } : candidate) })); }} /> Ready</label><button type="button" disabled={isSubmitting} onClick={() => submitForecastDays([day])}>Post</button></div></div>)}<button className="add-day" type="button" aria-label="Add next forecast day" onClick={() => setForecastRun((run) => ({ ...run, days: [...run.days, createForecastDay(addDays(new Date(`${run.days.at(-1)?.date}T12:00:00`), 1))] }))}>+</button></div>
        <input type="hidden" name="target-date" form="forecast-form" value={selectedDay.date} />
        {tabMenuIndex !== null && <div className="tab-menu" style={{ left: tabMenuPosition.left, top: tabMenuPosition.top }}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${forecastRun.days[tabMenuIndex].date}T12:00:00`))}</strong><label>Change date<input type="date" value={forecastRun.days[tabMenuIndex].date} onChange={(event) => { const nextDate = event.target.value; if (forecastRun.days.some((day, index) => index !== tabMenuIndex && day.date === nextDate)) { setTabMenuMessage("That date already has a forecast tab."); return; } setForecastRun((run) => ({ ...run, days: run.days.map((day, index) => index === tabMenuIndex ? { ...day, date: nextDate } : day) })); setTabMenuMessage(""); }} /></label><div><button type="button" onClick={() => setTabMenuIndex(null)}>Done</button><button type="button" disabled={forecastRun.days.length === 1} onClick={() => { setForecastRun((run) => ({ ...run, days: run.days.filter((_, index) => index !== tabMenuIndex) })); setSelectedForecastDay((current) => Math.max(0, Math.min(current, forecastRun.days.length - 2))); setTabMenuIndex(null); }}>Remove day</button></div>{tabMenuMessage && <small>{tabMenuMessage}</small>}</div>}
        <form id="forecast-form" onSubmit={handleForecastFormSubmit} onKeyDown={advanceForecastEntry}><div className="forecast-period-columns">
          <fieldset className="forecast-period"><legend>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${selectedDay.date}T12:00:00`))} day <small>7 AM–7 PM</small></legend><div className="forecast-fields">
            <label>High temperature<span className="unit-input" style={unitInputStyle(temperatureInputValue(selectedDay.day.highLow), 2)}><input inputMode="decimal" placeholder="72" value={temperatureInputValue(selectedDay.day.highLow)} onChange={(event) => updatePeriod("day", "highLow", temperatureInputValue(event.target.value))} onBlur={() => formatPeriodField("day", "highLow")} /><i aria-hidden="true">°</i></span></label>
            <label>Conditions<select value={selectedDay.day.conditions} onChange={(event) => updatePeriod("day", "conditions", event.target.value)}><option value="">Choose conditions</option>{conditionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="wide-field">Icon<IconPicker value={periodIconCondition(selectedDay.day)} onChange={(next) => updatePeriod("day", "iconCondition", next)} style={weatherIconStyle} /></label>
            <label>Rain chance<span className="unit-input" style={unitInputStyle(percentInputValue(selectedDay.day.rainChance), 2)}><input inputMode="numeric" placeholder="40" value={percentInputValue(selectedDay.day.rainChance)} onChange={(event) => updatePeriod("day", "rainChance", percentInputValue(event.target.value))} onBlur={() => formatPeriodField("day", "rainChance")} /><i aria-hidden="true">%</i></span></label>
            <label>Likely timing<input placeholder="3–8 PM" value={selectedDay.day.timing} onChange={(event) => updatePeriod("day", "timing", event.target.value)} onBlur={() => formatPeriodField("day", "timing")} /></label>
            <label>Wind<input value={selectedDay.day.wind} onChange={(event) => updatePeriod("day", "wind", event.target.value)} /></label>
            <label>Confidence<select value={selectedDay.day.confidence} onChange={(event) => updatePeriod("day", "confidence", event.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<textarea rows={2} placeholder="Hazards, impacts, or confidence notes" value={selectedDay.day.hazards} onChange={(event) => updatePeriod("day", "hazards", event.target.value)} /></label>
            <ReferencePicker options={referenceOptions} references={selectedDay.day.references} onAdd={(item) => addFreshReference("day", item)} onRemove={(id) => removeReference("day", id)} addedLabel="Added to this day" recommendedIds={recommendedReferenceIds("day")} />
            <label className="wide-field">Day reasoning<textarea value={selectedDay.day.reasoning} onChange={(event) => updatePeriod("day", "reasoning", event.target.value)} /></label>
          </div></fieldset>
          <fieldset className="forecast-period"><legend>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${selectedDay.date}T12:00:00`))} night <small>7 PM–7 AM</small></legend><div className="forecast-fields">
            <label>Low temperature<span className="unit-input" style={unitInputStyle(temperatureInputValue(selectedDay.night.highLow), 2)}><input inputMode="decimal" placeholder="61" value={temperatureInputValue(selectedDay.night.highLow)} onChange={(event) => updatePeriod("night", "highLow", temperatureInputValue(event.target.value))} onBlur={() => formatPeriodField("night", "highLow")} /><i aria-hidden="true">°</i></span></label>
            <label>Conditions<select value={selectedDay.night.conditions} onChange={(event) => updatePeriod("night", "conditions", event.target.value)}><option value="">Choose conditions</option>{conditionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="wide-field">Icon<IconPicker value={periodIconCondition(selectedDay.night)} onChange={(next) => updatePeriod("night", "iconCondition", next)} style={weatherIconStyle} /></label>
            <label>Rain chance<span className="unit-input" style={unitInputStyle(percentInputValue(selectedDay.night.rainChance), 2)}><input inputMode="numeric" placeholder="20" value={percentInputValue(selectedDay.night.rainChance)} onChange={(event) => updatePeriod("night", "rainChance", percentInputValue(event.target.value))} onBlur={() => formatPeriodField("night", "rainChance")} /><i aria-hidden="true">%</i></span></label>
            <label>Likely timing<input placeholder="Before 10 PM" value={selectedDay.night.timing} onChange={(event) => updatePeriod("night", "timing", event.target.value)} onBlur={() => formatPeriodField("night", "timing")} /></label>
            <label>Wind<input value={selectedDay.night.wind} onChange={(event) => updatePeriod("night", "wind", event.target.value)} /></label>
            <label>Confidence<select value={selectedDay.night.confidence} onChange={(event) => updatePeriod("night", "confidence", event.target.value)}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<textarea rows={2} placeholder="Hazards, impacts, or confidence notes" value={selectedDay.night.hazards} onChange={(event) => updatePeriod("night", "hazards", event.target.value)} /></label>
            <ReferencePicker options={referenceOptions} references={selectedDay.night.references} onAdd={(item) => addFreshReference("night", item)} onRemove={(id) => removeReference("night", id)} addedLabel="Added to this night" recommendedIds={recommendedReferenceIds("night")} />
            <label className="wide-field">Night reasoning<textarea value={selectedDay.night.reasoning} onChange={(event) => updatePeriod("night", "reasoning", event.target.value)} /></label>
          </div></fieldset></div>
          {submissionToken && <div className="submission-token" role="status"><span>✓</span><div><strong>Forecast archived</strong><small>{submissionToken}</small></div><button type="button" aria-label="Dismiss submission confirmation" onClick={() => setSubmissionToken("")}>×</button></div>}
          <div className="form-actions"><span>{saveMessage}</span><button type="submit" disabled={isSubmitting}>{isSubmitting ? "Submitting forecast…" : forecastRun.days.some((day) => day.ready) ? `Submit ${forecastRun.days.filter((day) => day.ready).length} ready day${forecastRun.days.filter((day) => day.ready).length === 1 ? "" : "s"}` : "Submit forecast run"}</button></div>
        </form>
      </section>}

      {activeSection === "verify" && !session && <section className="workspace-card access-wall"><h2>Sign in to open your archive</h2><p>Your forecasts, evidence, revisions, and verification history stay private to your account.</p><button onClick={() => setActiveSection("forecast")}>Go to Forecast sign-in</button></section>}
      {activeSection === "verify" && session && <nav className="classroom-hub-tabs" aria-label="Verify sections">
        <button type="button" className={verifyTab === "records" ? "active" : ""} onClick={() => setVerifyTab("records")}>Records</button>
        <button type="button" className={verifyTab === "scenarios" ? "active" : ""} onClick={() => setVerifyTab("scenarios")}>Scenarios</button>
      </nav>}
      {activeSection === "verify" && session && verifyTab === "records" && <section className="workspace-card">
        <div className="records-toolbar"><div><p className="eyebrow">Forecast records</p><h2>Verify your work</h2></div><div><span>{filteredArchives.length} record{filteredArchives.length === 1 ? "" : "s"}</span><button type="button" className={archiveFiltersOpen ? "active" : ""} onClick={() => setArchiveFiltersOpen((open) => !open)}>Filter</button></div></div>
        {archiveFiltersOpen && <div className="archive-filters"><label>Forecast date<input type="date" value={archiveDateFilter} onChange={(event) => setArchiveDateFilter(event.target.value)} /></label><label>Status<select value={archiveStatusFilter} onChange={(event) => setArchiveStatusFilter(event.target.value as "all" | SavedForecast["status"])}><option value="all">All statuses</option><option value="submitted">Submitted</option><option value="verified">Verified</option><option value="revised">Revised</option><option value="draft">Draft</option></select></label><label>Search conditions<input value={archiveSearch} onChange={(event) => setArchiveSearch(event.target.value)} placeholder="storms, clear…" /></label><button type="button" onClick={() => { setArchiveDateFilter(""); setArchiveStatusFilter("all"); setArchiveSearch(""); }}>Clear</button></div>}
        <section className="record-calendar" aria-label="Forecast record dates"><div className="record-calendar-heading"><div><strong>{new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" }).format(new Date(`${recordWindowStart}T12:00:00`))}</strong><small>Forecast target dates</small></div><div><button type="button" aria-label="Previous seven days" onClick={() => setRecordWindowStart(addDays(new Date(`${recordWindowStart}T12:00:00`), -7))}>←</button><button type="button" aria-label="Next seven days" onClick={() => setRecordWindowStart(addDays(new Date(`${recordWindowStart}T12:00:00`), 7))}>→</button></div></div><div className="day-outlook-cards record-calendar-days">{recordWindowDates.map((targetDate) => { const archive = archiveForDate(targetDate); const verification = archive ? automaticVerifications[archive.id] : null; return <button type="button" key={targetDate} className={`${targetDate === recordFocusDate ? "active " : ""}${targetDate === todayDateString ? "today " : ""}${archive ? "has-record" : ""}`} onClick={() => { setRecordFocusDate(targetDate); setSelectedArchiveId(archive ? archive.id : null); }}><span className="dow">{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))} {new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))}</span><img src={`/weather-icons/${weatherIconStyle}/${periodIconCondition(archive?.day)}.svg`} alt="" /><em>{archive ? `${displayForecastTemperature(archive.day.high)} / ${displayForecastTemperature(archive.night.low)}` : "– / –"}</em><small>{archive ? `PoP ${displayForecastChance(archive.day.rainChance)}/${displayForecastChance(archive.night.rainChance)}` : "PoP —/—"}</small><small>{archive ? (verification?.dayScore !== null && verification?.dayScore !== undefined ? `Score ${verification.dayScore}%` : "Unscored") : "No forecast"}</small></button>; })}</div></section>
        <section className="outlook-strip class-outlook-strip" aria-label="Local seven-day guidance"><div className="outlook-heading"><div><h2>NWS 7-Day Forecast</h2></div><span>Local</span></div><div className="outlook-cards">{recordWindowDates.map((targetDate) => { const guidance = outlook.find((day) => day.date === targetDate); return <button type="button" key={targetDate} className={targetDate === recordFocusDate ? "active" : ""} onClick={() => { setRecordFocusDate(targetDate); const archive = archiveForDate(targetDate); setSelectedArchiveId(archive ? archive.id : null); }}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(new Date(`${targetDate}T12:00:00`))}</strong><b aria-hidden="true"><WeatherIcon description={guidance?.shortForecast ?? "Forecast"} style="traditional" /></b><span>{guidance?.shortForecast ?? "Guidance unavailable"}</span><em>{guidance?.high ?? "—"}° / {guidance?.low ?? "—"}°</em><small>{guidance?.precipitationChance ?? "—"}% PoP</small></button>; })}</div></section>
        <section className="date-record-list"><div><strong>{forecastTargetTitle(recordFocusDate)}</strong><small>{focusedDateRecords.length ? `${focusedDateRecords.length} forecast${focusedDateRecords.length === 1 ? "" : "s"} for this date` : "No saved forecasts for this date"}</small></div>{focusedDateRecords.length ? <div>{focusedDateRecords.map((archive) => { const verification = automaticVerifications[archive.id]; return <button type="button" key={archive.id} className={archive.id === selectedArchiveId ? "active" : ""} onClick={() => setSelectedArchiveId(archive.id)}><strong>V{archive.versionNumber} · {archive.status}</strong><span>H {displayForecastTemperature(archive.day.high)} · L {displayForecastTemperature(archive.night.low)} · PoP {displayForecastChance(archive.day.rainChance)}/{displayForecastChance(archive.night.rainChance)}</span><small>{forecastAuthorLabel(archive, profiles, session.user.id)} · {verification?.dayScore !== null && verification?.dayScore !== undefined ? `Day score ${verification.dayScore}%` : "Unscored"}</small></button>; })}</div> : <p className="empty">No saved forecasts for this date.</p>}</section>
        {verificationMessage && <p className="empty">{verificationMessage}</p>}
        <div className="verification-grid">{selectedArchive ? <div><div className="record-heading"><div><p className="eyebrow">Selected forecast</p><h2>{archiveVersionTitle(selectedArchive)}</h2><p>{locationForArchive(selectedArchive).name} · {archiveSubmissionTitle(selectedArchive)}</p></div><div className="verification-score"><strong>{selectedArchive.status === "draft" ? "Draft" : selectedVerificationIsFinal ? "Verified" : "In progress"}</strong><span>{selectedArchive.status === "draft" ? "not graded" : selectedVerificationIsFinal ? "automatic verification saved" : "observations and scores update as periods finish"}</span><button type="button" disabled={collectingArchiveId === selectedArchive.id} onClick={() => collectActuals(selectedArchive)}>{collectingArchiveId === selectedArchive.id ? "Collecting…" : "Collect actuals"}</button></div></div><div className="record-score-bar"><div><span>Day automatic score</span><i><b style={{ width: `${selectedAutomaticVerification?.dayScore ?? 0}%` }} /></i><strong>{scoreLabel(selectedAutomaticVerification?.dayScore, selectedAutomaticVerification?.day)}</strong></div><div><span>Night automatic score</span><i><b style={{ width: `${selectedAutomaticVerification?.nightScore ?? 0}%` }} /></i><strong>{scoreLabel(selectedAutomaticVerification?.nightScore, selectedAutomaticVerification?.night)}</strong></div></div><h3>Day · 7 AM–7 PM</h3><table className="verification-table"><colgroup><col className="metric-column" /><col className="forecast-column" /><col className="observed-column" /></colgroup><thead><tr><th>Metric</th><th>Your forecast</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>{displayForecastTemperature(selectedArchive.day.high)}</td><td>{selectedAutomaticVerification?.day.highF ?? "Awaiting period end"}</td></tr><tr><td>Conditions</td><td>{conditionLabel(selectedArchive.day.conditions)}</td><td>{selectedAutomaticVerification?.day.conditions.join("; ") || "Awaiting period end"}</td></tr><tr><td>Rain chance</td><td>{displayForecastChance(selectedArchive.day.rainChance)}</td><td>{selectedAutomaticVerification ? selectedAutomaticVerification.day.precipitationObserved ? "Precipitation observed" : "No precipitation observed" : "Awaiting period end"}</td></tr><tr><td>Timing / hazards</td><td>{[selectedArchive.day.timing, selectedArchive.day.hazards].filter(Boolean).join(" · ") || "—"}</td><td>{selectedAutomaticVerification?.day.maxWindMph ? `Max wind ${selectedAutomaticVerification.day.maxWindMph} mph` : "Awaiting period end"}</td></tr></tbody></table>
        <h3>Night · 7 PM–7 AM</h3><table className="verification-table"><colgroup><col className="metric-column" /><col className="forecast-column" /><col className="observed-column" /></colgroup><thead><tr><th>Metric</th><th>Your forecast</th><th>Observed</th></tr></thead><tbody><tr><td>Low temperature</td><td>{displayForecastTemperature(selectedArchive.night.low)}</td><td>{selectedAutomaticVerification?.night.lowF ?? "Awaiting period end"}</td></tr><tr><td>Conditions</td><td>{conditionLabel(selectedArchive.night.conditions)}</td><td>{selectedAutomaticVerification?.night.conditions.join("; ") || "Awaiting period end"}</td></tr><tr><td>Rain chance</td><td>{displayForecastChance(selectedArchive.night.rainChance)}</td><td>{selectedAutomaticVerification ? selectedAutomaticVerification.night.precipitationObserved ? "Precipitation observed" : "No precipitation observed" : "Awaiting period end"}</td></tr><tr><td>Timing / hazards</td><td>{[selectedArchive.night.timing, selectedArchive.night.hazards].filter(Boolean).join(" · ") || "—"}</td><td>{selectedAutomaticVerification?.night.maxWindMph ? `Max wind ${selectedAutomaticVerification.night.maxWindMph} mph` : "Awaiting period end"}</td></tr></tbody></table><ForecasterNotes archive={selectedArchive} />
        <section className="submission-evidence"><header><h3>Submission evidence</h3><p>Conditions and guidance captured when this forecast was submitted.</p></header><div><article><span>NWS observation at submission</span><small>{readableEvidence(selectedArchive.evidence.observation)}</small></article><article><span>NWS forecast at submission</span><small>{readableEvidence(selectedArchive.evidence.forecast)}</small></article><article><span>Alerts at submission</span><small>{readableEvidence(selectedArchive.evidence.alerts)}</small></article></div></section><section className="saved-references"><h3>Attached reference data</h3><p>Saved views from the forecast workspace. Open source details only when you need the raw record.</p>{selectedReferences.length ? selectedReferences.map(({ reference, periods }) => <article key={reference.id}><strong>{periods.join(" + ")} · {reference.label}</strong><ArchivedReferencePreview reference={reference} /></article>) : <p className="empty">No reference sources were attached to this older record.</p>}</section></div> : <div className="verification-empty"><p className="eyebrow">Selected forecast</p><h2>{forecastTargetTitle(recordFocusDate)}</h2><p>No forecast was saved for this date yet.</p></div>}<aside className="history"><h3>Forecast history</h3><p>Open a saved forecast and its captured evidence. Right-click a record for actions.</p>{filteredArchives.map((archive) => { const verification = automaticVerifications[archive.id]; const dayScore = verification?.dayScore; const nightScore = verification?.nightScore; return <button key={archive.id} className={archive.id === selectedArchiveId ? "active" : ""} onClick={() => setSelectedArchiveId(archive.id)} onContextMenu={(event) => { event.preventDefault(); setArchiveMenuId(archive.id); setArchiveMenuPosition({ left: event.clientX, top: event.clientY }); }}>Forecast: {forecastTargetTitle(archive.targetDate)}<div className="archive-score-bars"><span><i style={{ width: `${dayScore ?? 0}%` }} /></span><small>Day {dayScore ?? "pending"}</small><span><i style={{ width: `${nightScore ?? 0}%` }} /></span><small>Night {nightScore ?? "pending"}</small></div><small>{forecastAuthorLabel(archive, profiles, session.user.id)} · V{archive.versionNumber ?? 1} · {archive.status}</small></button>})}{filteredArchives.length === 0 && <p className="empty">No forecasts match these filters.</p>}</aside></div>
      </section>}
      {activeSection === "verify" && session && verifyTab === "scenarios" && <section className="workspace-card case-library-preview"><div className="case-library-heading"><div><p className="eyebrow">Verify</p><h2>Historical scenarios</h2><p>Your activity on real past events. Start a new scenario from the Forecast page.</p></div></div>{!scenarios.length && <p className="empty">No scenarios are published yet.</p>}<div className="case-library-grid">{scenarios.map((scenario) => { const attempts = myWorkspaceArchives.filter((archive) => archive.scenarioId === scenario.id); return <article key={scenario.id}><span className="case-library-category">{scenario.category ?? "Case study"}</span><h3>{scenario.title}</h3><small>{new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${scenario.event_date}T12:00:00Z`))}</small><p>{scenario.summary}</p>{scenario.reference_links.length > 0 && <><strong>Reference data</strong><ul>{scenario.reference_links.map((link) => <li key={link.label}>{link.label}{link.detail ? ` — ${link.detail}` : ""}{link.url && <> · <a href={link.url} target="_blank" rel="noreferrer">Open</a></>}</li>)}</ul></>}{scenario.reference_notes && <p className="case-library-note">{scenario.reference_notes}</p>}{canManageActiveClassroom && <div className="settings-actions"><button type="button" onClick={() => assignScenarioToClass(scenario)}>Assign to class</button></div>}{attempts.length > 0 ? <div className="scenario-attempts"><strong>Your attempts</strong>{attempts.map((attempt) => { const verification = automaticVerifications[attempt.id]; return <button type="button" key={attempt.id} onClick={() => { setSelectedArchiveId(attempt.id); setVerifyTab("records"); }}>{forecastTargetTitle(attempt.targetDate)}<small>{verification?.dayScore !== null && verification?.dayScore !== undefined ? `Day score ${verification.dayScore}%` : "Unscored"}</small></button>; })}</div> : <p className="empty">No attempts yet — start this scenario from the Forecast page.</p>}</article>; })}</div>{scenarioMessage && <p className="control-message" role="status">{scenarioMessage}</p>}</section>}
      {archiveMenu && <div className="tab-menu" style={{ left: archiveMenuPosition.left, top: archiveMenuPosition.top }}><strong>{archiveVersionTitle(archiveMenu)}</strong><small>{archiveMenu.status === "draft" ? "Draft records may be permanently removed." : archiveMenu.runId ? "Withdrawal removes this entire forecast run from your working archive while retaining an audit record." : "Withdrawal removes this submission from your working archive while retaining an audit record."}</small><div><button type="button" onClick={() => { setSelectedArchiveId(archiveMenu.id); setArchiveMenuId(null); setActiveSection("verify"); }}>Open</button><button type="button" onClick={() => reviseArchive(archiveMenu)}>Revise</button></div><button type="button" onClick={() => requestArchiveRemoval(archiveMenu)}>{archiveMenu.status === "draft" ? "Delete draft" : archiveMenu.runId ? "Withdraw forecast run" : "Withdraw submission"}</button></div>}
      {pendingArchiveRemoval && <div className="archive-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="archive-confirmation-title"><div><p className="eyebrow">Confirm archive action</p><h2 id="archive-confirmation-title">{pendingArchiveRemoval.status === "draft" ? "Delete this draft?" : "Withdraw this forecast?"}</h2><p>{pendingArchiveRemoval.status === "draft" ? "This draft will be permanently deleted from your archive." : "This forecast will be hidden from your working archive and excluded from grading. Its protected audit record remains available to administrators."}</p><small>{forecastTargetTitle(pendingArchiveRemoval.targetDate)} · V{pendingArchiveRemoval.versionNumber}</small><div><button type="button" onClick={() => setPendingArchiveRemovalId(null)}>Cancel</button><button type="button" className="danger" onClick={() => { if (pendingArchiveRemoval.status === "draft") deleteArchive(pendingArchiveRemoval); else withdrawArchive(pendingArchiveRemoval); setPendingArchiveRemovalId(null); }}>{pendingArchiveRemoval.status === "draft" ? "Delete draft" : "Withdraw forecast"}</button></div></div></div>}
      {activeSection === "control" && hasAcademicReviewAccess && !hasControlAccess && activeWorkspace && <section className="workspace-card"><AcademicReviewDesk workspace={activeWorkspace} roster={academicRoster} onReviewMember={setReviewTarget} message={academicMessage} /></section>}
      {activeSection === "school" && session && activeWorkspace?.kind === "organization" && <section className="workspace-card school-workspace"><SchoolDesk workspace={activeWorkspace} classrooms={workspaceContexts.filter((workspace) => workspace.kind === "classroom" && workspace.organizationId === activeWorkspace.organizationId)} members={schoolMembers} codes={classroomJoinCodes} entitlement={schoolEntitlement} classroomEnrollment={classroomEnrollment} onOpenClassroom={switchWorkspace} onCreateClassroom={(name, term, seatLimit) => createClassroom(activeWorkspace.organizationId!, name, term, seatLimit)} onRenameClassroom={renameSchoolClassroom} onAssignInstructor={assignSchoolInstructor} onCreateCode={createSchoolClassCode} onRetireCode={retireSchoolClassCode} onArchiveClassroom={(classroomId) => setClassroomStatus(classroomId, "archived")} onRestoreClassroom={(classroomId) => setClassroomStatus(classroomId, "active")} onDeleteClassroom={deleteClassroomPermanently} message={accessMessage} /></section>}
      {joinPanelOpen && <section className="workspace-card enrollment-panel"><header className="section-heading"><div><p className="eyebrow">School access</p><h2>Join a school or class</h2><p>Enter the code supplied by your school or instructor. Your access remains within that school’s licensed seats.</p></div><button type="button" onClick={() => { setJoinPanelOpen(false); setJoinMessage(""); }}>Close</button></header><form onSubmit={(event) => { event.preventDefault(); redeemSchoolOrClassCode(); }}><label>Access code<input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} placeholder="FF-XXXXXXXXXXXX" autoComplete="off" /></label><button type="submit" disabled={!joinCode.trim()}>Join</button></form>{joinMessage && <p className="control-message" role="status">{joinMessage}</p>}</section>}
      {activeSection === "classroom" && session && activeWorkspace?.kind === "classroom" && <section className="workspace-card classroom-workspace">
        <div className="section-heading"><div><p className="eyebrow">Classroom desk</p><h2>{workspaceDeskLabel(activeWorkspace)}</h2><p>{activeWorkspace.active === false ? "Your access to this class has ended. Assignments and class tools are no longer available, but your past forecasts and grades are still yours to review under Verify." : canManageActiveClassroom ? "Assignments, submissions, and class progress." : "Your assignments and forecasts for this class."}</p></div><span>{activeWorkspace.active === false ? "access ended" : activeWorkspace.role ?? "member"}</span></div>
        <nav className="classroom-hub-tabs" aria-label="Classroom sections">
          <button type="button" className={classroomHubTab === "outlook" ? "active" : ""} onClick={() => setClassroomHubTab("outlook")}>Class forecast</button>
          <button type="button" className={classroomHubTab === "assignments" ? "active" : ""} onClick={() => setClassroomHubTab("assignments")}>Assignments</button>
          <button type="button" className={classroomHubTab === "progress" ? "active" : ""} onClick={() => setClassroomHubTab("progress")}>{canManageActiveClassroom ? "Class progress" : "Progress"}</button>
          {canManageActiveClassroom && <button type="button" className={classroomHubTab === "roster" ? "active" : ""} onClick={() => setClassroomHubTab("roster")}>Roster</button>}
        </nav>
        {classroomHubTab === "assignments" && (reviewTarget && reviewTarget.classroomId === activeWorkspace.classroomId ? <><ClassroomReviewPanel target={reviewTarget} runs={visibleReviewRuns} selectedRun={selectedReviewRun} notes={reviewNotes} comment={reviewComment} manualScore={reviewManualScore} message={reviewMessage} onSelectRun={setSelectedReviewRunId} onCommentChange={setReviewComment} onManualScoreChange={setReviewManualScore} onSave={saveForecastReview} onClose={() => { setReviewTarget(null); setReviewRuns([]); setReviewNotes({}); }} />{selectedReviewRun && <InstructorRubricCard rubric={reviewRubric} onRubricChange={setReviewRubric} notes={reviewNotes[selectedReviewRun.id] ?? []} onSave={() => saveForecastReview(selectedReviewRun.id)} />}</> : <ClassroomAssignmentDesk assignments={classroomAssignments} submissions={assignmentSubmissions} references={assignmentReferences} reviews={assignmentReviews} roster={academicRoster} selectedAssignmentId={selectedClassroomAssignmentId} dismissedAssignmentId={dismissedClassroomAssignmentId} canManage={canManageActiveClassroom} myUserId={session.user.id} weatherIconStyle={weatherIconStyle} draftResponses={assignmentDraftResponses} saving={assignmentSaving} referenceOptions={referenceOptions} linkLabel={assignmentLinkLabel} linkUrl={assignmentLinkUrl} onCreate={createClassroomAssignment} onSelectAssignment={selectClassroomAssignment} onDismissAssignment={dismissClassroomAssignment} onUpdateAssignment={updateClassroomAssignment} onDraftChange={updateAssignmentDraft} onFormatDraftField={formatAssignmentResponseField} onSaveDraft={saveAssignmentSubmission} onAddReference={(assignment, item) => addAssignmentReference(assignment, { kind: ["model-radar", "sounding"].includes(item.id) ? "model" : "observation", label: item.label, detail: { text: item.detail, preview: item.preview } })} onRemoveReference={removeAssignmentReference} onLinkLabelChange={setAssignmentLinkLabel} onLinkUrlChange={setAssignmentLinkUrl} onAddLinkReference={(assignment) => { addAssignmentReference(assignment, { kind: "link", label: assignmentLinkLabel.trim(), url: assignmentLinkUrl.trim() }); setAssignmentLinkLabel(""); setAssignmentLinkUrl(""); }} reviewOpenId={assignmentReviewOpenId} reviewComment={assignmentReviewComment} reviewScore={assignmentReviewScore} reviewMessage={assignmentReviewMessage} onOpenReview={(submissionId) => { setAssignmentReviewOpenId(submissionId); setAssignmentReviewComment(""); setAssignmentReviewScore(""); setAssignmentReviewMessage(""); }} onReviewCommentChange={setAssignmentReviewComment} onReviewScoreChange={setAssignmentReviewScore} onSaveReview={saveAssignmentReview} message={assignmentMessage} />)}
        {classroomHubTab === "outlook" && <ClassroomLiveForecast archives={archives} roster={academicRoster} canManage={canManageActiveClassroom} publicGuidance={outlook} message={assignmentMessage} />}
        {classroomHubTab === "progress" && <ClassroomProgress assignments={classroomAssignments} submissions={assignmentSubmissions} roster={academicRoster} canManage={canManageActiveClassroom} currentUserId={session.user.id} />}
        {classroomHubTab === "roster" && canManageActiveClassroom && <ClassroomRosterPanel roster={classroomRoster} assignments={classroomAssignments} submissions={assignmentSubmissions} reviews={assignmentReviews} message={classroomRosterMessage} onRevoke={(userId) => setClassroomMemberStatus(userId, "suspended")} onRestore={(userId) => setClassroomMemberStatus(userId, "active")} onInvite={inviteClassroomStudent} />}
      </section>}
      {activeSection === "control" && session && <section className="workspace-card control-panel plan-card"><header><p className="eyebrow">Account</p><h3>Your plan</h3><p>Model data, ensembles, and simulated reflectivity are part of Personal+. Live observations, radar, and the forecast workspace are on every plan.</p></header><div className="plan-status"><b className={hasSchoolMembership || personalTier === "paid" ? "status-ready" : "status-pending"}>{hasSchoolMembership ? "Included via school" : personalTier === "paid" ? "Personal+" : "Free"}</b>{hasSchoolMembership ? <span>Your school or class workspace already includes Personal+ features — no request needed.</span> : personalTier === "paid" ? <span>You have Personal+ access on this account.</span> : <span>Pricing is still being finalized while Frontline Forecast is pre-launch. Request access below and we will follow up by email.</span>}</div>{!hasSchoolMembership && personalTier !== "paid" && (pendingTierRequest ? <p className="control-message" role="status">Request pending review since {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(pendingTierRequest.created_at))}. Approved yet? <button type="button" className="login-menu-link" onClick={() => setProfileRefreshToken((value) => value + 1)}>Check again</button></p> : <form onSubmit={(event) => { event.preventDefault(); submitTierRequest(); }} className="settings-grid"><label>Note (optional)<textarea value={tierNote} onChange={(event) => setTierNote(event.target.value)} placeholder="Anything we should know?" rows={2} /></label><div className="settings-actions"><button type="submit" disabled={tierRequestBusy}>{tierRequestBusy ? "Sending…" : "Request Personal+ access"}</button></div></form>)}<div className="settings-actions"><button type="button" onClick={() => setJoinPanelOpen(true)}>Have a school or class code?</button></div>{tierRequestMessage && <p className="control-message" role="status">{tierRequestMessage}</p>}</section>}
      {activeSection === "control" && session && hasControlAccess && <section className="workspace-card control-panel"><header><p className="eyebrow">Account</p><h3>Tier requests</h3><p>Approve or deny Personal+ access until billing is wired up.</p></header><div className="access-roster-list">{adminTierRequests.map((request) => <div key={request.id}><span><strong>{request.profiles?.display_name || request.profiles?.email || request.user_id}</strong><small>{request.note || "No note"} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(request.created_at))}</small></span><button type="button" onClick={() => resolveTierRequest(request.id, true)}>Approve</button><button type="button" onClick={() => resolveTierRequest(request.id, false)}>Deny</button></div>)}</div>{!adminTierRequests.length && <p className="empty">No pending tier requests.</p>}{adminTierMessage && <p className="control-message" role="status">{adminTierMessage}</p>}</section>}
      {activeSection === "control" && session && <section className="workspace-card control-center"><div className="section-heading"><div><p className="eyebrow">Account</p><h2>Your settings</h2><p>Set the defaults for how Frontline Forecast opens.</p></div><span>Account</span></div><div className="control-layout"><section className="control-panel"><header><p className="eyebrow">Personal settings</p><h3>Your defaults</h3><p>Weather symbols save to your account; other choices stay with this browser.</p></header><div className="settings-grid"><label>Default location<select value={defaultLocationId} onChange={(event) => setDefaultLocationId(weatherDeskLocation(event.target.value).id)}>{weatherDeskLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>New forecast horizon<select value={defaultForecastDays} onChange={(event) => setDefaultForecastDays(Number(event.target.value) as 1 | 3 | 7)}><option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option></select></label><label>Dark mode<select value={theme} onChange={(event) => setTheme(event.target.value as "light" | "dark")}><option value="light">Light mode</option><option value="dark">Dark mode</option></select></label><label>Weather symbols<select value={weatherIconStyle} onChange={(event) => saveWeatherIconStyle(event.target.value as WeatherIconStyle)}><option value="traditional">Traditional</option><option value="minimal">Minimal</option></select><small>Traditional is the public default. Your preference follows your account.</small></label></div><div className="settings-actions"><button type="button" onClick={() => { setLocationId(defaultLocationId); setActiveSection("dashboard"); setControlMessage("Opened your default weather view."); }}>Open weather</button><button type="button" onClick={() => { setDefaultLocationId(defaultWeatherDeskLocation.id); setDefaultForecastDays(1); setTheme("light"); saveWeatherIconStyle("traditional"); setControlMessage("Personal defaults restored."); }}>Restore defaults</button></div>{controlMessage && <p className="control-message" role="status">{controlMessage}</p>}</section><aside className="control-panel control-delivery"><header><p className="eyebrow">Account</p><h3>Service status</h3><p>Useful account and data status at a glance.</p></header><div className="control-service-list"><div><span>Forecast archive</span><strong>{supabaseUrl && supabaseKey ? "Connected" : "Needs setup"}</strong><small>Your saved forecasts sync through your account.</small></div><div><span>Weather sources</span><strong>{liveWeather ? "Available" : "Checking"}</strong><small>Weather, radar, and model guidance load as needed.</small></div><div><span>Map controls</span><strong>Radar desk</strong><small>Map view, overlays, and opacity are managed in Radar.</small></div></div></aside></div></section>}
      {activeSection === "control" && session && <section className="workspace-card control-panel control-password-card"><header><p className="eyebrow">Account</p><h3>Change password</h3><p>Update the password used to sign in to Frontline Forecast.</p></header><form onSubmit={(event) => { event.preventDefault(); changePassword(); }} className="settings-grid"><label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" /></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat new password" /></label><div className="settings-actions"><button type="submit" disabled={passwordBusy || !newPassword || !confirmPassword}>{passwordBusy ? "Updating…" : "Update password"}</button></div></form>{passwordMessage && <p className="control-message" role="status">{passwordMessage}</p>}</section>}
      {activeSection === "control" && session && <section className="workspace-card control-panel control-data-card"><header><p className="eyebrow">Account</p><h3>Your data</h3><p>Download a copy of your account, forecasts, and reviews.</p></header><div className="settings-actions"><button type="button" onClick={exportMyData}>Export my data</button></div>{exportMessage && <p className="control-message" role="status">{exportMessage}</p>}</section>}
      {activeSection === "control" && session && <section className="workspace-card control-panel control-delete-card"><header><p className="eyebrow">Account</p><h3>Delete account</h3><p>Permanently removes your login and profile information. See our <a href="/privacy">Privacy Policy</a> for what happens to coursework tied to a school.</p></header><form onSubmit={(event) => { event.preventDefault(); deleteAccount(); }} className="settings-grid"><label>Type DELETE to confirm<input value={deleteConfirmText} onChange={(event) => setDeleteConfirmText(event.target.value)} placeholder="DELETE" /></label><div className="settings-actions"><button type="submit" className="danger" disabled={deleteBusy || deleteConfirmText.trim().toUpperCase() !== "DELETE"}>{deleteBusy ? "Deleting…" : "Delete my account"}</button></div></form>{deleteMessage && <p className="control-message" role="status">{deleteMessage}</p>}</section>}
      {activeSection === "control" && hasAcademicReviewAccess && reviewTarget && <ClassroomReviewPanel target={reviewTarget} runs={visibleReviewRuns} selectedRun={selectedReviewRun} notes={reviewNotes} comment={reviewComment} manualScore={reviewManualScore} message={reviewMessage} onSelectRun={setSelectedReviewRunId} onCommentChange={setReviewComment} onManualScoreChange={setReviewManualScore} onSave={saveForecastReview} onClose={() => { setReviewTarget(null); setReviewRuns([]); setReviewNotes({}); }} />}
      {activeSection === "control" && hasAcademicReviewAccess && selectedReviewRun && <InstructorRubricCard rubric={reviewRubric} onRubricChange={setReviewRubric} notes={reviewNotes[selectedReviewRun.id] ?? []} onSave={() => saveForecastReview(selectedReviewRun.id)} />}

      {activeSection === "verify" && session && selectedArchive && <section className="workspace-card record-actions-card"><div className="record-actions"><div><strong>Archive actions</strong><small>Revisions create a new auditable forecast. Removing a submitted forecast withdraws it from your working archive while retaining its protected history.</small></div><div><button type="button" onClick={() => reviseArchive(selectedArchive)}>Revise forecast</button><button type="button" className="danger" onClick={() => requestArchiveRemoval(selectedArchive)}>{selectedArchive.status === "draft" ? "Delete draft" : "Withdraw forecast"}</button></div></div></section>}
    </main>
    <footer className="site-footer"><span>© {new Date().getFullYear()} Frontline Forecast</span><nav><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></nav></footer>
    </>
  );
}
