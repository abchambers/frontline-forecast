-- A school licenses a total learner seat count, not a class structure. Andrew's
-- call (2026-08-23): the company shouldn't dictate how many classes a school runs
-- or how many seats go in each one -- that's the school's own organization to make,
-- same way Google Classroom/Canvas license by user count, not class count. The one
-- real backstop that matters (total licensed seats) already has its own trigger
-- below and is untouched. class_limit/class_seat_limit were a second, redundant
-- company-imposed ceiling that required HQ to guess a school's classroom structure
-- in advance -- dropped entirely, replaced by a single global sanity cap (100
-- classes) that protects the platform from runaway data, not a per-school lever.
create or replace function frontline_private.enforce_school_class_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, frontline_private
as $$
declare
  entitlement public.organization_entitlements%rowtype;
  active_classes integer;
begin
  if not exists (select 1 from public.organizations where id = new.organization_id and kind = 'school') then
    return new;
  end if;

  select * into entitlement from public.organization_entitlements
  where organization_id = new.organization_id for update;
  if not found or entitlement.status not in ('trial', 'active') then
    raise exception 'This school does not have an active license.';
  end if;

  if new.seat_limit is null or new.seat_limit < 1 then
    raise exception 'Set a valid seat limit for this class.';
  end if;

  if tg_op = 'INSERT' and new.status = 'active' then
    select count(*) into active_classes from public.classrooms
    where organization_id = new.organization_id and status = 'active';
    if active_classes >= 100 then
      raise exception 'This school has reached the maximum of 100 classes.';
    end if;
  elsif tg_op = 'UPDATE' and old.status <> 'active' and new.status = 'active' then
    select count(*) into active_classes from public.classrooms
    where organization_id = new.organization_id and status = 'active' and id <> old.id;
    if active_classes >= 100 then
      raise exception 'This school has reached the maximum of 100 classes.';
    end if;
  end if;
  return new;
end;
$$;

alter table public.organization_entitlements
  drop constraint if exists organization_entitlements_class_seat_limit_within_school,
  drop constraint if exists organization_entitlements_class_seat_limit_positive,
  drop column if exists class_limit,
  drop column if exists class_seat_limit;
