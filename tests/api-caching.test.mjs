import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function routeFiles(dir = "src/app/api") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await routeFiles(full)));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

test("route files only export names Next allows (anything else breaks the production build)", async () => {
  const allowed = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "dynamic", "revalidate", "runtime", "maxDuration", "preferredRegion", "fetchCache", "dynamicParams", "generateStaticParams"]);
  for (const file of await routeFiles()) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var)\s+([A-Za-z0-9_]+)/gm)) {
      assert.ok(allowed.has(match[1]), `${file} exports "${match[1]}", which Next does not allow from a route file`);
    }
  }
});

test("the weather route shares one response between visitors, but only for a short, alert-safe window", async () => {
  const source = await readFile("src/app/api/weather/route.ts", "utf8");
  const seconds = Number(source.match(/const WEATHER_SHARED_CACHE_SECONDS = (\d+)/)?.[1]);
  assert.ok(seconds > 0 && seconds <= 60, `shared window must stay within a minute for safety-critical alerts, got ${seconds}`);
  assert.match(source, /s-maxage=\$\{WEATHER_SHARED_CACHE_SECONDS\}/);
  assert.doesNotMatch(source, /Cache-Control": "no-store" \} \},\s*\);\s*\} catch/, "the success response must not be no-store");
});

test("only static NWS lookups are remembered; observations, forecast and alerts are always fetched live", async () => {
  const source = await readFile("src/app/api/weather/route.ts", "utf8");
  assert.match(source, /nwsStatic<NwsFeature<PointProperties>>/);
  assert.match(source, /nwsStatic<\{ features: NwsFeature<\{ stationIdentifier/);
  // The live calls must go through nws() (always no-store), never the remembering helper.
  for (const live of ["nws<NwsFeature<ObservationProperties>>(", "nws<{ properties: { periods: ForecastPeriod[] } }>(pointData.forecast)", "nws<{ features: NwsFeature<AlertProperties>[] }>("]) {
    assert.ok(source.includes(live), `expected a live nws() call: ${live}`);
  }
  assert.equal((source.match(/nwsStatic</g) ?? []).length, 3, "exactly the helper definition plus the two structural lookups may use nwsStatic");
});

test("high-traffic public JSON is CDN-shareable instead of one function call per visitor", async () => {
  for (const file of ["src/app/api/site-config/route.ts", "src/app/api/radar/mosaic/route.ts", "src/app/api/radar/nexrad-severe/route.ts"]) {
    const source = await readFile(file, "utf8");
    assert.match(source, /s-maxage=\d+/, file);
    assert.doesNotMatch(source, /"private, max-age/, `${file} still marks a shared payload private`);
  }
});
