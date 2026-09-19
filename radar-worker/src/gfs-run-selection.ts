// Picks the newest GFS cycle that is really published. Pure (no I/O of its own) so the decision logic
// can be tested; the caller supplies the probe.
//
// A probe has THREE outcomes, not two. "absent" (the object is definitively not there yet) is the only
// thing that justifies moving to an older cycle. "unknown" (a timeout, a dropped connection, a 5xx)
// says nothing about whether the cycle exists. Treating unknown as absent -- which the previous version
// did via `.catch(() => null)` -- silently served a map up to 12+ hours old whenever the worker was busy
// or NOAA hiccuped, and then cached it. Found live 2026-09-19: 500mb showed the 18Z run of the previous
// day while the 250mb map, computed minutes later, correctly showed the 06Z run that had been on
// NOAA's bucket for five hours.

export const GFS_CYCLE_HOURS = [0, 6, 12, 18];
export const REAL_PUBLISH_LAG_HOURS = 5;

export type RunCandidate = { runDate: string; runHour: string };
export type Probe = { kind: "present"; fileSize: number } | { kind: "absent" } | { kind: "unknown" };
export type SelectedRun = RunCandidate & { fileSize: number; degraded: boolean };

const pad2 = (n: number) => n.toString().padStart(2, "0");

export function candidateRuns(now: Date): RunCandidate[] {
  const lagged = new Date(now.getTime() - REAL_PUBLISH_LAG_HOURS * 3_600_000);
  const candidates: RunCandidate[] = [];
  for (let back = 0; back < 3; back++) {
    const t = new Date(lagged.getTime() - back * 6 * 3_600_000);
    const cycleHour = GFS_CYCLE_HOURS.filter((h) => h <= t.getUTCHours()).pop()!;
    candidates.push({ runDate: `${t.getUTCFullYear()}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCDate())}`, runHour: pad2(cycleHour) });
  }
  return candidates;
}

export async function selectLatestRun(
  now: Date,
  probe: (candidate: RunCandidate) => Promise<Probe>,
  options: { retries?: number; wait?: (ms: number) => Promise<void> } = {},
): Promise<SelectedRun> {
  const retries = options.retries ?? 2;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let skippedOnUncertainty = false;
  for (const candidate of candidateRuns(now)) {
    let outcome: Probe = { kind: "unknown" };
    for (let attempt = 0; attempt <= retries; attempt++) {
      outcome = await probe(candidate);
      if (outcome.kind !== "unknown") break;
      if (attempt < retries) await wait(750 * (attempt + 1));
    }
    if (outcome.kind === "present") return { ...candidate, fileSize: outcome.fileSize, degraded: skippedOnUncertainty };
    if (outcome.kind === "unknown") skippedOnUncertainty = true;
  }
  throw new Error("No recent GFS run is available on NOAA's public feed.");
}
