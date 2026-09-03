// Runs as its own OS process (spawned by server.ts via node:child_process), not just a function
// call in the main process — see server.ts's own comment on why. Short version: this file's job
// (download+parse a NEXRAD volume, then run the geometry/sampling/render pipeline) is the exact
// work with a real, already-documented history of taking far longer than expected (a volume parse
// alone has measured 60-210+ seconds during severe weather, independent of anything in this file's
// own code — see level2.ts) and running fully synchronously with no yield points. If that work
// happens in the SAME process as the HTTP server, a genuinely stuck computation blocks the whole
// event loop — including /health — for as long as it's stuck, which is exactly what happened live,
// 2026-09-01 (unresponsive for hours, no crash/OOM signal, meaning something hung rather than
// died). Isolating it in a child process means the main process's HTTP server and /health check
// keep answering no matter what this process is doing, and a hang can be dealt with the only way
// that actually works for synchronous CPU-bound work: killing the process outright (SIGKILL, not a
// graceful shutdown this file could ignore anyway if it's the thing that's stuck).
import { getRadarSite } from "./site.js";
import { getVolumeCached, extractLowestElevation } from "./level2.js";
import { computeReflectivityGrid, computeVelocityGrid, buildCandidateCells, boundsOf, mergeReflectivityCells, makeSharedMergeGrid, sharedMergeGridToPoints } from "./project.js";
import { renderMrmsGridToDataUrl, renderVelocityGridToDataUrl } from "./render.js";
import { GRID_STEP_DEG, MAX_RANGE_KM } from "./radar-constants.js";

type SingleRequest = { id: number; kind: "single"; station: string; moment: "reflectivity" | "velocity" };
type MosaicRequest = { id: number; kind: "mosaic"; stations: string[] };
type WorkerRequest = SingleRequest | MosaicRequest;
type WorkerResponse = { id: number; ok: true; body: unknown } | { id: number; ok: false; error: string };

// Real NEXRAD Volume Coverage Pattern codes for Clear Air surveillance (31 = long-pulse, 35 =
// short-pulse) — confirmed live, 2026-09-01: pulled the real decoded pattern_number for KFFC, KGSP,
// KJGX, KBMX, and KMXX simultaneously and all five read 35, exactly matching what RadarScope's own
// UI showed for the same stations at the same moment ("VCP 35: Clear Air Mode"). A station only
// runs Clear Air Mode when there is NO active precipitation anywhere in its range — that's the
// mode's whole purpose (slower scan, better sensitivity to weak returns, run specifically because
// there's nothing strong to see) — so anything surviving this app's noise-floor pipeline on a
// Clear-Air-Mode frame is, by definition, not a real storm: weak drizzle, biological scatter, or
// ground clutter. See render.ts's isClearAirMode parameter for what this actually changes.
const CLEAR_AIR_VCPS = new Set([31, 35]);

function isClearAirVcp(radar: Awaited<ReturnType<typeof getVolumeCached>>["radar"]): boolean {
  const pattern = radar.vcp?.record?.pattern_number;
  return pattern !== undefined && CLEAR_AIR_VCPS.has(pattern);
}

