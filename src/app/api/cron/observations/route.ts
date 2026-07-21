import { NextRequest, NextResponse } from "next/server";
import { weatherDeskLocations } from "@/lib/locations";

function localDate(timeZone: string, offsetDays = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day") + offsetDays)).toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return NextResponse.json({ error: "Observation archive storage is not configured." }, { status: 500 });

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" };
  const targets = weatherDeskLocations.flatMap((location) => [localDate(location.timezone, -1), localDate(location.timezone)].map((validDate) => ({ location, validDate })));
  let saved = 0;
  try {
    for (const { location, validDate } of targets) {
      const response = await fetch(new URL(`/api/verify?date=${validDate}&location=${location.id}`, request.url), { cache: "no-store" });
      if (!response.ok) continue;
      const data = await response.json();
      const complete = Boolean(data.day?.complete && data.night?.complete);
      const qualityStatus = data.day?.observationCount || data.night?.observationCount ? complete ? "complete" : "provisional" : "degraded";
      const archive = await fetch(`${supabaseUrl}/rest/v1/weather_daily_observations?on_conflict=source,location_id,valid_date`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          source: "NWS station observations",
          source_kind: "observation",
          location_id: location.id,
          location_name: location.name,
          valid_date: validDate,
          day_actual: data.day,
          night_actual: data.night,
          raw_payload: data,
          quality_status: qualityStatus,
          fetched_at: data.fetchedAt ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });
      if (archive.ok) saved += 1;
    }
    return NextResponse.json({ checkedLocations: weatherDeskLocations.length, savedDailyRecords: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Observation archive failed." }, { status: 500 });
  }
}
