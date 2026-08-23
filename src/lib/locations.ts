export type WeatherDeskLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  observationStation: string;
  upperAirStation: string;
  radarSite: string;
};

export const weatherDeskLocations: WeatherDeskLocation[] = [
  { id: "athens-ga", name: "Athens, GA", latitude: 33.9519, longitude: -83.3576, timezone: "America/New_York", observationStation: "KAHN", upperAirStation: "FFC", radarSite: "KFFC" },
  { id: "atlanta-ga", name: "Atlanta, GA", latitude: 33.749, longitude: -84.388, timezone: "America/New_York", observationStation: "KATL", upperAirStation: "FFC", radarSite: "KFFC" },
  { id: "gainesville-ga", name: "Gainesville, GA", latitude: 34.2979, longitude: -83.8241, timezone: "America/New_York", observationStation: "KGVL", upperAirStation: "FFC", radarSite: "KFFC" },
  { id: "birmingham-al", name: "Birmingham, AL", latitude: 33.5186, longitude: -86.8104, timezone: "America/Chicago", observationStation: "KBHM", upperAirStation: "BMX", radarSite: "KBMX" },
];

export const defaultWeatherDeskLocation = weatherDeskLocations[0];

export function weatherDeskLocation(id: string | null | undefined) {
  return weatherDeskLocations.find((location) => location.id === id) ?? defaultWeatherDeskLocation;
}

// Every weather-data API route needs the same location shape, whether the client is on one of
// the 4 curated presets or a custom location resolved via /api/location-lookup (search or a map
// station pick). Custom locations arrive as raw lat/lon plus the other fields already resolved
// client-side, so no route needs to re-derive them.
export function resolveWeatherDeskLocation(params: URLSearchParams): WeatherDeskLocation {
  // Number(null) is 0, not NaN -- a request with no lat/lon params at all (the normal preset
  // path) must not silently resolve as a "custom" location at 0,0. Only parse when both params
  // are actually present.
  const latParam = params.get("lat");
  const lonParam = params.get("lon");
  const latitude = latParam !== null && latParam !== "" ? Number(latParam) : NaN;
  const longitude = lonParam !== null && lonParam !== "" ? Number(lonParam) : NaN;
  if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    return {
      id: params.get("id") || "custom",
      name: params.get("name") || "Custom location",
      latitude,
      longitude,
      timezone: params.get("tz") || "America/New_York",
      observationStation: (params.get("station") || "").toUpperCase(),
      upperAirStation: (params.get("upperAir") || "").toUpperCase(),
      radarSite: (params.get("radar") || "").toUpperCase(),
    };
  }
  return weatherDeskLocation(params.get("location"));
}
