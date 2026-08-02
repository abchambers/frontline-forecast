"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { L?: any }
}

type RadarMapProps = { opacity?: number; showReflectivity?: boolean; weatherLayer?: string; showAlerts?: boolean; refreshToken?: number; recenterToken?: number; timelineTileUrl?: string | null; theme?: "light" | "dark"; location: { id: string; name: string; latitude: number; longitude: number; radarSite: string } };

const basemapTiles = {
  light: { url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  dark: { url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
};

const ndfdLayers: Record<string, string> = {
  ndfd_maxt: "ndfd.conus.maxt",
  ndfd_pop12: "ndfd.conus.pop12",
  ndfd_windspd: "ndfd.conus.windspd",
};

export default function RadarMap({ opacity = 0.72, showReflectivity = true, weatherLayer = "none", showAlerts = true, refreshToken = 0, recenterToken = 0, timelineTileUrl = null, theme = "light", location }: RadarMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const baseLayerRef = useRef<any>(null);
  const radarLayerRef = useRef<any>(null);
  const weatherLayerRef = useRef<any>(null);
  const alertLayerRef = useRef<any>(null);
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
      weatherLayerRef.current = null;
      alertLayerRef.current = null;
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
  }, [leafletLoaded, theme]);

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

  const opacityRef = useRef(opacity);
  useEffect(() => { opacityRef.current = opacity; radarLayerRef.current?.setOpacity(opacity); }, [opacity]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (!showReflectivity) {
      if (radarLayerRef.current) mapRef.current.removeLayer(radarLayerRef.current);
      radarLayerRef.current = null;
      return;
    }
    // Add the next frame at opacity 0 and fade it in once its tiles finish loading, rather than
    // removing the previous frame immediately — avoids a flash to the bare basemap between frames.
    const previousLayer = radarLayerRef.current;
    const nextLayer = timelineTileUrl
      ? window.L.tileLayer(timelineTileUrl, {
        opacity: 0,
        // RainViewer publishes radar tiles through zoom 7. Leaflet can keep
        // the user's closer map view by scaling the nearest supported tile.
        maxNativeZoom: 7,
        maxZoom: 18,
        attribution: 'Radar: <a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>',
      })
      : window.L.tileLayer.wms("https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows", {
        layers: "conus_bref_qcd", format: "image/png", transparent: true, opacity: 0, version: "1.3.0", cache: Date.now() + refreshToken,
        attribution: 'Radar: <a href="https://www.weather.gov/gis/cloudgiswebservices">NOAA/NWS</a>',
      });
    nextLayer.addTo(mapRef.current);
    radarLayerRef.current = nextLayer;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      nextLayer.setOpacity(opacityRef.current);
      if (previousLayer && mapRef.current) mapRef.current.removeLayer(previousLayer);
    };
    nextLayer.once("load", settle);
    const fallback = window.setTimeout(settle, 700);
    return () => window.clearTimeout(fallback);
  }, [leafletLoaded, showReflectivity, refreshToken, timelineTileUrl]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (weatherLayerRef.current) mapRef.current.removeLayer(weatherLayerRef.current);
    weatherLayerRef.current = null;
    if (weatherLayer === "none") return;
    if (ndfdLayers[weatherLayer]) {
      weatherLayerRef.current = window.L.tileLayer.wms("https://digital.weather.gov/ndfd.conus/wms", {
        layers: ndfdLayers[weatherLayer],
        format: "image/png",
        transparent: true,
        version: "1.3.0",
        // NOAA's NDFD WMS returns fully opaque tiles regardless of transparent=true (no alpha
        // channel), but Leaflet's layer-level opacity still blends the whole raster with the
        // basemap beneath it correctly — the earlier fix here forced near-full opacity on the
        // theory that partial opacity couldn't work, which just traded one bug (a washed-out
        // blend) for a worse one (an opaque wall of color hiding the map entirely). The
        // ndfd-layer className boosts saturation/contrast so the NWS's fairly pastel palette
        // still reads clearly at a real, user-controlled opacity.
        opacity,
        className: "ndfd-layer",
        maxZoom: 18,
        attribution: 'Forecast maps: <a href="https://digital.weather.gov/staticpages/mapservices.php" target="_blank">NOAA/NWS NDFD</a>',
      }).addTo(mapRef.current);
      return;
    }
    weatherLayerRef.current = window.L.tileLayer(`/api/radar/openweather/${weatherLayer}/{z}/{x}/{y}`, {
      opacity,
      maxZoom: 18,
      attribution: 'Weather layers: <a href="https://openweathermap.org/" target="_blank">OpenWeather</a>',
    }).addTo(mapRef.current);
  }, [leafletLoaded, opacity, weatherLayer]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onReady={() => setLeafletLoaded(true)} />
      <div ref={mapElement} className="live-radar-map" aria-label={`Live NOAA radar map centered on ${location.name}`} />
    </>
  );
}
