import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { mosaicStationSets } from "@/lib/mosaic-station-sets";
import { fetchMosaicTileFromWorker } from "@/lib/radar-worker-client";

// Phase 1 of the tile-based radar architecture, scoped 2026-09-01 and prototyped against real live
// data before this route existed (scripts/prototype-mercator-tiles.ts's seam-check: 35 real tiles
// stitched back together, zero byte difference against an independent whole-image reprojection).
// Mirrors the existing openweather tile route's own shape ([layer]/[z]/[x]/[y], no .png in the
// Next.js route itself, added only when proxying) rather than inventing a new convention.
//
// `station` resolves through the SAME mosaicStationSets lookup /api/radar/mosaic already uses —
// this route doesn't decide which stations back a location, the app does, same separation of
// concerns as every other radar route (the worker itself has no station-coordinate database, see
// server.ts's own comment on why).
const STATION_ID_PATTERN = /^[A-Z0-9]{3,5}$/;
const MAX_ZOOM = 12;

export async function GET(request: Request, { params }: { params: Promise<{ station: string; z: string; x: string; y: string }> }) {
  const limit = checkRateLimit(request, "radar-tile", 300, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);

  const { station: stationParam, z, x, y } = await params;
  const station = stationParam.trim().toUpperCase();
  if (!STATION_ID_PATTERN.test(station)) {
    return NextResponse.json({ error: "A valid radar station ID is required, e.g. KFFC." }, { status: 400 });
  }

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

  // Falls back to just the single station alone if it's somehow not in the generated table —
  // same graceful degradation /api/radar/mosaic already has, kept consistent here.
  const stationIds = mosaicStationSets[station] ?? [station];

  const tileBuffer = await fetchMosaicTileFromWorker(stationIds, zoom, tileX, tileY);
  if (!tileBuffer) {
    // Deliberately still a JSON error, not a fallback image — Leaflet's tileLayer treats a failed
    // tile load as "leave this cell blank," which is the correct, graceful behavior for a radar
    // overlay (same spirit as every other layer in this app: an in-house miss never blocks the
    // rest of the map, it just quietly shows less than it could).
    return NextResponse.json({ error: "That radar tile is unavailable right now." }, { status: 502 });
  }

  // Real CDN caching, not just this app's own in-memory Map the JSON mosaic route uses — a tile at
  // this stable URL is exactly what Vercel's Edge Network caches natively. s-maxage roughly matches
  // real volume-scan cadence (4-6 minutes depending on VCP); stale-while-revalidate means a user
  // never waits behind a cache miss once any request has warmed this exact tile once.
  return new NextResponse(new Uint8Array(tileBuffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, s-maxage=90, stale-while-revalidate=300",
    },
  });
}
