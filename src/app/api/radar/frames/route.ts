import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

type RainViewerFrame = { time: number; path: string };
type RainViewerResponse = { host?: string; radar?: { past?: RainViewerFrame[] } };

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "radar-frames", 60, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  try {
    const response = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Radar timeline request failed (${response.status})`);
    const data = await response.json() as RainViewerResponse;
    const host = data.host ?? "https://tilecache.rainviewer.com";
    const frames = (data.radar?.past ?? []).slice(-12).map((frame) => ({
      time: frame.time,
      tileUrl: `${host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`,
    }));
    if (!frames.length) throw new Error("No radar frames were available.");
    return NextResponse.json({ provider: "RainViewer", frames, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=300" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load the radar timeline." }, { status: 502 });
  }
}
