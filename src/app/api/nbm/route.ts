import { NextResponse } from "next/server";

const station = "KAHN";

function cycleCandidates() {
  const candidates: Date[] = [];
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  for (let offset = 1; offset <= 8; offset += 1) {
    candidates.push(new Date(now.getTime() - offset * 60 * 60 * 1000));
  }
  return candidates;
}

function formatRun(date: Date) {
  const datePart = date.toISOString().slice(0, 10).replaceAll("-", "");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  return { datePart, hour };
}

function stationBulletin(text: string) {
  const start = text.indexOf(station);
  if (start < 0) return null;
  const nextStation = text.indexOf("\nK", start + station.length);
  return text.slice(Math.max(0, text.lastIndexOf("\n", start - 1)), nextStation > 0 ? nextStation : start + 9000).trim();
}

export async function GET() {
  for (const candidate of cycleCandidates()) {
    const { datePart, hour } = formatRun(candidate);
    const url = `https://nomads.ncep.noaa.gov/pub/data/nccf/com/blend/prod/blend.${datePart}/${hour}/text/blend_nbhtx.t${hour}z`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": "The Weather Desk student forecasting project" }, next: { revalidate: 1800 } });
      if (!response.ok) continue;
      const bulletin = stationBulletin(await response.text());
      if (bulletin) {
        return NextResponse.json({ station, cycle: `${datePart} ${hour}Z`, text: bulletin, source: url }, { headers: { "Cache-Control": "s-maxage=1800" } });
      }
    } catch {
      continue;
    }
  }
  return NextResponse.json({ error: "The latest NBM station bulletin is not available right now." }, { status: 502 });
}
