import parseLevel3 from "nexrad-level-3-data";
import type { RadarSite } from "./site";
import { destinationPoint } from "./project";
import { fetchLatestLevel3Product } from "./level3";

// Detection-algorithm products — Storm Tracking (NST), Hail Index (NHI),
// Tornadic Vortex Signature (NTV), Mesocyclone (NMD). Structurally very
// different from reflectivity/velocity: these are small text tables of
// tracked storm cells (an azimuth/range from the radar site, in nautical
// miles, plus algorithm output like hail size or rotation strength), not a
// raster field — nexrad-level-3-data already resolves them into structured
// objects via its "formatted" output, so unlike storm-relative velocity
// there's no undocumented bit-level decode to get wrong here. Confirmed
// live against a REAL tracked storm (see level3-markers verification notes)
// for NST; NHI/NTV/NMD were only verified structurally (via the library's
// documented text-table format and an empty-but-correctly-shaped NMD
// response) since no active hail/rotation signature existed to test against
// at verification time — the parsing pattern is identical across all four,
// so this is a reasonable, not a blind, extrapolation.
const NAUTICAL_MILE_KM = 1.852;

export type StormTrack = {
  id: string;
  lat: number;
  lon: number;
  movementDeg: number | null;
  movementKts: number | null;
  forecast: { lat: number; lon: number }[];
};

export type HailDetection = {
  id: string;
  lat: number;
  lon: number;
  probSevereHailPct: number;
  probHailPct: number;
  maxSizeInches: number;
};

export type TvsDetection = {
  id: string;
  featureType: string;
  lat: number;
  lon: number;
  maxShearHeightKft: number;
};

export type MesocycloneDetection = {
  id: string;
  lat: number;
  lon: number;
  hasTvs: boolean;
  strengthIndex: number | null;
};

function azRangeToLatLon(site: RadarSite, azimuthDeg: number, rangeNm: number): { lat: number; lon: number } {
  return destinationPoint(site, azimuthDeg, rangeNm * NAUTICAL_MILE_KM);
}

function siteFromProductDescription(stationId: string, productDescription: { latitude: number; longitude: number; height: number }): RadarSite {
  return {
    id: stationId,
    name: stationId,
    latitude: productDescription.latitude,
    longitude: productDescription.longitude,
    elevationMeters: productDescription.height,
  };
}

export async function fetchStormTracks(stationId: string): Promise<{ tracks: StormTrack[]; time: string | null }> {
  const product = await fetchLatestLevel3Product(stationId, "NST");
  if (!product) return { tracks: [], time: null };
  const data = parseLevel3(product.buffer, { logger: false });
  const site = siteFromProductDescription(stationId, data.productDescription);
  const storms = (data as { formatted?: { storms?: Record<string, { current: { deg: number; nm: number } | null; movement: { deg: number; kts: number } | null; forecast: ({ deg: number; nm: number } | null)[] }> } }).formatted?.storms ?? {};

  const tracks: StormTrack[] = [];
  for (const [id, storm] of Object.entries(storms)) {
    if (!storm.current) continue; // "NO DATA"/dropped track
    const { lat, lon } = azRangeToLatLon(site, storm.current.deg, storm.current.nm);
    const forecast = storm.forecast
      .filter((point): point is { deg: number; nm: number } => point !== null)
      .map((point) => azRangeToLatLon(site, point.deg, point.nm));
    tracks.push({
      id,
      lat,
      lon,
      movementDeg: storm.movement?.deg ?? null,
      movementKts: storm.movement?.kts ?? null,
      forecast,
    });
  }
  return { tracks, time: product.lastModified };
}

export async function fetchHailDetections(stationId: string): Promise<{ detections: HailDetection[]; time: string | null }> {
  const [product, tracks] = await Promise.all([fetchLatestLevel3Product(stationId, "NHI"), fetchStormTracks(stationId)]);
  if (!product) return { detections: [], time: null };
  const data = parseLevel3(product.buffer, { logger: false });
  const hail = (data as { formatted?: { hail?: Record<string, { probSevere: number; probHail: number; maxSize: number }> } }).formatted?.hail ?? {};
  // NHI's own table doesn't carry a position — it's keyed by the same storm
  // ID the tracking algorithm (NST) assigns, so position comes from there.
  const trackById = new Map(tracks.tracks.map((track) => [track.id, track]));

  const detections: HailDetection[] = [];
  for (const [id, hailData] of Object.entries(hail)) {
    const track = trackById.get(id);
    if (!track) continue; // can't place it on the map without a matching tracked position
    detections.push({ id, lat: track.lat, lon: track.lon, probSevereHailPct: hailData.probSevere, probHailPct: hailData.probHail, maxSizeInches: hailData.maxSize });
  }
  return { detections, time: product.lastModified };
}

export async function fetchTvsDetections(stationId: string): Promise<{ detections: TvsDetection[]; time: string | null }> {
  const product = await fetchLatestLevel3Product(stationId, "NTV");
  if (!product) return { detections: [], time: null };
  const data = parseLevel3(product.buffer, { logger: false });
  const site = siteFromProductDescription(stationId, data.productDescription);
  const tvs = (data as { formatted?: { tvs?: Record<string, { type: string; az: number; range: number; maxshearheight: number }> } }).formatted?.tvs ?? {};

  const detections: TvsDetection[] = [];
  for (const [id, entry] of Object.entries(tvs)) {
    const { lat, lon } = azRangeToLatLon(site, entry.az, entry.range);
    detections.push({ id, featureType: entry.type, lat, lon, maxShearHeightKft: entry.maxshearheight });
  }
  return { detections, time: product.lastModified };
}

export async function fetchMesocycloneDetections(stationId: string): Promise<{ detections: MesocycloneDetection[]; time: string | null }> {
  const product = await fetchLatestLevel3Product(stationId, "NMD");
  if (!product) return { detections: [], time: null };
  const data = parseLevel3(product.buffer, { logger: false });
  const site = siteFromProductDescription(stationId, data.productDescription);
  const mesocyclones = (data as { formatted?: { mesocyclone?: Record<string, { az: number; ran: number; tvs: boolean; msi: string | null }> } }).formatted?.mesocyclone ?? {};

  const detections: MesocycloneDetection[] = [];
  for (const [id, entry] of Object.entries(mesocyclones)) {
    const { lat, lon } = azRangeToLatLon(site, entry.az, entry.ran);
    const strengthIndex = entry.msi !== null && entry.msi !== "" ? Number(entry.msi) : null;
    detections.push({ id, lat, lon, hasTvs: entry.tvs, strengthIndex: Number.isFinite(strengthIndex) ? strengthIndex : null });
  }
  return { detections, time: product.lastModified };
}
