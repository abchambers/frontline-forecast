-- School licensing foundation.
--
-- Roles answer what a person can do. Entitlements answer what a school has
-- purchased. Codes are redeemable invitations, never proof of payment.
-- Billing providers should update organization_entitlements through a verified
-- server-side webhook; the browser must never mark a plan as paid.

create extension if not exists pgcrypto with schema extensions;

create table public.organization_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  plan_code text not null default 'pilot',
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'suspended', 'canceled', 'expired')),
  seat_limit integer check (seat_limit is null or seat_limit > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  billing_provider text,
  billing_customer_id text,
  billing_subscription_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.organization_license_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entitlement_id uuid references public.organization_entitlements(id) on delete set null,
  code_hash text not null unique,
  code_hint text not null,
  label text,
  default_role text not null default 'student' check (default_role in ('member', 'student', 'forecaster')),
  expires_at timestamptz,
  max_redemptions integer,
  redemption_count integer not null default 0,
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_redemptions is null or max_redemptions > 0),
  check (redemption_count >= 0),
  check (expires_at is null or expires_at > created_at)
);

create table public.organization_license_redemptions (
  id uuid primary key default gen_random_uuid(),
  license_code_id uuid not null references public.organization_license_codes(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (license_code_id, user_id)
);

create index organization_license_codes_organization_idx on public.organization_license_codes (organization_id, active, expires_at);
create index organization_license_redemptions_user_idx on public.organization_license_redemptions (user_id, redeemed_at desc);

create or replace function public.touch_organization_license_records()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organization_entitlements_touch_updated_at
  before update on public.organization_entitlements
  for each row execute procedure public.touch_organization_license_records();

create trigger organization_license_codes_touch_updated_at
  before update on public.organization_license_codes
  for each row execute procedure public.touch_organization_license_records();

alter table public.organization_entitlements enable row level security;
alter table public.organization_license_codes enable row level security;
alter table public.organization_license_redemptions enable row level security;

grant select on public.organization_entitlements, public.organization_license_codes, public.organization_license_redemptions to authenticated;

create policy "Organization members read their plan" on public.organization_entitlements
  for select to authenticated
  using (public.can_view_organization(organization_id));

create policy "Platform owner manages organization plans" on public.organization_entitlements
  for all to authenticated
  using (public.is_owner())
  with check (public.is_owner());

create policy "Organization managers read their codes" on public.organization_license_codes
  for select to authenticated
  using (public.can_manage_organization(organization_id));

create policy "Organization managers manage their codes" on public.organization_license_codes
  for all to authenticated
  using (public.can_manage_organization(organization_id))
  with check (public.can_manage_organization(organization_id));

create policy "People read their own redemptions" on public.organization_license_redemptions
  for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_organization(organization_id));

-- Redeeming a code is intentionally a narrow server-side transaction. The
-- raw code is hashed inside Postgres, capacity is locked before membership is
-- written, and no client can set a plan or increment a counter directly.
create or replace function public.redeem_organization_license(raw_code text)
returns table (organization_id uuid, organization_name text, membership_role text)
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  license public.organization_license_codes%rowtype;
  entitlement public.organization_entitlements%rowtype;
  normalized_hash text;
  current_seats integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before redeeming a school code.';
  end if;

  normalized_hash := encode(extensions.digest(upper(trim(raw_code)), 'sha256'), 'hex');
  select * into license
  from public.organization_license_codes
  where code_hash = normalized_hash
  for update;

  if not found or not license.active then
    raise exception 'This school code is not active.';
  end if;
  if license.expires_at is not null and license.expires_at <= now() then
    raise exception 'This school code has expired.';
  end if;
  if license.max_redemptions is not null and license.redemption_count >= license.max_redemptions then
    raise exception 'This school code has reached its redemption limit.';
  end if;

  select * into entitlement
  from public.organization_entitlements
  where id = license.entitlement_id or (license.entitlement_id is null and organization_id = license.organization_id)
  order by starts_at desc
  limit 1
  for update;

  if found and (entitlement.status not in ('trial', 'active') or (entitlement.ends_at is not null and entitlement.ends_at <= now())) then
    raise exception 'This school license is not currently active.';
  end if;

  select count(*) into current_seats
  from public.organization_memberships
  where organization_id = license.organization_id and status = 'active';
  if found and entitlement.seat_limit is not null and current_seats >= entitlement.seat_limit
    and not exists (select 1 from public.organization_memberships where organization_id = license.organization_id and user_id = auth.uid() and status = 'active') then
    raise exception 'This school license has no remaining seats.';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (license.organization_id, auth.uid(), license.default_role, 'active')
  on conflict (organization_id, user_id) do update
    set status = 'active';

  insert into public.organization_license_redemptions (license_code_id, organization_id, user_id)
  values (license.id, license.organization_id, auth.uid())
  on conflict (license_code_id, user_id) do nothing;

  if found then
    update public.organization_license_codes
    set redemption_count = redemption_count + 1
    where id = license.id;
  end if;

  return query
  select organization.id, organization.name, license.default_role
  from public.organizations organization
  where organization.id = license.organization_id;
end;
$$;

revoke all on function public.redeem_organization_license(text) from public;
revoke all on function public.redeem_organization_license(text) from anon, service_role;
grant execute on function public.redeem_organization_license(text) to authenticated;
