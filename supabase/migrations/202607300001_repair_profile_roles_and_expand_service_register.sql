-- Restore role-change approvals after authorization helpers moved out of public.
-- The trigger remains an internal-only SECURITY DEFINER trigger function and
-- calls the private helper explicitly so it cannot become a public RPC surface.
create or replace function public.protect_profile_identity()
returns trigger
language plpgsql
security definer
set search_path = public, frontline_private
as $$
begin
  if new.email is distinct from old.email then
    raise exception 'Email is managed by the authentication account.';
  end if;

  if new.role is distinct from old.role
    and not frontline_private.is_admin() then
    raise exception 'Only an owner or administrator can change platform roles.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.protect_profile_identity() from public, anon, authenticated, service_role;

-- A service record is an operational register, not a credential store. These
-- fields identify the plan and ownership without ever storing passwords or API
-- tokens in the HQ database.
alter table public.hq_accounts
  add column if not exists category text,
  add column if not exists plan_name text,
  add column if not exists account_reference text,
  add column if not exists billing_cadence text,
  add column if not exists notes text;

alter table public.hq_accounts
  drop constraint if exists hq_accounts_category_length,
  drop constraint if exists hq_accounts_plan_name_length,
  drop constraint if exists hq_accounts_account_reference_length,
  drop constraint if exists hq_accounts_billing_cadence_valid,
  drop constraint if exists hq_accounts_notes_length;

alter table public.hq_accounts
  add constraint hq_accounts_category_length check (category is null or char_length(category) <= 80),
  add constraint hq_accounts_plan_name_length check (plan_name is null or char_length(plan_name) <= 120),
  add constraint hq_accounts_account_reference_length check (account_reference is null or char_length(account_reference) <= 160),
  add constraint hq_accounts_billing_cadence_valid check (billing_cadence is null or billing_cadence in ('Monthly', 'Annual', 'Usage-based', 'One-time', 'Other')),
  add constraint hq_accounts_notes_length check (notes is null or char_length(notes) <= 4_000);

create index if not exists hq_accounts_user_category_idx
  on public.hq_accounts (user_id, category);
