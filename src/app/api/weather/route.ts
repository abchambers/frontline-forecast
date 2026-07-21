import { NextResponse } from "next/server";
import { weatherDeskLocation } from "@/lib/locations";
import { canonicalObservation, celsiusToFahrenheit, metersPerSecondToMph, windDirectionLabel } from "@/lib/weather-data";

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
  startTime: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  detailedForecast: string;
  icon?: string | null;
  probabilityOfPrecipitation: { value: number | null };
};

type AlertProperties = { event: string; headline: string | null };

async function nws<T>(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json, application/ld+json",
      "User-Agent": "The Weather Desk student forecasting project",
    },
    // Alerts are safety-critical reference data for this workspace. Do not
    // serve a minutes-old cached response as if it were current.
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`NWS request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export async function GET(request: Request) {
  try {
    const selectedLocation = weatherDeskLocation(new URL(request.url).searchParams.get("location"));
    const point = await nws<NwsFeature<PointProperties>>(
      `https://api.weather.gov/points/${selectedLocation.latitude},${selectedLocation.longitude}`,
    );
    const pointData = point.properties;

    const stationList = await nws<{ features: NwsFeature<{ stationIdentifier: string }>[] }>(
      pointData.observationStations,
    );
    const stationId = stationList.features.find(({ properties }) => properties.stationIdentifier === selectedLocation.observationStation)?.properties.stationIdentifier
      ?? stationList.features[0]?.properties.stationIdentifier;
    if (!stationId) throw new Error("No nearby NWS observation station was available");

    const [observationResult, forecastResult, alertsResult] = await Promise.allSettled([
      nws<NwsFeature<ObservationProperties>>(
        `https://api.weather.gov/stations/${stationId}/observations/latest`,
      ),
      nws<{ properties: { periods: ForecastPeriod[] } }>(pointData.forecast),
      nws<{ features: NwsFeature<AlertProperties>[] }>(
        `https://api.weather.gov/alerts/active?point=${selectedLocation.latitude},${selectedLocation.longitude}`,
      ),
    ]);

    if (observationResult.status !== "fulfilled" || forecastResult.status !== "fulfilled") {
      const details = [observationResult, forecastResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : "NWS request failed")
        .join("; ");
      throw new Error(`NWS live data is temporarily unavailable: ${details}`);
    }

    const observation = observationResult.value;
    const forecast = forecastResult.value;
    const alertsAvailable = alertsResult.status === "fulfilled";
    const alerts = alertsAvailable ? alertsResult.value : { features: [] };
    const current = observation.properties;
    const nextPeriod = forecast.properties.periods[0];
    const observedTemperatureF = celsiusToFahrenheit(current.temperature.value);
    const forecastTemperatureF = nextPeriod?.temperature ?? null;
    const normalizedObservation = canonicalObservation({
      source: "NWS station observation",
      locationId: selectedLocation.id,
      observedAt: current.timestamp,
      temperatureF: observedTemperatureF,
      dewpointF: celsiusToFahrenheit(current.dewpoint.value),
      relativeHumidity: null,
      precipitationIn: null,
      precipitationProbability: null,
      windMph: metersPerSecondToMph(current.windSpeed.value),
      windDirectionDeg: current.windDirection.value,
      windGustMph: null,
      condition: current.textDescription,
    });

    return NextResponse.json(
      {
        location: selectedLocation.name,
        locationDetails: { ...selectedLocation, nwsOffice: (pointData as PointProperties & { gridId?: string }).gridId ?? null, gridX: (pointData as PointProperties & { gridX?: number }).gridX ?? null, gridY: (pointData as PointProperties & { gridY?: number }).gridY ?? null },
        observation: {
          station: current.stationIdentifier,
          stationName: current.name,
          observedAt: current.timestamp,
          description: current.textDescription,
          // Some METAR observations legitimately omit temperature. In that
          // case, keep the dashboard useful with a clearly identified NWS
          // forecast estimate rather than rendering a blank reading.
          temperatureF: observedTemperatureF ?? forecastTemperatureF,
          temperatureSource: observedTemperatureF === null && forecastTemperatureF !== null
            ? "forecast estimate"
            : "observation",
          dewpointF: normalizedObservation.dewpointF,
          windMph: normalizedObservation.windMph,
          windDirection: windDirectionLabel(normalizedObservation.windDirectionDeg),
        },
        normalizedObservation,
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
        forecastPeriods: forecast.properties.periods.slice(0, 14).map((period) => ({
          name: period.name,
          startTime: period.startTime,
          temperature: period.temperature,
          temperatureUnit: period.temperatureUnit,
          shortForecast: period.shortForecast,
          precipitationChance: period.probabilityOfPrecipitation.value,
          icon: period.icon ?? null,
        })),
        alerts: alerts.features.slice(0, 3).map(({ properties }) => ({
          event: properties.event,
          headline: properties.headline,
        })),
        alertsAvailable,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to load NWS weather data", error);
    return NextResponse.json(
      { error: "Live NWS data is temporarily unavailable. Please try again shortly." },
      { status: 502 },
    );
  }
}
