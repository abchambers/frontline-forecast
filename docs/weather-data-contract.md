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
