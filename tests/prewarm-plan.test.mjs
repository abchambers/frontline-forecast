import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { comboKey, DEMAND_WINDOW_MS, isServeableWithoutRefresh, MIN_PREWARM_GAP_MS, nextPrewarmDelayMs, recordDemand, REFRESH_AHEAD_MARGIN_MS, refreshAheadMs, selectPrewarmCombos } from "../radar-worker/src/prewarm-plan.ts";

const HOME = [["KFFC", "KJGX", "KMXX", "KBMX", "KGSP"], ["KBMX", "KMXX", "KGWX", "KHTX"]];
const METROS = [["KATX", "KLGX", "KRTX", "KOTX"], ["KOKX", "KDIX", "KBOX", "KENX"], ["KLOT", "KMKX", "KILX", "KIWX"]];
const NOW = Date.UTC(2026, 8, 19, 15, 0, 0);

test("a combo's identity ignores station order, case and duplicates (it must match the worker's own cache key)", () => {
  assert.equal(comboKey(["KOKX", "KDIX", "KBOX", "KENX"]), comboKey(["kenx", "KBOX", "KDIX", "KOKX", "KOKX"]));
  assert.equal(comboKey([" KATX ", ""]), "KATX");
  assert.equal(comboKey([]), "");
});

test("with nobody asking for a metro, only the two home combos are prewarmed", () => {
  assert.deepEqual(selectPrewarmCombos(HOME, METROS, new Map(), NOW), HOME);
});

test("a metro is prewarmed only while someone has requested it recently, whatever order they asked in", () => {
  const demand = new Map();
  recordDemand(demand, ["KENX", "KBOX", "KDIX", "KOKX"], NOW - 60_000);
  assert.deepEqual(selectPrewarmCombos(HOME, METROS, demand, NOW), [...HOME, METROS[1]]);
  const requestedAt = NOW - 60_000;
  assert.deepEqual(selectPrewarmCombos(HOME, METROS, demand, requestedAt + DEMAND_WINDOW_MS), [...HOME, METROS[1]], "still inside the window at exactly its edge");
  assert.deepEqual(selectPrewarmCombos(HOME, METROS, demand, requestedAt + DEMAND_WINDOW_MS + 1), HOME, "drops out the moment the window passes");
});

test("a fresh request keeps a metro in rotation", () => {
  const demand = new Map();
  recordDemand(demand, METROS[0], NOW - 5 * 3_600_000);
  recordDemand(demand, METROS[0], NOW);
  assert.deepEqual(selectPrewarmCombos(HOME, METROS, demand, NOW + 5 * 3_600_000), [...HOME, METROS[0]]);
});

test("an arbitrary combo nobody listed never gets prewarmed, and the demand table cannot grow without bound", () => {
  const demand = new Map();
  recordDemand(demand, ["KZZZ", "KYYY"], NOW);
  assert.deepEqual(selectPrewarmCombos(HOME, METROS, demand, NOW), HOME);
  for (let i = 0; i < 3000; i++) recordDemand(demand, [`K${i}`], NOW + i);
  assert.ok(demand.size <= 500, `tracked ${demand.size}`);
});

test("scheduling is start-to-start with a floor, so a slow cycle never runs back to back", () => {
  assert.equal(nextPrewarmDelayMs(110_000, 270_000), 160_000);
  assert.equal(nextPrewarmDelayMs(269_000, 270_000), MIN_PREWARM_GAP_MS);
  assert.equal(nextPrewarmDelayMs(900_000, 270_000), MIN_PREWARM_GAP_MS);
  assert.equal(nextPrewarmDelayMs(0, 270_000), 270_000);
});

test("the worker keeps exactly the two home combos always-on, the ten metros on-demand, and a period under the 5-minute cache TTL", async () => {
  const source = await readFile(new URL("../radar-worker/src/server.ts", import.meta.url), "utf8");
  const list = (name) => [...source.match(new RegExp(`const ${name}: string\\[\\]\\[\\] = \\[([\\s\\S]*?)\\n\\];`))[1].matchAll(/\[("K[A-Z]{3}"(?:, "K[A-Z]{3}")*)\]/g)].map((m) => m[1].replaceAll('"', "").split(", "));
  const always = list("ALWAYS_ON_MOSAIC_COMBOS"), onDemand = list("ON_DEMAND_MOSAIC_COMBOS");
  assert.deepEqual(always, [["KFFC", "KJGX", "KMXX", "KBMX", "KGSP"], ["KBMX", "KMXX", "KGWX", "KHTX"]]);
  assert.equal(onDemand.length, 10);
  const period = Number(source.match(/const PREWARM_INTERVAL_MS = (\d[\d_]*);/)[1].replaceAll("_", ""));
  const ttl = Number(source.match(/const MOSAIC_CACHE_TTL_MS = (\d[\d_]*);/)[1].replaceAll("_", ""));
  assert.ok(period < ttl, `period ${period} must be below the cache TTL ${ttl} or entries expire mid-refresh`);
});

