import { createServer } from "node:http";
import { getRadarSite } from "./site.js";
import { getVolumeCached, extractLowestElevation } from "./level2.js";
import { computeReflectivityGrid, computeVelocityGrid, buildCandidateCells } from "./project.js";
import { fetchStormTracks, fetchHailDetections, fetchTvsDetections, fetchMesocycloneDetections } from "./level3-markers.js";
import { renderMrmsGridToDataUrl, renderVelocityGridToDataUrl } from "./render.js";

// The whole reason this worker exists instead of the Vercel route it mirrors:
// a persistent process means the module-level caches below (and
// getVolumeCached's own volume cache in level2.ts) actually stay warm across
// requests. On Vercel, a serverless cold start wipes them, which is why real
// production load times there were measured anywhere from ~0.15s to ~16s for
// superficially identical requests — see project memory. Same station
// requested twice in a row here hits a warm parsed volume, not a fresh S3
// download + binary decode.
//
// 0.004deg (~445m) — deliberately finer than the main app's own fallback
// route (still 0.01deg), affordable because this worker renders a PNG
// server-side (render.ts) instead of shipping raw {lat,lon,dbz} JSON.
// Two finer steps were tried and pulled back, each for a real measured
// reason, not a guess:
//   - 0.0025deg (~278m, near-native gate spacing): ~2.6M candidate cells —
//     produced multi-hundred-second compute pileups under concurrent load
//     (fixed by the request queue below, but the per-request cost itself was
//     still disproportionately high — ~12.7s locally vs. a much smaller step
//     down at 0.0033deg's ~4.6s, not a linear relationship, likely V8/GC
//     overhead at that many live objects).
//   - 0.0033deg (~370m, ~1.5M candidate cells): compute time was fine, but
//     a genuine OOM recurred on the velocity path specifically (which holds
//     reflectivity + CC + velocity Map<string,...> structures at once) —
//     anon-rss hit 1.8GB against shared-cpu-1x's hard 2GB ceiling (confirmed
//     live: Fly rejects any higher vm memory on this size class; upgrading
//     to a paid `performance` tier for more RAM is a real recurring cost
//     decision, not made unilaterally).
// 0.004deg reduces candidate-cell count (and therefore memory) by roughly a
// third versus 0.0033deg while still being a real ~2.5x resolution gain
// over the 0.01deg original.
const GRID_STEP_DEG = 0.004;
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

// Real production incident, found live via fly logs: this app's heavy
// compute (the gather-mapping sample pass) is fully synchronous with no
// yield points, so Node's single event-loop thread runs one to completion
// before touching anything else — including /health. Multiple concurrent
// cold requests (a handful of real users, or in this case a debugging
// session hammering the worker) don't run "concurrently" at all, they queue
// up behind each other with zero coordination; logged TOTAL compute times
// over 500 SECONDS for what should take a few seconds, and /health itself
// went unresponsive for minutes, triggering Fly's own restart cycle. A
// simple FIFO queue capping how many heavy computations can be in flight at
// once turns that unbounded pileup into bounded, predictable serialization —
// same total work, but it can never compound into the kind of runaway
// backlog that starved health checks.
const MAX_CONCURRENT_COMPUTE = 1;
let activeCompute = 0;
const computeQueue: (() => void)[] = [];

async function withComputeSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeCompute >= MAX_CONCURRENT_COMPUTE) {
    await new Promise<void>((resolve) => computeQueue.push(resolve));
  }
  activeCompute += 1;
  try {
    return await fn();
  } finally {
    activeCompute -= 1;
    const next = computeQueue.shift();
    if (next) next();
  }
}

// In-flight request de-duplication — if the exact same station+moment is
// already being computed (e.g. two browser tabs, or a client retry landing
// while the first attempt is still running), share that one computation
// instead of each starting an independent, fully redundant one competing
// for the same compute slot above.
const inFlight = new Map<string, Promise<{ status: number; body: unknown; source: "cache" | "live" }>>();

