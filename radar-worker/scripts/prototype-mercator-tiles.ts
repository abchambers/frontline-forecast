// Phase 1 tile-architecture prototype — proves out ONLY the Web Mercator projection + tiling
// math in isolation, against a REAL live composite, before touching any production code. Reuses
// today's actual rendered PNG (already fully QC'd -- despeckle, CC-gate, elongation, VCP-mode,
// color table -- all unchanged and untouched by this prototype) as the source raster, and answers
// exactly one question: can this be correctly reprojected into standard XYZ tiles with no seams,
// no misalignment, no lost data?
//
// Deliberately reprojects the FINAL rendered PNG here, not the pre-blur classified value grid a
// real production version would use (to avoid double-resampling blur) -- that distinction doesn't
// matter for what this prototype is actually checking (is the TILE GEOMETRY correct), and reusing
// the finished PNG means zero changes to render.ts's already-proven QC/color pipeline to test this.
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const STATION = process.argv[2] ?? "KFFC";
const WORKER_URL = process.argv[3] ?? "http://localhost:8099";
const OUT_DIR = "/tmp/tile-prototype";
const TILE_SIZE = 256;

// Real NEXRAD Level II resolution at this app's GRID_STEP_DEG=0.006deg is ~668m/pixel at mid
// latitudes -- measured (not guessed) against Web Mercator's own per-zoom resolution table:
// zoom 7 = 1019m/px (coarser, loses real detail), zoom 8 = 509m/px (closer, mild upsample), zoom
// 9 = 255m/px (clearly oversampling). Zoom 8 is the best match and lines up with IEM's own
// maxNativeZoom: 8 already wired into radar-map.tsx for their tile layer -- not a coincidence,
// real Level II data has a genuine physical resolution ceiling.
const NATIVE_ZOOM = 8;

// --- Standard Web Mercator / Slippy Map tile math (well-documented, verified against known
// reference points below rather than trusted blindly) ---
function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * Math.pow(2, z);
}
function latToTileY(lat: number, z: number): number {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, z);
}
function tileXToLon(x: number, z: number): number {
  return (x / Math.pow(2, z)) * 360 - 180;
}
function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function verifyProjectionMath() {
  // Tile 0/0/0 at zoom 0 must cover the whole world.
  const west = tileXToLon(0, 0);
  const east = tileXToLon(1, 0);
  const north = tileYToLat(0, 0);
  const south = tileYToLat(1, 0);
  console.log(`zoom-0 tile bounds: west=${west} east=${east} north=${north.toFixed(4)} south=${south.toFixed(4)}`);
  if (west !== -180 || east !== 180) throw new Error("zoom-0 longitude bounds wrong");
  if (Math.abs(north - 85.0511) > 0.01 || Math.abs(south + 85.0511) > 0.01) throw new Error("zoom-0 latitude bounds wrong (should be +-85.0511, Mercator's real limit)");

  // Round-trip check: lon/lat -> tile -> lon/lat should recover the tile's own edge, not drift.
  const testLon = -84.388, testLat = 33.749; // real Atlanta coordinates
  const tx = Math.floor(lonToTileX(testLon, NATIVE_ZOOM));
  const ty = Math.floor(latToTileY(testLat, NATIVE_ZOOM));
  const backLon = tileXToLon(tx, NATIVE_ZOOM);
  const backLat = tileYToLat(ty, NATIVE_ZOOM);
  console.log(`Atlanta (${testLon},${testLat}) -> tile (${tx},${ty}) at z${NATIVE_ZOOM} -> tile NW corner (${backLon.toFixed(4)},${backLat.toFixed(4)})`);
  if (backLon > testLon || backLat < testLat) throw new Error("tile containing Atlanta doesn't actually contain Atlanta -- projection math is wrong");
  console.log("projection math sanity checks: PASSED\n");
}

type SourceBounds = { minLatitude: number; maxLatitude: number; minLongitude: number; maxLongitude: number };

