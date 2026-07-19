import { NextResponse } from "next/server";

const ATHENS = { latitude: 33.9519, longitude: -83.3576 };

type NwsFeature<T> = { properties: T };

type PointProperties = {
  forecast: string;
  forecastHourly: string;
  observationStations: string;
  relativeLocation: { properties: { city: string; state: string } };
};

type ObservationProperties = {
  stationIdentifier: string;
  name: string;
  timestamp: string;
  textDescription: string;
  temperature: { value: number | null };
  dewpoint: { value: number | null };
  windSpeed: { value: number | null };
  windDirection: { value: number | null };
};

type ForecastPeriod = {
  name: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  detailedForecast: string;
  probabilityOfPrecipitation: { value: number | null };
};

type AlertProperties = { event: string; headline: string | null };

async function nws<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json, application/ld+json",
      "User-Agent": "The Weather Desk student forecasting project",
    },
    next: { revalidate: 300 },
  });

  if (!response.ok) throw new Error(`NWS request failed (${response.status})`);
  return response.json() as Promise<T>;
}

function celsiusToFahrenheit(value: number | null) {
  return value === null ? null : Math.round((value * 9) / 5 + 32);
}

function metersPerSecondToMph(value: number | null) {
  return value === null ? null : Math.round(value * 2.23694);
}

function directionFromDegrees(value: number | null) {
  if (value === null) return null;
  const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return labels[Math.round(value / 45) % 8];
}

export async function GET() {
  try {
    const point = await nws<NwsFeature<PointProperties>>(
      `https://api.weather.gov/points/${ATHENS.latitude},${ATHENS.longitude}`,
    );
    const pointData = point.properties;

    const stationList = await nws<{ features: NwsFeature<{ stationIdentifier: string }>[] }>(
      pointData.observationStations,
    );
    const stationId = stationList.features[0]?.properties.stationIdentifier;
    if (!stationId) throw new Error("No nearby NWS observation station was available");

    const [observation, forecast, alerts] = await Promise.all([
      nws<NwsFeature<ObservationProperties>>(
        `https://api.weather.gov/stations/${stationId}/observations/latest`,
      ),
      nws<{ properties: { periods: ForecastPeriod[] } }>(pointData.forecast),
      nws<{ features: NwsFeature<AlertProperties>[] }>(
        `https://api.weather.gov/alerts/active?point=${ATHENS.latitude},${ATHENS.longitude}`,
      ),
    ]);

    const current = observation.properties;
    const nextPeriod = forecast.properties.periods[0];

    return NextResponse.json(
      {
        location: `${pointData.relativeLocation.properties.city}, ${pointData.relativeLocation.properties.state}`,
        observation: {
          station: current.stationIdentifier,
          stationName: current.name,
          observedAt: current.timestamp,
          description: current.textDescription,
          temperatureF: celsiusToFahrenheit(current.temperature.value),
          dewpointF: celsiusToFahrenheit(current.dewpoint.value),
          windMph: metersPerSecondToMph(current.windSpeed.value),
          windDirection: directionFromDegrees(current.windDirection.value),
        },
        forecast: nextPeriod
          ? {
              period: nextPeriod.name,
              temperature: nextPeriod.temperature,
              temperatureUnit: nextPeriod.temperatureUnit,
              shortForecast: nextPeriod.shortForecast,
              detailedForecast: nextPeriod.detailedForecast,
              precipitationChance: nextPeriod.probabilityOfPrecipitation.value,
            }
          : null,
        alerts: alerts.features.slice(0, 3).map(({ properties }) => ({
          event: properties.event,
          headline: properties.headline,
        })),
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (error) {
    console.error("Unable to load NWS weather data", error);
    return NextResponse.json(
      { error: "Live NWS data is temporarily unavailable. Please try again shortly." },
      { status: 502 },
    );
  }
}
