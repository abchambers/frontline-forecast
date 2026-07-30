-- A personal display preference only. Public visitors always receive the
-- traditional symbol set, while signed-in users may choose a simpler set.
alter table public.profiles
  add column if not exists weather_icon_style text not null default 'traditional'
  check (weather_icon_style in ('traditional', 'minimal'));
