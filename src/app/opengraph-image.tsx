import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";


export const alt = "Frontline Forecast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const [mark, wordmark] = await Promise.all(
    ["frontline-forecast-mark.png", "frontline-forecast-wordmark.png"].map(async (asset) => {
      const bytes = await readFile(join(process.cwd(), "public", "brand", asset));
      return `data:image/png;base64,${bytes.toString("base64")}`;
    }),
  );

  return new ImageResponse(
    (
      <div style={{ alignItems: "center", background: "#08054e", color: "#f8f9ff", display: "flex", height: "100%", padding: "76px", width: "100%" }}>
        <div style={{ alignItems: "center", display: "flex", gap: "32px" }}>
          <img alt="" height="180" src={mark} style={{ borderRadius: "28px", height: "180px", objectFit: "cover", width: "180px" }} width="180" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#72c8f7", fontSize: "27px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase" }}>Human-first forecasting</div>
            <img alt="Frontline Forecast" height="110" src={wordmark} style={{ height: "110px", marginTop: "14px", objectFit: "contain", objectPosition: "left center", width: "520px" }} width="520" />
            <div style={{ color: "#d7daf6", fontSize: "31px", marginTop: "23px" }}>Weather analysis, forecasting, and verification.</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
