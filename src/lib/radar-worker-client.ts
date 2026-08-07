// Optional fast path: if the persistent Fly.io worker (radar-worker/) is
// configured, prefer it over this app's own per-request S3 polling — same
// data, same decode/projection logic, but served from an always-warm process
// instead of a serverless cold start. Returns null on ANY failure (unset env,
// network error, timeout, non-2xx) so callers fall back to their existing
// local logic unchanged — the worker is a speed optimization, never a hard
// dependency for radar to work at all.
const WORKER_URL = process.env.RADAR_WORKER_URL;
const WORKER_API_KEY = process.env.RADAR_WORKER_API_KEY;
// Real production bug found live: a cold worker request (uncached station)
// measured 26-30s on Fly's shared-cpu-1x at the current near-native grid
// resolution. Setting this timeout anywhere close to that is actually
// dangerous, not just slow — this timeout PLUS however long the local
// fallback itself then takes both have to fit inside the calling route's own
// maxDuration (route.ts). Set too high, a slow worker eats the whole time
// budget, the fallback never gets a chance to finish either, and Vercel
// kills the entire function with a bare 504 — worse than not having a
// worker at all. Kept short and deliberately conservative: long enough to
// reliably catch a warm-cache worker response (~1s) or a moderately-quick
// cold one, short enough that (this timeout + local fallback's own ~3-12s)
// stays safely under maxDuration even in the worst case.
const TIMEOUT_MS = 9_000;

export async function fetchFromWorker(path: string): Promise<unknown | null> {
  if (!WORKER_URL) return null;

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
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`radar-worker-client: ${path} failed —`, error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
