"use client";

import { useEffect, useState } from "react";

// Real NWS upper-air observation charts (station plots + hand-analyzed contours from actual
// radiosonde/aircraft/satellite obs, not model output), same "own tab, distinct product" pattern
// just established for the fronts map rather than another radar overlay. 250mb is the conventional
// jet-stream level (isotachs); 500mb is the classic "heights" pattern (troughs/ridges) Andrew asked
// for alongside it — see /api/upper-air for why these come from SPC's twice-daily analysis rather
// than a model forecast.
const LEVELS = [
  { value: "250", label: "250 mb", caption: "Jet stream (isotachs)" },
  { value: "300", label: "300 mb", caption: "Upper-level wind" },
  { value: "500", label: "500 mb", caption: "Heights (troughs & ridges)" },
  { value: "700", label: "700 mb", caption: "Mid-level moisture" },
  { value: "850", label: "850 mb", caption: "Low-level temps & jet" },
  { value: "925", label: "925 mb", caption: "Near-surface flow" },
] as const;

type UpperAirData = { validTime: string | null; levels: Record<string, string> };

export default function UpperAirMap() {
  const [level, setLevel] = useState<(typeof LEVELS)[number]["value"]>("250");
  const [data, setData] = useState<UpperAirData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    fetch("/api/upper-air")
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Upper-air charts unavailable");
        if (!active) return;
        setData(body);
        setStatus("ready");
      })
      .catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, []);

  const validLabel = data?.validTime
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(data.validTime))
    : null;
  const activeLevel = LEVELS.find((entry) => entry.value === level)!;

  return (
    <>
      <div className="radar-field-picker satellite-channel-picker upper-air-level-picker">
        {LEVELS.map((entry) => <button type="button" key={entry.value} className={level === entry.value ? "active" : ""} onClick={() => setLevel(entry.value)}>{entry.label}</button>)}
      </div>
      <figure className="upper-air-view">
        {status === "ready" && data?.levels[level] && <img src={data.levels[level]} alt={`NWS ${activeLevel.label} upper-air observation chart: ${activeLevel.caption}`} />}
        {status === "loading" && <div className="radar-loading">Loading upper-air charts…</div>}
        {status === "error" && <div className="radar-loading">Upper-air charts are unavailable right now.</div>}
        <figcaption>{activeLevel.caption} · NWS Storm Prediction Center{validLabel ? ` · ${validLabel}` : ""}</figcaption>
      </figure>
    </>
  );
}
