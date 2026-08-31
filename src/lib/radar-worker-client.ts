// Optional fast path: if the persistent Fly.io worker (radar-worker/) is
// configured, prefer it over this app's own per-request S3 polling — same
// data, same decode/projection logic, but served from an always-warm process
// instead of a serverless cold start. Returns null on ANY failure (unset env,
// network error, timeout, non-2xx) so callers fall back to their existing
// local logic unchanged — the worker is a speed optimization, never a hard
// dependency for radar to work at all.
const WORKER_URL = process.env.RADAR_WORKER_URL;
const WORKER_API_KEY = process.env.RADAR_WORKER_API_KEY;
// Real production bug found live: a cold worker request measured 26-30s at
// the resolution then in use (0.0025deg) — this timeout PLUS however long
// the local fallback itself then takes both have to fit inside the calling
// route's own maxDuration (route.ts), or Vercel kills the whole function
// with a bare 504 before the fallback ever runs, worse than no worker at
// all. Since then: the worker's compute was both sped up (shared geometry
// across moments, a cheaper flat-earth approximation) and its resolution
// pulled back slightly (0.0033deg) specifically because 0.0025deg's cost
// wasn't just slow, it scaled non-linearly. Measured live afterward: a full
// reflectivity+velocity request's pure compute dropped to single-digit
// seconds locally. Raised from the emergency-hotfix value of 9s accordingly,
// still leaving real margin under maxDuration=30 for the local fallback's
// own ~3-12s if the worker is ever genuinely down or overloaded.
const TIMEOUT_MS = 15_000;

// User-reported live ("radar struggles to switch between IEM and the house radar"): during a real
// worker outage, every single call still pays the full TIMEOUT_MS above before falling back — the
// timeout itself is correctly tuned for a genuinely slow-but-alive worker (see the history above),
// so shortening it would just as easily abandon a real cold-start. The actual fix is not to shorten
// the wait, but to stop waiting at all once the worker has already shown itself to be down: after a
// few consecutive failures, skip straight to the null (fallback) return for a cooldown window, then
// let one request through to check if it's back. This is in-memory and per-lambda-instance, not a
// real distributed circuit breaker — Vercel doesn't guarantee the same instance across requests —
// but it's the same "best-effort, no hard dependency" spirit as the per-request cache a few lines
// down, and it's what actually removes the stall for the common case of one warm instance serving a
// user's radar tab through a real multi-minute outage.
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

export async function fetchFromWorker(path: string): Promise<unknown | null> {
  if (!WORKER_URL) return null;
  if (Date.now() < circuitOpenUntil) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${WORKER_URL}${path}`, {
      headers: WORKER_API_KEY ? { "x-worker-key": WORKER_API_KEY } : {},
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      console.error(`radar-worker-client: ${path} returned ${response.status}`);
      recordFailure();
      return null;
    }
    consecutiveFailures = 0;
    circuitOpenUntil = 0;
    return await response.json();
  } catch (error) {
    console.error(`radar-worker-client: ${path} failed —`, error instanceof Error ? error.message : error);
    recordFailure();
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function recordFailure() {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    circuitOpenUntil = Date.now() + COOLDOWN_MS;
    consecutiveFailures = 0;
  }
}

// Separate timeout + circuit breaker from fetchFromWorker above, on purpose — a mosaic request
// decodes several stations sequentially in one call (measured live: ~14-20s/station on the
// performance-1x worker, so a 4-station default mosaic can genuinely take a minute), an entirely
// different latency budget than a single-station call. Sharing the 15s single-station timeout
// would make every mosaic request fail before it could ever finish; sharing the same circuit
// breaker state would let a few slow (not actually broken) mosaic calls incorrectly trip the
// breaker for ordinary single-station traffic too.
const MOSAIC_TIMEOUT_MS = 90_000;
const MOSAIC_FAILURE_THRESHOLD = 3;
const MOSAIC_COOLDOWN_MS = 60_000;
let mosaicConsecutiveFailures = 0;
let mosaicCircuitOpenUntil = 0;

export async function fetchMosaicFromWorker(stations: string[]): Promise<unknown | null> {
  if (!WORKER_URL) return null;
  if (Date.now() < mosaicCircuitOpenUntil) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MOSAIC_TIMEOUT_MS);
  try {
    const response = await fetch(`${WORKER_URL}/mosaic?stations=${stations.join(",")}`, {
      headers: WORKER_API_KEY ? { "x-worker-key": WORKER_API_KEY } : {},
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      console.error(`radar-worker-client: /mosaic returned ${response.status}`);
      recordMosaicFailure();
      return null;
    }
    mosaicConsecutiveFailures = 0;
    mosaicCircuitOpenUntil = 0;
    return await response.json();
  } catch (error) {
    console.error(`radar-worker-client: /mosaic failed —`, error instanceof Error ? error.message : error);
    recordMosaicFailure();
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function recordMosaicFailure() {
  mosaicConsecutiveFailures += 1;
  if (mosaicConsecutiveFailures >= MOSAIC_FAILURE_THRESHOLD) {
    mosaicCircuitOpenUntil = Date.now() + MOSAIC_COOLDOWN_MS;
    mosaicConsecutiveFailures = 0;
  }
}