test("demand is recorded only from the HTTP route, never by the prewarm's own calls", async () => {
  const source = await readFile(new URL("../radar-worker/src/server.ts", import.meta.url), "utf8");
  const calls = [...source.matchAll(/recordDemand\(/g)].length;
  assert.equal(calls, 1);
  assert.match(source, /if \(url\.pathname === "\/mosaic"\) \{\s*recordDemand\(/);
});

test("refresh-ahead: the prewarm rebuilds an entry that would not survive to the next cycle, real requests keep serving it", () => {
  const period = 270_000, ttl = 300_000, ahead = refreshAheadMs(period);
  assert.equal(ahead, period + REFRESH_AHEAD_MARGIN_MS);
  // Real requests pass 0: any unexpired entry is served, an expired one is not.
  assert.equal(isServeableWithoutRefresh(1, 0), true);
  assert.equal(isServeableWithoutRefresh(0, 0), false);
  // The prewarm, one full period after computing an entry (30s of life left), must rebuild it...
  assert.equal(isServeableWithoutRefresh(ttl - period, ahead), false);
  // ...but leaves an entry that was built seconds ago alone.
  assert.equal(isServeableWithoutRefresh(ttl - 5_000, ahead), true);
});

// Models one prewarmed entry: cycles start every `period`, a rebuild takes `compute` and its result replaces
// the old entry only when it lands. Returns how long visitors would have found the entry ABSENT.
function coldTime(minRemainingMs, { period = 270_000, ttl = 300_000, compute = 45_000, cycles = 40 } = {}) {
  let builtAt = compute; // built during cycle 0, which began at t=0
  let cold = 0;
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const cycleStart = cycle * period;
    if (isServeableWithoutRefresh(ttl - (cycleStart - builtAt), minRemainingMs)) continue; // still good, skipped
    const landsAt = cycleStart + compute;
    const oldExpiresAt = builtAt + ttl;
    if (oldExpiresAt < landsAt) cold += landsAt - oldExpiresAt; // absent from expiry until the rebuild lands
    builtAt = landsAt;
  }
  return cold;
}

test("skip-until-expired (the behavior found live 2026-09-19) leaves a home entry cold for a large share of the time", () => {
  const cold = coldTime(0);
  assert.ok(cold > 40 * 270_000 * 0.3, `expected roughly 40% cold, got ${(cold / (40 * 270_000) * 100).toFixed(0)}%`);
});

test("with refresh-ahead, an entry is rebuilt before it expires and is never cold in steady state", () => {
  assert.equal(coldTime(refreshAheadMs(270_000)), 0);
  assert.equal(coldTime(refreshAheadMs(270_000), { compute: 80_000 }), 0, "still gap-free with a slow 80s rebuild");
});

test("the worker prewarm passes the refresh-ahead window to both handlers, and it sits between the period and the cache TTL", async () => {
  const source = await readFile(new URL("../radar-worker/src/server.ts", import.meta.url), "utf8");
  assert.match(source, /handleReflectivityOrVelocity\(station, "reflectivity", PREWARM_REFRESH_AHEAD_MS\)/);
  assert.match(source, /handleMosaic\(combo\.join\(","\), PREWARM_REFRESH_AHEAD_MS\)/);
  const num = (name) => Number(source.match(new RegExp(`const ${name} = (\\d[\\d_]*);`))[1].replaceAll("_", ""));
  const ahead = refreshAheadMs(num("PREWARM_INTERVAL_MS"));
  assert.ok(ahead > num("PREWARM_INTERVAL_MS"));
  assert.ok(ahead < num("MOSAIC_CACHE_TTL_MS") && ahead < num("PAYLOAD_CACHE_TTL_MS"), "refresh-ahead must be shorter than the cache lifetime or every cycle rebuilds every entry immediately");
  // Real visitor requests must keep using plain cached-entry semantics (min remaining 0).
  assert.doesNotMatch(source, /handleMosaic\(url\.searchParams\.get\("stations"\) \?\? "", PREWARM/);
});
