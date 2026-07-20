"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { L?: any }
}

const ATHENS = [33.9519, -83.3576] as const;

type RadarMapProps = { opacity?: number; showReflectivity?: boolean; refreshToken?: number; timelineTileUrl?: string | null };

export default function RadarMap({ opacity = 0.72, showReflectivity = true, refreshToken = 0, timelineTileUrl = null }: RadarMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const radarLayerRef = useRef<any>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  useEffect(() => {
    if (window.L) setLeafletLoaded(true);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapElement.current || !window.L) return;

    const map = window.L.map(mapElement.current, { zoomControl: true }).setView(ATHENS, 8);
    mapRef.current = map;
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    window.L.circleMarker(ATHENS, { color: "#18222f", fillColor: "#ffffff", fillOpacity: 1, weight: 2, radius: 6 })
      .bindPopup("Athens, Georgia")
      .addTo(map);

    return () => {
      radarLayerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [leafletLoaded]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (radarLayerRef.current) mapRef.current.removeLayer(radarLayerRef.current);
    if (!showReflectivity) { radarLayerRef.current = null; return; }
    radarLayerRef.current = timelineTileUrl
      ? window.L.tileLayer(timelineTileUrl, { opacity, attribution: 'Radar: <a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>' }).addTo(mapRef.current)
      : window.L.tileLayer.wms("https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows", {
        layers: "conus_bref_qcd", format: "image/png", transparent: true, opacity, version: "1.3.0", cache: Date.now() + refreshToken,
        attribution: 'Radar: <a href="https://www.weather.gov/gis/cloudgiswebservices">NOAA/NWS</a>',
      }).addTo(mapRef.current);
  }, [leafletLoaded, opacity, showReflectivity, refreshToken, timelineTileUrl]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onReady={() => setLeafletLoaded(true)} />
      <div ref={mapElement} className="live-radar-map" aria-label="Live NOAA radar map centered on Athens, Georgia" />
    </>
  );
}
