"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { L?: any }
}

const ATHENS = [33.9519, -83.3576] as const;

export default function RadarMap() {
  const mapElement = useRef<HTMLDivElement>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  useEffect(() => {
    if (window.L) setLeafletLoaded(true);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapElement.current || !window.L) return;

    const map = window.L.map(mapElement.current, { zoomControl: true }).setView(ATHENS, 8);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const radarLayer = window.L.tileLayer.wms("https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows", {
      layers: "conus_bref_qcd",
      format: "image/png",
      transparent: true,
      opacity: 0.72,
      version: "1.3.0",
      cache: Date.now(),
      attribution: 'Radar: <a href="https://www.weather.gov/gis/cloudgiswebservices">NOAA/NWS</a>',
    }).addTo(map);
    window.L.circleMarker(ATHENS, { color: "#18222f", fillColor: "#ffffff", fillOpacity: 1, weight: 2, radius: 6 })
      .bindPopup("Athens, Georgia")
      .addTo(map);

    const refreshTimer = window.setInterval(() => radarLayer.setParams({ cache: Date.now() }), 120000);
    return () => {
      window.clearInterval(refreshTimer);
      map.remove();
    };
  }, [leafletLoaded]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onReady={() => setLeafletLoaded(true)} />
      <div ref={mapElement} className="live-radar-map" aria-label="Live NOAA radar map centered on Athens, Georgia" />
    </>
  );
}
