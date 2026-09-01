// Shared between server.ts (the main HTTP process) and compute-worker.ts (the child process that
// does the actual decode+compute, see server.ts's own comment on why that split exists) — a single
// source of truth so the two processes can never quietly drift onto different resolutions/ranges.

// Pulled back 0.004 -> 0.006deg, 2026-09-01 (Andrew's explicit call), the morning after shipping
// 0.004deg: the worker was found unresponsive for hours overnight (/health failing, no known
// healthy instances) with NO OOM or crash signal anywhere in the logs — the process was alive but
// stuck, not killed. project.ts's flat-array refactor was verified hard against MEMORY (see that
// file's history) but never load-tested against sustained concurrent request bursts, and this
// worker still runs all its heavy decode+compute fully SYNCHRONOUSLY on one thread with no yield
// points and no timeout. 0.004deg made every request's compute step genuinely take longer, thinning
// the safety margin against an already-documented risk class. Pulled back to the known-safe value;
// the compute-worker.ts split + timeout below is the real fix for that risk class, independent of
// whatever resolution this ends up at.
export const GRID_STEP_DEG = 0.006;

// Raised 230km -> 460km, 2026-08-31 — see git history for the full real-NEXRAD-range/RadarScope-
// parity reasoning and the live measurements that justified it. Unaffected by the resolution
// pullback above; range and resolution are separate axes.
export const MAX_RANGE_KM = 460;
