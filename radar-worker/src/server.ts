import { createServer } from "node:http";
import { getRadarSite } from "./site.js";
import { getVolumeCached, extractLowestElevation } from "./level2.js";
import { computeReflectivityGrid, computeVelocityGrid, buildCandidateCells, cellsToGrid, boundsOf, mergeReflectivityCells } from "./project.js";
import { fetchStormTracks, fetchHailDetections, fetchTvsDetections, fetchMesocycloneDetections } from "./level3-markers.js";
import { renderMrmsGridToDataUrl, renderVelocityGridToDataUrl } from "./render.js";

// Ring buffer of this worker's own past renders, so the app can build a real in-house timeline
// instead of only ever showing "now" and falling back to an external mosaic for every past frame.
// Reflectivity only (matches PREWARM_STATIONS' own reflectivity-only scope below) and deliberately
// tiny: stores only the already-rendered ~2MB PNG payload, never a raw volume (~800MB+, see
// level2.ts), and only ever retains a copy of a render that was going to happen anyway (a real
// request or the existing prewarm cycle) — this adds NO new compute load, never triggers an extra
// decode/render pass. Hard-capped on both axes, not just TTL — TTL-only eviction (sweep on access,
// no count/byte cap) is exactly the pattern that caused this worker's past OOM incidents: at most
// MAX_FRAMES_PER_STATION per station, and at most MAX_STATIONS_TRACKED distinct stations tracked at
// once (evicting the least-recently-touched station's entire history beyond that — the station
// picker lets a user land on any of 159 real sites, not just the two prewarmed presets, so this
// can't assume a small fixed station set). Worst case is a small, fixed, predictable
// ~MAX_STATIONS_TRACKED * MAX_FRAMES_PER_STATION * 2MB (~96MB) regardless of how many distinct
// stations get requested over the worker's lifetime.
//
// Shares this exact same map/eviction pool with mosaic combos (see mosaicKey below) rather than a
// separate tracked set — a real user is looking at either a single station's history or one mosaic
// combo's history at a time, never both, so splitting the budget would just make each half smaller
// for no benefit. A mosaic combo's key can never collide with a plain station ID (it's always
// several comma-joined IDs, a station ID never contains a comma).
const MAX_FRAMES_PER_STATION = 12;
const RETENTION_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAX_STATIONS_TRACKED = 4;

type FramePayload = { time: string; elevationDeg?: number; [key: string]: unknown };
const frameHistory = new Map<string, FramePayload[]>();
const stationLastTouched = new Map<string, number>();

// A mosaic composite has no single elevation angle (each member station contributes its own lowest
// tilt), so its retained frames just omit elevationDeg (FramePayload above made it optional for
// exactly this case) rather than inventing a misleading placeholder value.
function mosaicKey(stations: string[]) {
  return [...stations].sort().join(",");
}

function recordFrame(station: string, payload: FramePayload) {
  const now = Date.now();
  if (!frameHistory.has(station) && frameHistory.size >= MAX_STATIONS_TRACKED) {
    let oldestStation: string | null = null;
    let oldestTouch = Infinity;
    for (const [trackedStation, touchedAt] of stationLastTouched) {
      if (touchedAt < oldestTouch) {
        oldestTouch = touchedAt;
        oldestStation = trackedStation;
      }
    }
    if (oldestStation) {
      frameHistory.delete(oldestStation);
      stationLastTouched.delete(oldestStation);
    }
  }
  stationLastTouched.set(station, now);

  const cutoff = now - RETENTION_WINDOW_MS;
  const frames = (frameHistory.get(station) ?? []).filter((frame) => new Date(frame.time).getTime() >= cutoff);
  // A retried request or a second concurrent tab can legitimately recompute the same volume —
  // don't double-store the same moment.
  if (frames.some((frame) => frame.time === payload.time)) {
    frameHistory.set(station, frames);
    return;
  }
  frames.push(payload);
  if (frames.length > MAX_FRAMES_PER_STATION) frames.shift();
  frameHistory.set(station, frames);
}

