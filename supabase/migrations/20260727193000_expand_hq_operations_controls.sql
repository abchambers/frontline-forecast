-- Expand the private HQ operating tools. These records are not part of the
-- public Forecast API and are restricted to the platform owner through RLS.

alter table public.hq_tasks
  add column if not exists assignee text,
  add column if not exists notes text;

create table if not exists public.hq_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  event_date date not null,
  category text not null default 'Operating' check (category in ('Operating', 'Finance', 'Legal', 'Launch', 'Review')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hq_calendar_events_user_date_idx
  on public.hq_calendar_events (user_id, event_date);

create table if not exists public.hq_activity_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (char_length(trim(action)) between 1 and 120),
  subject text not null check (char_length(trim(subject)) between 1 and 160),
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists hq_activity_log_user_created_idx
  on public.hq_activity_log (user_id, created_at desc);

alter table public.hq_calendar_events enable row level security;
alter table public.hq_activity_log enable row level security;

grant select, insert, update, delete on public.hq_calendar_events to authenticated;
grant select, insert on public.hq_activity_log to authenticated;
revoke update, delete on public.hq_activity_log from authenticated;

drop policy if exists "Platform owners manage HQ calendar events" on public.hq_calendar_events;
create policy "Platform owners manage HQ calendar events"
on public.hq_calendar_events for all to authenticated
using ((select public.is_owner()) and (select auth.uid()) = user_id)
with check ((select public.is_owner()) and (select auth.uid()) = user_id);

drop policy if exists "Platform owners read HQ activity" on public.hq_activity_log;
drop policy if exists "Platform owners append HQ activity" on public.hq_activity_log;
create policy "Platform owners read HQ activity"
on public.hq_activity_log for select to authenticated
using ((select public.is_owner()) and (select auth.uid()) = user_id);
create policy "Platform owners append HQ activity"
on public.hq_activity_log for insert to authenticated
with check ((select public.is_owner()) and (select auth.uid()) = user_id);