// Moved verbatim from the previous in-process computeReflectivityOrVelocity — only the
// cache-write/frame-recording at the end stayed behind in server.ts (that's pure in-memory
// bookkeeping the HTTP process owns directly, no reason to round-trip it through IPC).
async function computeSingle(station: string, moment: "reflectivity" | "velocity") {
  const t0 = performance.now();
  const [site, volume] = await Promise.all([getRadarSite(station), getVolumeCached(station)]);
  const { radar } = volume;
  const t1 = performance.now();

  let correlationCoefficient;
  try {
    correlationCoefficient = await extractLowestElevation(radar, "correlationCoefficient", station);
  } catch {
    correlationCoefficient = undefined;
  }

  const candidateCells = buildCandidateCells(site, GRID_STEP_DEG, MAX_RANGE_KM);
  const t2 = performance.now();
  const isClearAirMode = isClearAirVcp(radar);

  let grid, bounds, elevationDeg, qualityControl;
  if (moment === "velocity") {
    const reflElevation = await extractLowestElevation(radar, "reflectivity", station);
    const velElevation = await extractLowestElevation(radar, "velocity", station);
    const { echoMask, qualityControl: qc } = computeReflectivityGrid(reflElevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells);
    ({ grid, bounds } = computeVelocityGrid(velElevation, site, GRID_STEP_DEG, MAX_RANGE_KM, echoMask, candidateCells));
    elevationDeg = velElevation.elevationDeg;
    qualityControl = qc;
  } else {
    const elevation = await extractLowestElevation(radar, "reflectivity", station);
    ({ grid, bounds, qualityControl } = computeReflectivityGrid(elevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells));
    elevationDeg = elevation.elevationDeg;
  }
  const tCompute = performance.now();
  console.log(`[${station}:${moment}] fetch+parse ${(t1 - t0).toFixed(0)}ms, geometry ${(t2 - t1).toFixed(0)}ms, sample ${(tCompute - t2).toFixed(0)}ms, total ${(tCompute - t0).toFixed(0)}ms${moment === "reflectivity" && isClearAirMode ? " (Clear Air Mode — weak-signal dimming applied)" : ""}`);

  const hasSignal = grid.some((point) => point.dbz !== null);
  if (!hasSignal) throw new Error(`No ${moment} data available for ${station} in this volume.`);

  const imageDataUrl =
    moment === "velocity"
      ? renderVelocityGridToDataUrl(grid, bounds, GRID_STEP_DEG)
      : renderMrmsGridToDataUrl(grid, bounds, GRID_STEP_DEG, isClearAirMode);
  if (!imageDataUrl) throw new Error(`Failed to render ${moment} image for ${station}.`);
  console.log(`[${station}:${moment}] render+encode: ${(performance.now() - tCompute).toFixed(0)}ms, image ~${Math.round((imageDataUrl.length * 0.75) / 1024)}KB`);

  return {
    time: volume.lastModified,
    bounds,
    step: GRID_STEP_DEG,
    imageDataUrl,
    elevationDeg,
    qualityControl,
    source: `NEXRAD Level II (${station}, ${moment})`,
  };
}

