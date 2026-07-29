import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";


export const alt = "Frontline Forecast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const officialLogo = await readFile(join(process.cwd(), "public", "brand", "frontline-forecast-official.svg"));
  const logoSource = `data:image/svg+xml;base64,${officialLogo.toString("base64")}`;

  return new ImageResponse(
    (
      <div style={{ alignItems: "center", background: "#08054e", color: "#f8f9ff", display: "flex", height: "100%", padding: "76px", width: "100%" }}>
        <div style={{ alignItems: "center", display: "flex", gap: "32px" }}>
          <img alt="Frontline Forecast" height="280" src={logoSource} style={{ height: "280px", objectFit: "contain", width: "180px" }} width="180" />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#72c8f7", fontSize: "27px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase" }}>Human-first forecasting</div>
            <div style={{ color: "#d7daf6", fontSize: "31px", marginTop: "23px" }}>Weather analysis, forecasting, and verification.</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
