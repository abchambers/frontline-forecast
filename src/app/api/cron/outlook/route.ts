import { NextRequest, NextResponse } from "next/server";
import { weatherDeskLocations } from "@/lib/locations";
import { reduceForecastPeriodsToDailyOutlook } from "@/lib/weather-data";

// NWS's 7-day forecast is a rolling window -- it never contains a date once that date is in
// the past. /api/weather is a pure live pass-through of it, so without this cron, a day's
// guidance vanishes from the Verify page the moment the day rolls over. This runs once daily,
// captures whatever the live feed currently has for each preset location (always "today" plus
// whatever's ahead of it), and upserts it into weather_daily_outlook. A day only ever gets
// written while it's still live, so once captured it's never overwritten with missing data --
// the same durable-archive pattern as /api/cron/observations for actuals.

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Outlook archive storage is not configured." }, { status: 500 });

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
  let saved = 0;
  try {
    for (const location of weatherDeskLocations) {
      const response = await fetch(new URL(`/api/weather?location=${location.id}`, request.url), { cache: "no-store" });
      if (!response.ok) continue;
      const data = await response.json();
      const days = reduceForecastPeriodsToDailyOutlook(data.forecastPeriods ?? [], location.timezone);
      // Read-before-write so a run that lands after today's daytime period has already dropped out
      // of NWS's feed (a retry, a schedule change, this cron ever running more than once a day)
      // can't blank out a real high/low this same location+date already captured -- same
      // "never overwritten with missing data" invariant this file already documents above, just
      // actually enforced for same-day updates now instead of only across day-rollover. See the
      // /api/weather route's matching fix for the live-display half of this same bug.
      const existingResponse = await fetch(
        `${supabaseUrl}/rest/v1/weather_daily_outlook?select=valid_date,high_f,low_f&location_id=eq.${encodeURIComponent(location.id)}&valid_date=in.(${days.map((day) => day.date).join(",")})`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      );
      const existingByDate = new Map(
        existingResponse.ok
          ? ((await existingResponse.json()) as { valid_date: string; high_f: number | null; low_f: number | null }[]).map((row) => [row.valid_date, row])
          : [],
      );
      for (const day of days) {
        const existing = existingByDate.get(day.date);
        const archive = await fetch(`${supabaseUrl}/rest/v1/weather_daily_outlook?on_conflict=location_id,valid_date`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            location_id: location.id,
            location_name: location.name,
            valid_date: day.date,
            label: day.label,
            high_f: day.high ?? existing?.high_f ?? null,
            low_f: day.low ?? existing?.low_f ?? null,
            short_forecast: day.shortForecast,
            precipitation_chance: day.precipitationChance,
            wind: day.wind,
            fetched_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
        });
        if (archive.ok) saved += 1;
      }
    }
    return NextResponse.json({ checkedLocations: weatherDeskLocations.length, savedDailyRecords: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Outlook archive failed." }, { status: 500 });
  }
}
