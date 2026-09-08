// Every outbound call this worker makes (NWS station lookup, S3 list/get for
// NEXRAD Level II/III) previously used plain fetch() with no timeout —
// harmless on Vercel where a function has its own hard execution limit
// anyway, but a real problem for a long-running process: a single hung
// connection (a stalled TCP handshake, a route that never resolves) blocks
// that request forever with no error, no log, nothing to diagnose. Found
// live: /health responded instantly while /reflectivity hung past 120s on
// the very first real deploy. Wrapping every outbound fetch in an explicit
// AbortController timeout turns a silent infinite hang into a real error the
// route handlers already know how to report as a 502.
const DEFAULT_TIMEOUT_MS = 10_000;

// Real, global outbound-fetch concurrency cap, 2026-09-08 — added after two real Phase 3
// incidents this session traced to the SAME root cause: this worker's own outbound capacity (not
// any single upstream's rate limit — fly logs both times showed S3 AND api.weather.gov timing out
// simultaneously, the network-saturation signature) getting overwhelmed. The safety that existed
// before this (compute-worker.ts's VOLUME_FETCH_BATCH_SIZE, gating fetches WITHIN one mosaic job)
// was real but incomplete: it said nothing about how many fetches OTHER concurrent jobs (a second
// mosaic, a single-station reflectivity request, a prewarm cycle, now upper-air's GRIB2 fetches
// too) might be making at the very same moment, since each job only ever knew about its own
// fetches. Real measured data points from live testing this session: 2 concurrent jobs x 2
// fetches/job (4 total) completed cleanly with zero drops; 3 concurrent jobs x 2 fetches/job (6
// total) caused real S3 timeouts, dropped stations, and a 17-minute client-facing hang even though
// the server-side work eventually succeeded. Capped here at the PROVEN-safe number (4), not
// somewhere between the known-good and known-bad points — raise only with fresh live verification,
// the same discipline every other change to a concurrency constant on this worker has followed.
//
// Every real network call in this process goes through fetchWithTimeout already (confirmed: NEXRAD
// S3 list+download in level2.ts, NWS site lookups in site.ts, GFS/GRIB2 fetches in upper-air.ts),
// so gating IT ONCE here is a true global cap regardless of which job kind initiated the request —
// strictly more correct than the old per-job batching, which could never see fetches from a
// DIFFERENT concurrently-running job at all.
const MAX_CONCURRENT_OUTBOUND_FETCHES = 4;
let activeOutboundFetches = 0;
const outboundFetchQueue: (() => void)[] = [];

async function acquireOutboundFetchSlot(): Promise<void> {
  if (activeOutboundFetches >= MAX_CONCURRENT_OUTBOUND_FETCHES) {
    await new Promise<void>((resolve) => outboundFetchQueue.push(resolve));
  }
  activeOutboundFetches += 1;
}

function releaseOutboundFetchSlot(): void {
  activeOutboundFetches -= 1;
  const next = outboundFetchQueue.shift();
  if (next) next();
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  // Queue wait time deliberately does NOT count against timeoutMs — that budget exists to catch a
  // hung NETWORK connection (see this file's own history above), not to bound how long a request
  // waits its turn for a slot. The outer job-level timeout (compute-worker.ts's COMPUTE_TIMEOUT_MS)
  // is the real backstop against a request stuck too long in this queue.
  await acquireOutboundFetchSlot();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request to ${url} timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    releaseOutboundFetchSlot();
  }
}
