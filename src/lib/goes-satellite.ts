// Shared between /api/satellite/frames (server) and page.tsx (client, for an immediate guess
// before that fetch resolves) so the two can never quietly drift onto different thresholds.
//
// Real request, 2026-09-08: GOES-East (GOES-19, nadir 75.2°W) was hardcoded regardless of where
// the user's location actually is — a real, meaningfully worse (more oblique) view angle for the
// West Coast, same reasoning NOAA/broadcast meteorologists already use to prefer GOES-West (GOES-
// 18, nadir 137°W) there. The dividing longitude is the real midpoint between the two satellites'
// nadir points (~106°W), not a guess — roughly the Rockies/Mountain-Time area, matching where a
// real handoff already feels natural.
export const GOES_EAST_WEST_DIVIDE_LON = -106;

export type GoesSatellite = { id: "GOES19" | "GOES18"; label: "GOES-East" | "GOES-West" };

export function satelliteForLongitude(longitude: number | null | undefined): GoesSatellite {
  if (typeof longitude === "number" && Number.isFinite(longitude) && longitude < GOES_EAST_WEST_DIVIDE_LON) {
    return { id: "GOES18", label: "GOES-West" };
  }
  return { id: "GOES19", label: "GOES-East" };
}
