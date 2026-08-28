// Shared Leaflet rendering for the WPC surface-fronts GeoJSON (/api/fronts) — used by the dedicated
// full-CONUS Fronts tab (src/app/fronts-map.tsx). Colored/dashed lines rather than true frontal
// glyphs (triangles/semicircles) deliberately, to keep this a real, useful v1 rather than a custom-
// Leaflet-plugin project; H/L labels for pressure centers match the convention every forecaster
// already reads off a broadcast surface map. Factored out of radar-map.tsx once fronts became their
// own tab instead of a radar overlay — see that commit for why.
export const FRONT_LINE_STYLE: Record<string, { color: string; weight: number; dashArray?: string }> = {
  cold: { color: "#2f6fed", weight: 3 },
  warm: { color: "#e0393e", weight: 3 },
  occluded: { color: "#b0348f", weight: 3 },
  stationary: { color: "#7d5ba6", weight: 3, dashArray: "9,6" },
  trough: { color: "#8a6d3b", weight: 2, dashArray: "4,5" },
};

export const FRONT_LABEL: Record<string, string> = {
  cold: "Cold front",
  warm: "Warm front",
  occluded: "Occluded front",
  stationary: "Stationary front",
  trough: "Surface trough",
};

export function createFrontsGeoJsonOptions(L: any) {
  return {
    style: (feature: any) => FRONT_LINE_STYLE[feature?.properties?.kind] ?? { color: "#526274", weight: 2 },
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
      const kind = feature?.properties?.kind;
      if (kind === "high" || kind === "low") {
        layer.bindTooltip(`${kind === "high" ? "High" : "Low"} pressure${feature?.properties?.pressureMb ? ` · ${feature.properties.pressureMb}mb` : ""}`, { direction: "top" });
      } else {
        layer.bindTooltip(FRONT_LABEL[kind] ?? "Surface feature", { className: "spc-outlook-tooltip", direction: "auto", sticky: true });
      }
    },
  };
}
