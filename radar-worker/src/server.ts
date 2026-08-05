import { createServer } from "node:http";
import { getRadarSite } from "./site.js";
import { getVolumeCached, extractLowestElevation } from "./level2.js";
import { computeReflectivityGrid, computeVelocityGrid } from "./project.js";
import { fetchStormTracks, fetchHailDetections, fetchTvsDetections, fetchMesocycloneDetections } from "./level3-markers.js";

// The whole reason this worker exists instead of the Vercel route it mirrors:
// a persistent process means the module-level caches below (and
// getVolumeCached's own volume cache in level2.ts) actually stay warm across
// requests. On Vercel, a serverless cold start wipes them, which is why real
// production load times there were measured anywhere from ~0.15s to ~16s for
// superficially identical requests — see project memory. Same station
// requested twice in a row here hits a warm parsed volume, not a fresh S3
// download + binary decode.
const GRID_STEP_DEG = 0.01;
const MAX_RANGE_KM = 230;
const PAYLOAD_CACHE_TTL_MS = 90_000;
const SEVERE_CACHE_TTL_MS = 60_000;
const PORT = Number(process.env.PORT ?? 8080);
// Optional — if set, requests must carry a matching header. Unset by default
// so local dev and the first deploy don't require any secret wiring; the
// main app should set this once the worker URL is configured as its primary
// source, matching the graceful-degradation pattern used elsewhere in this
// codebase (e.g. rate-limit, GribStream budget).
const API_KEY = process.env.WORKER_API_KEY;

const STATION_ID_PATTERN = /^[A-Z0-9]{3,5}$/;

type CacheEntry = { data: unknown; expiresAt: number };
const payloadCache = new Map<string, CacheEntry>();

function cached(key: string): unknown | null {
  const entry = payloadCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  return null;
}

function setCache(key: string, data: unknown, ttlMs: number) {
  payloadCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

async function handleReflectivityOrVelocity(station: string, moment: "reflectivity" | "velocity") {
  const cacheKey = `${station}:${moment}`;
  const hit = cached(cacheKey);
  if (hit) return { status: 200, body: hit, source: "cache" as const };

  const [site, volume] = await Promise.all([getRadarSite(station), getVolumeCached(station)]);
  const { radar } = volume;

  let correlationCoefficient;
  try {
    correlationCoefficient = extractLowestElevation(radar, "correlationCoefficient");
  } catch {
    correlationCoefficient = undefined;
  }

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
  setCache(cacheKey, payload, PAYLOAD_CACHE_TTL_MS);
  return { status: 200, body: payload, source: "live" as const };
}

async function handleSevere(station: string) {
  const hit = cached(`severe:${station}`);
  if (hit) return { status: 200, body: hit, source: "cache" as const };

  const [storms, hail, tvs, mesocyclones] = await Promise.all([
    fetchStormTracks(station),
    fetchHailDetections(station),
    fetchTvsDetections(station),
    fetchMesocycloneDetections(station),
  ]);

  const payload = {
    stormTracks: storms.tracks,
    hail: hail.detections,
    tvs: tvs.detections,
    mesocyclones: mesocyclones.detections,
    times: { stormTracks: storms.time, hail: hail.time, tvs: tvs.time, mesocyclones: mesocyclones.time },
  };
  setCache(`severe:${station}`, payload, SEVERE_CACHE_TTL_MS);
  return { status: 200, body: payload, source: "live" as const };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (API_KEY && request.headers["x-worker-key"] !== API_KEY) {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Unauthorized." }));
    return;
  }

  const station = url.searchParams.get("station")?.trim().toUpperCase();

  const respondJson = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
    response.end(JSON.stringify(body));
  };

  const routes: Record<string, (station: string) => Promise<{ status: number; body: unknown; source: "cache" | "live" }>> = {
    "/reflectivity": (s) => handleReflectivityOrVelocity(s, "reflectivity"),
    "/velocity": (s) => handleReflectivityOrVelocity(s, "velocity"),
    "/severe": (s) => handleSevere(s),
  };

  const handler = routes[url.pathname];
  if (!handler) {
    respondJson(404, { error: "Not found." });
    return;
  }
  if (!station || !STATION_ID_PATTERN.test(station)) {
    respondJson(400, { error: "A valid radar station ID is required, e.g. KFFC." });
    return;
  }

  handler(station)
    .then((result) => respondJson(result.status, result.body, { "X-Radar-Source": result.source }))
    .catch((error: unknown) => {
      respondJson(502, { error: error instanceof Error ? error.message : "Radar worker request failed." });
    });
});

server.listen(PORT, () => {
  console.log(`Radar worker listening on :${PORT}${API_KEY ? " (API key required)" : " (no API key set — open access)"}`);
});
