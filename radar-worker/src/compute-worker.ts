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
    correlationCoefficient = extractLowestElevation(radar, "correlationCoefficient");
  } catch {
    correlationCoefficient = undefined;
  }

  const candidateCells = buildCandidateCells(site, GRID_STEP_DEG, MAX_RANGE_KM);
  const t2 = performance.now();

  let grid, bounds, elevationDeg, qualityControl;
  if (moment === "velocity") {
    const reflElevation = extractLowestElevation(radar, "reflectivity");
    const velElevation = extractLowestElevation(radar, "velocity");
    const { echoMask, qualityControl: qc } = computeReflectivityGrid(reflElevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells);
    ({ grid, bounds } = computeVelocityGrid(velElevation, site, GRID_STEP_DEG, MAX_RANGE_KM, echoMask, candidateCells));
    elevationDeg = velElevation.elevationDeg;
    qualityControl = qc;
  } else {
    const elevation = extractLowestElevation(radar, "reflectivity");
    ({ grid, bounds, qualityControl } = computeReflectivityGrid(elevation, site, GRID_STEP_DEG, MAX_RANGE_KM, correlationCoefficient, candidateCells));
    elevationDeg = elevation.elevationDeg;
  }
  const tCompute = performance.now();
  console.log(`[${station}:${moment}] fetch+parse ${(t1 - t0).toFixed(0)}ms, geometry ${(t2 - t1).toFixed(0)}ms, sample ${(tCompute - t2).toFixed(0)}ms, total ${(tCompute - t0).toFixed(0)}ms`);

  const hasSignal = grid.some((point) => point.dbz !== null);
  if (!hasSignal) throw new Error(`No ${moment} data available for ${station} in this volume.`);

  const imageDataUrl =
    moment === "velocity"
      ? renderVelocityGridToDataUrl(grid, bounds, GRID_STEP_DEG)
      : renderMrmsGridToDataUrl(grid, bounds, GRID_STEP_DEG);
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

  for (const { station, site } of resolvedSites) {
    const stationStart = performance.now();
    try {
      const volume = await getVolumeCached(station);
      const elevation = extractLowestElevation(volume.radar, "reflectivity");
      let correlationCoefficient;
      try {
        correlationCoefficient = extractLowestElevation(volume.radar, "correlationCoefficient");
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
  const imageDataUrl = renderMrmsGridToDataUrl(mergedPoints, bounds, GRID_STEP_DEG);
  if (!imageDataUrl) throw new Error(`No mosaic coverage available for [${stations.join(",")}].`);

  console.log(`[mosaic:${stations.join(",")}] ${perStationMs.join(" ")}, total ${((performance.now() - t0) / 1000).toFixed(1)}s${failedStations.length ? ` (${failedStations.length} station(s) skipped: ${failedStations.join(",")})` : ""}`);

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
