"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { L?: any }
}

// Real NWS upper-air observation charts (station plots + hand-analyzed contours from actual
// radiosonde/aircraft/satellite obs, not model output), same "own tab, distinct product" pattern
// just established for the fronts map rather than another radar overlay. 250mb is the conventional
// jet-stream level (isotachs); 500mb is the classic "heights" pattern (troughs/ridges) Andrew asked
// for alongside it — see /api/upper-air for why these come from SPC's twice-daily analysis rather
// than a model forecast.
const LEVELS = [
  { value: "250", label: "250 mb", caption: "Jet stream (isotachs)" },
  { value: "300", label: "300 mb", caption: "Upper-level wind" },
  { value: "500", label: "500 mb", caption: "Heights (troughs & ridges)" },
  { value: "700", label: "700 mb", caption: "Mid-level moisture" },
  { value: "850", label: "850 mb", caption: "Low-level temps & jet" },
  { value: "925", label: "925 mb", caption: "Near-surface flow" },
] as const;

// The model map's own legend, one per level -- matches radar-worker/src/upper-air.ts's own
// LEVEL_FIELD/color-band choices exactly (kept in sync by hand; both sides are small, stable
// tables). Andrew's real complaint: the map had no legend at all, so there was no way to read what
// the colored fill actually meant. Reuses the SAME .radar-legend/.radar-legend-scale CSS classes
// RadarLegendStrip already established (gradient swatch + hover-able bands + left/mid/right ticks)
// rather than inventing a new legend pattern for one more map.
type UpperAirLegend = { title: string; unit: string; gradient: string; bands: { label: string; description: string }[] };
const UPPER_AIR_LEGENDS: Record<(typeof LEVELS)[number]["value"], UpperAirLegend> = {
  "250": {
    title: "Isotachs (wind speed)", unit: "knots",
    gradient: "linear-gradient(90deg,transparent 0 20%,#afd7eb 20% 36%,#ebe178 36% 52%,#f0a550 52% 68%,#dc5a46 68% 84%,#a53ca5 84% 100%)",
    bands: [
      { label: "< 50", description: "Below the conventional jet-core threshold — left uncolored." },
      { label: "50-70", description: "Notable upper-level wind." },
      { label: "70-90", description: "Strong jet streak." },
      { label: "90-110", description: "Very strong jet streak." },
      { label: "110-130", description: "Extreme jet core." },
      { label: "130+", description: "Exceptional jet core." },
    ],
  },
  "300": {
    title: "Isotachs (wind speed)", unit: "knots",
    gradient: "linear-gradient(90deg,transparent 0 20%,#afd7eb 20% 36%,#ebe178 36% 52%,#f0a550 52% 68%,#dc5a46 68% 84%,#a53ca5 84% 100%)",
    bands: [
      { label: "< 50", description: "Below the conventional jet-core threshold — left uncolored." },
      { label: "50-70", description: "Notable upper-level wind." },
      { label: "70-90", description: "Strong jet streak." },
      { label: "90-110", description: "Very strong jet streak." },
      { label: "110-130", description: "Extreme jet core." },
      { label: "130+", description: "Exceptional jet core." },
    ],
  },
  "500": {
    title: "Relative vorticity", unit: "×10⁻⁵ s⁻¹",
    gradient: "linear-gradient(90deg,transparent 0 14%,#adebad 14% 28%,#e6e282 28% 42%,#f0b45a 42% 56%,#eb6e46 56% 70%,#cd3737 70% 84%,#961e82 84% 100%)",
    bands: [
      { label: "< 5", description: "Near-zero — left uncolored." },
      { label: "5-10", description: "Weak cyclonic turning." },
      { label: "10-15", description: "Moderate cyclonic turning." },
      { label: "15-20", description: "Strong cyclonic turning, often near a shortwave." },
      { label: "20-30", description: "Very strong — a real vort max." },
      { label: "30-40", description: "Intense vort max, often tropical or a deep low." },
      { label: "40+", description: "Extreme — a very deep, tight circulation." },
    ],
  },
  "700": {
    title: "Relative humidity", unit: "%",
    gradient: "linear-gradient(90deg,transparent 0 40%,#deecca 40% 52%,#b6dda2 52% 64%,#84c97a 64% 76%,#52ab5c 76% 88%,#2a843e 88% 100%)",
    bands: [
      { label: "< 40", description: "Dry air — left uncolored." },
      { label: "40-60", description: "Slightly moist." },
      { label: "60-70", description: "Moist — some lift/cloud potential." },
      { label: "70-80", description: "Quite moist." },
      { label: "80-90", description: "Very moist — good lift/precipitation support." },
      { label: "90+", description: "Saturated." },
    ],
  },
  "850": {
    title: "Temperature", unit: "°C",
    gradient: "linear-gradient(90deg,#5a32a5 0 12.5%,#4164cd 12.5% 25%,#5f9be6 25% 37.5%,#96cde1 37.5% 50%,#fae18c 50% 62.5%,#f8af5a 62.5% 75%,#eb7846 75% 87.5%,#cd3c3c 87.5% 100%)",
    bands: [
      { label: "< -20", description: "Very cold air mass." },
      { label: "-20 to -10", description: "Cold." },
      { label: "-10 to 0", description: "Cool, near/below freezing at this level." },
      { label: "0-10", description: "Mild." },
      { label: "10-20", description: "Warm." },
      { label: "20-25", description: "Quite warm." },
      { label: "25-30", description: "Hot." },
      { label: "30+", description: "Very hot air mass." },
    ],
  },
  "925": {
    title: "Isotachs (near-surface flow)", unit: "knots",
    gradient: "linear-gradient(90deg,transparent 0 33%,#afd7eb 33% 46%,#ebe178 46% 60%,#f0a550 60% 73%,#dc5a46 73% 86%,#a53ca5 86% 100%)",
    bands: [
      { label: "< 20", description: "Light near-surface flow — left uncolored." },
      { label: "20-30", description: "Breezy — a real, notable low-level flow." },
      { label: "30-40", description: "Strong low-level jet." },
      { label: "40-50", description: "Very strong low-level jet." },
      { label: "50-60", description: "Extreme low-level jet." },
      { label: "60+", description: "Exceptional — hurricane-force near the surface." },
    ],
  },
};

