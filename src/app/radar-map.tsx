"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { L?: any }
}

type RadarMapProps = { opacity?: number; showReflectivity?: boolean; refreshToken?: number; timelineTileUrl?: string | null; location: { id: string; name: string; latitude: number; longitude: number; radarSite: string } };

export default function RadarMap({ opacity = 0.72, showReflectivity = true, refreshToken = 0, timelineTileUrl = null, location }: RadarMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const radarLayerRef = useRef<any>(null);
  const weatherLayerRef = useRef<any>(null);
  const alertLayerRef = useRef<any>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  useEffect(() => {
    if (window.L) setLeafletLoaded(true);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapElement.current || !window.L) return;

    const coordinates = [location.latitude, location.longitude] as const;
    const map = window.L.map(mapElement.current, { zoomControl: true }).setView(coordinates, 8);
    mapRef.current = map;
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    window.L.circleMarker(coordinates, { color: "#18222f", fillColor: "#ffffff", fillOpacity: 1, weight: 2, radius: 6 })
      .bindPopup(`${location.name} · nearest radar ${location.radarSite}`)
      .addTo(map);

    return () => {
      radarLayerRef.current = null;
      weatherLayerRef.current = null;
      alertLayerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [leafletLoaded, location]);

  useEffect(() => {
    const update = (event: Event) => setAlertsEnabled(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("weather-desk-alert-overlay", update);
    return () => window.removeEventListener("weather-desk-alert-overlay", update);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (alertLayerRef.current) mapRef.current.removeLayer(alertLayerRef.current);
    alertLayerRef.current = null;
    if (!alertsEnabled) return;
    let active = true;
    fetch(`/api/alerts?location=${encodeURIComponent(location.id)}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "NWS alert overlay unavailable");
        if (!active || !mapRef.current || !window.L) return;
        const colorFor = (severity: string | undefined) => ({ Extreme: "#b71c1c", Severe: "#d95f02", Moderate: "#c69000", Minor: "#2667b8" }[severity ?? ""] ?? "#526274");
        alertLayerRef.current = window.L.geoJSON(data, {
          style: (feature: any) => ({ color: colorFor(feature?.properties?.severity), fillColor: colorFor(feature?.properties?.severity), fillOpacity: 0.15, weight: 2 }),
          onEachFeature: (feature: any, layer: any) => {
            const properties = feature?.properties ?? {};
            layer.bindTooltip(`${properties.event ?? "NWS alert"}${properties.headline ? ` · ${properties.headline}` : ""}`, { className: "nws-alert-tooltip", direction: "auto", sticky: true });
          },
        }).addTo(mapRef.current);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [leafletLoaded, alertsEnabled, location.id]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (radarLayerRef.current) mapRef.current.removeLayer(radarLayerRef.current);
    if (!showReflectivity) { radarLayerRef.current = null; return; }
    radarLayerRef.current = timelineTileUrl
      ? window.L.tileLayer(timelineTileUrl, {
        opacity,
        // RainViewer publishes radar tiles through zoom 7. Leaflet can keep
        // the user's closer map view by scaling the nearest supported tile.
        maxNativeZoom: 7,
        maxZoom: 18,
        attribution: 'Radar: <a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>',
      }).addTo(mapRef.current)
      : window.L.tileLayer.wms("https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows", {
        layers: "conus_bref_qcd", format: "image/png", transparent: true, opacity, version: "1.3.0", cache: Date.now() + refreshToken,
        attribution: 'Radar: <a href="https://www.weather.gov/gis/cloudgiswebservices">NOAA/NWS</a>',
      }).addTo(mapRef.current);
  }, [leafletLoaded, opacity, showReflectivity, refreshToken, timelineTileUrl]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    const updateWeatherLayer = (event: Event) => {
      const layer = (event as CustomEvent<string>).detail ?? "none";
      if (weatherLayerRef.current) mapRef.current.removeLayer(weatherLayerRef.current);
      weatherLayerRef.current = null;
      if (layer === "none") return;
      weatherLayerRef.current = window.L.tileLayer(`/api/radar/openweather/${layer}/{z}/{x}/{y}`, {
        opacity: 0.55,
        maxZoom: 18,
        attribution: 'Weather layers: <a href="https://openweathermap.org/" target="_blank">OpenWeather</a>',
      }).addTo(mapRef.current);
    };
    window.addEventListener("weather-desk-radar-layer", updateWeatherLayer);
    return () => window.removeEventListener("weather-desk-radar-layer", updateWeatherLayer);
  }, [leafletLoaded]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onReady={() => setLeafletLoaded(true)} />
      <div ref={mapElement} className="live-radar-map" aria-label={`Live NOAA radar map centered on ${location.name}`} />
    </>
  );
}
