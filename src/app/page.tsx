"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const RadarMap = dynamic(() => import("./radar-map"), {
  ssr: false,
  loading: () => <div className="radar-loading">Loading live radar…</div>,
});

type DataPanel = "nbm" | "sounding" | "models";
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
type SavedForecast = {
  id: string;
  runId?: string;
  periodIds?: { day?: string; night?: string };
  savedAt: string;
  label: string;
  targetDate: string;
  status: "draft" | "submitted" | "revised" | "verified" | "withdrawn";
  versionNumber: number;
  day: { high: string; conditions: string; rainChance: string; timing: string; hazards: string; references?: ReferenceItem[] };
  night: { low: string; conditions: string; rainChance: string; timing: string; hazards: string; references?: ReferenceItem[] };
  evidence: { observation: string; forecast: string; alerts: string };
};
type WeatherDeskSession = { access_token: string; user: { id: string; email?: string } };
type ReferenceItem = { id: string; label: string; detail: string };
type PeriodDraft = { highLow: string; conditions: string; rainChance: string; timing: string; wind: string; confidence: string; hazards: string; reasoning: string; references: ReferenceItem[] };
type ForecastDayDraft = { date: string; day: PeriodDraft; night: PeriodDraft };
type ForecastRunDraft = { id: string; days: ForecastDayDraft[]; initialHorizonDays: number };
type CloudRunRow = { id: string; created_at: string; status: string; forecast_periods: { id: string; valid_date: string; period: "day" | "night"; forecast_data: PeriodDraft; evidence_snapshot: SavedForecast["evidence"]; forecast_verifications?: { observed_data: ActualPeriod; score_data: { automaticScore?: number | null } }[] }[] };
type ActualPeriod = { observationCount: number; highF: number | null; lowF: number | null; maxWindMph: number | null; precipitationObserved: boolean; conditions: string[]; complete: boolean };
type AutomaticVerification = { station: string; fetchedAt: string; day: ActualPeriod; night: ActualPeriod; dayScore: number | null; nightScore: number | null };
type Profile = { id: string; email: string | null; role: "student" | "forecaster" | "reviewer" | "admin" };

const archiveStorageKey = "weather-desk-forecast-archives";
const forecastDraftStorageKey = "weather-desk-active-forecast-draft";
const sessionStorageKey = "weather-desk-supabase-session";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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

function savedReferences(value: unknown): ReferenceItem[] {
  return Array.isArray(value) ? value.filter((item): item is ReferenceItem => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.label === "string" && typeof item.detail === "string")) : [];
}

function automaticPeriodScore(forecastTemperature: string, rainChance: string, actual: ActualPeriod, useHigh: boolean) {
  const predictedTemperature = Number.parseFloat(forecastTemperature);
  const actualTemperature = useHigh ? actual.highF : actual.lowF;
  if (!actual.complete || !Number.isFinite(predictedTemperature) || actualTemperature === null) return null;
  const temperaturePoints = Math.max(0, 70 - Math.abs(predictedTemperature - actualTemperature) * 10);
  const predictedRain = Number.parseFloat(rainChance) >= 50;
  const precipitationPoints = predictedRain === actual.precipitationObserved ? 30 : 0;
  return Math.round(temperaturePoints + precipitationPoints);
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
      day: { high: dayData.highLow, conditions: dayData.conditions, rainChance: dayData.rainChance, timing: dayData.timing, hazards: dayData.hazards, references: savedReferences(dayData.references) },
      night: { low: nightData.highLow, conditions: nightData.conditions, rainChance: nightData.rainChance, timing: nightData.timing, hazards: nightData.hazards, references: savedReferences(nightData.references) },
      evidence: day?.evidence_snapshot ?? night?.evidence_snapshot ?? { observation: "No observation snapshot", forecast: "No NWS snapshot", alerts: "No alert snapshot" },
    };
  });
}

