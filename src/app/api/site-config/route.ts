import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json({ content: [], themes: [] }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  }

  try {
    const response = await fetch(`${url}/rest/v1/site_content?select=key,value&is_public=eq.true`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: 300, tags: ["site-config"] },
    });
    if (!response.ok) return NextResponse.json({ content: [], themes: [] }, { status: response.status });

    const rows = await response.json() as Array<{ key: string; value: Record<string, unknown> }>;
    const content = rows
      .filter((row) => row.key.endsWith(".public"))
      .map((row) => ({ content_key: row.key.slice(0, -".public".length), value: row.value }));
    const themes = rows
      .filter((row) => row.key === "theme.shared")
      .map((row) => ({ tokens: row.value }));

    return NextResponse.json({ content, themes }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ content: [], themes: [] }, { status: 503 });
  }
}
