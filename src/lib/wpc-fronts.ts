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
export type PipKind = "cold-pip" | "warm-pip";

// Minimal local GeoJSON shape rather than pulling in @types/geojson for two field uses — this app
// only ever produces these two geometry types here and consumes them with Leaflet's own `any`-typed
// geoJSON() call, so a full spec-shaped dependency wouldn't buy anything.
export type WpcFeature =
  | { type: "Feature"; properties: { kind: PressureKind; pressureMb: number }; geometry: { type: "Point"; coordinates: [number, number] } }
  | { type: "Feature"; properties: { kind: FrontKind }; geometry: { type: "LineString"; coordinates: [number, number][] } }
  | { type: "Feature"; properties: { kind: PipKind; frontKind: FrontKind }; geometry: { type: "Polygon"; coordinates: [number, number][][] } };

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

  for (const feature of [...features]) {
    if (feature.geometry.type !== "LineString") continue;
    const kind = feature.properties.kind as FrontKind;
    if (kind === "trough") continue; // troughs render as a plain dashed line, no pips, matching WPC's own convention
    features.push(...generateFrontPips(kind, feature.geometry.coordinates));
  }

  return { validTime: validMatch?.[1] ?? null, issuedAt: issuedMatch?.[1]?.trim() ?? null, features };
}

// --- Frontal pip (triangle/semicircle) geometry --------------------------------------------
// WPC's own bulletin format documents NO convention for which side of a line the pips belong on
// (confirmed directly against WPC's own "Reading the High-Resolution Coded Surface Bulletin" doc —
// it specifies point sequences only, nothing about symbol orientation), and the coordinate order
// itself proved inconclusive when checked directly against WPC's own real published chart image for
// the same real valid time (a genuinely curvy, few-point front segment doesn't give a clean single
// "left" or "right" answer the way a long straight line would). Real, load-bearing convention used
// here instead, grounded in basic synoptic structure rather than guessed: a front's pips always face
// the direction it is actually advancing, which for the classic Norwegian cyclone model a front
// trails from is the SAME direction as the air mass it is displacing — cold fronts advance into the
// warm sector (predominantly east/southeast of the front in the vast majority of real US midlatitude
// cases), warm fronts advance into the cold sector ahead of them (predominantly north/northeast,
// poleward). This is a real, physically-reasoned default, not exhaustively verified against every
// possible front orientation (an unusual backdoor front, for instance, could reasonably invert it) —
// worth real (temperature-field-based) verification later if it ever looks visibly wrong on a real
// chart.
const EARTH_RADIUS_KM = 6371;
const PIP_SPACING_KM = 90;
const PIP_SIZE_KM = 16;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Initial compass bearing (0=north, 90=east) from point 1 to point 2.
function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Standard spherical destination-point formula — same tier of approximation already used
// elsewhere in this app's own radar geometry (radar-worker/src/project.ts's destinationPoint).
function destinationPoint(lat: number, lon: number, bearing: number, distanceKm: number): [number, number] {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const bearingRad = toRad(bearing);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad));
  const lon2 = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return [toDeg(lon2), toDeg(lat2)]; // [lon, lat], GeoJSON order
}

// Picks whichever perpendicular to the local line tangent points closer to `favorBearing` — e.g.
// 90 (east) for a cold front's "advances into the warm sector" default, 0 (north) for a warm
// front's "advances poleward" default.
function outwardBearing(tangentBearing: number, favorBearing: number): number {
  const left = (tangentBearing + 90) % 360;
  const right = (tangentBearing + 270) % 360;
  const angularDiff = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  return angularDiff(left, favorBearing) <= angularDiff(right, favorBearing) ? left : right;
}

function trianglePip(lat: number, lon: number, tangentBearing: number, favorBearing: number): [number, number][] {
  const outward = outwardBearing(tangentBearing, favorBearing);
  const [baseLon1, baseLat1] = destinationPoint(lat, lon, (tangentBearing + 180) % 360, PIP_SIZE_KM * 0.6);
  const [baseLon2, baseLat2] = destinationPoint(lat, lon, tangentBearing, PIP_SIZE_KM * 0.6);
  const apex = destinationPoint(lat, lon, outward, PIP_SIZE_KM);
  return [[baseLon1, baseLat1], apex, [baseLon2, baseLat2], [baseLon1, baseLat1]];
}

