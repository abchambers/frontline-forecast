/**
 * Contract for future gridded model fields. Point guidance and soundings use
 * individual weather points today; maps add run/valid-time/grid metadata so a
 * renderer can request a field without caring whether it came from an owned
 * model, Open-Meteo, or another licensed provider.
 */
export type ModelMapVariable = "temperature_2m" | "dewpoint_2m" | "precipitation" | "cape" | "wind_10m" | "mslp" | "reflectivity";

export type ModelMapRequest = {
  provider: string;
  model: string;
  runTime: string;
  validTime: string;
  variable: ModelMapVariable;
  level: "surface" | `${number}hPa`;
  units: string;
};

export const modelMapVariables: { id: ModelMapVariable; label: string; units: string }[] = [
  { id: "temperature_2m", label: "2 m temperature", units: "°F" },
  { id: "dewpoint_2m", label: "2 m dew point", units: "°F" },
  { id: "precipitation", label: "Accumulated precipitation", units: "in" },
  { id: "cape", label: "Surface CAPE", units: "J/kg" },
  { id: "wind_10m", label: "10 m wind", units: "mph" },
  { id: "mslp", label: "Mean sea-level pressure", units: "hPa" },
  { id: "reflectivity", label: "Composite reflectivity", units: "dBZ" },
];

export function modelMapKey(request: ModelMapRequest) {
  return [request.provider, request.model, request.runTime, request.validTime, request.variable, request.level].join(":");
}
