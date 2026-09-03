// Standard Web Mercator / Slippy Map tile math — the exact same formulas already verified and
// shipped in radar-worker/src/mercator.ts (that file's own comment documents the real-data seam
// check that proved it correct). Duplicated here rather than shared across packages because the
// main app and radar-worker are two separate deployments with no shared module boundary — these
// are pure, tiny, well-tested functions, not something worth a cross-package dependency for.
export function tileXToLon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export type TileBounds = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number };

export function tileBounds(z: number, x: number, y: number): TileBounds {
  return {
    minLongitude: tileXToLon(x, z),
    maxLongitude: tileXToLon(x + 1, z),
    maxLatitude: tileYToLat(y, z),
    minLatitude: tileYToLat(y + 1, z),
  };
}

const EARTH_RADIUS_KM = 6371;
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Real point-to-axis-aligned-lat/lon-box distance: clamp the point into the box (0 if already
// inside), then haversine from the original point to that clamped point. Same flat/local-geometry
// spirit already used elsewhere in this codebase (radar-worker's own despeckle/candidate-cell math)
// — accurate enough at these scales, not attempting true geodesic polygon intersection.
export function distanceToBoundsKm(lat: number, lon: number, bounds: TileBounds): number {
  const nearestLat = Math.max(bounds.minLatitude, Math.min(lat, bounds.maxLatitude));
  const nearestLon = Math.max(bounds.minLongitude, Math.min(lon, bounds.maxLongitude));
  return haversineKm(lat, lon, nearestLat, nearestLon);
}
