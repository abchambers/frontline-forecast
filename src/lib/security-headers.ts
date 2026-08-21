type Header = { key: string; value: string };

// upgrade-insecure-requests tells the browser to force every sub-resource on
// the page onto HTTPS, no matter what scheme was actually requested -- right
// for production (real TLS), but it silently breaks `next dev` over plain
// HTTP: the page itself loads, then every CSS/JS/API request it makes gets
// upgraded to HTTPS and fails outright since there's no local certificate.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob: https://*.supabase.co https://basemaps.cartocdn.com https://opengeo.ncep.noaa.gov https://digital.weather.gov https://mesonet.agron.iastate.edu https://cdn.star.nesdis.noaa.gov https://www.spc.noaa.gov",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(process.env.NODE_ENV === "development" ? [] : ["upgrade-insecure-requests"]),
].join("; ");

export function securityHeaders(): Header[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}
