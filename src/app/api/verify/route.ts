import { NextRequest, NextResponse } from "next/server";
import { weatherDeskLocation } from "@/lib/locations";

type Observation = {
  properties: {
    timestamp: string;
    temperature?: { value: number | null };
    windSpeed?: { value: number | null };
    precipitationLastHour?: { value: number | null };
    textDescription: string;
  };
};

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function localTimeToUtc(date: string, hour: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, hour);
  let estimate = new Date(target);
  // Two passes account for the local UTC offset, including daylight saving time.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = localParts(estimate, timeZone);
    const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    estimate = new Date(estimate.getTime() + target - displayed);
  }
  return estimate;
}

function fahrenheit(celsius: number) { return Math.round((celsius * 9) / 5 + 32); }
function mph(metersPerSecond: number) { return Math.round(metersPerSecond * 2.23694); }

function summarize(observations: Observation[], start: Date, end: Date) {
  const inPeriod = observations.filter(({ properties }) => {
    const time = new Date(properties.timestamp).getTime();
    return time >= start.getTime() && time < end.getTime();
  });
  const temperatures = inPeriod.map(({ properties }) => properties.temperature?.value ?? null).filter((value): value is number => value !== null).map(fahrenheit);
  const winds = inPeriod.map(({ properties }) => properties.windSpeed?.value ?? null).filter((value): value is number => value !== null).map(mph);
  const precipitation = inPeriod.some(({ properties }) => (properties.precipitationLastHour?.value ?? 0) > 0 || /rain|shower|storm|drizzle|snow/i.test(properties.textDescription ?? ""));
  return {
    observationCount: inPeriod.length,
    highF: temperatures.length ? Math.max(...temperatures) : null,
    lowF: temperatures.length ? Math.min(...temperatures) : null,
    maxWindMph: winds.length ? Math.max(...winds) : null,
    precipitationObserved: precipitation,
    conditions: [...new Set(inPeriod.map(({ properties }) => properties.textDescription).filter(Boolean))].slice(0, 4),
    complete: end.getTime() <= Date.now(),
  };
}

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get("date");
  const location = weatherDeskLocation(request.nextUrl.searchParams.get("location"));
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "A valid forecast date is required." }, { status: 400 });
  const dayStart = localTimeToUtc(date, 7, location.timezone);
  const dayEnd = localTimeToUtc(date, 19, location.timezone);
  const nextDate = new Date(`${date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nightEnd = localTimeToUtc(nextDate.toISOString().slice(0, 10), 7, location.timezone);
  try {
    const response = await fetch(`https://api.weather.gov/stations/${location.observationStation}/observations?start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(nightEnd.toISOString())}`, {
      headers: { Accept: "application/geo+json", "User-Agent": "The Weather Desk student forecasting project" }, cache: "no-store",
    });
    if (!response.ok) throw new Error(`NWS observations request failed (${response.status})`);
    const data = await response.json() as { features: Observation[] };
    return NextResponse.json({ station: location.observationStation, validDate: date, source: "NWS station observations", fetchedAt: new Date().toISOString(), day: summarize(data.features, dayStart, dayEnd), night: summarize(data.features, dayEnd, nightEnd) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to collect NWS observations." }, { status: 502 });
  }
}
