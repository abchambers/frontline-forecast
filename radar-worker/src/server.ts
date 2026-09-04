import { createServer } from "node:http";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchStormTracks, fetchHailDetections, fetchTvsDetections, fetchMesocycloneDetections } from "./level3-markers.js";
import { GRID_STEP_DEG, MAX_RANGE_KM } from "./radar-constants.js";
import { sliceTileFromComposite } from "./tile-slice.js";
import type { MrmsBounds } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
// download + binary decode (the compute worker, not this process, holds that
// cache now — see COMPUTE_WORKER_PATH below).
//
// GRID_STEP_DEG/MAX_RANGE_KM live in radar-constants.ts now, shared with compute-worker.ts (the
// child process that actually does the decode+compute — see that file and the block comment near
// COMPUTE_WORKER_PATH below for why this moved out of a single process). See that file for the
// full history of both values.
//
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
//
// Raised 1 -> 2, 2026-09-03: real problem found while prototyping Phase 3 (tile-native station
// selection) — an on-demand request for a combo outside the 2 continuously-running prewarm cycles
// had to queue behind whatever prewarm job was already running, and total round-trip (queue wait +
// real compute) occasionally exceeded what the client connection would tolerate, failing outright
// even though the server-side computation itself succeeded every time (confirmed live in fly logs).
// Phase 3's whole point is many more one-off, non-prewarmed combos, so this queue depth of 1 was
// about to become a real bottleneck, not just an inconvenience.
//
// This does NOT mean true CPU parallelism -- there's still only ONE persistent compute-worker
// child process (single JS thread), so jobs' own synchronous decode work still can't run at the
// exact same instant. What it buys: jobs' ASYNC work (S3 fetches, same mechanism already proven
// safe for concurrent fetches WITHIN one mosaic job) can genuinely interleave instead of one job
// blocking another's fetch phase from even starting. Verified live before trusting this — see git
// history for the real RSS numbers watched during an actual overlap.
//
// Raised 2 -> 3, 2026-09-04, real evidence from the Phase 3 redesign's own live verification: a
// single coalesced viewport can legitimately need 2 brand-new cold combos at once (crossing a
// region boundary), and with a live prewarm cycle also possibly active, 2 slots meant a realistic
// case was already queuing behind itself. Chose 3, not more, from the real memory math on record:
// steady-state floor ~1.04GB (post partial-decode), one active job ~1.5-1.6GB peak, two concurrent
// verified at ~2.04GB peak (~0.5-0.6GB per additional concurrent job) — three should land near
// ~2.5-2.6GB, still a real ~0.5GB+ margin below the ~3.1-3.2GB level that caused the two real OOMs
// this project has already had. Verify live (SSH + /proc/<pid>/status, real concurrent jobs) before
// trusting this number, same discipline as every previous change to this constant — do not raise
// again without doing that first.
const MAX_CONCURRENT_COMPUTE = 3;
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

// Real incident, 2026-09-01: the actual decode+compute work (compute-worker.ts) used to run
// in THIS process, inline. A genuinely stuck computation — no crash, no OOM, just stuck — left the
// worker unresponsive for HOURS (no known healthy instances, /health failing) because Node's single
// event-loop thread can't do anything else, including answer /health, while synchronous JS is
// running, and nothing here had a way to notice or recover from that. withComputeSlot above already
// serializes this correctly (one job at a time); the piece that was missing is a way to actually
// KILL a job that's taking too long, which is only possible if that job runs in a different OS
// process — a stuck synchronous loop can't even see a SIGTERM (its own event loop is what's stuck),
// only the OS killing the process from outside actually works.
//
// A single persistent worker (not a per-request fork) keeps the existing "warm parsed-volume cache
// across requests" benefit (level2.ts's getVolumeCached cache now lives in the worker process, not
// here) for the common case, and is only ever replaced when something actually goes wrong.
const COMPUTE_WORKER_PATH = path.join(__dirname, "compute-worker.js");
// Generous on purpose: level2.ts documents a real volume parse alone taking 60-210+ seconds during
// severe weather, independent of anything this app's own code does. This timeout exists to bound a
// genuine HANG to a few minutes instead of indefinitely, not to cut off a legitimately slow (but
// working) severe-weather request before it would have succeeded on its own — set comfortably
// above that documented worst case.
const COMPUTE_TIMEOUT_MS = Number(process.env.COMPUTE_TIMEOUT_MS ?? 240_000);

