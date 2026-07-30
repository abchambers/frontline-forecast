-- Finance records need payment context without storing card or bank details.
alter table public.hq_expenses
  add column if not exists payment_status text not null default 'Planned',
  add column if not exists payment_method text,
  add column if not exists reference text,
  add column if not exists notes text;

alter table public.hq_expenses
  drop constraint if exists hq_expenses_payment_status_valid,
  drop constraint if exists hq_expenses_payment_method_length,
  drop constraint if exists hq_expenses_reference_length,
  drop constraint if exists hq_expenses_notes_length;

alter table public.hq_expenses
  add constraint hq_expenses_payment_status_valid check (payment_status in ('Planned', 'Due', 'Paid', 'Reimbursed')),
  add constraint hq_expenses_payment_method_length check (payment_method is null or char_length(payment_method) <= 80),
  add constraint hq_expenses_reference_length check (reference is null or char_length(reference) <= 160),
  add constraint hq_expenses_notes_length check (notes is null or char_length(notes) <= 4_000);

create index if not exists hq_expenses_user_payment_status_idx
  on public.hq_expenses (user_id, payment_status);

-- A small internal assurance register: control evidence, accountability, and
-- review dates. It holds references only, never passwords or secret material.
create table if not exists public.hq_security_controls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  control_name text not null check (char_length(trim(control_name)) between 1 and 180),
  area text not null check (area in ('Identity', 'Domain', 'Source control', 'Hosting', 'Data', 'Continuity', 'Other')),
  status text not null default 'Not started' check (status in ('Not started', 'In progress', 'In place', 'Review needed')),
  owner text,
  review_date date,
  evidence_url text,
  notes text check (notes is null or char_length(notes) <= 4_000),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.hq_security_controls enable row level security;
grant select, insert, update, delete on public.hq_security_controls to authenticated;
drop policy if exists "Platform owners manage HQ security controls" on public.hq_security_controls;
create policy "Platform owners manage HQ security controls"
  on public.hq_security_controls for all to authenticated
  using ((select frontline_private.is_owner()) and (select auth.uid()) = user_id)
  with check ((select frontline_private.is_owner()) and (select auth.uid()) = user_id);

create index if not exists hq_security_controls_user_review_idx
  on public.hq_security_controls (user_id, review_date)
  where archived_at is null;
