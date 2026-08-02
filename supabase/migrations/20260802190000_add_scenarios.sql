-- Historical scenarios: HQ authors these (company-hq gets a new page for it),
-- the product surfaces published ones under Verify > Scenarios. Starting one
-- creates a real forecast run tagged with scenario_id — grading is immediate
-- because the target date is already in the past, reusing the existing
-- verification pipeline as-is. No archived-data provider integration exists
-- yet; reference_links/reference_notes are manually entered by HQ staff for
-- now, with a shape that a future autofill source can populate the same way.
create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  category text,
  summary text,
  event_date date not null,
  target_dates date[],
  location_id text not null,
  reference_notes text check (reference_notes is null or char_length(reference_notes) <= 4000),
  reference_links jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create index if not exists scenarios_status_idx on public.scenarios (status, event_date desc);

alter table public.scenarios enable row level security;

create policy "Published scenarios are visible to signed-in users" on public.scenarios
  for select
  using (status = 'published' or (select frontline_private.is_admin()));

create policy "Admins manage scenarios" on public.scenarios
  for all
  using ((select frontline_private.is_admin()))
  with check ((select frontline_private.is_admin()));

create or replace function public.touch_scenario_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scenarios_touch_updated_at on public.scenarios;
create trigger scenarios_touch_updated_at
  before update on public.scenarios
  for each row execute procedure public.touch_scenario_updated_at();

alter table public.forecast_runs
  add column if not exists scenario_id uuid references public.scenarios(id);

alter table public.classroom_assignments
  add column if not exists scenario_id uuid references public.scenarios(id);

create index if not exists forecast_runs_scenario_idx on public.forecast_runs (scenario_id) where scenario_id is not null;

insert into public.scenarios (slug, title, category, summary, event_date, location_id, reference_notes, reference_links, status)
values
  (
    '2011-04-27-super-outbreak',
    '2011 Super Outbreak',
    'Tornado outbreak',
    'One of the largest and most violent tornado outbreaks on record across the Southeast, including a long-track EF5 through Alabama.',
    '2011-04-27',
    'athens-ga',
    'Editorial notes only — archived radar, sounding, and outlook imagery are not linked yet.',
    '[{"label": "Archived NEXRAD reflectivity", "detail": "Full reflectivity loop through the event", "url": null}, {"label": "SPC outlook history", "detail": "Morning outlook and moderate/high-risk mesoscale discussions", "url": null}, {"label": "12Z sounding", "detail": "Extreme instability and shear ahead of the outbreak", "url": null}]'::jsonb,
    'published'
  ),
  (
    '2021-02-14-winter-storm-uri',
    'Texas Winter Storm Uri',
    'Winter storm / cold outbreak',
    'An extended arctic outbreak drove record-low temperatures across Texas and the South, triggering widespread power and water failures.',
    '2021-02-14',
    'athens-ga',
    'Editorial notes only — archived pattern, guidance, and AFD history are not linked yet.',
    '[{"label": "Surface and upper-air pattern", "detail": "Multi-day evolution as the cold built in", "url": null}, {"label": "NBM and ensemble guidance", "detail": "Temperature guidance in the days before onset", "url": null}, {"label": "Area Forecast Discussions", "detail": "Forecaster confidence tracking through the event", "url": null}]'::jsonb,
    'published'
  ),
  (
    '2017-08-25-hurricane-harvey',
    'Hurricane Harvey',
    'Tropical / flooding',
    'Harvey stalled over southeast Texas after landfall, producing catastrophic, multi-day rainfall totals and flooding.',
    '2017-08-25',
    'athens-ga',
    'Editorial notes only — archived satellite and rainfall data are not linked yet.',
    '[{"label": "GOES satellite loop", "detail": "Landfall and stall", "url": null}, {"label": "Model rainfall spread", "detail": "Across runs as the stall became apparent", "url": null}, {"label": "Observed vs. forecast rainfall", "detail": "Day-by-day comparison", "url": null}]'::jsonb,
    'published'
  )
on conflict (slug) do nothing;
