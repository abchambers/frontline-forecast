// Standalone Windows/native-binary smoke test — 2026-09-03.
//
// The decode benchmark deliberately avoided this dependency so it could run anywhere with zero
// compatibility risk. The REAL radar-worker also needs @napi-rs/canvas to actually paint the
// reflectivity grid into a PNG (see radar-worker/src/render.ts) — a compiled native binary, not
// pure JS, so "the decoder works here" doesn't prove "the whole worker would work here" on its
// own. This is the one genuinely unverified unknown before any networking/exposure setup is worth
// doing on a new machine.
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";

console.log(`Node ${process.version} on ${process.platform} ${process.arch}`);

try {
  const width = 400;
  const height = 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#0a1622";
  ctx.fillRect(0, 0, width, height);

  // A real radial gradient + shapes, not just a flat fill — closer to what render.ts's own
  // blur/composite pipeline actually exercises, not just "can this library be imported at all."
  ctx.filter = "blur(2px)";
  ctx.fillStyle = "#39d353";
  ctx.beginPath();
  ctx.arc(150, 150, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = "none";

  ctx.fillStyle = "#ffb703";
  ctx.beginPath();
  ctx.arc(260, 110, 35, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "16px sans-serif";
  ctx.fillText("napi-rs/canvas render test", 20, 270);

  const buffer = canvas.toBuffer("image/png");
  writeFileSync("canvas-test-output.png", buffer);
  console.log(`SUCCESS: rendered and encoded a ${width}x${height} PNG (${buffer.length} bytes)`);
  console.log(`Saved to canvas-test-output.png in this folder — open it to confirm it actually looks right (a green circle with a soft blurred edge, a solid orange circle, and white text), not just that the file exists.`);
} catch (error) {
  console.error("FAILED — this machine cannot run the real radar-worker as-is:", error);
  process.exit(1);
}