function UpperAirLegendStrip({ level }: { level: (typeof LEVELS)[number]["value"] }) {
  const legend = UPPER_AIR_LEGENDS[level];
  const [hoveredBand, setHoveredBand] = useState<{ label: string; description: string } | null>(null);
  return <div className="radar-legend radar-legend-inline" aria-label={`${legend.title} color scale`}>
    <span>{legend.title}</span>
    <div className="radar-legend-scale"><i style={{ background: legend.gradient }} />{legend.bands.map((band) => <button type="button" key={band.label} aria-label={`${band.label}: ${band.description}`} onBlur={() => setHoveredBand(null)} onFocus={() => setHoveredBand(band)} onMouseLeave={() => setHoveredBand(null)} onMouseEnter={() => setHoveredBand(band)} />)}</div>
    <div>{legend.bands.map((band) => <small key={band.label}>{band.label}</small>)}</div>
    <em>{hoveredBand ? `${hoveredBand.label} ${legend.unit} · ${hoveredBand.description}` : `${legend.unit} · hover a color band for guidance · black-on-white-halo lines are geopotential height contours (decameters)`}</em>
  </div>;
}

type UpperAirData = { validTime: string | null; levels: Record<string, string> };
type ModelUpperAirData = { time: string; bounds: { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number }; imageDataUrl: string; title?: string };

const CONUS_BOUNDS: [[number, number], [number, number]] = [
  [24.5, -125.5],
  [49.8, -66.5],
];
const cartoApiKey = process.env.NEXT_PUBLIC_CARTO_API_KEY;
const cartoKeyParam = cartoApiKey ? `?key=${cartoApiKey}` : "";

