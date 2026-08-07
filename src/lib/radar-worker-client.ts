// Optional fast path: if the persistent Fly.io worker (radar-worker/) is
// configured, prefer it over this app's own per-request S3 polling — same
// data, same decode/projection logic, but served from an always-warm process
// instead of a serverless cold start. Returns null on ANY failure (unset env,
// network error, timeout, non-2xx) so callers fall back to their existing
// local logic unchanged — the worker is a speed optimization, never a hard
// dependency for radar to work at all.
const WORKER_URL = process.env.RADAR_WORKER_URL;
const WORKER_API_KEY = process.env.RADAR_WORKER_API_KEY;
// Measured live against the deployed worker at the current (finer,
// near-native-resolution) grid step: a cold decode+render (uncached station,
// or its 90s payload cache expired) took ~12.5s on a dev machine — Fly's
// shared-cpu-1x has measured meaningfully slower than that for the same
// compute before (see project memory), so this leaves real margin rather
// than cutting it close. Must stay under the calling route's own
// `maxDuration` (see route.ts) or Vercel kills the whole function first,
// which would look identical to a timeout here but skip this fallback logic
// entirely.
const TIMEOUT_MS = 25_000;

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
