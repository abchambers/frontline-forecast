// Shared Leaflet rendering for the WPC surface-fronts GeoJSON (/api/fronts) — used by the dedicated
// full-CONUS Fronts tab (src/app/fronts-map.tsx). H/L labels for pressure centers match the
// convention every forecaster already reads off a broadcast surface map. Factored out of
// radar-map.tsx once fronts became their own tab instead of a radar overlay — see that commit for
// why.
//
// Real triangle/semicircle glyphs (2026-09-08), not just colored/dashed lines — the pip polygons
// themselves are generated server-side (wpc-fronts.ts's generateFrontPips, real geography-based
// geometry) and arrive as ordinary Polygon features in the same GeoJSON; this file only needs to
// give them the right fill color. A stationary front's own line no longer needs a distinct dash
// pattern to read as "different" now that its alternating blue/red pips do that job the traditional
// way — kept subtle anyway since two real fronts overlapping (a stationary front re-analyzed as a
// front-generating boundary) is a real, if uncommon, occurrence.
export const FRONT_LINE_STYLE: Record<string, { color: string; weight: number; dashArray?: string }> = {
  cold: { color: "#2f6fed", weight: 2.5 },
  warm: { color: "#e0393e", weight: 2.5 },
  occluded: { color: "#b0348f", weight: 2.5 },
  stationary: { color: "#7d5ba6", weight: 2, dashArray: "9,6" },
  trough: { color: "#8a6d3b", weight: 2, dashArray: "4,5" },
};

// Pip fill color depends on which FRONT the pip belongs to, not just its own triangle/semicircle
// shape — an occluded front's pips are both purple regardless of shape, while a stationary front's
// alternate real blue/red (its two parent air masses' own colors), matching FRONT_LINE_STYLE's
// existing color choices so a pip never looks like it belongs to a different front than its line.
function pipFillColor(frontKind: string, pipKind: string): string {
  if (frontKind === "occluded") return FRONT_LINE_STYLE.occluded.color;
  if (frontKind === "stationary") return pipKind === "cold-pip" ? FRONT_LINE_STYLE.cold.color : FRONT_LINE_STYLE.warm.color;
  return pipKind === "cold-pip" ? FRONT_LINE_STYLE.cold.color : FRONT_LINE_STYLE.warm.color;
}

export const FRONT_LABEL: Record<string, string> = {
  cold: "Cold front",
  warm: "Warm front",
  occluded: "Occluded front",
  stationary: "Stationary front",
  trough: "Surface trough",
};

export function createFrontsGeoJsonOptions(L: any) {
  return {
    style: (feature: any) => {
      if (feature?.geometry?.type === "Polygon") {
        const color = pipFillColor(feature?.properties?.frontKind, feature?.properties?.kind);
        return { color, weight: 0, fillColor: color, fillOpacity: 1 };
      }
      return FRONT_LINE_STYLE[feature?.properties?.kind] ?? { color: "#526274", weight: 2 };
    },
    pointToLayer: (feature: any, latlng: any) => {
      const kind = feature?.properties?.kind === "high" ? "high" : "low";
      const pressureMb = feature?.properties?.pressureMb;
      return L.marker(latlng, {
        icon: L.divIcon({
          className: `wpc-pressure-marker wpc-pressure-marker-${kind}`,
          html: `<span class="wpc-pressure-letter">${kind === "high" ? "H" : "L"}</span><span class="wpc-pressure-value">${pressureMb ?? ""}</span>`,
          iconSize: [30, 34],
          iconAnchor: [15, 17],
        }),
      });
    },
    onEachFeature: (feature: any, layer: any) => {
      if (feature?.geometry?.type === "Polygon") return; // pips are purely decorative — the parent line already carries the tooltip
      const kind = feature?.properties?.kind;
      if (kind === "high" || kind === "low") {
        layer.bindTooltip(`${kind === "high" ? "High" : "Low"} pressure${feature?.properties?.pressureMb ? ` · ${feature.properties.pressureMb}mb` : ""}`, { direction: "top" });
      } else {
        layer.bindTooltip(FRONT_LABEL[kind] ?? "Surface feature", { className: "spc-outlook-tooltip", direction: "auto", sticky: true });
      }
    },
  };
}
