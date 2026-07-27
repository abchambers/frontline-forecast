import { NextResponse } from "next/server";

export async function GET() {
  // Configuration publishing is deliberately opt-in. Until the shared HQ
  // control-plane schema is reconciled and deployed, the weather product must
  // keep its known-good built-in presentation rather than depend on an
  // unfinished cross-site endpoint.
  const url = process.env.COMPANY_HQ_CONFIG_URL;
  if (!url) {
    return NextResponse.json({ content: [], themes: [] }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  }
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
