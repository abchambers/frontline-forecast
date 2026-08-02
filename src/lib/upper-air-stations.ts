// The NWS/NOAA radiosonde (upper-air balloon launch) network is a fixed, publicly documented set
// of roughly 70 CONUS sites, each co-located with (and identified by) a Weather Forecast Office.
// api.weather.gov has no "nearest upper-air site" endpoint, so this list exists to compute that
// locally via haversine distance. Coordinates are the launch site, not the office coordinates.
export type UpperAirStation = { id: string; name: string; latitude: number; longitude: number };

export const upperAirStations: UpperAirStation[] = [
  { id: "CAR", name: "Caribou, ME", latitude: 46.87, longitude: -68.01 },
  { id: "GYX", name: "Gray, ME", latitude: 43.89, longitude: -70.25 },
  { id: "ALB", name: "Albany, NY", latitude: 42.69, longitude: -73.83 },
  { id: "OKX", name: "Upton, NY", latitude: 40.87, longitude: -72.86 },
  { id: "CHH", name: "Chatham, MA", latitude: 41.67, longitude: -69.97 },
  { id: "PIT", name: "Pittsburgh, PA", latitude: 40.53, longitude: -80.23 },
  { id: "IAD", name: "Sterling, VA", latitude: 38.98, longitude: -77.48 },
  { id: "WAL", name: "Wallops Island, VA", latitude: 37.93, longitude: -75.48 },
  { id: "RNK", name: "Blacksburg, VA", latitude: 37.2, longitude: -80.41 },
  { id: "GSO", name: "Greensboro, NC", latitude: 36.08, longitude: -79.94 },
  { id: "MHX", name: "Newport, NC", latitude: 34.78, longitude: -76.88 },
  { id: "CHS", name: "Charleston, SC", latitude: 32.9, longitude: -80.03 },
  { id: "FFC", name: "Peachtree City, GA", latitude: 33.36, longitude: -84.57 },
  { id: "JAX", name: "Jacksonville, FL", latitude: 30.48, longitude: -81.7 },
  { id: "TBW", name: "Tampa Bay, FL", latitude: 27.7, longitude: -82.4 },
  { id: "EYW", name: "Key West, FL", latitude: 24.55, longitude: -81.75 },
  { id: "MFL", name: "Miami, FL", latitude: 25.75, longitude: -80.38 },
  { id: "TLH", name: "Tallahassee, FL", latitude: 30.39, longitude: -84.35 },
  { id: "BMX", name: "Birmingham, AL", latitude: 33.17, longitude: -86.77 },
  { id: "MOB", name: "Mobile, AL", latitude: 30.68, longitude: -88.24 },
  { id: "JAN", name: "Jackson, MS", latitude: 32.32, longitude: -90.08 },
  { id: "BNA", name: "Nashville, TN", latitude: 36.25, longitude: -86.56 },
  { id: "OUN", name: "Norman, OK", latitude: 35.18, longitude: -97.44 },
  { id: "SHV", name: "Shreveport, LA", latitude: 32.45, longitude: -93.84 },
  { id: "LCH", name: "Lake Charles, LA", latitude: 30.13, longitude: -93.22 },
  { id: "LIX", name: "Slidell, LA", latitude: 30.34, longitude: -89.83 },
  { id: "CRP", name: "Corpus Christi, TX", latitude: 27.77, longitude: -97.51 },
  { id: "BRO", name: "Brownsville, TX", latitude: 25.92, longitude: -97.42 },
  { id: "DRT", name: "Del Rio, TX", latitude: 29.37, longitude: -100.92 },
  { id: "FWD", name: "Fort Worth, TX", latitude: 32.83, longitude: -97.3 },
  { id: "EPZ", name: "Santa Teresa, NM", latitude: 31.87, longitude: -106.7 },
  { id: "MAF", name: "Midland, TX", latitude: 31.94, longitude: -102.19 },
  { id: "AMA", name: "Amarillo, TX", latitude: 35.23, longitude: -101.7 },
  { id: "DDC", name: "Dodge City, KS", latitude: 37.76, longitude: -99.97 },
  { id: "TOP", name: "Topeka, KS", latitude: 39.07, longitude: -95.62 },
  { id: "SGF", name: "Springfield, MO", latitude: 37.24, longitude: -93.4 },
  { id: "LZK", name: "Little Rock, AR", latitude: 34.83, longitude: -92.26 },
  { id: "ILN", name: "Wilmington, OH", latitude: 39.42, longitude: -83.82 },
  { id: "APX", name: "Gaylord, MI", latitude: 44.91, longitude: -84.72 },
  { id: "DTX", name: "Detroit/Pontiac, MI", latitude: 42.7, longitude: -83.47 },
  { id: "ILX", name: "Lincoln, IL", latitude: 40.15, longitude: -89.34 },
  { id: "DVN", name: "Davenport, IA", latitude: 41.61, longitude: -90.58 },
  { id: "OAX", name: "Omaha/Valley, NE", latitude: 41.32, longitude: -96.37 },
  { id: "ABR", name: "Aberdeen, SD", latitude: 45.46, longitude: -98.41 },
  { id: "UNR", name: "Rapid City, SD", latitude: 44.07, longitude: -103.21 },
  { id: "BIS", name: "Bismarck, ND", latitude: 46.77, longitude: -100.75 },
  { id: "INL", name: "International Falls, MN", latitude: 48.57, longitude: -93.39 },
  { id: "MPX", name: "Chanhassen, MN", latitude: 44.85, longitude: -93.57 },
  { id: "GRB", name: "Green Bay, WI", latitude: 44.5, longitude: -88.11 },
  { id: "GGW", name: "Glasgow, MT", latitude: 48.21, longitude: -106.62 },
  { id: "TFX", name: "Great Falls, MT", latitude: 47.46, longitude: -111.38 },
  { id: "RIW", name: "Riverton, WY", latitude: 43.06, longitude: -108.48 },
  { id: "LBF", name: "North Platte, NE", latitude: 41.13, longitude: -100.68 },
  { id: "DNR", name: "Denver, CO", latitude: 39.77, longitude: -104.87 },
  { id: "GJT", name: "Grand Junction, CO", latitude: 39.12, longitude: -108.53 },
  { id: "ABQ", name: "Albuquerque, NM", latitude: 35.04, longitude: -106.62 },
  { id: "FGZ", name: "Flagstaff, AZ", latitude: 35.23, longitude: -111.82 },
  { id: "TWC", name: "Tucson, AZ", latitude: 32.12, longitude: -110.93 },
  { id: "TUS", name: "Tucson, AZ", latitude: 32.12, longitude: -110.93 },
  { id: "SLC", name: "Salt Lake City, UT", latitude: 40.77, longitude: -111.95 },
  { id: "BOI", name: "Boise, ID", latitude: 43.56, longitude: -116.22 },
  { id: "REV", name: "Reno, NV", latitude: 39.57, longitude: -119.8 },
  { id: "VEF", name: "Las Vegas, NV", latitude: 36.05, longitude: -115.18 },
  { id: "NKX", name: "San Diego, CA", latitude: 32.87, longitude: -117.14 },
  { id: "VBG", name: "Vandenberg, CA", latitude: 34.75, longitude: -120.56 },
  { id: "OAK", name: "Oakland, CA", latitude: 37.75, longitude: -122.22 },
  { id: "MFR", name: "Medford, OR", latitude: 42.37, longitude: -122.87 },
  { id: "SLE", name: "Salem, OR", latitude: 44.91, longitude: -123.02 },
  { id: "UIL", name: "Quillayute, WA", latitude: 47.95, longitude: -124.55 },
  { id: "OTX", name: "Spokane, WA", latitude: 47.68, longitude: -117.63 },
];

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

// Great-circle distance in kilometers.
function haversineKm(latitude1: number, longitude1: number, latitude2: number, longitude2: number) {
  const earthRadiusKm = 6371;
  const deltaLatitude = toRadians(latitude2 - latitude1);
  const deltaLongitude = toRadians(longitude2 - longitude1);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(toRadians(latitude1)) * Math.cos(toRadians(latitude2)) * Math.sin(deltaLongitude / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestUpperAirStation(latitude: number, longitude: number) {
  let nearest = upperAirStations[0];
  let nearestDistanceKm = Infinity;
  for (const station of upperAirStations) {
    const distanceKm = haversineKm(latitude, longitude, station.latitude, station.longitude);
    if (distanceKm < nearestDistanceKm) {
      nearestDistanceKm = distanceKm;
      nearest = station;
    }
  }
  return { station: nearest, distanceKm: Math.round(nearestDistanceKm) };
}
