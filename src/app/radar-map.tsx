"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { renderMrmsGridToDataUrl, type MrmsBounds, type MrmsPoint } from "@/lib/mrms-render";

declare global {
  interface Window { L?: any }
}

type RadarMapProps = { opacity?: number; showReflectivity?: boolean; showAlerts?: boolean; showOutlook?: boolean; refreshToken?: number; recenterToken?: number; timelineTileUrl?: string | null; isCurrentFrame?: boolean; theme?: "light" | "dark"; location: { id: string; name: string; latitude: number; longitude: number; radarSite: string }; onSourceChange?: (source: "nexrad" | "gribstream" | "provider" | null) => void };

const basemapTiles = {
  light: { url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  dark: { url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
};

export default function RadarMap({ opacity = 0.72, showReflectivity = true, showAlerts = true, showOutlook = false, refreshToken = 0, recenterToken = 0, timelineTileUrl = null, isCurrentFrame = true, theme = "light", location, onSourceChange }: RadarMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const baseLayerRef = useRef<any>(null);
  const radarLayerRef = useRef<any>(null);
  const alertLayerRef = useRef<any>(null);
  const outlookLayerRef = useRef<any>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  useEffect(() => {
    if (window.L) setLeafletLoaded(true);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapElement.current || !window.L) return;

    const coordinates = [location.latitude, location.longitude] as const;
    const map = window.L.map(mapElement.current, { zoomControl: false, scrollWheelZoom: false }).setView(coordinates, 8);
    window.L.control.zoom({ position: "bottomleft" }).addTo(map);
    mapRef.current = map;
    window.L.circleMarker(coordinates, { color: "#18222f", fillColor: "#ffffff", fillOpacity: 1, weight: 2, radius: 6 })
      .bindPopup(`${location.name} · nearest radar ${location.radarSite}`)
      .addTo(map);

    return () => {
      baseLayerRef.current = null;
      radarLayerRef.current = null;
      alertLayerRef.current = null;
      outlookLayerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [leafletLoaded, location]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (baseLayerRef.current) mapRef.current.removeLayer(baseLayerRef.current);
    const tiles = theme === "dark" ? basemapTiles.dark : basemapTiles.light;
    const nextBaseLayer = window.L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: 19 }).addTo(mapRef.current);
    nextBaseLayer.bringToBack();
    baseLayerRef.current = nextBaseLayer;
  }, [leafletLoaded, theme, location]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current) return;
    mapRef.current.setView([location.latitude, location.longitude], 8, { animate: true });
  }, [leafletLoaded, location.latitude, location.longitude, recenterToken]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (alertLayerRef.current) mapRef.current.removeLayer(alertLayerRef.current);
    alertLayerRef.current = null;
    if (!showAlerts) return;
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
  }, [leafletLoaded, showAlerts, location.id]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (outlookLayerRef.current) mapRef.current.removeLayer(outlookLayerRef.current);
    outlookLayerRef.current = null;
    if (!showOutlook) return;
    let active = true;
    fetch("/api/outlook")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "SPC outlook overlay unavailable");
        if (!active || !mapRef.current || !window.L) return;
        outlookLayerRef.current = window.L.geoJSON(data, {
          style: (feature: any) => ({ color: feature?.properties?.stroke ?? "#c69000", fillColor: feature?.properties?.fill ?? "#c69000", fillOpacity: 0.35, weight: 1.5 }),
          onEachFeature: (feature: any, layer: any) => {
            const properties = feature?.properties ?? {};
            layer.bindTooltip(`${properties.LABEL2 ?? "Convective outlook"}`, { className: "spc-outlook-tooltip", direction: "auto", sticky: true });
          },
        }).addTo(mapRef.current);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [leafletLoaded, showOutlook, location]);

  const opacityRef = useRef(opacity);
  useEffect(() => { opacityRef.current = opacity; radarLayerRef.current?.setOpacity(opacity); }, [opacity]);

  // Kept in a ref rather than the effect's dependency array on purpose: GribStream is metered, and
  // an inline arrow function prop (a new reference every render) would otherwise re-trigger a real
  // fetch on every parent re-render, not just on an actual location/frame change.
  const onSourceChangeRef = useRef(onSourceChange);
  useEffect(() => { onSourceChangeRef.current = onSourceChange; }, [onSourceChange]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (!showReflectivity) {
      if (radarLayerRef.current) mapRef.current.removeLayer(radarLayerRef.current);
      radarLayerRef.current = null;
      onSourceChangeRef.current?.(null);
      return;
    }
    let cancelled = false;
    // Add the next frame at opacity 0 and fade it in once it's ready, rather than removing the
    // previous frame immediately — avoids a flash to the bare basemap between frames.
    const previousLayer = radarLayerRef.current;
    let settled = false;
    const settle = (nextLayer: any, source: "nexrad" | "gribstream" | "provider") => {
      if (settled || cancelled) return;
      settled = true;
      nextLayer.setOpacity(opacityRef.current);
      radarLayerRef.current = nextLayer;
      if (previousLayer && mapRef.current) mapRef.current.removeLayer(previousLayer);
      onSourceChangeRef.current?.(source);
    };

    function addProviderLayer() {
      if (!mapRef.current) return;
      const nextLayer = timelineTileUrl
        ? window.L.tileLayer(timelineTileUrl, {
          opacity: 0,
          // IEM's mosaic tiles are rendered from ~1km-resolution data, which stops adding real
          // detail past zoom 8. Leaflet keeps the user's closer map view by scaling that tile.
          maxNativeZoom: 8,
          maxZoom: 18,
          attribution: 'Radar: <a href="https://mesonet.agron.iastate.edu/" target="_blank">Iowa Environmental Mesonet</a>',
        })
        : window.L.tileLayer.wms("https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows", {
          layers: "conus_bref_qcd", format: "image/png", transparent: true, opacity: 0, version: "1.3.0", cache: Date.now() + refreshToken,
          attribution: 'Radar: <a href="https://www.weather.gov/gis/cloudgiswebservices">NOAA/NWS</a>',
        });
      nextLayer.addTo(mapRef.current);
      nextLayer.once("load", () => settle(nextLayer, "provider"));
      window.setTimeout(() => settle(nextLayer, "provider"), 700);
    }

    // GribStream is the interim fallback while in-house NEXRAD coverage is still being verified
    // across locations — see the in-house-nexrad-radar project notes for why GribStream stopped
    // being the primary source (per-call metering doesn't scale evenly across schools or support
    // more than reflectivity without an ongoing bill; NEXRAD Level II/III data is free and
    // per-station instead).
    function addGribstreamLayer() {
      fetch(`/api/radar/gribstream?lat=${location.latitude}&lon=${location.longitude}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("GribStream unavailable");
          const data = await response.json() as { points: MrmsPoint[]; bounds: MrmsBounds; step: number };
          addGridLayer(data, "gribstream");
        })
        .catch(() => { if (!cancelled) addProviderLayer(); });
    }

    function addGridLayer(data: { points: MrmsPoint[]; bounds: MrmsBounds; step: number }, source: "nexrad" | "gribstream") {
      const dataUrl = renderMrmsGridToDataUrl(data.points, data.bounds, data.step);
      if (!dataUrl || cancelled || !mapRef.current) throw new Error("Render failed");
      const bounds: [[number, number], [number, number]] = [[data.bounds.minLatitude, data.bounds.minLongitude], [data.bounds.maxLatitude, data.bounds.maxLongitude]];
      const nextLayer = window.L.imageOverlay(dataUrl, bounds, { opacity: 0, interactive: false });
      nextLayer.addTo(mapRef.current);
      settle(nextLayer, source);
    }

    if (!isCurrentFrame) {
      // Scrubbed to a past position in the timeline loop — the current-moment sources below only
      // ever answer "what's happening right now," so historical frames stay on the provider mosaic.
      addProviderLayer();
    } else {
      // In-house NEXRAD Level II is the primary live source — free, real, per-station data,
      // rendered into a colored overlay client-side exactly like GribStream's payload was. Falls
      // back to GribStream, then to the provider WMS, on any failure (station outage, decode
      // error, network error), so an in-house radar issue never breaks the view, it just quietly
      // reverts to what was already working.
      fetch(`/api/radar/nexrad?station=${location.radarSite}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("In-house NEXRAD unavailable");
          const data = await response.json() as { points: MrmsPoint[]; bounds: MrmsBounds; step: number };
          addGridLayer(data, "nexrad");
        })
        .catch(() => { if (!cancelled) addGribstreamLayer(); });
    }

    return () => { cancelled = true; };
  }, [leafletLoaded, showReflectivity, refreshToken, timelineTileUrl, isCurrentFrame, location]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onReady={() => setLeafletLoaded(true)} />
      <div ref={mapElement} className="live-radar-map" aria-label={`Live NOAA radar map centered on ${location.name}`} />
    </>
  );
}
