import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { fetchMosaicTileFromWorker } from "@/lib/radar-worker-client";
import { resolveStationsForTile } from "@/lib/tile-station-resolver";

// Phase 3 of the tile-based radar architecture, 2026-09-03 — replaces the earlier
// [station]/[z]/[x]/[y] route (Phase 1), which always used one location's hardcoded
// mosaicStationSets combo for every tile that location's viewport touched, regardless of which
// specific tile was actually being requested. This route drops the station from the URL
// entirely: the tile itself decides its own real covering stations (tile-station-resolver.ts),
// so any tile anywhere in the country resolves the same way, not just the locations someone
// thought to add to a table. See radar-worker/scripts/prototype-tile-station-matching.ts for the
// real-data validation this design is based on before it became a real route.
const MAX_ZOOM = 12;

export async function GET(request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const limit = checkRateLimit(request, "radar-tile", 300, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const { z, x, y } = await params;
  const zoom = Number(z);
  const tileX = Number(x);
  const tileY = Number(y);
  const tilesAtZoom = 2 ** zoom;
  if (
    !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y) ||
    !Number.isInteger(zoom) || zoom < 0 || zoom > MAX_ZOOM ||
    tileX < 0 || tileY < 0 || tileX >= tilesAtZoom || tileY >= tilesAtZoom
  ) {
    return NextResponse.json({ error: "Invalid map tile request." }, { status: 400 });
  }

  const stationIds = await resolveStationsForTile(zoom, tileX, tileY);
  if (stationIds.length === 0) {
    // Real, expected case, not an error — genuine NEXRAD coverage gaps exist (open ocean, parts of
    // the Mountain West). Leblet/the browser already treats a failed tile load as "leave this cell
    // blank", the correct behavior for a radar overlay — same as Phase 1's own reasoning.
    return NextResponse.json({ error: "No radar coverage for this area." }, { status: 404 });
  }

  const tileBuffer = await fetchMosaicTileFromWorker(stationIds, zoom, tileX, tileY);
  if (!tileBuffer) {
    return NextResponse.json({ error: "That radar tile is unavailable right now." }, { status: 502 });
  }

  // Real CDN caching at this stable URL, same as Phase 1 — s-maxage roughly matches real
  // volume-scan cadence; stale-while-revalidate means a user never waits behind a cache miss once
  // any request anywhere has warmed this exact tile once.
  return new NextResponse(new Uint8Array(tileBuffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, s-maxage=90, stale-while-revalidate=300",
    },
  });
}
