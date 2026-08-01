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

test("live and timeline radar views share the same RainViewer frame source", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /radarLoop && radarMapView === "composite" \? radarFrame\?\.tileUrl : null/);
  assert.match(page, /timelineTileUrl=\{radarMapView === "composite" \? radarFrame\?\.tileUrl : null\}/);
});

test("the public configuration endpoint returns only published public content", async () => {
  const route = await readFile(new URL("../src/app/api/site-config/route.ts", import.meta.url), "utf8");

  assert.match(route, /site_content\?select=key,value&is_public=eq\.true/);
  assert.match(route, /row\.key\.endsWith\("\.public"\)/);
  assert.match(route, /Cache-Control.*no-store/);
});

test("the radar timeline endpoint limits its public frame response", async () => {
  const route = await readFile(new URL("../src/app/api/radar/frames/route.ts", import.meta.url), "utf8");

  assert.match(route, /slice\(-12\)/);
  assert.match(route, /No radar frames were available/);
});
