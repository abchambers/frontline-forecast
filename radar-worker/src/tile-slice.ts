// Slices ONE Web Mercator tile out of an already-rendered, already-QC'd equirectangular composite
// PNG — reprojects the FINAL rendered pixels (not the pre-blur classified value grid a more
// refined version might use to avoid double-resampling blur), which scripts/prototype-mercator-
// tiles.ts already proved introduces zero seams/misalignment when tiles are rendered independently
// and reassembled. Deliberately reuses the exact same per-pixel nearest-neighbor logic that
// prototype verified against real live data before this was ever wired into a real endpoint.
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { tileXToLon, tileYToLat, TILE_SIZE } from "./mercator.js";
import type { MrmsBounds } from "./types.js";

export async function sliceTileFromComposite(imageDataUrl: string, bounds: MrmsBounds, step: number, z: number, x: number, y: number): Promise<Buffer> {
  const base64 = imageDataUrl.replace(/^data:image\/png;base64,/, "");
  const sourceImg = await loadImage(Buffer.from(base64, "base64"));
  const sourceCanvas = createCanvas(sourceImg.width, sourceImg.height);
  const sourceCtx = sourceCanvas.getContext("2d");
  sourceCtx.drawImage(sourceImg, 0, 0);
  const sourceData = sourceCtx.getImageData(0, 0, sourceImg.width, sourceImg.height);

  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx: SKRSContext2D = canvas.getContext("2d");
  const outImage = ctx.createImageData(TILE_SIZE, TILE_SIZE);

  for (let py = 0; py < TILE_SIZE; py++) {
    const globalY = y + py / TILE_SIZE;
    const lat = tileYToLat(globalY, z);
    for (let px = 0; px < TILE_SIZE; px++) {
      const globalX = x + px / TILE_SIZE;
      const lon = tileXToLon(globalX, z);

      const sourceCol = Math.round((lon - bounds.minLongitude) / step);
      const sourceRow = Math.round((bounds.maxLatitude - lat) / step);
      if (sourceCol < 0 || sourceCol >= sourceImg.width || sourceRow < 0 || sourceRow >= sourceImg.height) continue;

      const sourceIdx = (sourceRow * sourceImg.width + sourceCol) * 4;
      const alpha = sourceData.data[sourceIdx + 3];
      if (alpha === 0) continue;
      const destIdx = (py * TILE_SIZE + px) * 4;
      outImage.data[destIdx] = sourceData.data[sourceIdx];
      outImage.data[destIdx + 1] = sourceData.data[sourceIdx + 1];
      outImage.data[destIdx + 2] = sourceData.data[sourceIdx + 2];
      outImage.data[destIdx + 3] = alpha;
    }
  }
  ctx.putImageData(outImage, 0, 0);
  return canvas.toBuffer("image/png");
}
