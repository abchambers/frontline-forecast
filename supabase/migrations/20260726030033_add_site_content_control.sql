-- Reconciled from the production database migration history on 2026-07-27.
-- Company HQ can edit these records later, but the Forecast application only
-- reads public, published content through its narrow configuration endpoint.

create table if not exists public.site_content (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9._-]*$'),
  section text not null,
  label text not null,
  description text,
  value jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  is_public boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.site_content enable row level security;

grant select on public.site_content to anon, authenticated;
grant insert, update, delete on public.site_content to authenticated;

drop policy if exists "Public can read published site content" on public.site_content;
drop policy if exists "Owners can read all site content" on public.site_content;
drop policy if exists "Owners can insert site content" on public.site_content;
drop policy if exists "Owners can update site content" on public.site_content;
drop policy if exists "Owners can delete site content" on public.site_content;

create policy "Public can read published site content"
on public.site_content for select to anon, authenticated
using (is_public = true);

create policy "Owners can read all site content"
on public.site_content for select to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and role in ('owner', 'admin')
));

create policy "Owners can insert site content"
on public.site_content for insert to authenticated
with check (
  exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('owner', 'admin')
  ) and updated_by = (select auth.uid())
);

create policy "Owners can update site content"
on public.site_content for update to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and role in ('owner', 'admin')
))
with check (
  exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('owner', 'admin')
  ) and updated_by = (select auth.uid())
);

create policy "Owners can delete site content"
on public.site_content for delete to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and role in ('owner', 'admin')
));

insert into public.site_content (key, section, label, value, is_public)
values
  ('brand.public', 'Brand', 'Public brand', '{"name":"Frontline Forecast","eyebrow":"Weather tools for learning and operations","tagline":"Analyze weather, build forecasts, and learn from the results."}'::jsonb, true),
  ('homepage.public', 'Homepage', 'Public homepage', '{"title":"Forecast with evidence.","description":"Use live observations, radar, guidance, and verification to make better weather decisions.","primaryAction":"View local weather","secondaryAction":"Sign in to forecast"}'::jsonb, true),
  ('navigation.public', 'Navigation', 'Public navigation', '{"items":[{"id":"weather","label":"Weather"},{"id":"radar","label":"Radar"},{"id":"learn","label":"How it works"},{"id":"login","label":"Sign in"}]}'::jsonb, true),
  ('navigation.staff', 'Navigation', 'Staff navigation', '{"items":[{"id":"dashboard","label":"Weather"},{"id":"forecast","label":"Forecast desk"},{"id":"classroom","label":"Classes"},{"id":"verify","label":"Review and results"},{"id":"control","label":"Settings"}]}'::jsonb, false),
  ('navigation.student', 'Navigation', 'Student navigation', '{"items":[{"id":"dashboard","label":"Home"},{"id":"classroom","label":"Assignments"},{"id":"forecast","label":"Create forecast"},{"id":"verify","label":"Results"}]}'::jsonb, false),
  ('theme.shared', 'Appearance', 'Shared appearance', '{"accent":"weather-blue","radius":"medium","density":"comfortable","cardStyle":"flat","showGradients":false}'::jsonb, true)
on conflict (key) do nothing;
