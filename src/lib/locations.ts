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
