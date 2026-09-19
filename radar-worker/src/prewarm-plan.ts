// Decides WHAT the background prewarm loop warms and WHEN. Pure (no I/O, no timers) so the decisions
// can be tested.
//
// Background (measured 2026-09-19): the loop used to prewarm 12 national metro mosaics on every cycle.
// A cycle took ~9-10 minutes and each entry only lives 5, so those metros were warm about a third of
// the time while the loop kept the single compute slot busy ~65% of the day -- which is also what real
// requests (upper-air, fresh tiles) queued behind, and what an OOM crash collided with. Now only the
// home combos are always warmed; a metro is warmed only while someone has actually asked for it lately.

export const DEMAND_WINDOW_MS = 6 * 3_600_000;
// Never restart back-to-back: even if a cycle overruns its period, leave the compute slot idle briefly.
export const MIN_PREWARM_GAP_MS = 30_000;
const MAX_TRACKED_COMBOS = 500;

export type Combo = readonly string[];

// The same identity the worker's own cache key uses (station order and case don't matter).
export function comboKey(stations: readonly string[]): string {
  return [...new Set(stations.map((station) => station.trim().toUpperCase()).filter(Boolean))].sort().join(",");
}

export function recordDemand(demand: Map<string, number>, stations: readonly string[], now: number): void {
  const key = comboKey(stations);
  if (!key) return;
  if (demand.size >= MAX_TRACKED_COMBOS) {
    for (const [existing, at] of demand) if (now - at > DEMAND_WINDOW_MS) demand.delete(existing);
    if (demand.size >= MAX_TRACKED_COMBOS) demand.clear();
  }
  demand.set(key, now);
}

// Always-on combos first (in their given order), then any on-demand combo requested within the window.
export function selectPrewarmCombos(alwaysOn: readonly Combo[], onDemand: readonly Combo[], demand: ReadonlyMap<string, number>, now: number, windowMs = DEMAND_WINDOW_MS): Combo[] {
  const wanted = onDemand.filter((combo) => {
    const at = demand.get(comboKey(combo));
    return at !== undefined && now - at <= windowMs;
  });
  return [...alwaysOn, ...wanted];
}

// Start-to-start scheduling: the next cycle begins `periodMs` after this one BEGAN, not after it ended.
export function nextPrewarmDelayMs(elapsedMs: number, periodMs: number, minGapMs = MIN_PREWARM_GAP_MS): number {
  return Math.max(minGapMs, periodMs - elapsedMs);
}