async function handleReflectivityOrVelocity(station: string, moment: "reflectivity" | "velocity") {
  const cacheKey = `${station}:${moment}`;
  const hit = cached(cacheKey);
  if (hit) return { status: 200, body: hit, source: "cache" as const };

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = withComputeSlot(() => computeReflectivityOrVelocity(station, moment, cacheKey));
  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function computeReflectivityOrVelocity(station: string, moment: "reflectivity" | "velocity", cacheKey: string) {
  const t0 = performance.now();
  const [site, volume] = await Promise.all([getRadarSite(station), getVolumeCached(station)]);
  const { radar } = volume;
  const t1 = performance.now();

  let correlationCoefficient;
  try {
    correlationCoefficient = extractLowestElevation(radar, "correlationCoefficient");
  } catch {
    correlationCoefficient = undefined;
  }

  // Geometry (bearing/range per output cell) is independent of which moment
  // is being sampled — built once here and shared across reflectivity, CC,
  // and velocity below instead of each redoing the same expensive trig pass.
  const candidateCells = buildCandidateCells(site, GRID_STEP_DEG, MAX_RANGE_KM);
  const t2 = performance.now();

  let grid, bounds, elevationDeg, qualityControl;
  if (moment === "velocity") {
    const reflElevation = extractLowestElevation(radar, "reflectivity");
    const velElevation = extractLowestElevation(radar, "velocity");
    const { echoMask, qualityControl: qc } = computeReflectivityGrid(reflElevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells);
    ({ grid, bounds } = computeVelocityGrid(velElevation, site, GRID_STEP_DEG, MAX_RANGE_KM, echoMask, candidateCells));
    elevationDeg = velElevation.elevationDeg;
    qualityControl = qc;
  } else {
    const elevation = extractLowestElevation(radar, "reflectivity");
    ({ grid, bounds, qualityControl } = computeReflectivityGrid(elevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells));
    elevationDeg = elevation.elevationDeg;
  }
  const tCompute = performance.now();
  console.log(`[${station}:${moment}] fetch+parse ${(t1 - t0).toFixed(0)}ms, geometry ${(t2 - t1).toFixed(0)}ms, sample ${(tCompute - t2).toFixed(0)}ms, total ${(tCompute - t0).toFixed(0)}ms`);

  const hasSignal = grid.some((point) => point.dbz !== null);
  if (!hasSignal) throw new Error(`No ${moment} data available for ${station} in this volume.`);

  // Rendered server-side rather than shipping raw points — see the
  // GRID_STEP_DEG comment above for why this matters at this resolution.
  const imageDataUrl =
    moment === "velocity"
      ? renderVelocityGridToDataUrl(grid, bounds, GRID_STEP_DEG)
      : renderMrmsGridToDataUrl(grid, bounds, GRID_STEP_DEG);
  if (!imageDataUrl) throw new Error(`Failed to render ${moment} image for ${station}.`);
  console.log(`[${station}:${moment}] render+encode: ${(performance.now() - tCompute).toFixed(0)}ms, image ~${Math.round((imageDataUrl.length * 0.75) / 1024)}KB`);

  const payload = {
    time: volume.lastModified,
    bounds,
    step: GRID_STEP_DEG,
    imageDataUrl,
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

  // Never queued/gated — must always answer instantly regardless of compute
  // load, or Fly's health check can't tell "busy" apart from "actually dead".
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
      console.error(`[${station}:${url.pathname}] request failed:`, error);
      respondJson(502, { error: error instanceof Error ? error.message : "Radar worker request failed." });
    });
});

server.listen(PORT, () => {
  console.log(`Radar worker listening on :${PORT}${API_KEY ? " (API key required)" : " (no API key set — open access)"}`);
});

// Keeps the app's real preset locations' radar sites warm proactively, so a
// real visitor's first request is far more likely to land on a payload-cache
// hit (near-instant) instead of a cold compute (several seconds, and the
// main app's own worker-client timeout may not even wait long enough for it
// — see radar-worker-client.ts). Deliberately reflectivity-only, not
// velocity: velocity is the secondary/non-default product and roughly
// doubles peak memory (see the fly.toml/Dockerfile comments on the real OOM
// that forced this app's resolution down) — not worth that cost just to
// pre-warm a view most visitors won't load. Station list matches
// src/lib/locations.ts's weatherDeskLocations exactly (KFFC covers
// Athens/Atlanta/Gainesville, KBMX covers Birmingham) — update both places
// together if the app's preset locations ever change.
const PREWARM_STATIONS = ["KFFC", "KBMX"];
const PREWARM_INTERVAL_MS = 80_000; // just under the 90s payload cache TTL, so a warm entry never fully expires under normal operation.

async function prewarm() {
  for (const station of PREWARM_STATIONS) {
    try {
      await handleReflectivityOrVelocity(station, "reflectivity");
    } catch (error) {
      console.error(`[prewarm:${station}] failed —`, error instanceof Error ? error.message : error);
    }
  }
}

prewarm();
setInterval(prewarm, PREWARM_INTERVAL_MS);
