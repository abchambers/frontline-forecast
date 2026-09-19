import assert from "node:assert/strict";
import test from "node:test";
import { candidateRuns, selectLatestRun } from "../radar-worker/src/gfs-run-selection.ts";

const at = (iso) => new Date(iso);
const noWait = async () => {};
const key = (c) => `${c.runDate}/${c.runHour}`;
const probeFrom = (table) => async (c) => table[key(c)] ?? { kind: "absent" };

test("candidates start 5 hours back and step one real 6-hour cycle at a time, across midnight", () => {
  assert.deepEqual(candidateRuns(at("2026-09-19T14:12:00Z")).map(key), ["20260919/06", "20260919/00", "20260918/18"]);
  assert.deepEqual(candidateRuns(at("2026-09-19T02:00:00Z")).map(key), ["20260918/18", "20260918/12", "20260918/06"]);
});

test("the newest published run wins and is not degraded", async () => {
  const run = await selectLatestRun(at("2026-09-19T14:12:00Z"), probeFrom({ "20260919/06": { kind: "present", fileSize: 5 } }), { wait: noWait });
  assert.equal(key(run), "20260919/06");
  assert.equal(run.degraded, false);
});

test("a run that is definitively not published yet falls back cleanly, without being flagged degraded", async () => {
  const run = await selectLatestRun(at("2026-09-19T14:12:00Z"), probeFrom({ "20260919/06": { kind: "absent" }, "20260919/00": { kind: "present", fileSize: 5 } }), { wait: noWait });
  assert.equal(key(run), "20260919/00");
  assert.equal(run.degraded, false);
});

test("a transient failure is retried and the newest run is still chosen (the 2026-09-19 stale-500mb bug)", async () => {
  let tries = 0;
  const flaky = async (c) => {
    if (key(c) === "20260919/06") { tries += 1; return tries < 3 ? { kind: "unknown" } : { kind: "present", fileSize: 9 }; }
    return { kind: "present", fileSize: 1 };
  };
  const run = await selectLatestRun(at("2026-09-19T14:12:00Z"), flaky, { wait: noWait });
  assert.equal(key(run), "20260919/06");
  assert.equal(run.degraded, false);
  assert.equal(tries, 3);
});

test("if a newer run stays unreachable, an older run is used but flagged degraded so it is not cached long", async () => {
  const run = await selectLatestRun(at("2026-09-19T14:12:00Z"), async (c) => (key(c) === "20260918/18" ? { kind: "present", fileSize: 1 } : { kind: "unknown" }), { wait: noWait });
  assert.equal(key(run), "20260918/18");
  assert.equal(run.degraded, true);
});

test("it throws only when nothing is available", async () => {
  await assert.rejects(selectLatestRun(at("2026-09-19T14:12:00Z"), probeFrom({}), { wait: noWait }), /No recent GFS run/);
});
