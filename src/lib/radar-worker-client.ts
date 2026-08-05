// Optional fast path: if the persistent Fly.io worker (radar-worker/) is
// configured, prefer it over this app's own per-request S3 polling — same
// data, same decode/projection logic, but served from an always-warm process
// instead of a serverless cold start. Returns null on ANY failure (unset env,
// network error, timeout, non-2xx) so callers fall back to their existing
// local logic unchanged — the worker is a speed optimization, never a hard
// dependency for radar to work at all.
const WORKER_URL = process.env.RADAR_WORKER_URL;
const WORKER_API_KEY = process.env.RADAR_WORKER_API_KEY;
const TIMEOUT_MS = 4000;

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
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