type ComputeWorkerJob = { kind: "single"; station: string; moment: "reflectivity" | "velocity" } | { kind: "mosaic"; stations: string[] };
type ComputeWorkerRequest = ComputeWorkerJob & { id: number };
type ComputeWorkerResponse = { id: number; ok: true; body: unknown } | { id: number; ok: false; error: string };

let computeWorker: ChildProcess | null = null;
let nextComputeRequestId = 1;
const pendingComputeJobs = new Map<number, { resolve: (body: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();

function spawnComputeWorker(): ChildProcess {
  const child = fork(COMPUTE_WORKER_PATH, [], { stdio: ["ignore", "inherit", "inherit", "ipc"] });
  child.on("message", (message: ComputeWorkerResponse) => {
    const job = pendingComputeJobs.get(message.id);
    if (!job) return;
    pendingComputeJobs.delete(message.id);
    clearTimeout(job.timeout);
    if (message.ok) job.resolve(message.body);
    else job.reject(new Error(message.error));
  });
  child.on("exit", (code, signal) => {
    console.error(`[compute-worker] exited unexpectedly (code=${code}, signal=${signal}) — respawning on next request`);
    // Whatever was in flight on this worker can never get an answer now — fail it rather than hang
    // its caller forever. MAX_CONCURRENT_COMPUTE=1 means there's at most one such job.
    for (const [id, job] of pendingComputeJobs) {
      clearTimeout(job.timeout);
      job.reject(new Error("Compute worker exited unexpectedly."));
      pendingComputeJobs.delete(id);
    }
    if (computeWorker === child) computeWorker = null;
  });
  return child;
}

function getComputeWorker(): ChildProcess {
  if (!computeWorker) computeWorker = spawnComputeWorker();
  return computeWorker;
}

function runInComputeWorker(request: ComputeWorkerJob): Promise<unknown> {
  const id = nextComputeRequestId++;
  const child = getComputeWorker();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingComputeJobs.delete(id);
      console.error(`[compute-worker] job ${id} (${request.kind}) exceeded ${COMPUTE_TIMEOUT_MS / 1000}s — killing and respawning the worker`);
      // SIGKILL, not SIGTERM: if this job is genuinely stuck in synchronous JS, the worker's event
      // loop is what's stuck, so it can never see or act on a graceful SIGTERM either — only the OS
      // forcibly tearing down the process actually works.
      child.kill("SIGKILL");
      if (computeWorker === child) computeWorker = null;
      reject(new Error(`Compute timed out after ${COMPUTE_TIMEOUT_MS / 1000}s.`));
    }, COMPUTE_TIMEOUT_MS);
    pendingComputeJobs.set(id, { resolve, reject, timeout });
    child.send({ id, ...request } as ComputeWorkerRequest);
  });
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
  // The actual fetch+decode+geometry+sample+render work all happens in compute-worker.ts now — see
  // that file and the COMPUTE_WORKER_PATH comment above for why. This function's own job shrinks to
  // "delegate, then own the parts that must stay in this process" (the payload cache and the
  // in-house frame-history ring buffer, both pure in-memory bookkeeping the HTTP-facing routes below
  // read directly and synchronously, with no reason to round-trip through IPC).
  const payload = await runInComputeWorker({ kind: "single", station, moment }) as FramePayload;
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
  // Same split as computeReflectivityOrVelocity above — the actual per-station decode+compute+merge
  // work (including the per-station graceful-degradation try/catch, 2026-08-31's real fix) now lives
  // in compute-worker.ts. This function keeps only the cache write and frame-history recording.
  const payload = await runInComputeWorker({ kind: "mosaic", stations }) as FramePayload;
  setCache(cacheKey, payload, MOSAIC_CACHE_TTL_MS);
  // Retained under the ORIGINALLY REQUESTED combo (a site's fixed, configured station set), not
  // whatever subset actually succeeded — that key is stable across requests (matches exactly what
  // the app will ask for again via mosaicKey), whereas the succeeded-subset can jitter run to run
  // whenever one member has a transient failure, which would fragment history across many
  // near-duplicate keys and make it much slower to ever cross MIN_INHOUSE_FRAMES. A frame retained
  // under a transient partial failure is the same tradeoff the live mosaic already accepts (degrade
  // gracefully, don't refuse).
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

  // Phase 1 of the tile-based architecture scoped and prototyped 2026-09-01/02 (see
  // scripts/prototype-mercator-tiles.ts for the real-data seam-check verification this reuses).
  // Deliberately reuses handleMosaic wholesale for the underlying composite -- same caching,
  // dedup, per-station graceful degradation, VCP-mode/elongation/strength-exemption QC, all of it
  // unchanged -- and only adds a slicing step at the very end. A single-station "mosaic" (one
  // entry in `stations`) is just computeMosaic's own already-handled degenerate case, so there's
  // no separate single-station tile path to maintain.
  //
  // Slices ON DEMAND from the composite's own cache rather than pre-slicing and caching every
  // tile separately: scripts/prototype-mercator-tiles.ts measured slicing at ~15ms/tile against
  // real data, negligible next to the composite's own multi-second decode -- a second cache layer
  // here would be real complexity for a cost that's already cheap enough to just redo per request.
  const tileMatch = url.pathname.match(/^\/tile\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (tileMatch) {
    const z = Number(tileMatch[1]);
    const x = Number(tileMatch[2]);
    const y = Number(tileMatch[3]);
    const stationsParam = url.searchParams.get("stations") ?? "";
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
    handleMosaic(stations.join(","))
      .then(async (result) => {
        if (result.status !== 200) {
          respondJson(result.status, result.body);
          return;
        }
        const body = result.body as { imageDataUrl: string; bounds: MrmsBounds; step: number };
        const tileBuffer = await sliceTileFromComposite(body.imageDataUrl, body.bounds, body.step, z, x, y);
        response.writeHead(200, {
          "Content-Type": "image/png",
          "X-Radar-Source": result.source,
          // Tiles are meant to be cached hard at the CDN edge, not just here -- see
          // src/app/api/radar/tile's own Cache-Control for the real header the browser/CDN sees;
          // this one only matters for a direct worker request (dev/debugging).
          "Cache-Control": "public, max-age=60",
        });
        response.end(tileBuffer);
      })
      .catch((error: unknown) => {
        console.error(`[tile:${z}/${x}/${y}] request failed:`, error);
        respondJson(502, { error: error instanceof Error ? error.message : "Tile request failed." });
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
// Real incident, 2026-09-01: mosaic is the default LIVE view for every visitor, but until now
// nothing kept its cache warm — only real requests did, and the mosaic cache TTL (5 min) is short
// enough that anyone arriving more than 5 minutes after the last visitor paid the FULL cold cost
// (measured live: a cold 4-station combo took 40.6s; the same combo warm from a recent request
// answered in 0.18s). Extending the existing single-station prewarm to also cover the mosaic
// combos actually shown by default closes that gap the same safe way the single-station prewarm
// already does — same self-rescheduling loop, same shared compute slot, no new mechanism.
//
// Hardcoded rather than looked up from src/lib/mosaic-station-sets.ts (the main app's table): this
// worker deliberately has no station-coordinate database to look combos up from (see handleMosaic's
// own comment for why — that logic belongs in the app, not here), so this is a hand-synced copy of
// just the two combos that matter: the ones covering this app's actual preset locations
// (weatherDeskLocations all resolve to KFFC or KBMX, same reasoning as PREWARM_STATIONS above).
// Update this alongside mosaic-station-sets.ts if either preset's station set ever changes.
const PREWARM_MOSAIC_COMBOS: string[][] = [
  ["KFFC", "KJGX", "KMXX", "KBMX", "KGSP"],
  ["KBMX", "KMXX", "KGWX", "KHTX"],
];
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
  // Runs AFTER the single-station loop above, deliberately: KFFC/KBMX's own parsed-volume cache
  // (level2.ts's getVolumeCached, shared across every route regardless of single-station vs mosaic)
  // is already warm by the time these run, so each combo only pays a fresh decode for its OTHER
  // members — e.g. KFFC's combo only needs KJGX/KMXX/KGSP fresh, not all 5. The two combos also
  // share KMXX/KBMX with each other, so running KFFC's combo first warms part of KBMX's combo too.
  for (const combo of PREWARM_MOSAIC_COMBOS) {
    try {
      await handleMosaic(combo.join(","));
    } catch (error) {
      console.error(`[prewarm:mosaic:${combo.join(",")}] failed —`, error instanceof Error ? error.message : error);
    }
  }
  setTimeout(prewarm, PREWARM_INTERVAL_MS);
}

prewarm();
