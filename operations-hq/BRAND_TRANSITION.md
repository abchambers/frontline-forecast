# Frontline Forecast brand transition

## Scope completed in the repository

- The visible application name, account menu, class-outlook copy, site metadata, icon, and social preview now use **Frontline Forecast**.
- The new SVG mark is available at `public/brand/frontline-forecast-mark.svg`. The legacy `weather-desk-mark.svg` path deliberately serves the same new mark so any existing asset link continues to resolve.
- Source-provider user-agent labels now identify the application as Frontline Forecast. Provider names, attribution, endpoint URLs, keys, and plans are unchanged.
- Operations HQ documentation and the isolated Concept Lab use the new name. Concept Lab has its own copied logo asset and remains free of production imports, API calls, and deployment wiring.

## Intentionally unchanged

- Production URL: `https://frontline-forecast-the-weather-desk.vercel.app`.
- Supabase project, database schema/table names, environment-variable names, API routes, local-storage keys, event names, and `WeatherDesk*` TypeScript identifiers.
- NWS/NOAA, Open-Meteo, RainViewer, OpenWeather, OpenStreetMap, and Leaflet attribution and provider identities.
- Legal-entity details, because no registered entity or verified legal name is represented in the repository.

These are stability boundaries, not evidence that the old product name remains public. Rename them only in a separately planned migration with redirects, authentication testing, and rollback steps.

## Manual dashboard and domain work before launch

1. In Supabase Authentication, update the confirmation, password-reset, and invite email templates to say **Frontline Forecast**. The templates are dashboard-managed and are not stored in this repository.
2. When a company domain is acquired, add it to Vercel first, then set the canonical production origin in `NEXT_PUBLIC_SITE_URL` and Supabase Authentication Site URL/redirect allow-list. Keep the current Vercel address as a deliberate compatibility URL until the redirect behavior is tested.
3. Set the email sender display name and a verified sending domain only after the domain and mailbox provider are ready. Do not invent a support address before one is monitored.
4. Update external service dashboards, billing records, and provider registration details separately. Changing a courtesy user-agent string does not change a commercial plan or a provider agreement.

## Trademark and naming caution

“Frontline Forecast” is a proposed brand, not a legal clearance. Before spending on a domain, advertising, or customer contracts, perform a jurisdiction- and class-specific trademark search and obtain qualified legal advice. A domain being available does not establish trademark rights.