// The whole reason this worker exists instead of the Vercel route it mirrors:
// a persistent process means the module-level caches below (and
// getVolumeCached's own volume cache in level2.ts) actually stay warm across
// requests. On Vercel, a serverless cold start wipes them, which is why real
// production load times there were measured anywhere from ~0.15s to ~16s for
// superficially identical requests — see project memory. Same station
// requested twice in a row here hits a warm parsed volume, not a fresh S3
// download + binary decode.
//
// 0.006deg (~670m) — finer than the main app's own fallback route (still
// 0.01deg), affordable because this worker renders a PNG server-side
// (render.ts) instead of shipping raw {lat,lon,dbz} JSON. Pulled back
// TWICE from more aggressive values, each for a real measured reason:
//   - 0.0025deg (~278m): ~2.6M candidate cells, multi-hundred-second compute
//     pileups under concurrent load (a scheduling bug, since fixed by the
//     request queue below) and disproportionately slow even alone.
//   - 0.0033/0.004deg (~370-445m): compute was fine in controlled testing,
//     but real production OOMs kept recurring even after fixing an actual
//     memory leak (see level2.ts/server.ts cache-eviction comments) — a
//     FRESH machine, seconds into its life, OOM'd while decoding a real
//     volume during active severe weather. The likely reason: the
//     nexrad-level-2-data library eagerly parses the ENTIRE volume (every
//     elevation/moment) regardless of which single elevation this app
//     actually uses, so a severe-weather VCP (more tilts, more supplemental
//     low-level scans) genuinely parses into a bigger object than a routine
//     VCP does — a cost independent of this app's own GRID_STEP_DEG, and
//     not something fixable without replacing that library (out of scope
//     tonight). Pulling resolution back further buys more headroom for MY
//     OWN sampling/render structures against that variable, sometimes-large
//     baseline, since shared-cpu-1x's 2GB ceiling can't be raised further
//     without a paid tier upgrade (a real recurring-cost decision, not made
//     unilaterally). If OOMs recur even here, the real fix is switching
//     per-cell storage from string-keyed Maps to typed arrays, or finding a
//     way to avoid the library's eager full-volume parse — not another
//     resolution cut.
const GRID_STEP_DEG = 0.006;
// Raised 230km -> 460km, 2026-08-31, after the fly.toml performance-1x + 4096mb upgrade (Andrew's
// own call, done the same day, see that file's history) removed the two real constraints that had
// kept this at 230km: shared-cpu-1x's CPU throttling (the actual root cause of the 60-210s
// severe-weather decode incidents, not raw compute cost — see fly.toml) and the 2GB memory ceiling
// Fly enforces on that size class. 230km was never a rendering-quality choice, it was "as far as we
// could safely go on that tier" — real NEXRAD super-res base reflectivity actually resolves out to
// ~460km (248nm), which is what RadarScope shows (confirmed live: KGSP reaching the Atlantic coast,
// ~310km away, was invisible here at the old 230km cutoff even though the data exists).
// Measured real cost of this change on live KGSP data before deploying: candidate cells 455k -> 1.82M
// (4x, as expected from the range^2 scaling in buildCandidateCells), sample compute 331ms -> 868ms —
// still well under a second per station, and MOSAIC_TIMEOUT_MS (radar-worker-client.ts, 150s) has
// enormous headroom even at MAX_MOSAIC_STATIONS=8 stations each paying this cost. If a real OOM
// recurs at this range even on the upgraded tier (check via fly logs, same as every past incident
// here), the fix is typed-array cell storage (flagged in fly.toml's own history), not reverting this.
const MAX_RANGE_KM = 460;
// Raised alongside level2.ts's VOLUME_CACHE_TTL_MS (90s -> 5min) — same real
// incident, same reasoning: during active severe weather the volume parse
// this payload is built from can itself take 60-210+ seconds, independent
// of this app's own resolution/sampling code, so a short TTL just forced
// that expensive work to repeat almost immediately. See level2.ts for the
// full writeup.
const PAYLOAD_CACHE_TTL_MS = 300_000;
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

// Same real leak class as level2.ts's volumeCache (see that file's comment
// for the full incident writeup) — expired entries were never deleted, just
// silently ignored by the expiresAt check, so every distinct station+moment
// ever requested in this process's lifetime stayed in memory forever (each
// entry holds a full base64 PNG, up to ~2MB). Sweeping on every access
// bounds this to "recently active" rather than "all-time".
function evictExpiredPayloads() {
  const now = Date.now();
  for (const [key, entry] of payloadCache) {
    if (entry.expiresAt <= now) payloadCache.delete(key);
  }
}