export default function Home() {
  const [dataPanel, setDataPanel] = useState<DataPanel>("nbm");
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("dashboard");
  const [radarExpanded, setRadarExpanded] = useState(false);
  const [radarLoop, setRadarLoop] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [liveWeather, setLiveWeather] = useState<LiveWeather | null>(null);
  const [weatherError, setWeatherError] = useState("");
  const [nbmText, setNbmText] = useState("");
  const [nbmStatus, setNbmStatus] = useState("Loading latest KAHN NBM bulletin…");
  const [soundingText, setSoundingText] = useState("");
  const [soundingStatus, setSoundingStatus] = useState("Loading latest observed FFC sounding…");
  const [archives, setArchives] = useState<SavedForecast[]>([]);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);
  const [session, setSession] = useState<WeatherDeskSession | null>(null);
  const [role, setRole] = useState("student");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
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
    const savedSession = window.localStorage.getItem(sessionStorageKey);
    if (savedSession) {
      try { setSession(JSON.parse(savedSession) as WeatherDeskSession); } catch { window.localStorage.removeItem(sessionStorageKey); }
    }
  }, []);

  useEffect(() => {
    if (!session || !supabaseUrl || !supabaseKey) return;
    const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` };
    Promise.all([
      fetch(`${supabaseUrl}/rest/v1/forecast_runs?select=id,created_at,status,forecast_periods(id,valid_date,period,forecast_data,evidence_snapshot,forecast_verifications(observed_data,score_data))&status=neq.withdrawn&order=created_at.desc`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/forecasts?select=id,created_at,forecast_data,evidence_snapshot&status=neq.withdrawn&order=created_at.desc`, { headers }),
    ]).then(async ([runResponse, legacyResponse]) => {
      if (!runResponse.ok || !legacyResponse.ok) throw new Error("Unable to load cloud archives");
      const runs = await runResponse.json() as CloudRunRow[];
      const legacyRows = await legacyResponse.json() as { id: string; created_at: string; forecast_data: Omit<SavedForecast, "id" | "savedAt">; evidence_snapshot: SavedForecast["evidence"] }[];
      const runArchives = runs.flatMap(archiveRecordsFromRun);
      const legacyArchives = legacyRows.map((row) => ({ ...row.forecast_data, id: row.id, savedAt: row.created_at, evidence: row.evidence_snapshot })) as SavedForecast[];
      const olderOnly = legacyArchives.filter((legacy) => !runArchives.some((run) => run.targetDate === legacy.targetDate && Math.abs(new Date(run.savedAt).getTime() - new Date(legacy.savedAt).getTime()) < 1000));
      const cloudArchives = [...runArchives, ...olderOnly].sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
      setArchives(cloudArchives);
      setSelectedArchiveId(cloudArchives[0]?.id ?? null);
      const restoredVerifications = Object.fromEntries(runArchives.flatMap((archive) => {
        const run = runs.find((item) => item.id === archive.runId);
        const day = run?.forecast_periods.find((period) => period.id === archive.periodIds?.day)?.forecast_verifications?.[0];
        const night = run?.forecast_periods.find((period) => period.id === archive.periodIds?.night)?.forecast_verifications?.[0];
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
  const selectedReferences = selectedArchive ? [
    ...savedReferences(selectedArchive.day.references).map((reference) => ({ ...reference, period: "Day" })),
    ...savedReferences(selectedArchive.night.references).map((reference) => ({ ...reference, period: "Night" })),
  ] : [];
  const selectedAutomaticVerification = selectedArchive ? automaticVerifications[selectedArchive.id] : null;
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

  function saveForecast(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const savedAt = new Date().toISOString();
    const nextArchives = forecastRun.days.map((day) => {
      const versionNumber = archives.filter((archive) => archive.targetDate === day.date).length + 1;
      return {
      id: crypto.randomUUID(), savedAt, label: archiveTitle({ savedAt }), targetDate: day.date,
      status: "submitted" as const, versionNumber,
      day: { high: day.day.highLow, conditions: day.day.conditions, rainChance: day.day.rainChance, timing: day.day.timing, hazards: day.day.hazards, references: day.day.references },
      night: { low: day.night.highLow, conditions: day.night.conditions, rainChance: day.night.rainChance, timing: day.night.timing, hazards: day.night.hazards, references: day.night.references },
      evidence: {
        observation: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F, ${liveWeather.observation.description}; ${liveWeather.observation.station} at ${observedAt}` : "No live observation available when saved",
        forecast: liveWeather?.forecast ? `${liveWeather.forecast.period}: ${liveWeather.forecast.shortForecast}; ${liveWeather.forecast.precipitationChance ?? 0}% precipitation chance` : "No NWS forecast available when saved",
        alerts: liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => alert.event).join(", ") : liveWeather?.alertsAvailable === false ? "NWS alert feed unavailable when saved" : "No active NWS alerts when saved",
      },
    } satisfies SavedForecast;
    });
    const combinedArchives = [...nextArchives, ...archives].slice(0, 50);
    setArchives(combinedArchives);
    setSelectedArchiveId(nextArchives[0]?.id ?? null);
    window.localStorage.setItem(archiveStorageKey, JSON.stringify(combinedArchives));
    if (session && supabaseUrl && supabaseKey) {
      saveForecastRunToCloud(savedAt)
        .then(() => setSaveMessage(`${nextArchives.length}-day forecast submitted and evidence archived.`))
        .catch((error: Error) => setSaveMessage(`Submitted in this browser, but cloud saving failed: ${error.message}`));
    } else {
      setSaveMessage("Forecast submitted in this browser. Sign in to archive it across devices.");
    }
  }

  async function saveForecastRunToCloud(submittedAt: string) {
    if (!session || !supabaseUrl || !supabaseKey) return;
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
    if (!periodResponse.ok) throw new Error("Forecast run was created, but its day/night periods could not be saved.");
  }

  function reviseArchive(archive: SavedForecast) {
    const targetDate = fallbackForecastDate(archive.targetDate);
    setForecastRun({ id: crypto.randomUUID(), initialHorizonDays: 1, days: [{ date: targetDate, day: { ...emptyPeriod("day"), highLow: archive.day.high, conditions: archive.day.conditions, rainChance: archive.day.rainChance, timing: archive.day.timing, hazards: archive.day.hazards, references: savedReferences(archive.day.references) }, night: { ...emptyPeriod("night"), highLow: archive.night.low, conditions: archive.night.conditions, rainChance: archive.night.rainChance, timing: archive.night.timing, hazards: archive.night.hazards, references: savedReferences(archive.night.references) } }] });
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
        const headers = { apikey: supabaseKey, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
        const saved = await Promise.all([
          fetch(`${supabaseUrl}/rest/v1/forecast_verifications`, { method: "POST", headers, body: JSON.stringify({ forecast_period_id: archive.periodIds.day, observed_data: data.day, score_data: { automaticScore: verification.dayScore, method: "temperature (70) + precipitation occurrence (30)" } }) }),
          fetch(`${supabaseUrl}/rest/v1/forecast_verifications`, { method: "POST", headers, body: JSON.stringify({ forecast_period_id: archive.periodIds.night, observed_data: data.night, score_data: { automaticScore: verification.nightScore, method: "temperature (70) + precipitation occurrence (30)" } }) }),
        ]);
        if (saved.some((response) => !response.ok)) throw new Error("Actuals were shown, but cloud verification could not be saved.");
        if (data.day.complete && data.night.complete && archive.runId) {
          await fetch(`${supabaseUrl}/rest/v1/forecast_runs?id=eq.${archive.runId}`, { method: "PATCH", headers, body: JSON.stringify({ status: "verified" }) });
        }
      }
      setVerificationMessage(data.day.complete && data.night.complete ? "Automatic score calculated from completed periods." : "Observations collected. A final score will appear after each period ends.");
    } catch (error) { setVerificationMessage(error instanceof Error ? error.message : "Unable to collect observations."); }
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
    const nextSession = { access_token: data.access_token, user: data.user } as WeatherDeskSession;
    window.localStorage.setItem(sessionStorageKey, JSON.stringify(nextSession));
    setSession(nextSession);
    setLoginMenuOpen(false);
    setAuthMessage(`Signed in as ${data.user.email}.`);
  }

  return (
    <main className={radarExpanded ? "app radar-expanded" : "app"}>
      <header className="header">
        <div><p className="eyebrow">Human-first forecasting workspace</p><h1>The Weather Desk</h1></div>
        <div className="header-meta"><div className="location">Athens, GA <span>Student workspace</span></div><div className="header-account">{session ? <><span>{session.user.email}</span><button type="button" onClick={() => { window.localStorage.removeItem(sessionStorageKey); setSession(null); setAuthMessage("Signed out."); }}>Sign out</button></> : <div className="login-menu-wrap"><button type="button" onClick={() => setLoginMenuOpen((open) => !open)}>Log in</button>{loginMenuOpen && <div className="login-menu"><strong>Weather Desk account</strong><input aria-label="Email" type="email" placeholder="Email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /><input aria-label="Password" type="password" placeholder="Password (6+ characters)" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /><div><button type="button" onClick={() => authenticate("signin")}>Sign in</button><button type="button" onClick={() => authenticate("signup")}>Create account</button></div>{authMessage && <small>{authMessage}</small>}</div>}</div>}</div></div>
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
          <div className="card-heading"><div><h2>Radar</h2><p>Live composite reflectivity · centered on Athens</p></div><div className="actions"><button onClick={() => setRadarLoop((value) => !value)}>{radarLoop ? "Interactive map" : "Animate loop"}</button><button onClick={() => setRadarExpanded((value) => !value)}>{radarExpanded ? "Exit expanded view" : "Expand radar"}</button></div></div>
          <div className="radar">{radarLoop ? <img className="radar-loop" src="https://radar.weather.gov/ridge/standard/KFFC_loop.gif" alt="Animated NOAA radar loop from Peachtree City radar covering Athens, Georgia" /> : <RadarMap />}</div>
          <div className="card-footer"><span>{radarLoop ? "KFFC animated radar loop" : "NOAA/NWS composite reflectivity"}</span><span>{radarLoop ? "Peachtree City radar · Athens coverage" : "Pan, zoom, or expand"}</span></div>
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
        </div>
        {dataPanel === "nbm" && <pre className="model-text">{nbmText || nbmStatus}</pre>}
        {dataPanel === "sounding" && <pre className="model-text">{soundingText || soundingStatus}</pre>}
        {dataPanel === "models" && <p className="empty">Start with NBM and observed soundings. Future sources will appear here as timestamped, archivable panels so you can compare them without losing context.</p>}
      </section>
      </>}

      {activeSection === "forecast" && !session && <section className="workspace-card access-wall"><h2>Log in to forecast</h2><p>The dashboard is available to explore, while forecasts, references, and archive work stay private to your account.</p><button type="button" onClick={() => setLoginMenuOpen(true)}>Open login</button></section>}
      {activeSection === "forecast" && session && <section className="workspace-card">
        <div className="section-heading forecast-title"><div><h2>Forecast workspace</h2><p>Each tab is one dated Day/Night forecast.</p></div><div className="horizon-actions"><button type="button" onClick={() => { const start = new Date(); setForecastRun({ id: crypto.randomUUID(), initialHorizonDays: 3, days: [0, 1, 2].map((offset) => createForecastDay(addDays(start, offset))) }); setSelectedForecastDay(0); }}>New 3-day</button><button type="button" onClick={() => { const start = new Date(); setForecastRun({ id: crypto.randomUUID(), initialHorizonDays: 7, days: Array.from({ length: 7 }, (_, offset) => createForecastDay(addDays(start, offset))) }); setSelectedForecastDay(0); }}>New 7-day</button></div></div>
        <div className="day-tabs" role="tablist" aria-label="Forecast days">{forecastRun.days.map((day, index) => <button type="button" key={`${day.date}-${index}`} className={index === selectedForecastDay ? "active" : ""} onClick={() => setSelectedForecastDay(index)} onContextMenu={(event) => { event.preventDefault(); setTabMenuIndex(index); setTabMenuPosition({ left: event.clientX, top: event.clientY }); setTabMenuMessage(""); }}>{new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day.date}T12:00:00`))}</button>)}<button className="add-day" type="button" aria-label="Add next forecast day" onClick={() => setForecastRun((run) => ({ ...run, days: [...run.days, createForecastDay(addDays(new Date(`${run.days.at(-1)?.date}T12:00:00`), 1))] }))}>+</button></div>
        <input type="hidden" name="target-date" form="forecast-form" value={selectedDay.date} />
        {tabMenuIndex !== null && <div className="tab-menu" style={{ left: tabMenuPosition.left, top: tabMenuPosition.top }}><strong>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${forecastRun.days[tabMenuIndex].date}T12:00:00`))}</strong><label>Change date<input type="date" value={forecastRun.days[tabMenuIndex].date} onChange={(event) => { const nextDate = event.target.value; if (forecastRun.days.some((day, index) => index !== tabMenuIndex && day.date === nextDate)) { setTabMenuMessage("That date already has a forecast tab."); return; } setForecastRun((run) => ({ ...run, days: run.days.map((day, index) => index === tabMenuIndex ? { ...day, date: nextDate } : day) })); setTabMenuMessage(""); }} /></label><div><button type="button" onClick={() => setTabMenuIndex(null)}>Done</button><button type="button" disabled={forecastRun.days.length === 1} onClick={() => { setForecastRun((run) => ({ ...run, days: run.days.filter((_, index) => index !== tabMenuIndex) })); setSelectedForecastDay((current) => Math.max(0, Math.min(current, forecastRun.days.length - 2))); setTabMenuIndex(null); }}>Remove day</button></div>{tabMenuMessage && <small>{tabMenuMessage}</small>}</div>}
        <section className="archive-summary"><div><strong>{archives.length} saved forecast{archives.length === 1 ? "" : "s"}</strong><span>Each save is a separate version with its own weather evidence.</span></div>{archives.length > 0 && <div className="archive-list">{archives.slice(0, 4).map((archive) => <button type="button" key={archive.id} onClick={() => { setSelectedArchiveId(archive.id); setActiveSection("verify"); }}>Forecast: {forecastTargetTitle(archive.targetDate)}<small>{archiveSubmissionTitle(archive)}</small></button>)}</div>}</section>
        <form id="forecast-form" onSubmit={saveForecast}>
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
          </div></fieldset>
          <div className="form-actions"><span>{saveMessage || "Draft is saved automatically in this browser. Submitting archives each dated tab as an immutable record."}</span><button type="submit">Submit forecast run</button></div>
        </form>
      </section>}

      {activeSection === "verify" && !session && <section className="workspace-card access-wall"><h2>Sign in to open your archive</h2><p>Your forecasts, evidence, revisions, and verification history stay private to your account.</p><button onClick={() => setActiveSection("forecast")}>Go to Forecast sign-in</button></section>}
      {activeSection === "verify" && session && <section className="workspace-card">
        {selectedArchive ? <><div className="section-heading"><div><h2>{archiveVersionTitle(selectedArchive)}</h2><p>Athens, GA · {archiveSubmissionTitle(selectedArchive)}</p></div><div className="verification-score"><strong>{selectedAutomaticVerification?.dayScore !== null && selectedAutomaticVerification?.dayScore !== undefined ? `${selectedAutomaticVerification.dayScore}%` : selectedArchive.status === "draft" ? "Draft" : "Pending"}</strong><span>{selectedAutomaticVerification ? "automatic day score" : selectedArchive.status === "draft" ? "not graded" : "verification"}</span><button type="button" onClick={() => collectActuals(selectedArchive)}>Collect actuals</button></div></div>{verificationMessage && <p className="empty">{verificationMessage}</p>}
        <div className="verification-grid"><div><h3>Day · 7 AM–7 PM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>Saved guidance</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>{selectedArchive.day.high}°F</td><td>{selectedArchive.evidence.forecast}</td><td>{selectedAutomaticVerification?.day.highF ?? "Awaiting period end"}</td></tr><tr><td>Conditions</td><td>{selectedArchive.day.conditions}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.day.conditions.join("; ") || "Awaiting period end"}</td></tr><tr><td>Rain chance</td><td>{selectedArchive.day.rainChance}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification ? selectedAutomaticVerification.day.precipitationObserved ? "Precipitation observed" : "No precipitation observed" : "Awaiting period end"}</td></tr><tr><td>Timing / hazards</td><td>{selectedArchive.day.timing} · {selectedArchive.day.hazards}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.day.maxWindMph ? `Max wind ${selectedAutomaticVerification.day.maxWindMph} mph` : "Awaiting period end"}</td></tr></tbody></table>
        <h3>Night · 7 PM–7 AM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>Saved guidance</th><th>Observed</th></tr></thead><tbody><tr><td>Low temperature</td><td>{selectedArchive.night.low}°F</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.night.lowF ?? "Awaiting period end"}</td></tr><tr><td>Conditions</td><td>{selectedArchive.night.conditions}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.night.conditions.join("; ") || "Awaiting period end"}</td></tr><tr><td>Rain chance</td><td>{selectedArchive.night.rainChance}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification ? selectedAutomaticVerification.night.precipitationObserved ? "Precipitation observed" : "No precipitation observed" : "Awaiting period end"}</td></tr><tr><td>Timing / hazards</td><td>{selectedArchive.night.timing} · {selectedArchive.night.hazards}</td><td>Saved with forecast</td><td>{selectedAutomaticVerification?.night.maxWindMph ? `Max wind ${selectedAutomaticVerification.night.maxWindMph} mph` : "Awaiting period end"}</td></tr></tbody></table>
        <div className="verification-notes"><div><span>Observation snapshot</span><strong>Captured</strong><small>{selectedArchive.evidence.observation}</small></div><div><span>NWS guidance snapshot</span><strong>Captured</strong><small>{selectedArchive.evidence.forecast}</small></div><div><span>Alert snapshot</span><strong>Captured</strong><small>{selectedArchive.evidence.alerts}</small></div></div><section className="saved-references"><h3>Attached reference data</h3><p>These are the source snapshots selected when this forecast was submitted.</p>{selectedReferences.length ? selectedReferences.map((reference) => <article key={`${reference.period}-${reference.id}`}><strong>{reference.period} · {reference.label}</strong><pre>{reference.detail}</pre></article>) : <p className="empty">No reference sources were attached to this older record.</p>}</section></div><aside className="history"><h3>Forecast history</h3><p>Open a saved forecast and its captured evidence. Right-click a record for actions.</p>{archives.map((archive) => <button key={archive.id} className={archive.id === selectedArchiveId ? "active" : ""} onClick={() => setSelectedArchiveId(archive.id)} onContextMenu={(event) => { event.preventDefault(); setArchiveMenuId(archive.id); setArchiveMenuPosition({ left: event.clientX, top: event.clientY }); }}>Forecast: {forecastTargetTitle(archive.targetDate)}<small>{archiveSubmissionTitle(archive)} · V{archive.versionNumber ?? 1} · {archive.status}</small></button>)}<button onClick={() => setSelectedArchiveId(null)}>Example · Jul 13<small>Sample verification layout</small></button></aside></div></>
        : <div className="verification-grid"><div><div className="section-heading"><div><h2>Verification · Monday, July 13</h2><p>Example forecast · Asheville Regional Airport</p></div><div className="verification-score"><strong>3 / 4</strong><span>metrics verified</span></div></div><h3>Day · 7 AM–7 PM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>NBM</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>85°F</td><td>83°F</td><td>84°F</td></tr><tr><td>Rain chance</td><td>70%</td><td>62%</td><td>Rain observed</td></tr><tr><td>Rain timing</td><td>4–7 PM</td><td>3–8 PM</td><td>5:12 PM</td></tr><tr><td>Thunderstorm risk</td><td>Scattered</td><td>Possible</td><td>One storm nearby</td></tr></tbody></table><div className="verification-notes"><div><span>Temperature error</span><strong>1°F</strong><small>Your forecast was closer</small></div><div><span>Timing error</span><strong>0:12</strong><small>Rain began 12 min later</small></div><div><span>Reflection</span><strong>Good call</strong><small>Storm coverage was limited</small></div></div></div><aside className="history"><h3>Forecast history</h3><p>Save a forecast to create an archive here.</p>{archives.map((archive) => <button key={archive.id} onClick={() => setSelectedArchiveId(archive.id)}>Forecast: {forecastTargetTitle(archive.targetDate)}<small>{archiveSubmissionTitle(archive)} · Day + night</small></button>)}</aside></div>}
      </section>}
      {archiveMenu && <div className="tab-menu" style={{ left: archiveMenuPosition.left, top: archiveMenuPosition.top }}><strong>{archiveVersionTitle(archiveMenu)}</strong><small>{archiveMenu.status === "draft" ? "Draft records may be permanently removed." : archiveMenu.runId ? "Withdrawal removes this entire forecast run from your working archive while retaining an audit record." : "Withdrawal removes this submission from your working archive while retaining an audit record."}</small><div><button type="button" onClick={() => { setSelectedArchiveId(archiveMenu.id); setArchiveMenuId(null); setActiveSection("verify"); }}>Open</button><button type="button" onClick={() => reviseArchive(archiveMenu)}>Revise</button></div><button type="button" onClick={() => archiveMenu.status === "draft" ? deleteArchive(archiveMenu) : withdrawArchive(archiveMenu)}>{archiveMenu.status === "draft" ? "Delete draft" : archiveMenu.runId ? "Withdraw forecast run" : "Withdraw submission"}</button></div>}
      {activeSection === "control" && session && role === "admin" && <section className="workspace-card"><div className="section-heading"><div><h2>Control center</h2><p>Administration for linked Weather Desk apps.</p></div><span>Admin</span></div><div className="verification-notes"><div><span>Publishing</span><strong>Protected</strong><small>Student drafts never feed a public-facing forecast.</small></div><div><span>Automated grading</span><strong>Private</strong><small>Scores are currently visible only in each student archive.</small></div><div><span>Audit history</span><strong>Active</strong><small>Submission, revision, withdrawal, and verification records are retained.</small></div></div><section className="role-manager"><h3>Users and roles</h3><p>Roles control access to training, review, administration, and future publishing tools.</p>{profiles.map((profile) => <div key={profile.id}><span>{profile.email ?? profile.id}</span><select value={profile.role} onChange={(event) => setProfileRole(profile, event.target.value as Profile["role"])}><option value="student">Student</option><option value="forecaster">Forecaster</option><option value="reviewer">Reviewer</option><option value="admin">Admin</option></select></div>)}{profileMessage && <small>{profileMessage}</small>}</section></section>}
    </main>
  );
}
