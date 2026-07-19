"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const RadarMap = dynamic(() => import("./radar-map"), {
  ssr: false,
  loading: () => <div className="radar-loading">Loading live radar…</div>,
});

type DataPanel = "nbm" | "sounding" | "models";
type WorkspaceSection = "dashboard" | "forecast" | "verify";
type LiveWeather = {
  location: string;
  observation: { station: string; stationName: string; observedAt: string; description: string; temperatureF: number | null; dewpointF: number | null; windMph: number | null; windDirection: string | null };
  forecast: { period: string; temperature: number; temperatureUnit: string; shortForecast: string; detailedForecast: string; precipitationChance: number | null } | null;
  alerts: { event: string; headline: string | null }[];
  fetchedAt: string;
};
type SavedForecast = {
  id: string;
  savedAt: string;
  label: string;
  day: { high: string; conditions: string; rainChance: string; timing: string; hazards: string };
  night: { low: string; conditions: string; rainChance: string; timing: string; hazards: string };
  evidence: { observation: string; forecast: string; alerts: string };
};

const archiveStorageKey = "weather-desk-forecast-archives";

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

  useEffect(() => {
    fetch("/api/weather")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load live data");
        setLiveWeather(data);
      })
      .catch((error: Error) => setWeatherError(error.message));
  }, []);

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

  function saveForecast(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const savedAt = new Date().toISOString();
    const nextArchive: SavedForecast = {
      id: crypto.randomUUID(),
      savedAt,
      label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(savedAt)),
      day: { high: String(form.get("day-high")), conditions: String(form.get("day-conditions")), rainChance: String(form.get("day-rain-chance")), timing: String(form.get("day-timing")), hazards: String(form.get("day-hazards")) },
      night: { low: String(form.get("night-low")), conditions: String(form.get("night-conditions")), rainChance: String(form.get("night-rain-chance")), timing: String(form.get("night-timing")), hazards: String(form.get("night-hazards")) },
      evidence: {
        observation: liveWeather ? `${liveWeather.observation.temperatureF ?? "—"}°F, ${liveWeather.observation.description}; ${liveWeather.observation.station} at ${observedAt}` : "No live observation available when saved",
        forecast: liveWeather?.forecast ? `${liveWeather.forecast.period}: ${liveWeather.forecast.shortForecast}; ${liveWeather.forecast.precipitationChance ?? 0}% precipitation chance` : "No NWS forecast available when saved",
        alerts: liveWeather?.alerts.length ? liveWeather.alerts.map((alert) => alert.event).join(", ") : "No active NWS alerts when saved",
      },
    };
    const nextArchives = [nextArchive, ...archives].slice(0, 20);
    setArchives(nextArchives);
    setSelectedArchiveId(nextArchive.id);
    window.localStorage.setItem(archiveStorageKey, JSON.stringify(nextArchives));
    setSaveMessage("Forecast and live weather evidence saved. Open Verify to review it.");
  }

  return (
    <main className={radarExpanded ? "app radar-expanded" : "app"}>
      <header className="header">
        <div><p className="eyebrow">Human-first forecasting workspace</p><h1>The Weather Desk</h1></div>
        <div className="location">Athens, GA <span>Student workspace</span></div>
      </header>

      <nav aria-label="Main navigation" className="navigation">
        <button className={activeSection === "dashboard" ? "active" : ""} onClick={() => setActiveSection("dashboard")}>Dashboard</button>
        <button className={activeSection === "forecast" ? "active" : ""} onClick={() => setActiveSection("forecast")}>Forecast</button>
        <button className={activeSection === "verify" ? "active" : ""} onClick={() => setActiveSection("verify")}>Verify</button>
      </nav>

      {activeSection === "dashboard" && <>
      <section className="dashboard-grid">
        <article className="radar-card">
          <div className="card-heading"><div><h2>Radar</h2><p>Live composite reflectivity · centered on Athens</p></div><div className="actions"><button onClick={() => setRadarLoop((value) => !value)}>{radarLoop ? "Interactive map" : "Animate loop"}</button><button onClick={() => setRadarExpanded((value) => !value)}>{radarExpanded ? "Exit expanded view" : "Expand radar"}</button></div></div>
          <div className="radar">{radarLoop ? <img className="radar-loop" src="https://radar.weather.gov/ridge/standard/KFFC_loop.gif" alt="Animated NOAA radar loop from Peachtree City radar covering Athens, Georgia" /> : <RadarMap />}</div>
          <div className="card-footer"><span>{radarLoop ? "KFFC animated radar loop" : "NOAA/NWS composite reflectivity"}</span><span>{radarLoop ? "Peachtree City radar · Athens coverage" : "Pan, zoom, or expand"}</span></div>
        </article>

        <aside className="quick-data" aria-label="Quick weather reference">
          {weatherError && <div><strong className="alert">Live data unavailable</strong><span>{weatherError}</span></div>}
          {!liveWeather && !weatherError && <div><strong>Loading Athens weather…</strong><span>Contacting the National Weather Service</span></div>}
          {liveWeather && <><div><strong>{liveWeather.observation.temperatureF ?? "—"}°F · {liveWeather.observation.description}</strong><span>Dew point {liveWeather.observation.dewpointF ?? "—"}°F · {liveWeather.observation.windDirection ?? "—"} {liveWeather.observation.windMph ?? "—"} mph</span></div>
          {liveWeather.forecast && <div><strong>NWS {liveWeather.forecast.period}: {liveWeather.forecast.shortForecast}</strong><span>{liveWeather.forecast.temperature}°{liveWeather.forecast.temperatureUnit} · {liveWeather.forecast.precipitationChance ?? 0}% rain chance</span></div>}
          <div><strong>{liveWeather.alerts[0] ? liveWeather.alerts[0].event : "No active NWS alerts"}</strong><span>{liveWeather.alerts[0]?.headline ?? "No watches, warnings, or advisories reported for this point."}</span></div>
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

      {activeSection === "forecast" && <section className="workspace-card">
        <div className="section-heading"><div><h2>Tuesday forecast</h2><p>Create separate forecasts for the day and night periods.</p></div><span>Draft</span></div>
        <form onSubmit={saveForecast}>
          <fieldset className="forecast-period"><legend>Tuesday day <small>7 AM–7 PM</small></legend><div className="forecast-fields">
            <label>High temperature<input name="day-high" defaultValue="86" inputMode="numeric" /></label>
            <label>Conditions<select name="day-conditions" defaultValue="storms"><option value="sunny">Mostly sunny</option><option value="storms">Partly cloudy; scattered storms</option><option value="cloudy">Cloudy</option></select></label>
            <label>Rain chance<input name="day-rain-chance" defaultValue="60%" /></label>
            <label>Likely timing<input name="day-timing" defaultValue="3–8 PM" /></label>
            <label>Wind<input defaultValue="SW 8–12 mph; gusts 20" /></label>
            <label>Confidence<select defaultValue="moderate"><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<input name="day-hazards" defaultValue="Scattered thunderstorms; brief heavy rain" /></label>
            <label className="wide-field">Day reasoning<textarea defaultValue="Morning clouds should limit heating somewhat, but surface moisture and an approaching boundary support scattered afternoon thunderstorms." /></label>
          </div></fieldset>
          <fieldset className="forecast-period"><legend>Tuesday night <small>7 PM–7 AM</small></legend><div className="forecast-fields">
            <label>Low temperature<input name="night-low" defaultValue="68" inputMode="numeric" /></label>
            <label>Conditions<select name="night-conditions" defaultValue="showers"><option value="showers">Partly cloudy; isolated shower early</option><option value="clear">Mostly clear</option><option value="cloudy">Cloudy</option></select></label>
            <label>Rain chance<input name="night-rain-chance" defaultValue="20%" /></label>
            <label>Likely timing<input name="night-timing" defaultValue="Before 10 PM" /></label>
            <label>Wind<input defaultValue="W 4–8 mph" /></label>
            <label>Confidence<select defaultValue="moderate"><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<input name="night-hazards" defaultValue="Patchy fog near daybreak" /></label>
            <label className="wide-field">Night reasoning<textarea defaultValue="Convection should diminish after sunset as instability weakens. Residual low-level moisture may support patchy fog in sheltered valleys toward morning." /></label>
          </div></fieldset>
          <div className="form-actions"><span>{saveMessage}</span><button type="submit">Save forecast draft</button></div>
        </form>
      </section>}

      {activeSection === "verify" && <section className="workspace-card">
        {selectedArchive ? <><div className="section-heading"><div><h2>Saved forecast · {selectedArchive.label}</h2><p>Athens, GA · saved {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(selectedArchive.savedAt))}</p></div><div className="verification-score"><strong>Pending</strong><span>verification</span></div></div>
        <div className="verification-grid"><div><h3>Day · 7 AM–7 PM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>Saved guidance</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>{selectedArchive.day.high}°F</td><td>{selectedArchive.evidence.forecast}</td><td>Awaiting period end</td></tr><tr><td>Conditions</td><td>{selectedArchive.day.conditions}</td><td>Saved with forecast</td><td>Awaiting period end</td></tr><tr><td>Rain chance</td><td>{selectedArchive.day.rainChance}</td><td>Saved with forecast</td><td>Awaiting period end</td></tr><tr><td>Timing / hazards</td><td>{selectedArchive.day.timing} · {selectedArchive.day.hazards}</td><td>Saved with forecast</td><td>Awaiting period end</td></tr></tbody></table>
        <h3>Night · 7 PM–7 AM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>Saved guidance</th><th>Observed</th></tr></thead><tbody><tr><td>Low temperature</td><td>{selectedArchive.night.low}°F</td><td>Saved with forecast</td><td>Awaiting period end</td></tr><tr><td>Conditions</td><td>{selectedArchive.night.conditions}</td><td>Saved with forecast</td><td>Awaiting period end</td></tr><tr><td>Rain chance</td><td>{selectedArchive.night.rainChance}</td><td>Saved with forecast</td><td>Awaiting period end</td></tr><tr><td>Timing / hazards</td><td>{selectedArchive.night.timing} · {selectedArchive.night.hazards}</td><td>Saved with forecast</td><td>Awaiting period end</td></tr></tbody></table>
        <div className="verification-notes"><div><span>Observation snapshot</span><strong>Captured</strong><small>{selectedArchive.evidence.observation}</small></div><div><span>NWS guidance snapshot</span><strong>Captured</strong><small>{selectedArchive.evidence.forecast}</small></div><div><span>Alert snapshot</span><strong>Captured</strong><small>{selectedArchive.evidence.alerts}</small></div></div></div><aside className="history"><h3>Forecast history</h3><p>Open a saved forecast and its captured evidence.</p>{archives.map((archive) => <button key={archive.id} className={archive.id === selectedArchiveId ? "active" : ""} onClick={() => setSelectedArchiveId(archive.id)}>{archive.label} · Day + night<small>Live NWS observation, forecast, alerts</small></button>)}<button onClick={() => setSelectedArchiveId(null)}>Example · Jul 13<small>Sample verification layout</small></button></aside></div></>
        : <div className="verification-grid"><div><div className="section-heading"><div><h2>Verification · Monday, July 13</h2><p>Example forecast · Asheville Regional Airport</p></div><div className="verification-score"><strong>3 / 4</strong><span>metrics verified</span></div></div><h3>Day · 7 AM–7 PM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>NBM</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>85°F</td><td>83°F</td><td>84°F</td></tr><tr><td>Rain chance</td><td>70%</td><td>62%</td><td>Rain observed</td></tr><tr><td>Rain timing</td><td>4–7 PM</td><td>3–8 PM</td><td>5:12 PM</td></tr><tr><td>Thunderstorm risk</td><td>Scattered</td><td>Possible</td><td>One storm nearby</td></tr></tbody></table><div className="verification-notes"><div><span>Temperature error</span><strong>1°F</strong><small>Your forecast was closer</small></div><div><span>Timing error</span><strong>0:12</strong><small>Rain began 12 min later</small></div><div><span>Reflection</span><strong>Good call</strong><small>Storm coverage was limited</small></div></div></div><aside className="history"><h3>Forecast history</h3><p>Save a forecast to create an archive here.</p>{archives.map((archive) => <button key={archive.id} onClick={() => setSelectedArchiveId(archive.id)}>{archive.label} · Day + night<small>Live NWS observation, forecast, alerts</small></button>)}</aside></div>}
      </section>}
    </main>
  );
}