function cached(key: string): unknown | null {
  evictExpiredPayloads();
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
  if (moment === "reflectivity") recordFrame(station, payload);
  return { status: 200, body: payload, source: "live" as const };
}

async function handleFrameHistory(station: string) {
  const frames = frameHistory.get(station) ?? [];
  return {
    status: 200,
    body: { frames: frames.map((frame) => ({ time: frame.time, elevationDeg: frame.elevationDeg })) },
    source: "cache" as const,
  };
}

async function handleFrame(station: string, time: string | null) {
  if (!time) return { status: 400, body: { error: "A time parameter is required." }, source: "cache" as const };
  const frames = frameHistory.get(station) ?? [];
  const match = frames.find((frame) => frame.time === time);
  if (!match) return { status: 404, body: { error: "No retained frame for that station/time." }, source: "cache" as const };
  return { status: 200, body: match, source: "cache" as const };
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

// NOT WIRED IN to the main app yet (2026-08-29) — Andrew's explicit call: build this now, deploy
// the code, but don't point any live traffic at it until the worker is upgraded off shared-cpu-1x
// (see fly.toml). A `git push` here does NOT touch the running Fly machine — this project's
// radar-worker only updates on an explicit `fly deploy` (see docs/START_HERE.md /
// WORKING_WITH_ANDREW.md), so merging this is safe even before that upgrade happens. Once it IS
// deployed, this endpoint deliberately still shares the single MAX_CONCURRENT_COMPUTE slot with
// every other route above — a mosaic request can legitimately hold that slot for the sum of all its
// stations' decode times (proven in scripts/mosaic-prototype.ts: ~6-9s/station), so it will queue
// behind (and be queued behind by) ordinary single-station traffic on the current architecture.
// That's the right tradeoff for now (never silently bypass the safety invariant that already fixed a
// real overload incident) but is exactly why this shouldn't go live on the current small machine —
// see the cost/latency investigation in chat before wiring this up for real.
//
// Deliberately takes an explicit station list from the caller rather than a lat/lon + radius: this
// worker resolves individual station metadata live (site.ts), but has no cached list of ALL 159
// station coordinates to search from. That "nearest N stations to this location" logic belongs in
// the main app instead (which already fetches+caches the full station list for the station picker,
// see src/app/api/radar/stations/route.ts) — this endpoint's job is only "decode+merge+render
// whichever stations you tell me to."
const MAX_MOSAIC_STATIONS = 8;
const MOSAIC_CACHE_TTL_MS = 300_000; // matches PAYLOAD_CACHE_TTL_MS — same volume-refresh-cadence reasoning.

async function handleMosaic(stationsParam: string) {
  const stations = [...new Set(stationsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (stations.length === 0) return { status: 400, body: { error: "At least one station is required, e.g. ?stations=KFFC,KJGX,KVAX." }, source: "cache" as const };
  if (stations.length > MAX_MOSAIC_STATIONS) return { status: 400, body: { error: `At most ${MAX_MOSAIC_STATIONS} stations per mosaic request.` }, source: "cache" as const };
  for (const station of stations) {
    if (!STATION_ID_PATTERN.test(station)) return { status: 400, body: { error: `Invalid station ID: ${station}` }, source: "cache" as const };
  }

  const cacheKey = `mosaic:${[...stations].sort().join(",")}`;
  const hit = cached(cacheKey);
  if (hit) return { status: 200, body: hit, source: "cache" as const };

  const existing = inFlight.get(cacheKey);
  if (existing) return existing;

  const promise = withComputeSlot(() => computeMosaic(stations, cacheKey));
  inFlight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function computeMosaic(stations: string[], cacheKey: string) {
  const t0 = performance.now();
  const merged = new Map<string, number | null>();
  const perStationMs: string[] = [];
  const succeededStations: string[] = [];
  const failedStations: string[] = [];

  // Sequential, one station in flight at a time — same MAX_CONCURRENT_COMPUTE=1 invariant as every
  // other route, just spread across several stations instead of one. See the block comment above
  // this function for why that's the deliberate, safe choice on the CURRENT small machine.
  //
  // Each station is caught individually (2026-08-31, real incident): a single station failing for
  // ANY reason (a transient NWS metadata timeout, an S3 hiccup, a bad/missing volume) used to fail
  // the WHOLE mosaic request, even when every other station in the list would have succeeded fine —
  // found live via a real "Request to .../radar/stations/KMXX timed out after 10000ms" that took
  // down an otherwise-healthy 4-station mosaic. A multi-station composite has more surface area for
  // exactly this kind of single-point failure than a single-station request ever did, so it needs
  // to degrade gracefully: skip the failed station, keep going, and render whatever succeeded.
  for (const station of stations) {
    const stationStart = performance.now();
    try {
      const [site, volume] = await Promise.all([getRadarSite(station), getVolumeCached(station)]);
      const elevation = extractLowestElevation(volume.radar, "reflectivity");
      let correlationCoefficient;
      try {
        correlationCoefficient = extractLowestElevation(volume.radar, "correlationCoefficient");
      } catch {
        correlationCoefficient = undefined;
      }
      const candidateCells = buildCandidateCells(site, GRID_STEP_DEG, MAX_RANGE_KM);
      const { grid } = computeReflectivityGrid(elevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells);
      mergeReflectivityCells(merged, grid, GRID_STEP_DEG);
      succeededStations.push(station);
      perStationMs.push(`${station}=${((performance.now() - stationStart) / 1000).toFixed(1)}s`);
    } catch (error) {
      failedStations.push(station);
      perStationMs.push(`${station}=FAILED(${((performance.now() - stationStart) / 1000).toFixed(1)}s)`);
      console.error(`[mosaic:${stations.join(",")}] station ${station} failed, continuing with the rest —`, error instanceof Error ? error.message : error);
    }
  }

  if (!succeededStations.length) throw new Error(`Every station in [${stations.join(",")}] failed — no mosaic coverage available.`);

  const mergedPoints = cellsToGrid(merged, GRID_STEP_DEG);
  const bounds = boundsOf(mergedPoints);
  const imageDataUrl = renderMrmsGridToDataUrl(mergedPoints, bounds, GRID_STEP_DEG);
  if (!imageDataUrl) throw new Error(`No mosaic coverage available for [${stations.join(",")}].`);

  console.log(`[mosaic:${stations.join(",")}] ${perStationMs.join(" ")}, total ${((performance.now() - t0) / 1000).toFixed(1)}s${failedStations.length ? ` (${failedStations.length} station(s) skipped: ${failedStations.join(",")})` : ""}`);

  const payload = {
    time: new Date().toISOString(),
    bounds,
    step: GRID_STEP_DEG,
    imageDataUrl,
    // Reflects what's ACTUALLY in the composite, not the originally-requested list — a caller
    // relying on this (e.g. the dev console.log of which stations went into a mosaic) should never
    // be told a station contributed when it silently failed and got skipped.
    stations: succeededStations,
    failedStations: failedStations.length ? failedStations : undefined,
    source: `NEXRAD Level II mosaic (${succeededStations.join(", ")})`,
  };
  setCache(cacheKey, payload, MOSAIC_CACHE_TTL_MS);
  // Retained under the ORIGINALLY REQUESTED combo (a site's fixed, configured station set), not
  // succeededStations — that key is stable across requests (matches exactly what the app will ask
  // for again via mosaicKey), whereas succeededStations can jitter run to run whenever one member
  // has a transient failure, which would fragment history across many near-duplicate keys and make
  // it much slower to ever cross MIN_INHOUSE_FRAMES. A frame retained under a transient partial
  // failure is the same tradeoff the live mosaic already accepts (degrade gracefully, don't refuse).
  recordFrame(mosaicKey(stations), payload);
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

  const respondJson = (status: number, body: unknown, extraHeaders: Record<string, string> = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", ...extraHeaders });
    response.end(JSON.stringify(body));
  };

  // Special-cased ahead of the generic single-station routing below — takes a `stations` list
  // instead of a single `station` param, so it can't share that block's validation.
  if (url.pathname === "/mosaic") {
    handleMosaic(url.searchParams.get("stations") ?? "")
      .then((result) => respondJson(result.status, result.body, { "X-Radar-Source": result.source }))
      .catch((error: unknown) => {
        console.error(`[mosaic] request failed:`, error);
        respondJson(502, { error: error instanceof Error ? error.message : "Mosaic request failed." });
      });
    return;
  }

  // /frames and /frame each accept EITHER a single `station` (existing single-station history) OR
  // a `stations` list (a mosaic combo's retained history, keyed exactly like computeMosaic's own
  // recordFrame call above via mosaicKey) — special-cased here, ahead of the generic single-station
  // routing below, for the same reason /mosaic is: a `stations` list can't share that block's
  // single-ID validation.
  if (url.pathname === "/frames" || url.pathname === "/frame") {
    const stationsParam = url.searchParams.get("stations");
    let key: string;
    if (stationsParam) {
      const stations = [...new Set(stationsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
      if (stations.length === 0) {
        respondJson(400, { error: "At least one station is required, e.g. ?stations=KFFC,KJGX." });
        return;
      }
      for (const s of stations) {
        if (!STATION_ID_PATTERN.test(s)) {
          respondJson(400, { error: `Invalid station ID: ${s}` });
          return;
        }
      }
      key = mosaicKey(stations);
    } else {
      const station = url.searchParams.get("station")?.trim().toUpperCase();
      if (!station || !STATION_ID_PATTERN.test(station)) {
        respondJson(400, { error: "A valid radar station ID is required, e.g. KFFC." });
        return;
      }
      key = station;
    }

    const promise = url.pathname === "/frames" ? handleFrameHistory(key) : handleFrame(key, url.searchParams.get("time"));
    promise
      .then((result) => respondJson(result.status, result.body, { "X-Radar-Source": result.source }))
      .catch((error: unknown) => {
        console.error(`[${url.pathname}] request failed:`, error);
        respondJson(502, { error: error instanceof Error ? error.message : "Radar worker request failed." });
      });
    return;
  }

  const station = url.searchParams.get("station")?.trim().toUpperCase();

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
// Originally 80s (just under the 90s cache TTL, to never let it expire) —
// found live via fly logs this was too aggressive: each station's cold
// compute takes ~15-25s, so 2 stations back to back can occupy ~30-50s of
// every 80s cycle. Since prewarm shares the same single compute slot as real
// traffic (deliberately — it must respect the same concurrency safety, not
// bypass it), that duty cycle meant a real user's request had a meaningful
// chance of queuing behind a prewarm cycle instead of getting the fast path
// pre-warming exists to provide. 150s traded some cache-staleness for
// leaving real traffic more free capacity — but a second real incident (same
// severe-weather event) showed even that was too aggressive: with the
// underlying volume parse itself now taking up to 60-210+ seconds (see
// level2.ts), forcing BOTH stations through that on a fixed schedule,
// regardless of whether anyone's actually looking, was a major contributor
// to sustained memory pressure and repeated OOMs — self-inflicted load
// compounding with real, unavoidable severe-weather-driven cost. Raised to
// match the cache TTL (5 min) so a cycle only ever fires right as the
// existing warm entry would otherwise go stale, not on top of one still
// providing value. The self-rescheduling fix below already makes the exact
// interval value a soft target rather than a hard safety requirement — a
// slow cycle simply pushes the next one later, it can never overlap.
const PREWARM_INTERVAL_MS = 300_000;

// Real bug found live, same incident as the cache-eviction fixes above:
// setInterval fires unconditionally every PREWARM_INTERVAL_MS regardless of
// whether the PREVIOUS prewarm() call has finished. Once real-world compute
// started taking longer than the interval (which is exactly what the memory
// leak above caused, via GC thrashing), each new interval firing added
// another full prewarm cycle on top of one still running — a second,
// independent way this could compound into a growing backlog even with the
// per-station in-flight dedup already in place (dedup only helps while a
// request for that exact station is still active; it doesn't stop a NEW
// request from queuing the moment the old one finishes but before the next
// stacked interval fires). Self-rescheduling instead: the next cycle is
// only scheduled after the current one fully completes, so this can never
// run more than one prewarm cycle at a time regardless of how slow compute
// gets.
async function prewarm() {
  for (const station of PREWARM_STATIONS) {
    try {
      await handleReflectivityOrVelocity(station, "reflectivity");
    } catch (error) {
      console.error(`[prewarm:${station}] failed —`, error instanceof Error ? error.message : error);
    }
  }
  setTimeout(prewarm, PREWARM_INTERVAL_MS);
}

prewarm();
