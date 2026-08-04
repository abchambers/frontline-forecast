// NEXRAD site locations are fixed, published reference data — resolved live via
// the same NWS API family the app already uses for radar-site lookup
// (src/app/api/location-lookup/route.ts), rather than a hardcoded station table.
export type RadarSite = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevationMeters: number;
};

export async function getRadarSite(stationId: string): Promise<RadarSite> {
  const response = await fetch(`https://api.weather.gov/radar/stations/${stationId}`, {
    headers: { Accept: "application/geo+json", "User-Agent": "Frontline Forecast weather application" },
  });
  if (!response.ok) throw new Error(`NWS radar station lookup failed for ${stationId} (${response.status})`);
  const data = (await response.json()) as {
    geometry: { coordinates: [number, number] };
    properties: { name: string; elevation: { value: number } };
  };
  const [longitude, latitude] = data.geometry.coordinates;
  return {
    id: stationId,
    name: data.properties.name,
    latitude,
    longitude,
    elevationMeters: data.properties.elevation.value,
  };
}
