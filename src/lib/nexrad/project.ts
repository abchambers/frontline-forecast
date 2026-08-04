import type { DecodedElevation } from "./level2";
import type { RadarSite } from "./site";
import type { MrmsBounds, MrmsPoint } from "@/lib/mrms-render";

const EARTH_RADIUS_KM = 6371;

// Destination-point formula (spherical), converting a radar-relative
// bearing/ground-range into a lat/lon. Ground range approximates slant range
// via a flat-earth * cos(elevation) correction — the same approximation tier
// as mrms-render.ts's color table. It ignores beam curvature/refraction and
// earth curvature at long range; only matters for the highest tilts/longest
// ranges, not the near-range low-elevation view this app displays.
function destinationPoint(site: RadarSite, bearingDeg: number, groundRangeKm: number): { lat: number; lon: number } {
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (site.latitude * Math.PI) / 180;
  const lon1 = (site.longitude * Math.PI) / 180;
  const angularDistance = groundRangeKm / EARTH_RADIUS_KM;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: (lat2 * 180) / Math.PI, lon: (((lon2 * 180) / Math.PI + 540) % 360) - 180 };
}

// Projects every gate of every radial to a real lat/lon — an irregular point
// cloud at polar-native resolution (down to 250m near the radar). Kept
// separate from resampleToGrid so geometry and output-resolution stay two
// independently testable concerns.
//
// maxRangeKm crops gates beyond a useful local-viewing radius. Super-res
// reflectivity's real max range is ~460km, which at any reasonable grid
// resolution blows past src/lib/mrms-render.ts's 500,000-cell safety cap
// (found live: the full-range grid silently failed to render and fell back
// to GribStream every time — a real bug, not a hypothetical one). Cropping
// to a closer radius also matches the RadarScope-style "local station view"
// this app is aiming for, rather than trying to show the full detection range.
function projectElevation(elevation: DecodedElevation, site: RadarSite, maxRangeKm: number): MrmsPoint[] {
  const points: MrmsPoint[] = [];
  const elevationRad = (elevation.elevationDeg * Math.PI) / 180;

  for (const radial of elevation.radials) {
    for (let gateIndex = 0; gateIndex < radial.values.length; gateIndex += 1) {
      const slantRangeKm = radial.firstGateKm + gateIndex * radial.gateSizeKm;
      const groundRangeKm = slantRangeKm * Math.cos(elevationRad);
      if (groundRangeKm > maxRangeKm) break; // gates are range-ordered, so nothing further out matters either.
      const value = radial.values[gateIndex];
      const { lat, lon } = destinationPoint(site, radial.azimuthDeg, groundRangeKm);
      points.push({ lat, lon, dbz: value });
    }
  }
  return points;
}

// Bins the irregular polar point cloud into a regular lat/lon grid matching
// the exact shape src/lib/mrms-render.ts already renders — so the UI needs
// no new rendering code, only a new data source. Last-write-wins per cell:
// gates near the radar are much denser than the grid resolution, so a later
// gate simply overwrites an earlier one landing in the same cell.
function resampleToGrid(points: MrmsPoint[], stepDeg: number): { grid: MrmsPoint[]; bounds: MrmsBounds } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }

  const bounds: MrmsBounds = { minLatitude: minLat, maxLatitude: maxLat, minLongitude: minLon, maxLongitude: maxLon };
  const cells = new Map<string, number | null>();
  for (const p of points) {
    const row = Math.round((p.lat - minLat) / stepDeg);
    const col = Math.round((p.lon - minLon) / stepDeg);
    cells.set(`${row},${col}`, p.dbz);
  }

  const grid: MrmsPoint[] = [];
  for (const [key, dbz] of cells) {
    const [row, col] = key.split(",").map(Number);
    grid.push({ lat: minLat + row * stepDeg, lon: minLon + col * stepDeg, dbz });
  }
  return { grid, bounds };
}

export function projectAndResample(elevation: DecodedElevation, site: RadarSite, stepDeg: number, maxRangeKm: number) {
  return resampleToGrid(projectElevation(elevation, site, maxRangeKm), stepDeg);
}
