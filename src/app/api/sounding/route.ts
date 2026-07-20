import { NextResponse } from "next/server";

function candidates() {
  const list: Date[] = [];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    for (const hour of [12, 0]) {
      const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dayOffset, hour));
      if (candidate <= now) list.push(candidate);
    }
  }
  return list.sort((a, b) => b.getTime() - a.getTime());
}

function stamp(date: Date) {
  return date.toISOString().replace(/[-:T]/g, "").slice(2, 10);
}

export async function GET() {
  for (const candidate of candidates()) {
    const cycle = stamp(candidate);
    const url = `https://www.spc.noaa.gov/exper/soundings/${cycle}_OBS/FFC.txt`;
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "The Weather Desk student forecasting project" },
        cache: "no-store",
      });
      if (!response.ok) continue;
      const text = (await response.text()).trim();
      if (text.length > 100) return NextResponse.json({ station: "KFFC", cycle: `${cycle.slice(0, 6)} ${cycle.slice(6)}Z`, text, source: url }, { headers: { "Cache-Control": "s-maxage=900, stale-while-revalidate=3600" } });
    } catch {
      continue;
    }
  }
  return NextResponse.json({ error: "The latest observed FFC sounding is not available right now." }, { status: 502 });
}
