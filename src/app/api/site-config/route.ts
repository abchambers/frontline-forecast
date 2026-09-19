import { NextResponse } from "next/server";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

const noStore = { "Cache-Control": "no-store, max-age=0" };
// Published site content changes rarely (an HQ edit), yet every page view hit a function AND Supabase.
// A short shared window absorbs that while an HQ change still reaches visitors within a minute.
const sharedBriefly = { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" };

export async function GET(request: Request) {
  const limit = checkRateLimit(request, "site-config", 120, 60_000);
  if (limit.limited) return rateLimitResponse(limit.retryAfterSeconds);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ content: [], themes: [] }, {
      headers: noStore,
    });
  }

  try {
    const response = await fetch(`${url}/rest/v1/site_content?select=key,value&is_public=eq.true`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ content: [], themes: [] }, { status: response.status });

    const rows = await response.json() as Array<{ key: string; value: Record<string, unknown> }>;
    const content = rows
      .filter((row) => row.key.endsWith(".public"))
      .map((row) => ({ content_key: row.key.slice(0, -".public".length), value: row.value }));
    const themes = rows
      .filter((row) => row.key === "theme.shared")
      .map((row) => ({ tokens: row.value }));

    return NextResponse.json({ content, themes }, { headers: sharedBriefly });
  } catch {
    return NextResponse.json({ content: [], themes: [] }, { status: 503 });
  }
}
