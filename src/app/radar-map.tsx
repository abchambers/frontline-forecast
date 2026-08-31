"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { renderMrmsGridToDataUrl, renderVelocityGridToDataUrl, type MrmsBounds, type MrmsPoint } from "@/lib/mrms-render";

declare global {
  interface Window { L?: any }
}

type RadarStationSummary = { id: string; name: string; latitude: number; longitude: number };

// Reported alongside onSourceChange, only ever populated for the in-house NEXRAD path (the
// worker/fallback response already returns elevationDeg + time; the provider/IEM fallback has
// neither, since it's a mosaic, not a single-site elevation scan). Used to print the on-map
// product/tilt/time readout, RadarScope-style, instead of just the color-scale legend.
export type RadarFrameMeta = { elevationDeg: number | null; observedAt: string | null } | null;

type RadarMapProps = { opacity?: number; showReflectivity?: boolean; moment?: "reflectivity" | "velocity"; showAlerts?: boolean; showOutlook?: boolean; outlookDay?: 1 | 2; showSevereMarkers?: boolean; showStationPicker?: boolean; refreshToken?: number; recenterToken?: number; timelineTileUrl?: string | null; isCurrentFrame?: boolean; inHouseFrameTime?: string | null; forceProvider?: boolean; radarViewMode?: "mosaic" | "station"; theme?: "light" | "dark"; scrollZoom?: boolean; prefetchTileUrls?: string[]; prefetchNexradTimes?: string[]; location: { id: string; name: string; latitude: number; longitude: number; radarSite: string }; onSourceChange?: (source: "nexrad" | "mosaic" | "provider" | null) => void; onFrameMeta?: (meta: RadarFrameMeta) => void; onStationSelect?: (station: RadarStationSummary) => void; onMapClick?: () => void };

