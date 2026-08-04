"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { renderMrmsGridToDataUrl, renderVelocityGridToDataUrl, type MrmsBounds, type MrmsPoint } from "@/lib/mrms-render";

declare global {
  interface Window { L?: any }
}

type RadarStationSummary = { id: string; name: string; latitude: number; longitude: number };

type RadarMapProps = { opacity?: number; showReflectivity?: boolean; moment?: "reflectivity" | "velocity"; showAlerts?: boolean; showOutlook?: boolean; showSevereMarkers?: boolean; showStationPicker?: boolean; refreshToken?: number; recenterToken?: number; timelineTileUrl?: string | null; isCurrentFrame?: boolean; theme?: "light" | "dark"; location: { id: string; name: string; latitude: number; longitude: number; radarSite: string }; onSourceChange?: (source: "nexrad" | "provider" | null) => void; onStationSelect?: (station: RadarStationSummary) => void };

const basemapTiles = {
  light: { url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  dark: { url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
};

export default function RadarMap({ opacity = 0.72, showReflectivity = true, moment = "reflectivity", showAlerts = true, showOutlook = false, showSevereMarkers = false, showStationPicker = false, refreshToken = 0, recenterToken = 0, timelineTileUrl = null, isCurrentFrame = true, theme = "light", location, onSourceChange, onStationSelect }: RadarMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const baseLayerRef = useRef<any>(null);
  const radarLayerRef = useRef<any>(null);
  const alertLayerRef = useRef<any>(null);
  const outlookLayerRef = useRef<any>(null);
  const severeMarkersLayerRef = useRef<any>(null);
  const stationPickerLayerRef = useRef<any>(null);
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
      severeMarkersLayerRef.current = null;
      stationPickerLayerRef.current = null;
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

  // Level III severe-weather detection markers (storm tracks, hail, tornadic vortex signatures,
  // mesocyclones) — an additional overlay layer, same pattern as the NWS alerts layer above, not
  // part of the reflectivity/velocity source-selection logic below. An empty result is the normal
  // state (no active hail/rotation signature most of the time), not a failure.
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (severeMarkersLayerRef.current) mapRef.current.removeLayer(severeMarkersLayerRef.current);
    severeMarkersLayerRef.current = null;
    if (!showSevereMarkers) return;
    let active = true;
    fetch(`/api/radar/nexrad-severe?station=${location.radarSite}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Severe-weather markers unavailable");
        if (!active || !mapRef.current || !window.L) return;

        const group = window.L.layerGroup();
        for (const track of data.stormTracks ?? []) {
          window.L.circleMarker([track.lat, track.lon], { color: "#526274", fillColor: "#8fa1b3", fillOpacity: 0.9, weight: 1.5, radius: 5 })
            .bindTooltip(`Storm ${track.id}${track.movementDeg !== null ? ` · moving ${track.movementDeg}° at ${track.movementKts}kt` : ""}`, { direction: "auto" })
            .addTo(group);
          if (track.forecast?.length) {
            window.L.polyline([[track.lat, track.lon], ...track.forecast.map((p: { lat: number; lon: number }) => [p.lat, p.lon])], { color: "#8fa1b3", weight: 1, dashArray: "3,4", interactive: false }).addTo(group);
          }
        }
        for (const hail of data.hail ?? []) {
          window.L.circleMarker([hail.lat, hail.lon], { color: "#9b2678", fillColor: "#ff8027", fillOpacity: 0.9, weight: 2, radius: 7 })
            .bindTooltip(`Hail ${hail.id} · ${hail.maxSizeInches}in max · ${hail.probSevereHailPct}% severe probability`, { direction: "auto" })
            .addTo(group);
        }
        for (const tvs of data.tvs ?? []) {
          window.L.circleMarker([tvs.lat, tvs.lon], { color: "#7a0d0d", fillColor: "#ec3e32", fillOpacity: 0.95, weight: 2, radius: 8 })
            .bindTooltip(`TVS ${tvs.id} (${tvs.featureType}) · max shear height ${tvs.maxShearHeightKft}kft`, { direction: "auto" })
            .addTo(group);
        }
        for (const meso of data.mesocyclones ?? []) {
          window.L.circleMarker([meso.lat, meso.lon], { color: "#4a1a6b", fillColor: "#9b59d0", fillOpacity: 0.9, weight: 2, radius: 7 })
            .bindTooltip(`Mesocyclone ${meso.id}${meso.hasTvs ? " · TVS present" : ""}${meso.strengthIndex !== null ? ` · MSI ${meso.strengthIndex}` : ""}`, { direction: "auto" })
            .addTo(group);
        }
        group.addTo(mapRef.current);
        severeMarkersLayerRef.current = group;
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [leafletLoaded, showSevereMarkers, location.radarSite]);

  // Station picker (task #31, redesigned per explicit direction): stations
  // are picked by tapping a dot ON the map, not a text search — you can't
  // pick the wrong one if you can see where it actually is relative to you.
  // Selecting any of the 159 real WSR-88D sites is always safe even if this
  // app doesn't have verified in-house support for it yet — the existing
  // nexrad -> provider fallback chain (see the reflectivity/velocity effect
  // below) already handles that per-request, silently.
  const allStationsRef = useRef<RadarStationSummary[] | null>(null);
  const onStationSelectRef = useRef(onStationSelect);
  useEffect(() => { onStationSelectRef.current = onStationSelect; }, [onStationSelect]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (stationPickerLayerRef.current) mapRef.current.removeLayer(stationPickerLayerRef.current);
    stationPickerLayerRef.current = null;
    if (!showStationPicker) return;
    let active = true;
    const map = mapRef.current;

    function renderVisibleStations(stations: RadarStationSummary[]) {
      if (!active || !mapRef.current) return;
      if (stationPickerLayerRef.current) mapRef.current.removeLayer(stationPickerLayerRef.current);
      const bounds = map.getBounds();
      const group = window.L.layerGroup();
      for (const station of stations) {
        if (!bounds.contains([station.latitude, station.longitude])) continue;
        const isActive = station.id === location.radarSite;
        window.L.circleMarker([station.latitude, station.longitude], {
          color: isActive ? "#18222f" : "#2667b8",
          fillColor: isActive ? "#ffffff" : "#5b9bf0",
          fillOpacity: 0.95,
          weight: isActive ? 2 : 1.5,
          radius: isActive ? 7 : 5,
        })
          .bindTooltip(`${station.name} (${station.id})`, { direction: "auto" })
          .on("click", () => onStationSelectRef.current?.(station))
          .addTo(group);
      }
      group.addTo(mapRef.current);
      stationPickerLayerRef.current = group;
    }

    function loadAndRender() {
      if (allStationsRef.current) {
        renderVisibleStations(allStationsRef.current);
        return;
      }
      fetch("/api/radar/stations")
        .then((response) => response.json())
        .then((data) => {
          if (!active || !Array.isArray(data)) return;
          allStationsRef.current = data;
          renderVisibleStations(data);
        })
        .catch(() => undefined);
    }

    loadAndRender();
    map.on("moveend", loadAndRender);
    return () => { active = false; map.off("moveend", loadAndRender); };
  }, [leafletLoaded, showStationPicker, location.radarSite]);

  const opacityRef = useRef(opacity);
  useEffect(() => { opacityRef.current = opacity; radarLayerRef.current?.setOpacity(opacity); }, [opacity]);

  // Kept in a ref rather than the effect's dependency array on purpose: an inline arrow function
  // prop (a new reference every render) would otherwise re-trigger a real decode+fetch on every
  // parent re-render, not just on an actual location/frame change.
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
    const settle = (nextLayer: any, source: "nexrad" | "provider") => {
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

    function addGridLayer(data: { points: MrmsPoint[]; bounds: MrmsBounds; step: number }, source: "nexrad", renderer: typeof renderMrmsGridToDataUrl) {
      const dataUrl = renderer(data.points, data.bounds, data.step);
      if (!dataUrl || cancelled || !mapRef.current) throw new Error("Render failed");
      const bounds: [[number, number], [number, number]] = [[data.bounds.minLatitude, data.bounds.minLongitude], [data.bounds.maxLatitude, data.bounds.maxLongitude]];
      const nextLayer = window.L.imageOverlay(dataUrl, bounds, { opacity: 0, interactive: false });
      nextLayer.addTo(mapRef.current);
      settle(nextLayer, source);
    }

    if (moment === "velocity") {
      // Velocity only exists via in-house NEXRAD — the IEM/NWS provider is reflectivity-only, so
      // there's no equivalent fallback source. On any failure this just clears the layer rather
      // than showing the wrong product.
      fetch(`/api/radar/nexrad?station=${location.radarSite}&moment=velocity`)
        .then(async (response) => {
          if (!response.ok) throw new Error("In-house velocity unavailable");
          const data = await response.json() as { points: MrmsPoint[]; bounds: MrmsBounds; step: number };
          addGridLayer(data, "nexrad", renderVelocityGridToDataUrl);
        })
        .catch(() => {
          if (cancelled || !mapRef.current) return;
          if (previousLayer) mapRef.current.removeLayer(previousLayer);
          radarLayerRef.current = null;
          onSourceChangeRef.current?.(null);
        });
    } else if (!isCurrentFrame) {
      // Scrubbed to a past position in the timeline loop — the current-moment sources below only
      // ever answer "what's happening right now," so historical frames stay on the provider mosaic.
      addProviderLayer();
    } else {
      // In-house NEXRAD Level II is the primary live source — free, real, per-station data,
      // rendered into a colored overlay client-side. Falls back directly to the IEM/NWS provider
      // WMS on any failure (station outage, decode error, network error — including a station
      // this app doesn't have verified in-house support for yet, since the picker lets you select
      // any of the 159 real WSR-88D sites), so an in-house radar issue never breaks the view, it
      // just quietly reverts to what was already working. No metered third-party API sits in
      // between anymore — see the in-house-nexrad-radar project notes for why GribStream was
      // dropped entirely rather than kept as a middle fallback.
      fetch(`/api/radar/nexrad?station=${location.radarSite}`)
        .then(async (response) => {
          if (!response.ok) throw new Error("In-house NEXRAD unavailable");
          const data = await response.json() as { points: MrmsPoint[]; bounds: MrmsBounds; step: number };
          addGridLayer(data, "nexrad", renderMrmsGridToDataUrl);
        })
        .catch(() => { if (!cancelled) addProviderLayer(); });
    }

    return () => { cancelled = true; };
  }, [leafletLoaded, showReflectivity, moment, refreshToken, timelineTileUrl, isCurrentFrame, location]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onReady={() => setLeafletLoaded(true)} />
      <div ref={mapElement} className="live-radar-map" aria-label={`Live NOAA radar map centered on ${location.name}`} />
    </>
  );
}
