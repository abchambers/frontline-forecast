-- NWS's 7-day forecast product is a rolling window: once a date is in the past, NWS simply
-- stops returning it, and /api/weather has always been a pure live pass-through with
-- cache: "no-store" and zero persistence. That made yesterday's guidance vanish from the
-- Verify page the moment the day rolled over, which defeats the point of "verify" -- you need
-- to see what was forecast for a day to compare it against what actually happened. This table
-- is the durable capture of each day's guidance, following the exact same convention as
-- weather_daily_observations (202607210010_weather_observation_archive.sql): the daily cron
-- writes it with the service role, /api/weather reads it server-side to backfill dates the
-- live feed has already dropped, and no client-facing policies are added since nothing reads
-- this table directly over PostgREST.
create table public.weather_daily_outlook (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,
  location_name text not null,
  valid_date date not null,
  label text not null,
  high_f integer,
  low_f integer,
  short_forecast text not null,
  precipitation_chance integer,
  wind text,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, valid_date)
);

create index weather_daily_outlook_location_date_idx
  on public.weather_daily_outlook (location_id, valid_date desc);

alter table public.weather_daily_outlook enable row level security;
