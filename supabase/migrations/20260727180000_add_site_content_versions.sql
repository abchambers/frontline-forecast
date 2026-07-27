-- Immutable snapshots created before a production content change or restore.
-- The current record stays in site_content; this table is the restore history.

create table if not exists public.site_content_versions (
  id bigint generated always as identity primary key,
  content_key text not null references public.site_content(key) on delete cascade,
  value jsonb not null check (jsonb_typeof(value) = 'object'),
  is_public boolean not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists site_content_versions_key_created_at_idx
  on public.site_content_versions (content_key, created_at desc);

alter table public.site_content_versions enable row level security;

grant select, insert on public.site_content_versions to authenticated;
revoke update, delete on public.site_content_versions from authenticated;

drop policy if exists "Owners can read site content versions" on public.site_content_versions;
drop policy if exists "Owners can append site content versions" on public.site_content_versions;

create policy "Owners can read site content versions"
on public.site_content_versions for select to authenticated
using (exists (
  select 1 from public.profiles
  where id = (select auth.uid()) and role in ('owner', 'admin')
));

create policy "Owners can append site content versions"
on public.site_content_versions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('owner', 'admin')
  )
);
