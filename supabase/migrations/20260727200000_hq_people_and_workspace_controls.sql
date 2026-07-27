-- Private operating records for user invitations and role-change requests.
-- Creating an entry never creates an Auth account or changes a platform role.

create table if not exists public.hq_user_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_profile_id uuid references public.profiles(id) on delete set null,
  request_type text not null check (request_type in ('invite', 'role_change')),
  email text,
  display_name text,
  requested_role text not null check (requested_role in ('owner', 'admin', 'instructor', 'reviewer', 'forecaster', 'student', 'member')),
  notes text,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Declined', 'Completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (request_type = 'invite' and email is not null and char_length(trim(email)) > 3)
    or (request_type = 'role_change' and target_profile_id is not null)
  )
);

create index if not exists hq_user_access_requests_user_created_idx
  on public.hq_user_access_requests (user_id, created_at desc);

alter table public.hq_user_access_requests enable row level security;
grant select, insert, update, delete on public.hq_user_access_requests to authenticated;

drop policy if exists "Platform owners manage HQ user access requests" on public.hq_user_access_requests;
create policy "Platform owners manage HQ user access requests"
on public.hq_user_access_requests for all to authenticated
using ((select public.is_owner()) and (select auth.uid()) = user_id)
with check ((select public.is_owner()) and (select auth.uid()) = user_id);

insert into public.site_content (key, section, label, value, is_public)
values (
  'workspace-access.public',
  'Production',
  'Workspace access',
  '{"items":[{"id":"weather","label":"Weather","access":"public","enabled":true},{"id":"radar","label":"Radar","access":"public","enabled":true},{"id":"about","label":"About","access":"public","enabled":true},{"id":"forecast","label":"Forecast","access":"member","enabled":true},{"id":"verify","label":"Verify","access":"member","enabled":true},{"id":"control","label":"Control panel","access":"owner","enabled":true}]}'::jsonb,
  true
)
on conflict (key) do nothing;
