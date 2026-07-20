import { NextResponse } from "next/server";

const ALLOWED_LAYERS = new Set(["precipitation_new", "clouds_new", "pressure_new", "wind_new", "temp_new"]);

export async function GET(_: Request, { params }: { params: Promise<{ layer: string; z: string; x: string; y: string }> }) {
  const { layer, z, x, y } = await params;
  const key = process.env.OPENWEATHER_API_KEY;
  if (!key) return NextResponse.json({ error: "OpenWeather map layers are not configured." }, { status: 503 });
  if (!ALLOWED_LAYERS.has(layer) || !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
    return NextResponse.json({ error: "Invalid map tile request." }, { status: 400 });
  }
  try {
    const response = await fetch(`https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${encodeURIComponent(key)}`, {
      headers: { "User-Agent": "The Weather Desk student forecasting project" },
      next: { revalidate: 600 },
    });
    if (!response.ok) throw new Error(`OpenWeather returned ${response.status}`);
    return new NextResponse(response.body, { headers: { "Content-Type": "image/png", "Cache-Control": "public, s-maxage=600, stale-while-revalidate=600" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OpenWeather layer is unavailable." }, { status: 502 });
  }
}
