# Radar worker (in-house NEXRAD ingestion)

Separate deployment target from the main Next.js app — this needs a persistent,
always-on process (planned host: Fly.io), not a Vercel serverless route. See
the GribStream cost/UX conversation in project memory for why this exists:
GribStream's metered free tier doesn't scale equally across schools or support
more than composite reflectivity without an ongoing per-call bill.

## Status: Phase 1 complete, verified against live data

`npm install && npm run test:kffc` (or `npx tsx scripts/test-kffc.ts <STATION_ID>`)
runs the full pipeline against a real, live NEXRAD volume and prints an ASCII
heatmap so you can eyeball spatial coherence without opening a browser.

Verified for real, not assumed:
- `unidata-nexrad-level2-chunks` / `unidata-nexrad-level2` (S3, public, no
  credentials) are reachable and contain genuinely live data — observed
  volumes landing within ~1-2 minutes of real time.
- `api.weather.gov/radar/stations/{id}` gives authoritative site lat/lon/elevation
  — no hardcoded station table needed.
- `nexrad-level-2-data` correctly decodes real reflectivity (720 radials x
  1832 gates, matching WSR-88D's published super-res spec) and velocity
  (present on the split-cut lower tilts, not every elevation — confirmed
  empirically per-elevation on a real KFFC volume, see the comment in
  `src/level2.ts`).
- The polar-to-lat/lon projection and grid resampling produce a real, spatially
  coherent reflectivity field (contiguous storm-cell shapes, not noise) in the
  exact `{lat, lon, dbz}` grid shape `src/lib/mrms-render.ts` already renders
  in the browser — so Phase 2 should be a source swap, not new rendering code.

## Real bugs found and fixed during Phase 1 (worth knowing before extending this)

- `gate_size`/`first_gate` from the decoder are already in **kilometers**, not
  meters — an initial `/1000` conversion silently shrank every gate to 0.1%
  of its real range (grid collapsed to ~1km instead of ~460km). Caught via
  the ASCII heatmap looking wrong, not by any thrown error.
- The archive bucket's "latest" key by timestamp isn't always a normal volume
  — a `_V06_MDM` variant (a status/maintenance message, much smaller, not
  decodable as a real volume) showed up as the most recent key during testing
  and crashed the decoder with a buffer-overrun error. Fixed by filtering to
  keys ending in exactly `_V0[0-9]`.

## Known simplifications (documented, not hidden)

- `project.ts`'s ground-range correction (`slantRange * cos(elevation)`) is a
  flat-earth approximation — ignores beam curvature and earth curvature at
  long range. Same approximation-tier as `mrms-render.ts`'s color table. Only
  matters if far-range accuracy becomes visibly wrong once this is on a map.
- `fetchLatestVolume` pulls the latest **complete assembled volume**, which
  lags real-time chunk delivery by several minutes. This is fine for proving
  the pipeline locally but is NOT the final ingestion path — a real deployment
  needs to stream `unidata-nexrad-level2-chunks` and reassemble volumes itself
  for genuinely real-time freshness. That's Phase 2+/hosting work.

## Next: Phase 2

Wire this into `radar-map.tsx` in place of GribStream for one location,
verified live in the browser, then add velocity (already decodable — see
`decodeLowestElevation(buffer, "velocity")`).
