import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("signed-in users do not receive a redundant public sign-in tab", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /item\.target !== "login" \|\| !session/);
});

test("radar frames load proactively on the dashboard and radar sections, not only after the timeline is opened", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(activeSection !== "radar" && activeSection !== "dashboard" && !radarLoop\) return;/);
});

test("live and timeline radar views share the same IEM NEXRAD frame source", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /radarLoop && radarMapView === "composite" \? radarFrame\?\.tileUrl : null/);
  assert.match(page, /radarMapView === "composite" \? radarFrame\?\.tileUrl : radarMapView === "future_reflectivity" \? futureRadarFrame\?\.tileUrl : null/);
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
