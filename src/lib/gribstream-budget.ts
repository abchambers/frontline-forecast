// Shared between the radar route and the status route — kept out of the
// route.ts file itself because Next.js App Router route handlers only allow
// exporting HTTP method handlers and a small set of recognized config
// values, not arbitrary helper functions.

// Hard, guaranteed ceiling — deliberately conservative and independent of
// whatever the actual per-call credit cost turns out to be, since that's an
// external measurement this app can't verify from GribStream's response. At
// the original, measured pre-optimization cost (~107 credits/call), 8
// calls/day is ~856 credits, leaving real margin under a 1200/day cap even
// if later cost reductions end up mattering less than estimated. If the
// real cap is ever raised (a paid GribStream tier), raise this to match —
// but compute the new value against measured usage, not hope.
export const MAX_DAILY_CALLS = 8;

let dailyCallCount = 0;
let dailyResetAt = 0;

function rollDailyWindow() {
  const now = Date.now();
  if (now >= dailyResetAt) {
    dailyCallCount = 0;
    // Reset at the next UTC midnight, matching how a daily API quota resets.
    const next = new Date();
    next.setUTCHours(24, 0, 0, 0);
    dailyResetAt = next.getTime();
  }
}

export function withinDailyBudget(): boolean {
  rollDailyWindow();
  return dailyCallCount < MAX_DAILY_CALLS;
}

export function recordGribstreamCall() {
  rollDailyWindow();
  dailyCallCount += 1;
}

export function getDailyUsage() {
  rollDailyWindow();
  return { callsToday: dailyCallCount, maxDailyCalls: MAX_DAILY_CALLS, resetsAt: new Date(dailyResetAt || Date.now()).toISOString() };
}

// Instant kill switch: set GRIBSTREAM_DISABLED=true in the deployment
// environment to force every radar view back to the original provider tiles
// with no code change — just an env var flip and a redeploy/restart, much
// faster than removing and re-adding GRIBSTREAM_API_KEY, and explicit about
// intent (a missing key could just be a config accident; this can't be).
export function isGribstreamDisabled(): boolean {
  return process.env.GRIBSTREAM_DISABLED === "true";
}
