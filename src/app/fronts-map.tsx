"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { createFrontsGeoJsonOptions } from "@/lib/wpc-fronts-layer";

declare global {
  interface Window { L?: any }
}

// A dedicated, full-CONUS surface analysis view — deliberately its own tab rather than a checkbox
// on the local radar map (Andrew, live: "I dont think that throwing the frontal maps into a setting
// in the menu is the right call... it should be it's own option and a distinctly different
// product"). Always frames the whole continental US on load, independent of the user's own location,
// since fronts are a national-scale product, not something you scrub/zoom around a single station
// for. Reuses the exact fronts-rendering logic (colors, dash patterns, H/L markers) already built
// and shipped for the radar overlay — see wpc-fronts-layer.ts — just relocated and reframed.
const CONUS_BOUNDS: [[number, number], [number, number]] = [
  [24.5, -125.5],
  [49.8, -66.5],
];

type FrontsMeta = { validTime: string | null; issuedAt: string | null };

export default function FrontsMap() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const frontsLayerRef = useRef<any>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [meta, setMeta] = useState<FrontsMeta | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (window.L) setLeafletLoaded(true);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapElement.current || !window.L) return;
    const map = window.L.map(mapElement.current, { zoomControl: false, scrollWheelZoom: false });
    map.fitBounds(CONUS_BOUNDS);
    window.L.control.zoom({ position: "bottomleft" }).addTo(map);
    const tiles = window.L.tileLayer("https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 12,
    });
    tiles.addTo(map);
    mapRef.current = map;

    return () => {
      frontsLayerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [leafletLoaded]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    let active = true;
    setStatus("loading");
    fetch("/api/fronts")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "WPC surface analysis unavailable");
        if (!active || !mapRef.current || !window.L) return;
        if (frontsLayerRef.current) mapRef.current.removeLayer(frontsLayerRef.current);
        frontsLayerRef.current = window.L.geoJSON(data, createFrontsGeoJsonOptions(window.L)).addTo(mapRef.current);
        setMeta({ validTime: data.properties?.validTime ?? null, issuedAt: data.properties?.issuedAt ?? null });
        setStatus("ready");
      })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [leafletLoaded]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onReady={() => setLeafletLoaded(true)} />
      <div ref={mapElement} className="live-radar-map fronts-map" aria-label="WPC surface analysis: fronts, troughs, and pressure centers across the continental United States" />
      <div className="fronts-map-footer">
        <div className="fronts-legend">
          <span><i className="fronts-legend-swatch fronts-legend-cold" /> Cold front</span>
          <span><i className="fronts-legend-swatch fronts-legend-warm" /> Warm front</span>
          <span><i className="fronts-legend-swatch fronts-legend-stationary" /> Stationary front</span>
          <span><i className="fronts-legend-swatch fronts-legend-occluded" /> Occluded front</span>
          <span><i className="fronts-legend-swatch fronts-legend-trough" /> Surface trough</span>
        </div>
        <small>
          {status === "loading" && "Loading WPC surface analysis…"}
          {status === "error" && "WPC surface analysis is unavailable right now."}
          {status === "ready" && meta?.issuedAt && `NWS Weather Prediction Center · ${meta.issuedAt}${meta.validTime ? ` · valid ${meta.validTime}` : ""}`}
        </small>
      </div>
    </>
  );
}
