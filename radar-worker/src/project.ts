import type { DecodedElevation } from "./level2.js";
import type { RadarSite } from "./site.js";

export type GridPoint = { lat: number; lon: number; dbz: number | null };
export type GridBounds = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number };

const EARTH_RADIUS_KM = 6371;

// Destination-point formula (spherical), converting a radar-relative
// bearing/ground-range into a lat/lon. Ground range approximates slant range
// via a flat-earth * cos(elevation) correction, which is the same
// simplification level as this app's other geographic approximations (see
// mrms-render.ts's documented-approximation comment) — it ignores beam
// curvature/refraction and earth curvature over long ranges, which matters
// more for the highest tilts and longest ranges than for the near-range,
// low-elevation view this app displays. Good enough for Phase 1; revisit if
// far-range accuracy turns out to matter once this is on the map.
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

// Projects every gate of every radial to a real lat/lon, producing an
// irregular point cloud in polar-native resolution (down to 250m near the
// radar). This is intentionally NOT yet a regular grid — that's what
// resampleToGrid does next, kept as a separate step so the two concerns
// (geometry vs. resolution/output-shape) can be tested independently.
// maxRangeKm crops gates beyond a useful local-viewing radius. Found live in
// the main app (src/lib/nexrad/project.ts): the full ~460km super-res range
// at any reasonable grid step blows past the renderer's cell-count safety
// cap and silently fails, falling back to the next radar source every time.
// Cropping closer also matches the RadarScope-style "your nearest station"
// view this app is aiming for.
export function projectElevation(elevation: DecodedElevation, site: RadarSite, maxRangeKm = 230): GridPoint[] {
  const points: GridPoint[] = [];
  const elevationRad = (elevation.elevationDeg * Math.PI) / 180;

  for (const radial of elevation.radials) {
    for (let gateIndex = 0; gateIndex < radial.values.length; gateIndex += 1) {
      const slantRangeKm = radial.firstGateKm + gateIndex * radial.gateSizeKm;
      const groundRangeKm = slantRangeKm * Math.cos(elevationRad);
      if (groundRangeKm > maxRangeKm) break;
      const value = radial.values[gateIndex];
      const { lat, lon } = destinationPoint(site, radial.azimuthDeg, groundRangeKm);
      points.push({ lat, lon, dbz: value });
    }
  }
  return points;
}

// Bins the irregular polar point cloud into a regular lat/lon grid matching
// the shape the app's existing renderer (src/lib/mrms-render.ts) already
// consumes, so Phase 2 can point the UI at this worker's output with no
// rendering-code changes. Last-write-wins per cell is deliberate: gates near
// the radar are much denser than the grid resolution, so an incoming later
// gate simply overwrites an earlier one in the same cell — acceptable at
// this resolution, revisit only if cell-boundary artifacts show up visually.
export function resampleToGrid(points: GridPoint[], stepDeg: number): { grid: GridPoint[]; bounds: GridBounds } {
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

  const bounds: GridBounds = { minLatitude: minLat, maxLatitude: maxLat, minLongitude: minLon, maxLongitude: maxLon };
  const cells = new Map<string, number | null>();
  for (const p of points) {
    const row = Math.round((p.lat - minLat) / stepDeg);
    const col = Math.round((p.lon - minLon) / stepDeg);
    cells.set(`${row},${col}`, p.dbz);
  }

  const grid: GridPoint[] = [];
  for (const [key, dbz] of cells) {
    const [row, col] = key.split(",").map(Number);
    grid.push({ lat: minLat + row * stepDeg, lon: minLon + col * stepDeg, dbz });
  }
  return { grid, bounds };
}