// Andrew, live (2026-08-26): CARTO stopped serving these keylessly — tiles still return a normal
// 200, but every one now has "API KEY REQUIRED" stamped across it (confirmed by downloading a live
// tile directly, not just guessing from the map looking off). Their own free tier is genuinely
// usable here: no account needed, key emailed instantly from https://carto.com/basemaps/apikey/
// (just an email + the site's domain + a one-line project description), 5 million tile requests/
// month fair use, and per their docs "you do not need to tell us in advance whether your project is
// commercial" — exceeding the limit gets a conversation about a paid plan, not a cutoff. Add the key
// to Vercel as NEXT_PUBLIC_CARTO_API_KEY (must be NEXT_PUBLIC_ since this file fetches tiles
// directly from the browser, not a server route) and this picks it up with no other code change.
const cartoApiKey = process.env.NEXT_PUBLIC_CARTO_API_KEY;
const cartoKeyParam = cartoApiKey ? `?key=${cartoApiKey}` : "";
const basemapTiles = {
  light: { url: `https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png${cartoKeyParam}`, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  dark: { url: `https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png${cartoKeyParam}`, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
};

export default function RadarMap({ opacity = 0.72, showReflectivity = true, moment = "reflectivity", showAlerts = true, showOutlook = false, outlookDay = 1, showSevereMarkers = false, showStationPicker = false, refreshToken = 0, recenterToken = 0, timelineTileUrl = null, isCurrentFrame = true, inHouseFrameTime = null, forceProvider = false, radarViewMode = "mosaic", theme = "light", scrollZoom = false, prefetchTileUrls, prefetchNexradTimes, location, onSourceChange, onFrameMeta, onStationSelect, onMapClick }: RadarMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const baseLayerRef = useRef<any>(null);
  const radarLayerRef = useRef<any>(null);
  const alertLayerRef = useRef<any>(null);
  const outlookLayerRef = useRef<any>(null);
  const severeMarkersLayerRef = useRef<any>(null);
  const stationPickerLayerRef = useRef<any>(null);
  // Cache of provider tile-layer instances, keyed by their URL template, kept mounted (hidden at
  // opacity 0) instead of destroyed on every frame swap. A Leaflet tile layer that's already been
  // added once has its tiles sitting in the browser's own HTTP cache; recreating the layer object
  // each frame change still meant Leaflet re-requesting every tile from scratch on this component's
  // first pass through the loop. Reusing the instance instead skips the redundant fetch entirely on
  // every subsequent visit to that frame — see the addProviderLayer/prefetch effect below.
  const providerLayerCacheRef = useRef<Map<string, any>>(new Map());
  // Mirrors providerLayerCacheRef's reasoning but for in-house NEXRAD past frames: without this,
  // every frame the timeline plays through re-fetches /api/radar/nexrad?...&time=... (and, on the
  // local-fallback path, re-renders the grid client-side) at the exact moment playback reaches it —
  // a real network round-trip stalling every single frame advance, which is the actual root cause of
  // "still not as smooth as RadarScope" even though the in-house rendering technique itself (a flat
  // imageOverlay, not a tile pyramid) is already the right shape. Keyed by the frame's own
  // `inHouseTime` string, which is safe to cache indefinitely: the worker's /frame endpoint already
  // marks that response `Cache-Control: immutable` since a specific past volume never changes.
  const nexradFrameCacheRef = useRef<Map<string, { imageDataUrl?: string; points?: MrmsPoint[]; bounds: MrmsBounds; step: number; elevationDeg?: number; time?: string }>>(new Map());
  // Tracks which radar-source credit string is currently registered on the map's attribution
  // control, managed explicitly in settle() below — see that comment for why this can't just be a
  // per-layer `attribution` option like the basemap uses.
  const radarAttributionRef = useRef<string | null>(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  // Only true for a station's FIRST radar layer (no previousLayer yet) — a refresh/timeline
  // change already has a visible frame underneath and fades the new one in, so a loading overlay
  // there would just flicker over a working map. This is specifically for the case a user reported
  // live: opening the dashboard shows a bare basemap with nothing indicating the radar is still
  // being fetched, which reads as broken rather than loading — especially since the worker+fallback
  // chain can legitimately take 10-30s. Reuses the same `.radar-loading` sweep animation already
  // built for the component-bundle loading state, so both loading moments look consistent.
  const [isDataLoading, setIsDataLoading] = useState(false);

  useEffect(() => {
    if (window.L) setLeafletLoaded(true);
  }, []);

  useEffect(() => {
    if (!leafletLoaded || !mapElement.current || !window.L) return;

    const coordinates = [location.latitude, location.longitude] as const;
    const map = window.L.map(mapElement.current, { zoomControl: false, scrollWheelZoom: scrollZoom }).setView(coordinates, 8);
    window.L.control.zoom({ position: "bottomleft" }).addTo(map);
    mapRef.current = map;
    window.L.circleMarker(coordinates, { color: "#18222f", fillColor: "#ffffff", fillOpacity: 1, weight: 2, radius: 6 })
      .bindPopup(`${location.name} · nearest radar ${location.radarSite}`)
      .addTo(map);
    // Click-to-pause (RadarScope convention): a plain click on the map background pauses whichever
    // timeline the parent has playing. Station-marker and popup clicks stop their own propagation
    // (see the station-picker effect below) so selecting a station doesn't also pause playback.
    map.on("click", () => onMapClickRef.current?.());

    return () => {
      baseLayerRef.current = null;
      radarLayerRef.current = null;
      alertLayerRef.current = null;
      outlookLayerRef.current = null;
      severeMarkersLayerRef.current = null;
      stationPickerLayerRef.current = null;
      providerLayerCacheRef.current.clear();
      nexradFrameCacheRef.current.clear();
      mapRef.current = null;
      map.remove();
    };
  }, [leafletLoaded, location, scrollZoom]);

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
    fetch(`/api/outlook?day=${outlookDay}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "SPC outlook overlay unavailable");
        if (!active || !mapRef.current || !window.L) return;
        outlookLayerRef.current = window.L.geoJSON(data, {
          style: (feature: any) => ({ color: feature?.properties?.stroke ?? "#c69000", fillColor: feature?.properties?.fill ?? "#c69000", fillOpacity: 0.35, weight: 1.5 }),
          onEachFeature: (feature: any, layer: any) => {
            const properties = feature?.properties ?? {};
            layer.bindTooltip(`Day ${outlookDay} · ${properties.LABEL2 ?? "Convective outlook"}`, { className: "spc-outlook-tooltip", direction: "auto", sticky: true });
          },
        }).addTo(mapRef.current);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [leafletLoaded, showOutlook, outlookDay, location]);

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
          .on("click", (event: any) => { window.L.DomEvent.stopPropagation(event); onStationSelectRef.current?.(station); })
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
  const onFrameMetaRef = useRef(onFrameMeta);
  useEffect(() => { onFrameMetaRef.current = onFrameMeta; }, [onFrameMeta]);

  // Bounded well above the ~12-frame timeline this ever actually sees — eviction is a safety net,
  // not a real limit in normal operation.
  const PROVIDER_CACHE_LIMIT = 16;
  function getOrCreateProviderLayer(url: string) {
    const cache = providerLayerCacheRef.current;
    const existing = cache.get(url);
    if (existing) return existing;
    const layer = window.L.tileLayer(url, {
      opacity: 0,
      // IEM's mosaic tiles are rendered from ~1km-resolution data, which stops adding real
      // detail past zoom 8. Leaflet keeps the user's closer map view by scaling that tile.
      maxNativeZoom: 8,
      maxZoom: 18,
      className: "radar-frame-layer",
      // No `attribution` option here on purpose — see radarAttributionRef below for why.
    });
    cache.set(url, layer);
    if (cache.size > PROVIDER_CACHE_LIMIT) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey) {
        const oldestLayer = cache.get(oldestKey);
        if (oldestLayer && oldestLayer !== radarLayerRef.current && mapRef.current) mapRef.current.removeLayer(oldestLayer);
        cache.delete(oldestKey);
      }
    }
    return layer;
  }

  // Warms every frame in the current timeline into the tile cache above as soon as the frame list
  // is known — not just the one frame currently on screen — so Play doesn't stutter through a wave
  // of first-time tile fetches (same "choppy on first play, smooth on repeat" symptom the satellite
  // Image-preload fix addressed; tile layers just need this per-layer form instead of a plain
  // `new Image()` since a frame here is a grid of tiles, not one file).
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L || !prefetchTileUrls?.length) return;
    for (const url of prefetchTileUrls) {
      if (providerLayerCacheRef.current.has(url)) continue;
      const layer = getOrCreateProviderLayer(url);
      if (mapRef.current && !mapRef.current.hasLayer(layer)) layer.addTo(mapRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletLoaded, prefetchTileUrls?.join("|")]);

  // Same "load the whole loop before Play, not frame-by-frame during Play" idea as the provider-tile
  // prefetch above, applied to in-house NEXRAD past frames. Fires all requests in parallel up front
  // (COD's own site preloads its ~24 GIF frames the same way before animating) so by the time
  // playback or scrubbing reaches a given past frame, addGridLayer below can paint it from
  // nexradFrameCacheRef instantly instead of waiting on a live fetch.
  const NEXRAD_FRAME_CACHE_LIMIT = 16;
  useEffect(() => {
    if (!leafletLoaded || !prefetchNexradTimes?.length) return;
    let active = true;
    for (const time of prefetchNexradTimes) {
      if (nexradFrameCacheRef.current.has(time)) continue;
      fetch(`/api/radar/nexrad?station=${location.radarSite}&time=${encodeURIComponent(time)}`)
        .then(async (response) => {
          if (!active || !response.ok) return;
          const data = await response.json();
          const cache = nexradFrameCacheRef.current;
          cache.set(time, data);
          if (cache.size > NEXRAD_FRAME_CACHE_LIMIT) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey) cache.delete(oldestKey);
          }
        })
        .catch(() => undefined);
    }
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletLoaded, location.radarSite, prefetchNexradTimes?.join("|")]);

  useEffect(() => {
    if (!leafletLoaded || !mapRef.current || !window.L) return;
    if (!showReflectivity) {
      if (radarLayerRef.current) mapRef.current.removeLayer(radarLayerRef.current);
      radarLayerRef.current = null;
      onSourceChangeRef.current?.(null);
      onFrameMetaRef.current?.(null);
      return;
    }
    let cancelled = false;
    // Add the next frame at opacity 0 and fade it in once it's ready, rather than removing the
    // previous frame immediately — avoids a flash to the bare basemap between frames.
    const previousLayer = radarLayerRef.current;
    if (!previousLayer) setIsDataLoading(true);
    let settled = false;
    // Andrew, live (2026-08-27): this used to be a real 300ms crossfade (globals.css gave
    // .leaflet-tile/.leaflet-image-layer a .25s opacity transition) — removed for radar frames
    // specifically via the "radar-frame-layer" className (see globals.css) since cross-fading
    // hard-banded categorical data between two different storm positions reads as ghosting/flicker,
    // not smooth motion. setOpacity below is now an instant hard cut for radar layers. The delay
    // before actually removeLayer-ing the old one is just cleanup bookkeeping now (the old layer is
    // already invisible the instant the new one settles) — kept short rather than zero only so a
    // stray render in flight has no chance to touch a layer that's mid-removal.
    const CROSSFADE_MS = 50;
    const settle = (nextLayer: any, source: "nexrad" | "mosaic" | "provider", meta: RadarFrameMeta = null) => {
      if (settled || cancelled) return;
      settled = true;
      setIsDataLoading(false);
      nextLayer.setOpacity(opacityRef.current);
      radarLayerRef.current = nextLayer;
      if (previousLayer && mapRef.current) {
        previousLayer.setOpacity(0);
        window.setTimeout(() => { if (mapRef.current) mapRef.current.removeLayer(previousLayer); }, CROSSFADE_MS);
      }
      // Andrew, live (2026-08-27): "the credits at the bottom do not change" — a real bug caused by
      // this file's own tile-layer caching (providerLayerCacheRef): cached provider layers stay
      // mounted forever for instant reuse, so Leaflet's attribution control (which tracks credits
      // per currently-mounted layer) registers "Iowa Environmental Mesonet" once and then never lets
      // go of it, even while a completely different in-house-rendered layer is what's actually
      // visible on top. Managing the radar-source credit explicitly here — tied to what settle()
      // just confirmed is ACTUALLY showing, not to Leaflet's layer-mount bookkeeping — fixes it
      // regardless of caching. Every provider/WMS layer creation above deliberately omits its own
      // `attribution` option so this is the only thing that ever touches this specific credit.
      if (mapRef.current?.attributionControl) {
        const attributionControl = mapRef.current.attributionControl;
        const nextAttribution = source === "nexrad"
          ? "Radar: in-house NEXRAD Level II"
          : source === "mosaic"
            ? "Radar: in-house NEXRAD Level II (local mosaic)"
            : 'Radar: <a href="https://mesonet.agron.iastate.edu/" target="_blank">Iowa Environmental Mesonet</a>';
        if (radarAttributionRef.current !== nextAttribution) {
          if (radarAttributionRef.current) attributionControl.removeAttribution(radarAttributionRef.current);
          attributionControl.addAttribution(nextAttribution);
          radarAttributionRef.current = nextAttribution;
        }
      }
      onSourceChangeRef.current?.(source);
      onFrameMetaRef.current?.(meta);
    };

    function addProviderLayer() {
      if (!mapRef.current) return;
      if (!timelineTileUrl) {
        // Legacy WMS fallback — essentially never hit now that /api/radar/frames always sets a
        // tileUrl, so this stays uncached (a per-request cache-busted WMS layer isn't reusable
        // across frames the way a tile-template layer is).
        const nextLayer = window.L.tileLayer.wms("https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows", {
          layers: "conus_bref_qcd", format: "image/png", transparent: true, opacity: 0, version: "1.3.0", cache: Date.now() + refreshToken,
          className: "radar-frame-layer",
          // No `attribution` option here on purpose — see radarAttributionRef below for why.
        });
        nextLayer.addTo(mapRef.current);
        nextLayer.once("load", () => settle(nextLayer, "provider"));
        window.setTimeout(() => settle(nextLayer, "provider"), 700);
        return;
      }
      const nextLayer = getOrCreateProviderLayer(timelineTileUrl);
      const wasAlreadyMounted = mapRef.current.hasLayer(nextLayer);
      if (!wasAlreadyMounted) nextLayer.addTo(mapRef.current);
      const finish = () => settle(nextLayer, "provider");
      nextLayer.once("load", finish);
      // A reused/prefetched layer already has its tiles in place (mounted at opacity 0 since it was
      // created) — settle almost immediately rather than waiting out the full first-fetch window.
      window.setTimeout(finish, wasAlreadyMounted ? 60 : 700);
    }

    // The worker renders server-side and sends a ready PNG data URL directly
    // (imageDataUrl) — used almost always, since RADAR_WORKER_URL is set in
    // production. The Vercel route's own local fallback (only exercised if
    // the worker itself is unreachable) still returns raw {points, step} for
    // client-side rendering, at the coarser 0.01deg grid — both shapes are
    // handled here so a worker outage degrades gracefully rather than
    // breaking the map.
    function addGridLayer(
      data: { imageDataUrl?: string; points?: MrmsPoint[]; bounds: MrmsBounds; step: number; elevationDeg?: number; time?: string },
      source: "nexrad" | "mosaic",
      renderer: typeof renderMrmsGridToDataUrl,
    ) {
      const dataUrl = data.imageDataUrl ?? (data.points ? renderer(data.points, data.bounds, data.step) : null);
      if (!dataUrl || cancelled || !mapRef.current) throw new Error("Render failed");
      const bounds: [[number, number], [number, number]] = [[data.bounds.minLatitude, data.bounds.minLongitude], [data.bounds.maxLatitude, data.bounds.maxLongitude]];
      const nextLayer = window.L.imageOverlay(dataUrl, bounds, { opacity: 0, interactive: false, className: "radar-frame-layer" });
      nextLayer.addTo(mapRef.current);
      settle(nextLayer, source, { elevationDeg: data.elevationDeg ?? null, observedAt: data.time ?? null });
    }

    if (moment === "velocity") {
      // Velocity only exists via in-house NEXRAD — the IEM/NWS provider is reflectivity-only, so
      // there's no equivalent fallback source. On any failure this just clears the layer rather
      // than showing the wrong product.
      fetch(`/api/radar/nexrad?station=${location.radarSite}&moment=velocity`)
        .then(async (response) => {
          if (!response.ok) throw new Error("In-house velocity unavailable");
          const data = await response.json() as { imageDataUrl?: string; points?: MrmsPoint[]; bounds: MrmsBounds; step: number; elevationDeg?: number; time?: string };
          addGridLayer(data, "nexrad", renderVelocityGridToDataUrl);
        })
        .catch(() => {
          if (cancelled || !mapRef.current) return;
          setIsDataLoading(false);
          if (previousLayer) mapRef.current.removeLayer(previousLayer);
          radarLayerRef.current = null;
          onSourceChangeRef.current?.(null);
          onFrameMetaRef.current?.(null);
        });
    } else if (forceProvider) {
      // "IEM mosaic" channel preference — deliberately skips the in-house attempt entirely for
      // BOTH the live frame and past frames, rather than the "auto" default's in-house-first-with-
      // fallback. Velocity is exempt above: there's no provider equivalent for it at all, so the
      // preference has nothing to switch to and it stays in-house-only regardless.
      addProviderLayer();
    } else if (!isCurrentFrame) {
      // Scrubbed to a past position in the timeline loop. If the worker retained its own render for
      // this exact moment (see radar-worker/src/server.ts's frameHistory), prefer it — real in-house
      // data, same color table as "now" — over the coarser provider mosaic. `inHouseFrameTime` is
      // only ever set by the parent when /api/radar/frames found a matching retained frame; falls
      // back to the provider on any fetch failure or when no in-house frame exists for this slot,
      // same graceful-degradation pattern as the live-frame branch below.
      if (inHouseFrameTime) {
        const cached = nexradFrameCacheRef.current.get(inHouseFrameTime);
        if (cached) {
          try {
            addGridLayer(cached, "nexrad", renderMrmsGridToDataUrl);
          } catch {
            if (!cancelled) addProviderLayer();
          }
        } else {
          fetch(`/api/radar/nexrad?station=${location.radarSite}&time=${encodeURIComponent(inHouseFrameTime)}`)
            .then(async (response) => {
              if (!response.ok) throw new Error("In-house past frame unavailable");
              const data = await response.json() as { imageDataUrl?: string; points?: MrmsPoint[]; bounds: MrmsBounds; step: number; elevationDeg?: number; time?: string };
              nexradFrameCacheRef.current.set(inHouseFrameTime, data);
              addGridLayer(data, "nexrad", renderMrmsGridToDataUrl);
            })
            .catch(() => { if (!cancelled) addProviderLayer(); });
        }
      } else {
        addProviderLayer();
      }
    } else {
      // In-house NEXRAD Level II is the primary live source — free, real, per-station data,
      // rendered into a colored overlay client-side. Falls back directly to the IEM/NWS provider
      // WMS on any failure (station outage, decode error, network error — including a station
      // this app doesn't have verified in-house support for yet, since the picker lets you select
      // any of the 159 real WSR-88D sites), so an in-house radar issue never breaks the view, it
      // just quietly reverts to what was already working. No metered third-party API sits in
      // between anymore — see the in-house-nexrad-radar project notes for why GribStream was
      // dropped entirely rather than kept as a middle fallback.
      // Andrew's call 2026-08-31: the local mosaic (multi-station composite, radar-worker's
      // /mosaic) is now the default live view, not the single station. Tried FIRST here, ahead of
      // the single-station fetch below — on any failure (worker unreachable, cold-start too slow,
      // no coverage near this location) this falls through to the exact same single-station-then-
      // provider chain that already existed, unchanged. Deliberately scoped to the live/current
      // frame only — no scrubbable mosaic timeline exists yet, and won't fire for velocity (no
      // mosaic equivalent) or the "IEM mosaic" forced-provider preference (a different, existing
      // concept — an external national composite, not this app's own multi-station render).
      const tryMosaic = radarViewMode === "mosaic"
        ? fetch(`/api/radar/mosaic?station=${location.radarSite}`)
            .then(async (response) => {
              if (!response.ok) throw new Error("Local mosaic unavailable");
              const data = await response.json() as { imageDataUrl?: string; bounds: MrmsBounds; step: number; time?: string; stations?: string[] };
              // Dev-only visibility into which stations actually went into this composite — Andrew's
              // explicit ask, 2026-08-31: not a site feature, just a way to know what's being pulled
              // in while watching a real storm blend across station boundaries. console.log rather
              // than any UI element on purpose, since it's not meant to ship as a visible feature.
              if (data.stations?.length) console.log(`[local mosaic] stations: ${data.stations.join(", ")}`);
              addGridLayer(data, "mosaic", renderMrmsGridToDataUrl);
              return true;
            })
            .catch(() => false)
        : Promise.resolve(false);

      tryMosaic.then((mosaicSettled) => {
        if (mosaicSettled || cancelled) return;
        fetch(`/api/radar/nexrad?station=${location.radarSite}`)
          .then(async (response) => {
            if (!response.ok) throw new Error("In-house NEXRAD unavailable");
            const data = await response.json() as { imageDataUrl?: string; points?: MrmsPoint[]; bounds: MrmsBounds; step: number; elevationDeg?: number; time?: string };
            addGridLayer(data, "nexrad", renderMrmsGridToDataUrl);
          })
          .catch(() => { if (!cancelled) addProviderLayer(); });
      });
    }

    return () => { cancelled = true; };
  }, [leafletLoaded, showReflectivity, moment, refreshToken, timelineTileUrl, isCurrentFrame, inHouseFrameTime, forceProvider, radarViewMode, location]);

  return (
    <>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" strategy="afterInteractive" onReady={() => setLeafletLoaded(true)} />
      <div ref={mapElement} className="live-radar-map" aria-label={`Live NOAA radar map centered on ${location.name}`} />
      {isDataLoading && <div className="radar-loading radar-loading-overlay" role="status">Loading live radar…</div>}
    </>
  );
}
