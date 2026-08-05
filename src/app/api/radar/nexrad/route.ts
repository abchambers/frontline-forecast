import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getRadarSite } from "@/lib/nexrad/site";
import { getVolumeCached, extractLowestElevation } from "@/lib/nexrad/level2";
import { computeReflectivityGrid, computeVelocityGrid } from "@/lib/nexrad/project";
import { fetchFromWorker } from "@/lib/radar-worker-client";

// In-house NEXRAD Level II radar — free, public-domain NOAA data (unlike
// GribStream's paid, ToS-ambiguous MRMS resale), and inherently per-station
// rather than metered, so cost doesn't scale with school count or with how
// many products (reflectivity, velocity, and eventually Level III severe
// products) are offered. See radar-worker/README.md for how this was
// verified against live data before being wired in here.
//
// This route polls the latest complete archive volume per request rather
// than streaming real-time chunks — measured live at 1-2 minute freshness,
// as fresh as GribStream's MRMS feed ever was, so no persistent process is
// needed yet. A streaming worker (radar-worker/) is the planned upgrade path
// once traffic or latency requirements outgrow this.
const GRID_STEP_DEG = 0.01; // finer than GribStream's 0.05deg MRMS grid, closer to native Level II resolution.
// Cropped well inside super-res reflectivity's real ~460km max range — at
// full range this grid blows past mrms-render.ts's 500,000-cell safety cap
// and silently fails to render (found live: every request fell back to
// GribStream because of exactly this). 230km also matches a sensible local
// "your nearest station" viewing radius rather than the full detection range.
const MAX_RANGE_KM = 230;
const CACHE_TTL_MS = 90_000; // roughly matches real volume-scan cadence; avoids re-decoding on every request.

type CacheEntry = { data: unknown; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const STATION_ID_PATTERN = /^[A-Z0-9]{3,5}$/;
const MOMENTS = new Set(["reflectivity", "velocity"]);

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-nexrad", 20, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const { searchParams } = new URL(request.url);
  const station = searchParams.get("station")?.trim().toUpperCase();
  const moment = searchParams.get("moment") ?? "reflectivity";

  if (!station || !STATION_ID_PATTERN.test(station)) {
    return NextResponse.json({ error: "A valid radar station ID is required, e.g. KFFC." }, { status: 400 });
  }
  if (!MOMENTS.has(moment)) {
    return NextResponse.json({ error: "moment must be 'reflectivity' or 'velocity'." }, { status: 400 });
  }

  const cacheKey = `${station}:${moment}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data, { headers: { "Cache-Control": "private, max-age=60", "X-Radar-Source": "cache" } });
  }

  const fromWorker = await fetchFromWorker(`/${moment}?station=${station}`);
  if (fromWorker) {
    cache.set(cacheKey, { data: fromWorker, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(fromWorker, { headers: { "Cache-Control": "private, max-age=60", "X-Radar-Source": "worker" } });
  }

  try {
    // getVolumeCached is shared across BOTH moments (keyed by station only,
    // caches the PARSED volume) — switching between Radar and Velocity in
    // the picker, the most common reason both get requested close together,
    // no longer re-downloads AND re-parses the same ~5-6MB volume from S3.
    const [site, volume] = await Promise.all([getRadarSite(station), getVolumeCached(station)]);
    const { radar } = volume;

    // Correlation coefficient (RHO) gates reflectivity by the actual physical
    // signature of a real hydrometeor vs. clutter/insects, replacing the
    // cruder noise-floor+despeckle heuristic wherever dual-pol data decodes
    // for this volume (see project.ts for why). Not every volume/station is
    // guaranteed to carry it, so this degrades gracefully to the old
    // heuristic rather than failing the whole request.
    let correlationCoefficient;
    try {
      correlationCoefficient = extractLowestElevation(radar, "correlationCoefficient");
    } catch {
      correlationCoefficient = undefined;
    }

    // Velocity needs a co-located reflectivity echo mask to filter against —
    // weak/clutter gates produce essentially random Doppler estimates, not
    // just weak ones, so gating by reflectivity signal (not by velocity
    // magnitude) is the real fix.
    let grid, bounds, elevationDeg, qualityControl;
    if (moment === "velocity") {
      const reflElevation = extractLowestElevation(radar, "reflectivity");
      const velElevation = extractLowestElevation(radar, "velocity");
      const { echoMask, qualityControl: qc } = computeReflectivityGrid(reflElevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient);
      ({ grid, bounds } = computeVelocityGrid(velElevation, site, GRID_STEP_DEG, MAX_RANGE_KM, echoMask));
      elevationDeg = velElevation.elevationDeg;
      qualityControl = qc;
    } else {
      const elevation = extractLowestElevation(radar, "reflectivity");
      ({ grid, bounds, qualityControl } = computeReflectivityGrid(elevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient));
      elevationDeg = elevation.elevationDeg;
    }

    const hasSignal = grid.some((point) => point.dbz !== null);
    if (!hasSignal) throw new Error(`No ${moment} data available for ${station} in this volume.`);

    const payload = {
      time: volume.lastModified,
      bounds,
      step: GRID_STEP_DEG,
      points: grid,
      elevationDeg,
      qualityControl,
      source: `NEXRAD Level II (${station}, ${moment})`,
    };
    cache.set(cacheKey, { data: payload, expiresAt: Date.now() + CACHE_TTL_MS });
    return NextResponse.json(payload, { headers: { "Cache-Control": "private, max-age=60", "X-Radar-Source": "live" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "In-house radar is unavailable right now." },
      { status: 502 },
    );
  }
}