// Moved verbatim from the previous in-process computeMosaic — same split as computeSingle above.
async function computeMosaic(stations: string[]) {
  const t0 = performance.now();
  const perStationMs: string[] = [];
  const succeededStations: string[] = [];
  const failedStations: string[] = [];

  const siteResults = await Promise.allSettled(stations.map((station) => getRadarSite(station)));
  const resolvedSites: { station: string; site: Awaited<ReturnType<typeof getRadarSite>> }[] = [];
  siteResults.forEach((result, i) => {
    if (result.status === "fulfilled") {
      resolvedSites.push({ station: stations[i], site: result.value });
    } else {
      failedStations.push(stations[i]);
      perStationMs.push(`${stations[i]}=FAILED(site lookup)`);
      console.error(`[mosaic:${stations.join(",")}] station ${stations[i]} site lookup failed, continuing with the rest —`, result.reason instanceof Error ? result.reason.message : result.reason);
    }
  });

  if (!resolvedSites.length) throw new Error(`Every station in [${stations.join(",")}] failed — no mosaic coverage available.`);

  const shared = makeSharedMergeGrid(resolvedSites.map((r) => r.site), GRID_STEP_DEG, MAX_RANGE_KM);
  // Conservative on purpose: only dims the WHOLE composite when EVERY contributing station is in
  // Clear Air Mode (see render.ts/CLEAR_AIR_VCPS for why that's a real, not-a-storm guarantee). A
  // mosaic where some member stations see real precipitation elsewhere in their own range while one
  // station's own clutter spoke persists doesn't get blanket-dimmed here — that's a real gap (see
  // the shape/density-based component check discussed as the next pass), but a per-cell,
  // per-contributing-station tag through the merge is real added complexity this first pass
  // deliberately doesn't take on. Starts true; any non-clear-air OR failed-to-determine station
  // flips it off for the whole composite, never the other way around — never risk under-dimming.
  let allClearAir = true;

  // Real evidence, 2026-09-02 (fly logs): each station's own "fetch+parse" time (13-25s in calm
  // weather) is logged as ONE number, but fetchLatestVolume's S3 download is genuine network I/O —
  // it overlaps fine across stations even on a single JS thread — while only the actual
  // `new Level2Radar(buffer)` parse afterward is synchronous CPU work that has to serialize. The old
  // code awaited getVolumeCached one station at a time, so station 2's download never even started
  // until station 1's ENTIRE fetch+parse+compute+merge had finished — paying the sum of every
  // station's time (a 5-station mosaic measured 54-71s total, live) instead of roughly the slowest
  // one. Firing every station's getVolumeCached concurrently fixes that for the network-bound part.
  // This does NOT fix the worst case: during active severe weather the decode ITSELF (not the
  // network wait) has separately measured 60-210+s per volume (see level2.ts/this file's own header
  // comment) — a nexrad-level-2-data library constraint (it eagerly parses every elevation/moment,
  // no partial-decode option), not a scheduling one, and concurrency across a single JS thread can't
  // parallelize that part. Out of scope here; the real fix for that case is a harder, separate task
  // (patching/replacing the decoder, or more CPU — the latter is a cost decision, not mine to make).
  //
  // REAL INCIDENT, 2026-09-03: shipping the line above as unbounded Promise.allSettled over every
  // station caused a genuine full-VM OOM reboot within hours (fly logs: "Out of memory: Killed
  // process" / Firecracker restart, not just the isolated compute-worker child getting SIGKILLed the
  // way the watchdog is designed to contain). Root cause, from level2.ts's own documented history:
  // each parsed volume measures ~800MB+ RSS, and MAX_NON_PRESET_STATIONS=1 exists specifically to
  // bound "how many distinct non-preset stations' volumes can be alive at once" after an earlier,
  // near-identical incident ("requesting 5 distinct stations in quick succession... OOM'd this
  // worker"). That eviction only trims the long-lived cache Map on insert — it does nothing to stop
  // firing all 5 stations' fetch+decode simultaneously in the first place, so a 5-station mosaic
  // (2 presets + 3 non-preset, like the KFFC combo) could have all 5 ~800MB decoded volumes alive at
  // once mid-flight, before any of them ever reached the point eviction runs.
  //
  // SECOND REAL INCIDENT, same night, same day: batching to 2 at a time was the first fix, and it
  // DID work as designed — this time the kernel's OOM killer only took the isolated compute-worker
  // child (confirmed live: SSH'd in and watched its RSS climb 2.26GB -> 3.17GB in real time, then
  // the exact fly logs line "Out of memory: Killed process 688 ... anon-rss:3134940kB" matching that
  // peak), and the existing watchdog respawned it and self-healed within ~15s -- a real, contained
  // recovery instead of a full machine reboot. But it's still a live crash, twice in one night from
  // this same change. Reverted to fully sequential (batch size 1) at the time.
  //
  // REVISITED, 2026-09-03, same day: the real blocker back then was the steady-state cache floor
  // itself sitting at ~2.26GB at rest on this 4GB machine (barely 1.7GB of headroom before any
  // concurrent decode even started) — not concurrency being inherently unsafe. Shipping the partial
  // NEXRAD decode (level2.ts/partial-level2-parser.ts) cut that same steady-state floor to ~1.04GB,
  // confirmed live via SSH immediately after deploy — roughly half. That changes the actual math
  // this reverted-to-1 decision was based on, so re-verifying concurrency here rather than assuming
  // it's still unsafe. Re-enabling full concurrency (no batch cap) and watching real RSS live during
  // an actual cycle before trusting it — see git log for whether that verification passed.
  const VOLUME_FETCH_BATCH_SIZE = resolvedSites.length;
  const volumeFetchStart = performance.now();
  const volumeResults: PromiseSettledResult<Awaited<ReturnType<typeof getVolumeCached>>>[] = [];
  for (let batchStart = 0; batchStart < resolvedSites.length; batchStart += VOLUME_FETCH_BATCH_SIZE) {
    const batch = resolvedSites.slice(batchStart, batchStart + VOLUME_FETCH_BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(({ station }) => getVolumeCached(station)));
    volumeResults.push(...batchResults);
  }
  console.log(`[mosaic:${stations.join(",")}] volume fetch+parse (batches of ${VOLUME_FETCH_BATCH_SIZE}, ${resolvedSites.length} stations): ${((performance.now() - volumeFetchStart) / 1000).toFixed(1)}s`);

  for (let i = 0; i < resolvedSites.length; i += 1) {
    const { station, site } = resolvedSites[i];
    const volumeResult = volumeResults[i];
    const stationStart = performance.now();
    if (volumeResult.status === "rejected") {
      failedStations.push(station);
      perStationMs.push(`${station}=FAILED(volume fetch)`);
      console.error(`[mosaic:${stations.join(",")}] station ${station} failed, continuing with the rest —`, volumeResult.reason instanceof Error ? volumeResult.reason.message : volumeResult.reason);
      continue;
    }
    try {
      const volume = volumeResult.value;
      if (!isClearAirVcp(volume.radar)) allClearAir = false;
      const elevation = await extractLowestElevation(volume.radar, "reflectivity", station);
      let correlationCoefficient;
      try {
        correlationCoefficient = await extractLowestElevation(volume.radar, "correlationCoefficient", station);
      } catch {
        correlationCoefficient = undefined;
      }
      const candidateCells = buildCandidateCells(site, GRID_STEP_DEG, MAX_RANGE_KM);
      const { grid } = computeReflectivityGrid(elevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells);
      mergeReflectivityCells(shared, grid, GRID_STEP_DEG);
      succeededStations.push(station);
      perStationMs.push(`${station}=${((performance.now() - stationStart) / 1000).toFixed(1)}s`);
    } catch (error) {
      failedStations.push(station);
      perStationMs.push(`${station}=FAILED(${((performance.now() - stationStart) / 1000).toFixed(1)}s)`);
      console.error(`[mosaic:${stations.join(",")}] station ${station} failed, continuing with the rest —`, error instanceof Error ? error.message : error);
    }
  }

  if (!succeededStations.length) throw new Error(`Every station in [${stations.join(",")}] failed — no mosaic coverage available.`);

  const mergedPoints = sharedMergeGridToPoints(shared, GRID_STEP_DEG);
  const bounds = boundsOf(mergedPoints);
  const imageDataUrl = renderMrmsGridToDataUrl(mergedPoints, bounds, GRID_STEP_DEG, allClearAir);
  if (!imageDataUrl) throw new Error(`No mosaic coverage available for [${stations.join(",")}].`);

  console.log(`[mosaic:${stations.join(",")}] ${perStationMs.join(" ")}, total ${((performance.now() - t0) / 1000).toFixed(1)}s${failedStations.length ? ` (${failedStations.length} station(s) skipped: ${failedStations.join(",")})` : ""}${allClearAir ? " (all stations Clear Air Mode — weak-signal dimming applied)" : ""}`);

  return {
    time: new Date().toISOString(),
    bounds,
    step: GRID_STEP_DEG,
    imageDataUrl,
    stations: succeededStations,
    failedStations: failedStations.length ? failedStations : undefined,
    source: `NEXRAD Level II mosaic (${succeededStations.join(", ")})`,
  };
}

process.on("message", (request: WorkerRequest) => {
  const respond = (response: WorkerResponse) => {
    if (process.send) process.send(response);
  };
  const job = request.kind === "single" ? computeSingle(request.station, request.moment) : computeMosaic(request.stations);
  job
    .then((body) => respond({ id: request.id, ok: true, body }))
    .catch((error: unknown) => respond({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
});

// A crash here (an uncaught exception outside the per-job try/catch above — shouldn't happen given
// every job path already catches its own errors, but a defense-in-depth backstop costs nothing)
// should take down only THIS process, not the parent — exiting lets server.ts's exit handler see it
// and respawn a fresh worker, same recovery path as a timeout-triggered kill.
process.on("uncaughtException", (error) => {
  console.error("[compute-worker] uncaught exception, exiting for a clean respawn —", error);
  process.exit(1);
});