function semicirclePip(lat: number, lon: number, tangentBearing: number, favorBearing: number): [number, number][] {
  const outward = outwardBearing(tangentBearing, favorBearing);
  const steps = 8;
  const arc: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = outward - 90 + (180 * i) / steps;
    arc.push(destinationPoint(lat, lon, angle, PIP_SIZE_KM));
  }
  return [...arc, arc[0]];
}

// Walks a front's real geometry at a fixed real-world spacing (matching how a printed chart spaces
// pips fairly evenly along a line regardless of how many raw vertices the source data happens to
// have) and drops a pip at each interval, using the LOCAL tangent direction at that point — not the
// front's overall end-to-end bearing — so a curvy front gets correctly-oriented pips along its
// whole length, not just at its two endpoints.
function generateFrontPips(kind: FrontKind, coordinates: [number, number][]): WpcFeature[] {
  if (coordinates.length < 2) return [];
  const points = coordinates.map(([lon, lat]) => ({ lat, lon }));
  const cumulative: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineKm(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon));
  }
  const totalKm = cumulative[cumulative.length - 1];
  if (totalKm < PIP_SPACING_KM * 0.6) return []; // too short for even one well-spaced pip

  const favorBearing = kind === "warm" ? 0 : 90; // cold/occluded/stationary all default to the "advances east" side
  const pips: WpcFeature[] = [];
  const count = Math.max(1, Math.round(totalKm / PIP_SPACING_KM));
  const centeredOffset = (totalKm - (count - 1) * PIP_SPACING_KM) / 2;

  for (let n = 0; n < count; n += 1) {
    const targetKm = centeredOffset + n * PIP_SPACING_KM;
    let segment = 0;
    while (segment < cumulative.length - 2 && cumulative[segment + 1] < targetKm) segment += 1;
    const segStart = points[segment];
    const segEnd = points[segment + 1];
    const segLenKm = cumulative[segment + 1] - cumulative[segment];
    const t = segLenKm > 0 ? (targetKm - cumulative[segment]) / segLenKm : 0;
    const lat = segStart.lat + (segEnd.lat - segStart.lat) * t;
    const lon = segStart.lon + (segEnd.lon - segStart.lon) * t;
    const tangent = bearingDeg(segStart.lat, segStart.lon, segEnd.lat, segEnd.lon);

    if (kind === "stationary") {
      // Real convention: alternating cold/warm pips on their OWN correct (opposite) sides, not both
      // symbols at the same point — see fntcodes2.shtml's own description of a stationary front.
      const pipKind: PipKind = n % 2 === 0 ? "cold-pip" : "warm-pip";
      const ring = pipKind === "cold-pip" ? trianglePip(lat, lon, tangent, 90) : semicirclePip(lat, lon, tangent, 0);
      pips.push({ type: "Feature", properties: { kind: pipKind, frontKind: kind }, geometry: { type: "Polygon", coordinates: [ring] } });
    } else if (kind === "occluded") {
      // Real convention: alternating triangle/semicircle on the SAME side of the line.
      const pipKind: PipKind = n % 2 === 0 ? "cold-pip" : "warm-pip";
      const ring = pipKind === "cold-pip" ? trianglePip(lat, lon, tangent, favorBearing) : semicirclePip(lat, lon, tangent, favorBearing);
      pips.push({ type: "Feature", properties: { kind: pipKind, frontKind: kind }, geometry: { type: "Polygon", coordinates: [ring] } });
    } else {
      const pipKind: PipKind = kind === "warm" ? "warm-pip" : "cold-pip";
      const ring = pipKind === "cold-pip" ? trianglePip(lat, lon, tangent, favorBearing) : semicirclePip(lat, lon, tangent, favorBearing);
      pips.push({ type: "Feature", properties: { kind: pipKind, frontKind: kind }, geometry: { type: "Polygon", coordinates: [ring] } });
    }
  }
  return pips;
}
