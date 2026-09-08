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

type UpperAirData = { validTime: string | null; levels: Record<string, string> };
type ModelUpperAirData = { time: string; bounds: { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number }; imageDataUrl: string };

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
function ModelUpperAirView() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlayRef = useRef<any>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [data, setData] = useState<ModelUpperAirData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (window.L) setLeafletLoaded(true);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapElement.current || !window.L) return;
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
  }, [leafletLoaded]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    let active = true;
    setStatus("loading");
    fetch("/api/upper-air-model")
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
  }, [leafletLoaded]);

  const validLabel = data?.time
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(data.time))
    : null;

  return (
    <>
      <div ref={mapElement} className="live-radar-map fronts-map" aria-label="500mb heights and relative vorticity, GFS model" />
      <div className="fronts-map-footer">
        <small>
          {status === "loading" && "Loading the 500mb model map…"}
          {status === "error" && "The in-house model map is unavailable right now."}
          {status === "ready" && `500mb Heights & Relative Vorticity · GFS${validLabel ? ` · valid ${validLabel}` : ""}`}
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
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" />
      <div className="radar-field-picker satellite-channel-picker upper-air-level-picker">
        <button type="button" className={mode === "model" ? "active" : ""} onClick={() => setMode("model")}>Model</button>
        <button type="button" className={mode === "observed" ? "active" : ""} onClick={() => setMode("observed")}>Observed</button>
      </div>
      {mode === "model" ? (
        <ModelUpperAirView />
      ) : (
        <>
          <div className="radar-field-picker satellite-channel-picker upper-air-level-picker">
            {LEVELS.map((entry) => <button type="button" key={entry.value} className={level === entry.value ? "active" : ""} onClick={() => setLevel(entry.value)}>{entry.label}</button>)}
          </div>
          <figure className="upper-air-view">
            {status === "ready" && data?.levels[level] && <img src={data.levels[level]} alt={`NWS ${activeLevel.label} upper-air observation chart: ${activeLevel.caption}`} />}
            {status === "loading" && <div className="radar-loading">Loading upper-air charts…</div>}
            {status === "error" && <div className="radar-loading">Upper-air charts are unavailable right now.</div>}
            <figcaption>{activeLevel.caption} · NWS Storm Prediction Center{validLabel ? ` · ${validLabel}` : ""}</figcaption>
          </figure>
        </>
      )}
    </>
  );
}
