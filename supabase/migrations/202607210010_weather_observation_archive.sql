-- Provider-neutral daily observation archive. Forecast verification can keep
-- using its period records while this table becomes the durable historical
-- source for trends, station comparison, and future local sensors.
create table public.weather_daily_observations (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_kind text not null check (source_kind in ('observation', 'sensor', 'model')),
  location_id text not null,
  location_name text not null,
  valid_date date not null,
  day_actual jsonb not null,
  night_actual jsonb not null,
  raw_payload jsonb not null,
  quality_status text not null default 'provisional' check (quality_status in ('provisional', 'complete', 'degraded')),
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, location_id, valid_date)
);

create index weather_daily_observations_location_date_idx
  on public.weather_daily_observations (location_id, valid_date desc);

alter table public.weather_daily_observations enable row level security;

-- Historical observations are operational data. The scheduler/service role
-- writes them; authenticated client access can be granted later with an
-- explicit public/archive policy rather than exposing raw station payloads now.
