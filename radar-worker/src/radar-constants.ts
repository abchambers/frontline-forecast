// Shared between server.ts (the main HTTP process) and compute-worker.ts (the child process that
// does the actual decode+compute, see server.ts's own comment on why that split exists) — a single
// source of truth so the two processes can never quietly drift onto different resolutions/ranges.

// Raised back 0.006 -> 0.004deg, 2026-09-02, once both of Andrew's own stated prerequisites were
// actually met, not assumed: (1) quality -- the VCP-mode dimming, elongation check, strength
// exemption, and color desaturation all shipped and verified against real precipitation false
// positives; (2) safety -- compute-worker.ts moved decode+compute into a killable child process
// with a real enforced timeout, so a hang degrades to one failed request instead of the hours-long
// outage that forced the original pullback (see git history, 2026-09-01 morning).
//
// Re-verified the memory calibration under the NEW architecture specifically, rather than trusting
// the old pre-watchdog numbers still applied: the original 0.004deg testing measured the in-process
// computation directly; this moved to a separate child process afterward, which inherits the same
// --max-old-space-size=3584 ceiling (confirmed live back when compute-worker.ts shipped) but is a
// different enough process topology that "should be the same" wasn't good enough to act on. Watched
// the REAL child process's own RSS (not a synthetic script) across several full prewarm cycles at
// this resolution: consistently peaked in the 900MB-1.5GB range, zero crashes, comfortably under
// the 3584MB ceiling -- consistent with (and slightly better than) the original pre-watchdog
// calibration. If a real OOM recurs even here, the next lever is typed per-cell storage (Int16Array
// with a fixed dBZ scale factor instead of Float32Array) for another ~2x, not another resolution cut.
export const GRID_STEP_DEG = 0.004;

// Raised 230km -> 460km, 2026-08-31 — see git history for the full real-NEXRAD-range/RadarScope-
// parity reasoning and the live measurements that justified it. Unaffected by the resolution
// pullback above; range and resolution are separate axes.
export const MAX_RANGE_KM = 460;
