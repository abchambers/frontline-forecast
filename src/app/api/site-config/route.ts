import { NextResponse } from "next/server";

const defaultConfigUrl = "https://hq.frontline-forecast.com/api/public-config/frontline-forecast";

export async function GET() {
  const url = process.env.COMPANY_HQ_CONFIG_URL || defaultConfigUrl;
  try {
    const response = await fetch(url, { next: { revalidate: 300, tags: ["site-config"] } });
    if (!response.ok) return NextResponse.json({ error: "No published configuration." }, { status: response.status });
    return NextResponse.json(await response.json(), {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ error: "Configuration unavailable." }, { status: 503 });
  }
}
