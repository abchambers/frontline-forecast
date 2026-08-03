-- Billing lifecycle scaffolding: schema and a due-date calculator ready to
-- drive an automated past_due -> suspended -> canceled cascade, with no real
-- payment processor wired up yet. next_payment_due_at is a real, advancing
-- column (not recomputed from scratch each time) so "mark as paid" just
-- advances it by one cadence period from whatever it currently is.
alter table public.organization_entitlements
  add column if not exists billing_cadence text not null default 'annual' check (billing_cadence in ('monthly', 'semester', 'annual')),
  add column if not exists next_payment_due_at timestamptz,
  add column if not exists status_changed_at timestamptz not null default now();

-- Monthly/annual are simple rolling offsets from whatever date is passed in.
-- Semester is different on purpose: schools think in academic terms, not a
-- rolling 6-month window from an arbitrary signup date, so it always lands
-- on the nearest Dec 15 or Jun 15 after the given date regardless of when
-- the school originally started — every semester-cadence school renews on
-- the same two calendar dates. Landing near Jun 15 (not Aug/Sept) is
-- deliberate: a school that doesn't renew for the fall still gets to keep
-- access through the tail of a summer term rather than being cut off right
-- at the spring/summer boundary.
create or replace function frontline_private.next_billing_date(from_date timestamptz, cadence text)
returns timestamptz
language sql
stable
as $$
  select case cadence
    when 'monthly' then from_date + interval '1 month'
    when 'annual' then from_date + interval '1 year'
    when 'semester' then (
      select min(candidate) from (
        select make_timestamptz(extract(year from from_date)::int, 6, 15, 0, 0, 0, 'UTC') as candidate
        union all select make_timestamptz(extract(year from from_date)::int, 12, 15, 0, 0, 0, 'UTC')
        union all select make_timestamptz(extract(year from from_date)::int + 1, 6, 15, 0, 0, 0, 'UTC')
        union all select make_timestamptz(extract(year from from_date)::int + 1, 12, 15, 0, 0, 0, 'UTC')
      ) candidates
      where candidate > from_date
    )
    else from_date + interval '1 year'
  end;
$$;

revoke all on function frontline_private.next_billing_date(timestamptz, text) from public, anon, service_role;
grant execute on function frontline_private.next_billing_date(timestamptz, text) to authenticated;

-- Backfill next_payment_due_at for the one existing school entitlement so
-- the automation has something real to work against immediately.
update public.organization_entitlements
set next_payment_due_at = frontline_private.next_billing_date(starts_at, billing_cadence)
where next_payment_due_at is null;

-- past_due is deliberately still "active" here — the whole point is that a
-- school's grace period stays invisible to its students out of respect for
-- the school while they sort out payment. Only suspended/canceled/expired
-- actually cut off access. This corrects the entitlement gate added earlier
-- today, which treated past_due as already-blocked.
create or replace function frontline_private.organization_entitlement_active(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select status in ('trial', 'active', 'past_due') from public.organization_entitlements where organization_id = target_organization),
    true
  );
$$;
