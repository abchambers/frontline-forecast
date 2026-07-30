-- Internal operating records for company formation and commercial readiness.
-- These tables hold accountable metadata and secure references only: never
-- credentials, banking numbers, signed files, or other secret material.

alter table public.hq_expenses
  add column if not exists service_id uuid references public.hq_accounts(id) on delete set null;

create index if not exists hq_expenses_user_service_idx
  on public.hq_expenses (user_id, service_id)
  where archived_at is null;

alter table public.hq_provider_reviews
  add column if not exists plan_name text,
  add column if not exists fallback_provider text;

alter table public.hq_provider_reviews
  drop constraint if exists hq_provider_reviews_plan_name_length,
  drop constraint if exists hq_provider_reviews_fallback_provider_length;

alter table public.hq_provider_reviews
  add constraint hq_provider_reviews_plan_name_length check (plan_name is null or char_length(plan_name) <= 120),
  add constraint hq_provider_reviews_fallback_provider_length check (fallback_provider is null or char_length(fallback_provider) <= 160);

alter table public.hq_employee_records
  add column if not exists employment_type text not null default 'Employee',
  add column if not exists work_email text,
  add column if not exists onboarding_notes text,
  add column if not exists policy_acknowledged_at date;

alter table public.hq_employee_records
  drop constraint if exists hq_employee_records_employment_type_valid,
  drop constraint if exists hq_employee_records_work_email_length,
  drop constraint if exists hq_employee_records_onboarding_notes_length;

alter table public.hq_employee_records
  add constraint hq_employee_records_employment_type_valid check (employment_type in ('Employee', 'Contractor', 'Volunteer', 'Advisor', 'Other')),
  add constraint hq_employee_records_work_email_length check (work_email is null or char_length(work_email) <= 320),
  add constraint hq_employee_records_onboarding_notes_length check (onboarding_notes is null or char_length(onboarding_notes) <= 4_000);

create table if not exists public.hq_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  document_type text not null default 'Other' check (document_type in ('Formation', 'Legal', 'Finance', 'Contract', 'Insurance', 'Policy', 'Brand', 'Other')),
  status text not null default 'Draft' check (status in ('Draft', 'Active', 'Review needed', 'Archived')),
  external_url text,
  owner text,
  review_date date,
  notes text,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (external_url is null or char_length(external_url) <= 1000),
  check (owner is null or char_length(owner) <= 120),
  check (notes is null or char_length(notes) <= 4000)
);

create index if not exists hq_documents_owner_status_review_idx
  on public.hq_documents (user_id, status, review_date);
alter table public.hq_documents enable row level security;
grant select, insert, update, delete on public.hq_documents to authenticated;
create policy "Platform owners manage HQ documents" on public.hq_documents for all to authenticated
using ((select frontline_private.is_owner()) and (select auth.uid()) = user_id)
with check ((select frontline_private.is_owner()) and (select auth.uid()) = user_id);

create table if not exists public.hq_roadmap_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  initiative_type text not null default 'Operations' check (initiative_type in ('Product', 'Operations', 'Legal', 'Finance', 'Launch')),
  status text not null default 'Planned' check (status in ('Planned', 'In progress', 'Blocked', 'Complete', 'Archived')),
  priority text not null default 'Normal' check (priority in ('Low', 'Normal', 'High')),
  owner text,
  target_date date,
  dependency text,
  task_id uuid references public.hq_tasks(id) on delete set null,
  notes text,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (owner is null or char_length(owner) <= 120),
  check (dependency is null or char_length(dependency) <= 500),
  check (notes is null or char_length(notes) <= 4000)
);

create index if not exists hq_roadmap_items_owner_status_target_idx
  on public.hq_roadmap_items (user_id, status, target_date);
alter table public.hq_roadmap_items enable row level security;
grant select, insert, update, delete on public.hq_roadmap_items to authenticated;
create policy "Platform owners manage HQ roadmap items" on public.hq_roadmap_items for all to authenticated
using ((select frontline_private.is_owner()) and (select auth.uid()) = user_id)
with check ((select frontline_private.is_owner()) and (select auth.uid()) = user_id);

create table if not exists public.hq_organization_records (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_name text,
  contact_email text,
  billing_contact text,
  contract_reference text,
  contract_status text not null default 'Prospect' check (contract_status in ('Prospect', 'Pilot', 'Active', 'Paused', 'Ended')),
  renewal_date date,
  onboarding_state text not null default 'Not started' check (onboarding_state in ('Not started', 'In progress', 'Complete')),
  notes text,
  updated_at timestamptz not null default now(),
  check (contact_name is null or char_length(contact_name) <= 160),
  check (contact_email is null or char_length(contact_email) <= 320),
  check (billing_contact is null or char_length(billing_contact) <= 320),
  check (contract_reference is null or char_length(contract_reference) <= 160),
  check (notes is null or char_length(notes) <= 4000)
);

create index if not exists hq_organization_records_user_renewal_idx
  on public.hq_organization_records (user_id, renewal_date);
alter table public.hq_organization_records enable row level security;
grant select, insert, update, delete on public.hq_organization_records to authenticated;
create policy "Platform owners manage HQ organization records" on public.hq_organization_records for all to authenticated
using ((select frontline_private.is_owner()) and (select auth.uid()) = user_id)
with check ((select frontline_private.is_owner()) and (select auth.uid()) = user_id);
