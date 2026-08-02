import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("signed-in users do not receive a redundant public sign-in tab", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /item\.target !== "login" \|\| !session/);
});

test("radar frames load proactively on the dashboard and radar sections", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(activeSection !== "radar" && activeSection !== "dashboard"\) return;/);
});

test("observed radar is always the scrub-bar frame loop, with no separate live/timeline toggle", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /radarLoop/);
  assert.doesNotMatch(page, /Past timeline|Close timeline|Radar timeline|Interactive map/);
  assert.match(page, /className="radar-scrub"/);
});

test("HRRR simulated reflectivity lives under Models & Observations, not the Radar workspace", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /radarProductMode/);
  assert.doesNotMatch(page, /"Future radar"/);
  assert.match(page, /dataPanel === "model-radar"/);
  assert.match(page, /futureRadarFrame\?\.tileUrl/);
});

test("the NDFD forecast-guidance radar mode has been removed", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /ndfd_maxt|ndfd_pop12|ndfd_windspd/);
});

test("the public configuration endpoint returns only published public content", async () => {
  const route = await readFile(new URL("../src/app/api/site-config/route.ts", import.meta.url), "utf8");

  assert.match(route, /site_content\?select=key,value&is_public=eq\.true/);
  assert.match(route, /row\.key\.endsWith\("\.public"\)/);
  assert.match(route, /Cache-Control.*no-store/);
});

test("the radar timeline endpoint synthesizes exactly 12 same-provider frames", async () => {
  const route = await readFile(new URL("../src/app/api/radar/frames/route.ts", import.meta.url), "utf8");

  assert.match(route, /PAST_MINUTES_AGO = \[55, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5\]/);
  assert.match(route, /nexrad-n0q-900913/);
});

test("the future radar endpoint sources genuine simulated reflectivity, not a probability field", async () => {
  const route = await readFile(new URL("../src/app/api/radar/future-frames/route.ts", import.meta.url), "utf8");

  assert.match(route, /hrrr::REFD-F/);
});
