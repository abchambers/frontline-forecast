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

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
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
}
