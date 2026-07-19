"use client";

import { useEffect, useState } from "react";

type DataPanel = "nbm" | "sounding" | "models";
type WorkspaceSection = "dashboard" | "forecast" | "verify";
type LiveWeather = {
  location: string;
  observation: { station: string; stationName: string; observedAt: string; description: string; temperatureF: number | null; dewpointF: number | null; windMph: number | null; windDirection: string | null };
  forecast: { period: string; temperature: number; temperatureUnit: string; shortForecast: string; detailedForecast: string; precipitationChance: number | null } | null;
  alerts: { event: string; headline: string | null }[];
  fetchedAt: string;
};

export default function Home() {
  const [dataPanel, setDataPanel] = useState<DataPanel>("nbm");
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("dashboard");
  const [radarExpanded, setRadarExpanded] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [liveWeather, setLiveWeather] = useState<LiveWeather | null>(null);
  const [weatherError, setWeatherError] = useState("");

  useEffect(() => {
    fetch("/api/weather")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load live data");
        setLiveWeather(data);
      })
      .catch((error: Error) => setWeatherError(error.message));
  }, []);

  const observedAt = liveWeather
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(liveWeather.observation.observedAt))
    : "Loading live NWS data…";

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
          <div className="card-heading"><div><h2>Radar</h2><p>Radar integration is next · current data is live</p></div><div className="actions"><button>Animate loop</button><button onClick={() => setRadarExpanded((value) => !value)}>{radarExpanded ? "Exit expanded view" : "Expand radar"}</button></div></div>
          <div className="radar" role="img" aria-label="Illustrative radar display centered on Athens, Georgia">
            <div className="ring ring-one" /><div className="ring ring-two" /><div className="crosshair horizontal" /><div className="crosshair vertical" /><div className="storm storm-one" /><div className="storm storm-two" /><div className="storm storm-three" />
            <div className="radar-label"><strong>Athens</strong><span>Illustrative radar preview</span></div>
          </div>
          <div className="card-footer"><span>Reflectivity preview</span><span>Live radar coming next</span></div>
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
        {dataPanel === "nbm" && <pre className="model-text">{`NBM 4.2 · KAVL · 2026-07-19 18Z
FHR    TMP  DPT  WDIR  WSPD  SKY  POP  QPF   TSTM
003     82   68   220     8   65   18  0.00    4
006     85   68   230    10   72   42  0.03   14
009     83   69   240     9   84   64  0.18   28
012     77   68   250     6   79   51  0.09   19

Guidance summary: scattered convection favored 3–8 PM; most likely rainfall remains light, but higher local totals are possible.`}</pre>}
        {dataPanel === "sounding" && <div className="sounding"><div className="skew" aria-label="Simplified sounding chart"><i className="temperature" /><i className="dewpoint" /><small>100 hPa</small><small>500 hPa</small><small>Surface</small></div><table><thead><tr><th>Pressure</th><th>Height</th><th>Temp</th><th>Dew point</th><th>Wind</th></tr></thead><tbody><tr><td>1000 hPa</td><td>610 m</td><td>23°C</td><td>19°C</td><td>220° / 8 kt</td></tr><tr><td>850 hPa</td><td>1,510 m</td><td>17°C</td><td>13°C</td><td>235° / 16 kt</td></tr><tr><td>700 hPa</td><td>3,090 m</td><td>7°C</td><td>1°C</td><td>245° / 23 kt</td></tr><tr><td>500 hPa</td><td>5,820 m</td><td>-8°C</td><td>-25°C</td><td>260° / 35 kt</td></tr></tbody></table></div>}
        {dataPanel === "models" && <p className="empty">Start with NBM and observed soundings. Future sources will appear here as timestamped, archivable panels so you can compare them without losing context.</p>}
      </section>
      </>}

      {activeSection === "forecast" && <section className="workspace-card">
        <div className="section-heading"><div><h2>Tuesday forecast</h2><p>Create separate forecasts for the day and night periods.</p></div><span>Draft</span></div>
        <form onSubmit={(event) => { event.preventDefault(); setSaveMessage("Forecast draft saved in this browser session."); }}>
          <fieldset className="forecast-period"><legend>Tuesday day <small>7 AM–7 PM</small></legend><div className="forecast-fields">
            <label>High temperature<input defaultValue="86" inputMode="numeric" /></label>
            <label>Conditions<select defaultValue="storms"><option value="sunny">Mostly sunny</option><option value="storms">Partly cloudy; scattered storms</option><option value="cloudy">Cloudy</option></select></label>
            <label>Rain chance<input defaultValue="60%" /></label>
            <label>Likely timing<input defaultValue="3–8 PM" /></label>
            <label>Wind<input defaultValue="SW 8–12 mph; gusts 20" /></label>
            <label>Confidence<select defaultValue="moderate"><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<input defaultValue="Scattered thunderstorms; brief heavy rain" /></label>
            <label className="wide-field">Day reasoning<textarea defaultValue="Morning clouds should limit heating somewhat, but surface moisture and an approaching boundary support scattered afternoon thunderstorms." /></label>
          </div></fieldset>
          <fieldset className="forecast-period"><legend>Tuesday night <small>7 PM–7 AM</small></legend><div className="forecast-fields">
            <label>Low temperature<input defaultValue="68" inputMode="numeric" /></label>
            <label>Conditions<select defaultValue="showers"><option value="showers">Partly cloudy; isolated shower early</option><option value="clear">Mostly clear</option><option value="cloudy">Cloudy</option></select></label>
            <label>Rain chance<input defaultValue="20%" /></label>
            <label>Likely timing<input defaultValue="Before 10 PM" /></label>
            <label>Wind<input defaultValue="W 4–8 mph" /></label>
            <label>Confidence<select defaultValue="moderate"><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option></select></label>
            <label className="wide-field">Hazards<input defaultValue="Patchy fog near daybreak" /></label>
            <label className="wide-field">Night reasoning<textarea defaultValue="Convection should diminish after sunset as instability weakens. Residual low-level moisture may support patchy fog in sheltered valleys toward morning." /></label>
          </div></fieldset>
          <div className="form-actions"><span>{saveMessage}</span><button type="submit">Save forecast draft</button></div>
        </form>
      </section>}

      {activeSection === "verify" && <section className="workspace-card">
        <div className="section-heading"><div><h2>Verification · Monday, July 13</h2><p>Asheville Regional Airport</p></div><div className="verification-score"><strong>3 / 4</strong><span>metrics verified</span></div></div>
        <div className="verification-grid"><div>
          <h3>Day · 7 AM–7 PM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>NBM</th><th>Observed</th></tr></thead><tbody><tr><td>High temperature</td><td>85°F</td><td>83°F</td><td>84°F</td></tr><tr><td>Rain chance</td><td>70%</td><td>62%</td><td>Rain observed</td></tr><tr><td>Rain timing</td><td>4–7 PM</td><td>3–8 PM</td><td>5:12 PM</td></tr><tr><td>Thunderstorm risk</td><td>Scattered</td><td>Possible</td><td>One storm nearby</td></tr></tbody></table>
          <h3>Night · 7 PM–7 AM</h3><table><thead><tr><th>Metric</th><th>Your forecast</th><th>NBM</th><th>Observed</th></tr></thead><tbody><tr><td>Low temperature</td><td>68°F</td><td>67°F</td><td>67°F</td></tr><tr><td>Rain chance</td><td>20%</td><td>24%</td><td>Dry after 8 PM</td></tr><tr><td>Fog risk</td><td>Patchy</td><td>Patchy</td><td>Patchy fog 5–7 AM</td></tr></tbody></table>
          <div className="verification-notes"><div><span>Temperature error</span><strong>1°F</strong><small>Your forecast was closer</small></div><div><span>Timing error</span><strong>0:12</strong><small>Rain began 12 min later</small></div><div><span>Reflection</span><strong>Good call</strong><small>Storm coverage was limited</small></div></div>
        </div><aside className="history"><h3>Forecast history</h3><p>Open a saved forecast and its archived evidence.</p><button className="active">Jul 13 · Day + night<small>Archived radar, NBM, sounding</small></button><button>Jul 12 · Day + night<small>Archived NBM, sounding</small></button><button>Jul 11 · Day + night<small>Archived radar, NBM</small></button></aside></div>
      </section>}
    </main>
  );
}
