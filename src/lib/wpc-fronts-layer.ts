// Shared Leaflet rendering for the WPC surface-fronts GeoJSON (/api/fronts) — used by the dedicated
// full-CONUS Fronts tab (src/app/fronts-map.tsx). H/L labels for pressure centers match the
// convention every forecaster already reads off a broadcast surface map. Factored out of
// radar-map.tsx once fronts became their own tab instead of a radar overlay — see that commit for
// why.
//
// Real triangle/semicircle glyphs (2026-09-08, fixed 2026-09-15 to render at a constant pixel size
// instead of true geography) — the pip points themselves are placed server-side (wpc-fronts.ts's
// generateFrontPips, real geography-based spacing/orientation) and arrive as Point features with a
// kind + bearingDeg in the same GeoJSON; this file draws each one as a small rotated CSS glyph via
// pointToLayer, matching how WPC's own chart keeps its symbols legible at any zoom instead of
// shrinking to sub-pixel at the map's normal whole-CONUS view. A stationary front's own line no
// longer needs a distinct dash pattern to read as "different" now that its alternating blue/red
// pips do that job the traditional way — kept subtle anyway since two real fronts overlapping (a
// stationary front re-analyzed as a front-generating boundary) is a real, if uncommon, occurrence.
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

const PIP_KINDS = new Set(["cold-pip", "warm-pip"]);

export function createFrontsGeoJsonOptions(L: any) {
  return {
    style: (feature: any) => {
      return FRONT_LINE_STYLE[feature?.properties?.kind] ?? { color: "#526274", weight: 2 };
    },
    pointToLayer: (feature: any, latlng: any) => {
      const kind = feature?.properties?.kind;
      if (PIP_KINDS.has(kind)) {
        const color = pipFillColor(feature?.properties?.frontKind, kind);
        const bearingDeg = feature?.properties?.bearingDeg ?? 0;
        const isTriangle = kind === "cold-pip";
        const shapeClass = isTriangle ? "wpc-pip-triangle" : "wpc-pip-semicircle";
        // Glyph is drawn pointing "up" (north, bearing 0) with its flat edge at the bottom, then
        // rotated by the real outward bearing — CSS rotate() is already clockwise-from-top, the same
        // convention as a compass bearing, so no angle conversion is needed. transform-origin sits at
        // the bottom-center of the box (see CSS) so the anchor point stays fixed on the front line
        // while the glyph swings around it.
        const iconSize: [number, number] = isTriangle ? [14, 12] : [14, 7];
        const iconAnchor: [number, number] = isTriangle ? [7, 12] : [7, 7];
        return L.marker(latlng, {
          icon: L.divIcon({
            className: "wpc-pip",
            html: `<span class="${shapeClass}" style="background:${color};transform:rotate(${bearingDeg}deg)"></span>`,
            iconSize,
            iconAnchor,
          }),
          interactive: false,
        });
      }
      const pressureKind = kind === "high" ? "high" : "low";
      const pressureMb = feature?.properties?.pressureMb;
      return L.marker(latlng, {
        icon: L.divIcon({
          className: `wpc-pressure-marker wpc-pressure-marker-${pressureKind}`,
          html: `<span class="wpc-pressure-letter">${pressureKind === "high" ? "H" : "L"}</span><span class="wpc-pressure-value">${pressureMb ?? ""}</span>`,
          iconSize: [30, 34],
          iconAnchor: [15, 17],
        }),
      });
    },
    onEachFeature: (feature: any, layer: any) => {
      const kind = feature?.properties?.kind;
      if (PIP_KINDS.has(kind)) return; // pips are purely decorative — the parent line already carries the tooltip
      if (kind === "high" || kind === "low") {
        layer.bindTooltip(`${kind === "high" ? "High" : "Low"} pressure${feature?.properties?.pressureMb ? ` · ${feature.properties.pressureMb}mb` : ""}`, { direction: "top" });
      } else {
        layer.bindTooltip(FRONT_LABEL[kind] ?? "Surface feature", { className: "spc-outlook-tooltip", direction: "auto", sticky: true });
      }
    },
  };
}
