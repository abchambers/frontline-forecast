import { ImageResponse } from "next/og";

export const alt = "Frontline Forecast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ alignItems: "center", background: "#09192e", color: "#f8fafc", display: "flex", height: "100%", padding: "76px", width: "100%" }}>
        <div style={{ alignItems: "center", display: "flex", gap: "32px" }}>
          <div style={{ alignItems: "center", background: "#0b1c34", border: "4px solid #3281ff", borderRadius: "42px", display: "flex", height: "180px", justifyContent: "center", position: "relative", width: "180px" }}>
            <div style={{ border: "12px solid #78b7ff", borderBottom: "0", borderLeftColor: "transparent", borderRadius: "100px 100px 0 0", height: "82px", position: "absolute", top: "33px", transform: "rotate(-10deg)", width: "112px" }} />
            <div style={{ background: "#f8fafc", borderRadius: "999px", height: "12px", transform: "rotate(-19deg)", width: "116px" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ color: "#78b7ff", fontSize: "27px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase" }}>Human-first forecasting</div>
            <div style={{ fontSize: "76px", fontWeight: 800, letterSpacing: "-0.055em", marginTop: "14px" }}>Frontline Forecast</div>
            <div style={{ color: "#c9d9ef", fontSize: "31px", marginTop: "23px" }}>Weather analysis, forecasting, and verification.</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