// The new "Model" mode, 2026-09-08: a real, in-house-rendered 500mb heights + relative vorticity
// map (radar-worker/src/upper-air.ts, real GFS/GRIB2 data) — the same "own real map, radar's
// visual style" upgrade the fronts tab got, as its own Leaflet map rather than a static image,
// since it carries real geographic bounds meant to be viewed as a map. Mirrors fronts-map.tsx's
// own minimal map-setup pattern rather than reusing radar-map.tsx's much larger timeline/station
// machinery, which this single-frame product has no use for.
function ModelUpperAirView({ level, leafletReady }: { level: string; leafletReady: boolean }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const [data, setData] = useState<ModelUpperAirData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!leafletReady || !mapElement.current || !window.L) return;
    const map = window.L.map(mapElement.current, { zoomControl: false, scrollWheelZoom: false });
    map.fitBounds(CONUS_BOUNDS);
    window.L.control.zoom({ position: "bottomleft" }).addTo(map);
    window.L.tileLayer(`https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png${cartoKeyParam}`, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 12,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      overlayRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [leafletReady]);

  useEffect(() => {
    if (!leafletReady || !mapRef.current || !window.L) return;
    let active = true;
    setStatus("loading");
    fetch(`/api/upper-air-model?level=${encodeURIComponent(level)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Model upper-air map unavailable");
        if (!active || !mapRef.current || !window.L) return;
        const bounds: [[number, number], [number, number]] = [
          [body.bounds.minLatitude, body.bounds.minLongitude],
          [body.bounds.maxLatitude, body.bounds.maxLongitude],
        ];
        if (overlayRef.current) mapRef.current.removeLayer(overlayRef.current);
        overlayRef.current = window.L.imageOverlay(body.imageDataUrl, bounds, { opacity: 0.9 }).addTo(mapRef.current);
        setData(body);
        setStatus("ready");
      })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [leafletReady, level]);

  const validLabel = data?.time
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(data.time))
    : null;

  return (
    <>
      <div ref={mapElement} className="live-radar-map fronts-map" aria-label={`${data?.title ?? "Upper-air"} model map`} />
      <UpperAirLegendStrip level={level as (typeof LEVELS)[number]["value"]} />
      <div className="fronts-map-footer">
        <small>
          {status === "loading" && "Loading the model map…"}
          {status === "error" && "The in-house model map is unavailable right now."}
          {status === "ready" && `${data?.title ?? "GFS model"}${validLabel ? ` · valid ${validLabel}` : ""}`}
        </small>
      </div>
    </>
  );
}

export default function UpperAirMap() {
  const [mode, setMode] = useState<"observed" | "model">("model");
  const [level, setLevel] = useState<(typeof LEVELS)[number]["value"]>("250");
  const [data, setData] = useState<UpperAirData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Real bug found live (2026-09-15): this used to check `window.L` exactly once on mount inside
  // ModelUpperAirView itself. If the Leaflet <Script> (loaded via strategy="afterInteractive")
  // hadn't finished executing by that exact moment -- a real race, not a rare one, on a fresh page
  // load -- `leafletLoaded` stayed false forever with nothing to ever recheck it, so the map (and
  // its zoom control) silently never initialized. Fixed the same way fronts-map.tsx's own Script
  // tag already correctly does it: driven by onReady (fires on load AND on every later remount,
  // unlike onLoad which only ever fires once per script tag for the whole app) instead of a one-
  // time guess at timing; the synchronous window.L check stays as a fallback for the case where the
  // script is already loaded before this effect even runs.
  const [leafletReady, setLeafletReady] = useState(false);
  useEffect(() => {
    if (window.L) setLeafletReady(true);
  }, []);

  useEffect(() => {
    if (mode !== "observed") return;
    let active = true;
    fetch("/api/upper-air")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Upper-air charts unavailable");
        if (!active) return;
        setData(body);
        setStatus("ready");
      })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [mode]);

  const validLabel = data?.validTime
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(data.validTime))
    : null;
  const activeLevel = LEVELS.find((entry) => entry.value === level)!;

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onReady={() => setLeafletReady(true)} />
      <div className="radar-field-picker satellite-channel-picker upper-air-level-picker">
        <button type="button" className={mode === "model" ? "active" : ""} onClick={() => setMode("model")}>Model</button>
        <button type="button" className={mode === "observed" ? "active" : ""} onClick={() => setMode("observed")}>Observed</button>
      </div>
      {/* One shared level picker for both modes, not a separate one per mode -- picking a level once
          and toggling Model/Observed compares the same level against itself, which is the real point
          of having both. Andrew's own critique of the old Model-only-does-500mb setup was exactly
          this: the Model side never offered the level choice the Observed side already had. */}
      <div className="radar-field-picker satellite-channel-picker upper-air-level-picker">
        {LEVELS.map((entry) => <button type="button" key={entry.value} className={level === entry.value ? "active" : ""} onClick={() => setLevel(entry.value)}>{entry.label}</button>)}
      </div>
      {mode === "model" ? (
        <ModelUpperAirView level={level} leafletReady={leafletReady} />
      ) : (
        <figure className="upper-air-view">
          {status === "ready" && data?.levels[level] && <img src={data.levels[level]} alt={`NWS ${activeLevel.label} upper-air observation chart: ${activeLevel.caption}`} />}
          {status === "loading" && <div className="radar-loading">Loading upper-air charts…</div>}
          {status === "error" && <div className="radar-loading">Upper-air charts are unavailable right now.</div>}
          <figcaption>{activeLevel.caption} · NWS Storm Prediction Center{validLabel ? ` · ${validLabel}` : ""}</figcaption>
        </figure>
      )}
    </>
  );
}
