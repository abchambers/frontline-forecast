-- Minimal internal employee records. These support the People workspace without
-- introducing payroll, tax, or other sensitive HR data before it is needed.
create table if not exists public.hq_employee_records (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  department text check (char_length(department) <= 120),
  employment_status text not null default 'Active' check (employment_status in ('Active', 'Onboarding', 'Leave', 'Inactive')),
  start_date date,
  manager_profile_id uuid references public.profiles(id) on delete set null,
  onboarding_state text not null default 'Not started' check (onboarding_state in ('Not started', 'In progress', 'Complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hq_employee_records_owner_status_idx on public.hq_employee_records (owner_id, employment_status);
alter table public.hq_employee_records enable row level security;
grant select, insert, update, delete on public.hq_employee_records to authenticated;
drop policy if exists "Platform owners manage HQ employee records" on public.hq_employee_records;
create policy "Platform owners manage HQ employee records" on public.hq_employee_records for all to authenticated
using ((select frontline_private.is_owner()) and (select auth.uid()) = owner_id)
with check ((select frontline_private.is_owner()) and (select auth.uid()) = owner_id);
