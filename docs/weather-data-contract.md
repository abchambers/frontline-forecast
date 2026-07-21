# Weather Desk data contract

The Weather Desk renders weather information from provider-neutral records in
`src/lib/weather-data.ts`. Providers are adapters, not UI dependencies.

## One weather point

Every observation, model output, or future sensor reading supplies:

- source and source kind (`observation`, `model`, or `sensor`)
- Weather Desk location identifier and UTC timestamp
- temperature, dew point, relative humidity, precipitation, and probability
- sustained wind, gust, and wind direction
- an optional human-readable condition

Values are normalized to Fahrenheit, mph, inches, degrees, and ISO timestamps
at ingestion. Raw provider payloads remain archiveable alongside the normalized
record so a forecast can reproduce both what the forecaster saw and where it
came from.

## Future ingestion path

1. A collector receives raw station, sensor, or model data.
2. A provider adapter validates units, timestamps, station ownership, and
   quality flags, then emits `CanonicalWeatherPoint` records.
3. A time-series store retains the raw payload and normalized records.
4. Forecast, map, verification, sounding, and alert views query the same
   contract rather than calling a particular provider directly.

This lets locally owned sensors and a future Weather Desk model coexist with
NWS and Open-Meteo data without a UI rewrite. Model-grid maps will require a
companion gridded-data contract, but can share the same run metadata:
provider/model, run time, valid time, variables, units, grid, and quality.

`src/lib/model-maps.ts` is that first gridded-data contract. It defines a
model-map request by provider, model, run, valid time, variable, level, and
units. The app will not draw a made-up model map: it will only render a field
after a provider or owned-model adapter can attach an exact grid/tile source to
that request.

## Daily observation archive

`weather_daily_observations` stores day/night observation summaries separately
from an individual forecast. The scheduled archive task records both yesterday
and the current local day for every configured Weather Desk location. A record
is marked `provisional` while a period is still in progress and becomes
`complete` when both periods are closed; missing station data is marked
`degraded` instead of being silently treated as a zero.

Run `202607210010_weather_observation_archive.sql` in Supabase before the
scheduled archive can save. It is intentionally service-role-only for now:
the historical/raw data does not become public just because it exists.
