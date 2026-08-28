// Parses WPC's live "Coded Surface Bulletin" (AFOS PIL CODSUS, WMO header ASUS02 KWBC — the
// high-resolution, 0.1°-precision variant) into GeoJSON. Verified against real live bulletin text
// before writing this: fetched via IEM's archive (mesonet.agron.iastate.edu/cgi-bin/afos/
// retrieve.py?pil=CODSUS&ttaaii=ASUS02&limit=1&order=desc&fmt=text — same IEM provider this app
// already depends on for radar tiles, no new vendor), decoded a sample by hand, and cross-checked
// the result against the same moment's standard-resolution sibling bulletin (ASUS01, whole-degree
// precision) to confirm the digit-group decode below lands on the same real-world location.
//
// Format (WPC's own "Reading the High-Resolution Coded Surface Bulletin" doc): every coordinate is
// a 7-digit group, first 3 digits = latitude in tenths of a degree N, last 4 = longitude in tenths
// of a degree W (the bulletin only ever covers the Northern/Western hemisphere, so no sign digit).
// HIGHS/LOWS lines interleave a pressure value (3-4 digits, whole mb) with a coordinate group per
// center; WARM/COLD/STNRY/OCFNT/TROF lines are each just a run of coordinate groups tracing one
// line segment — and the SAME keyword can appear multiple times in one bulletin for separate,
// unconnected segments (e.g. two distinct COLD fronts), each its own polyline, not a continuation.

export type FrontKind = "warm" | "cold" | "stationary" | "occluded" | "trough";
export type PressureKind = "high" | "low";

// Minimal local GeoJSON shape rather than pulling in @types/geojson for two field uses — this app
// only ever produces these two geometry types here and consumes them with Leaflet's own `any`-typed
// geoJSON() call, so a full spec-shaped dependency wouldn't buy anything.
export type WpcFeature =
  | { type: "Feature"; properties: { kind: PressureKind; pressureMb: number }; geometry: { type: "Point"; coordinates: [number, number] } }
  | { type: "Feature"; properties: { kind: FrontKind }; geometry: { type: "LineString"; coordinates: [number, number][] } };

export type WpcFrontsResult = {
  validTime: string | null;
  issuedAt: string | null;
  features: WpcFeature[];
};

const LINE_KEYWORDS: Record<string, FrontKind> = {
  WARM: "warm",
  COLD: "cold",
  STNRY: "stationary",
  OCFNT: "occluded",
  TROF: "trough",
};
const POINT_KEYWORDS: Record<string, PressureKind> = { HIGHS: "high", LOWS: "low" };
const ALL_KEYWORDS = new Set([...Object.keys(LINE_KEYWORDS), ...Object.keys(POINT_KEYWORDS)]);

const COORD_PATTERN = /^\d{7}$/;

function decodeCoord(token: string): [number, number] {
  const lat = Number(token.slice(0, 3)) / 10;
  const lon = -(Number(token.slice(3)) / 10);
  return [lon, lat]; // GeoJSON order: [longitude, latitude]
}

export function parseWpcSurfaceBulletin(raw: string): WpcFrontsResult {
  const validMatch = raw.match(/VALID\s+(\d{6}Z)/);
  // e.g. "631 PM EDT THU AUG 27 2026"
  const issuedMatch = raw.match(/^(\d{3,4}\s+[AP]M\s+[A-Z]{2,4}\s+[A-Z]{3}\s+[A-Z]{3}\s+\d{1,2}\s+\d{4})\s*$/m);

  // Tokenize everything after the VALID line, up to the "$$" sign-off, ignoring line breaks —
  // a single logical group of coordinates routinely wraps across physical text lines in the raw
  // product (see HIGHS in the module comment's own sample fetch).
  const bodyStart = raw.indexOf("VALID");
  const body = bodyStart === -1 ? raw : raw.slice(bodyStart);
  const signOffIndex = body.indexOf("$$");
  const tokens = (signOffIndex === -1 ? body : body.slice(0, signOffIndex))
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !/^\d{6}Z$/.test(token)); // drop the VALID timestamp token itself

  const features: WpcFeature[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!ALL_KEYWORDS.has(token)) { index += 1; continue; }
    index += 1;

    if (token in POINT_KEYWORDS) {
      const kind = POINT_KEYWORDS[token];
      while (index < tokens.length && !ALL_KEYWORDS.has(tokens[index])) {
        const pressureToken = tokens[index];
        const coordToken = tokens[index + 1];
        if (!coordToken || !COORD_PATTERN.test(coordToken)) break; // malformed pair — stop this run, keep whatever parsed so far
        const pressureMb = Number(pressureToken);
        if (!Number.isFinite(pressureMb)) break;
        features.push({
          type: "Feature",
          properties: { kind, pressureMb },
          geometry: { type: "Point", coordinates: decodeCoord(coordToken) },
        });
        index += 2;
      }
    } else {
      const kind = LINE_KEYWORDS[token];
      const coordinates: [number, number][] = [];
      while (index < tokens.length && COORD_PATTERN.test(tokens[index])) {
        coordinates.push(decodeCoord(tokens[index]));
        index += 1;
      }
      if (coordinates.length >= 2) {
        features.push({ type: "Feature", properties: { kind }, geometry: { type: "LineString", coordinates } });
      }
    }
  }

  return { validTime: validMatch?.[1] ?? null, issuedAt: issuedMatch?.[1]?.trim() ?? null, features };
}
