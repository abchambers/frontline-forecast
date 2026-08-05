// Mirrors radar-worker/src/fetch-with-timeout.ts — see that file for why:
// a hung outbound connection with no timeout is a silent failure mode.
// Lower-stakes here since Vercel bounds function execution time on its own,
// but this turns a platform-level timeout into a real, diagnosable error
// instead of just "the function got killed."
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
