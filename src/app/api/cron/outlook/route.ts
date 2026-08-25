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
      for (const day of days) {
        const archive = await fetch(`${supabaseUrl}/rest/v1/weather_daily_outlook?on_conflict=location_id,valid_date`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            location_id: location.id,
            location_name: location.name,
            valid_date: day.date,
            label: day.label,
            high_f: day.high,
            low_f: day.low,
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
