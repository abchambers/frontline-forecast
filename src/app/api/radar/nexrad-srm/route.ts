import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { computeStormRelativeVelocityGrid } from "@/lib/nexrad/level3";

// Storm-Relative Mean Radial Velocity (Level III, product 56) — NOT linked
// from any UI. This exists to be inspected, verified, and tuned before it's
// ever shown to a real user: its decode requires resolving a raw NEXRAD
// threshold-table format the decode library doesn't handle for this product
// (see src/lib/nexrad/level3.ts for the algorithm, ported from Unidata's
// MetPy reference implementation rather than reverse-engineered), and it
// hasn't yet gotten the same noise-mitigation pass (echo-mask gating,
// despeckling) the shipped base-velocity layer has. Reachable directly by
// URL for manual verification; add a Data-layer picker entry only once
// someone has actually reviewed the output.
const GRID_STEP_DEG = 0.01;
const MAX_RANGE_KM = 230;
const CACHE_TTL_MS = 90_000;

type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const STATION_ID_PATTERN = /^[A-Z0-9]{3,5}$/;

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-nexrad-srm", 20, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const { searchParams } = new URL(request.url);
  const station = searchParams.get("station")?.trim().toUpperCase();
  if (!station || !STATION_ID_PATTERN.test(station)) {
    return NextResponse.json({ error: "A valid radar station ID is required, e.g. KFFC." }, { status: 400 });
  }

  const cached = cache.get(station);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data, { headers: { "Cache-Control": "private, max-age=60", "X-Radar-Source": "cache" } });
  }

  try {
    const { grid, bounds, time, elevationDeg } = await computeStormRelativeVelocityGrid(station, GRID_STEP_DEG, MAX_RANGE_KM);
    const hasSignal = grid.some((point) => point.dbz !== null);
    if (!hasSignal) throw new Error(`No storm-relative velocity data available for ${station} right now.`);

    const payload = {
      time,
      bounds,
      step: GRID_STEP_DEG,
      points: grid,
      elevationDeg,
      source: `NEXRAD Level III (${station}, storm-relative velocity) — unverified, not shown in the UI`,
    };
    cache.set(station, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=60", "X-Radar-Source": "live" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Storm-relative velocity is unavailable right now." },
      { status: 502 },
    );
  }
}
