import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { comboKey, DEMAND_WINDOW_MS, MIN_PREWARM_GAP_MS, nextPrewarmDelayMs, recordDemand, selectPrewarmCombos } from "../radar-worker/src/prewarm-plan.ts";

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