async function fetchRealComposite(station: string): Promise<{ imageDataUrl: string; bounds: SourceBounds; step: number; stations?: string[] }> {
  const url = `${WORKER_URL}/mosaic?stations=${station === "KFFC" ? "KFFC,KJGX,KMXX,KBMX,KGSP" : station}`;
  console.log(`fetching real composite: ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`worker returned ${response.status}: ${await response.text()}`);
  return (await response.json()) as { imageDataUrl: string; bounds: SourceBounds; step: number; stations?: string[] };
}

// Renders ONE tile by inverse-projecting each of its 256x256 pixels back to the source image's
// equirectangular pixel space and nearest-neighbor sampling -- the actual "production" version of
// this reads the pre-color classified value grid instead of a rendered PNG, everything else here
// (the projection math, the tiling boundaries) is identical to what that version would do.
function renderTile(sourceImageData: { data: Uint8ClampedArray; width: number; height: number }, bounds: SourceBounds, step: number, z: number, x: number, y: number) {
  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = canvas.getContext("2d");
  const outImage = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  let paintedPixels = 0;

  for (let py = 0; py < TILE_SIZE; py++) {
    // Fractional tile-pixel -> global Mercator tile coordinate -> lon/lat
    const globalY = y + py / TILE_SIZE;
    const lat = tileYToLat(globalY, z);
    for (let px = 0; px < TILE_SIZE; px++) {
      const globalX = x + px / TILE_SIZE;
      const lon = tileXToLon(globalX, z);

      const sourceCol = Math.round((lon - bounds.minLongitude) / step);
      const sourceRow = Math.round((bounds.maxLatitude - lat) / step);
      if (sourceCol < 0 || sourceCol >= sourceImageData.width || sourceRow < 0 || sourceRow >= sourceImageData.height) continue;

      const sourceIdx = (sourceRow * sourceImageData.width + sourceCol) * 4;
      const destIdx = (py * TILE_SIZE + px) * 4;
      const alpha = sourceImageData.data[sourceIdx + 3];
      if (alpha === 0) continue;
      outImage.data[destIdx] = sourceImageData.data[sourceIdx];
      outImage.data[destIdx + 1] = sourceImageData.data[sourceIdx + 1];
      outImage.data[destIdx + 2] = sourceImageData.data[sourceIdx + 2];
      outImage.data[destIdx + 3] = alpha;
      paintedPixels++;
    }
  }
  ctx.putImageData(outImage, 0, 0);
  return { canvas, paintedPixels };
}

async function main() {
  verifyProjectionMath();

  const composite = await fetchRealComposite(STATION);
  console.log(`real composite: bounds=${JSON.stringify(composite.bounds)} step=${composite.step} stations=${composite.stations?.join(",")}`);

  const base64 = composite.imageDataUrl.replace(/^data:image\/png;base64,/, "");
  const sourceImg = await loadImage(Buffer.from(base64, "base64"));
  const sourceCanvas = createCanvas(sourceImg.width, sourceImg.height);
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.drawImage(sourceImg, 0, 0);
  const sourceImageData = sourceCtx.getImageData(0, 0, sourceImg.width, sourceImg.height);
  console.log(`source image: ${sourceImg.width}x${sourceImg.height}`);

  // Determine which tiles this composite's bounds actually span at the native zoom.
  const minTileX = Math.floor(lonToTileX(composite.bounds.minLongitude, NATIVE_ZOOM));
  const maxTileX = Math.floor(lonToTileX(composite.bounds.maxLongitude, NATIVE_ZOOM));
  const minTileY = Math.floor(latToTileY(composite.bounds.maxLatitude, NATIVE_ZOOM)); // max lat = smallest Y
  const maxTileY = Math.floor(latToTileY(composite.bounds.minLatitude, NATIVE_ZOOM));
  const tileCountX = maxTileX - minTileX + 1;
  const tileCountY = maxTileY - minTileY + 1;
  console.log(`tile range at z${NATIVE_ZOOM}: x=[${minTileX},${maxTileX}] y=[${minTileY},${maxTileY}] -- ${tileCountX * tileCountY} tiles total`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, "tiles"), { recursive: true });

  // Render every tile independently, exactly as production would (each tile computed with zero
  // knowledge of its neighbors), then ALSO stitch them back into one big canvas -- this is the
  // real verification method: if tiling has ANY seam/misalignment bug, the stitched image will
  // show it directly as a visible discontinuity or gap at tile boundaries.
  const stitched = createCanvas(tileCountX * TILE_SIZE, tileCountY * TILE_SIZE);
  const stitchedCtx = stitched.getContext("2d");
  let totalPainted = 0;
  const t0 = performance.now();
  for (let ty = minTileY; ty <= maxTileY; ty++) {
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const { canvas, paintedPixels } = renderTile(sourceImageData, composite.bounds, composite.step, NATIVE_ZOOM, tx, ty);
      totalPainted += paintedPixels;
      const tileBuf = canvas.toBuffer("image/png");
      fs.writeFileSync(path.join(OUT_DIR, "tiles", `${NATIVE_ZOOM}_${tx}_${ty}.png`), tileBuf);
      stitchedCtx.drawImage(canvas, (tx - minTileX) * TILE_SIZE, (ty - minTileY) * TILE_SIZE);
    }
  }
  const elapsedMs = performance.now() - t0;
  console.log(`sliced ${tileCountX * tileCountY} tiles in ${elapsedMs.toFixed(0)}ms, ${totalPainted} total non-transparent pixels painted`);

  fs.writeFileSync(path.join(OUT_DIR, "stitched-from-tiles.png"), stitched.toBuffer("image/png"));

  // Independent cross-check: reproject the WHOLE composite in one pass (no tile boundaries at
  // all) and diff it pixel-for-pixel against the stitched-from-tiles version above. Any
  // difference means the tiling logic itself introduced an error, not the projection math.
  const wholeCanvas = createCanvas(tileCountX * TILE_SIZE, tileCountY * TILE_SIZE);
  const wholeCtx = wholeCanvas.getContext("2d");
  const wholeImage = wholeCtx.createImageData(tileCountX * TILE_SIZE, tileCountY * TILE_SIZE);
  for (let py = 0; py < tileCountY * TILE_SIZE; py++) {
    const globalY = minTileY + py / TILE_SIZE;
    const lat = tileYToLat(globalY, NATIVE_ZOOM);
    for (let px = 0; px < tileCountX * TILE_SIZE; px++) {
      const globalX = minTileX + px / TILE_SIZE;
      const lon = tileXToLon(globalX, NATIVE_ZOOM);
      const sourceCol = Math.round((lon - composite.bounds.minLongitude) / composite.step);
      const sourceRow = Math.round((composite.bounds.maxLatitude - lat) / composite.step);
      if (sourceCol < 0 || sourceCol >= sourceImg.width || sourceRow < 0 || sourceRow >= sourceImg.height) continue;
      const sourceIdx = (sourceRow * sourceImg.width + sourceCol) * 4;
      const destIdx = (py * tileCountX * TILE_SIZE + px) * 4;
      wholeImage.data[destIdx] = sourceImageData.data[sourceIdx];
      wholeImage.data[destIdx + 1] = sourceImageData.data[sourceIdx + 1];
      wholeImage.data[destIdx + 2] = sourceImageData.data[sourceIdx + 2];
      wholeImage.data[destIdx + 3] = sourceImageData.data[sourceIdx + 3];
    }
  }
  wholeCtx.putImageData(wholeImage, 0, 0);
  fs.writeFileSync(path.join(OUT_DIR, "whole-reprojection.png"), wholeCanvas.toBuffer("image/png"));

  const stitchedData = stitchedCtx.getImageData(0, 0, stitched.width, stitched.height).data;
  let diffCount = 0;
  let maxDiff = 0;
  for (let i = 0; i < stitchedData.length; i++) {
    const diff = Math.abs(stitchedData[i] - wholeImage.data[i]);
    if (diff > 0) {
      diffCount++;
      maxDiff = Math.max(maxDiff, diff);
    }
  }
  console.log(`\nSEAM CHECK: ${diffCount} differing byte values out of ${stitchedData.length} (max diff=${maxDiff}) between tiled-and-stitched vs. whole-image reprojection`);
  console.log(diffCount === 0 ? "RESULT: IDENTICAL -- tiling introduces zero seams/misalignment." : "RESULT: MISMATCH -- investigate before trusting this approach.");

  console.log(`\nWrote outputs to ${OUT_DIR}:`);
  console.log(`  tiles/${NATIVE_ZOOM}_x_y.png -- each tile rendered independently`);
  console.log(`  stitched-from-tiles.png -- tiles reassembled into one image`);
  console.log(`  whole-reprojection.png -- same area reprojected in one pass, no tiling`);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
