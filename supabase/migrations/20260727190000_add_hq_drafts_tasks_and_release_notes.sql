-- Separate editable HQ drafts from the public production configuration. Drafts
-- are never read by the production site and are owner-only through RLS.

alter table public.site_content_versions
  add column if not exists release_note text;

create table if not exists public.site_content_drafts (
  content_key text primary key references public.site_content(key) on delete cascade,
  value jsonb not null check (jsonb_typeof(value) = 'object'),
  release_note text,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create index if not exists site_content_drafts_updated_at_idx
  on public.site_content_drafts (updated_at desc);

alter table public.site_content_drafts enable row level security;
grant select, insert, update, delete on public.site_content_drafts to authenticated;

drop policy if exists "Owners manage site content drafts" on public.site_content_drafts;
create policy "Owners manage site content drafts"
on public.site_content_drafts for all to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and role in ('owner', 'admin')
))
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('owner', 'admin')
  )
);

-- Tasks are a private company work queue. They are intentionally separate
-- from roadmap prose so the HQ dashboard can link to actionable records.
create table if not exists public.hq_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  priority text not null default 'Normal' check (priority in ('Low', 'Normal', 'High')),
  status text not null default 'Open' check (status in ('Open', 'In progress', 'Done')),
  due_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists hq_tasks_open_due_idx
  on public.hq_tasks (user_id, status, due_at);

alter table public.hq_tasks enable row level security;
grant select, insert, update, delete on public.hq_tasks to authenticated;

drop policy if exists "Platform owners manage HQ tasks" on public.hq_tasks;
create policy "Platform owners manage HQ tasks"
on public.hq_tasks for all to authenticated
using ((select public.is_owner()) and (select auth.uid()) = user_id)
with check ((select public.is_owner()) and (select auth.uid()) = user_id);
