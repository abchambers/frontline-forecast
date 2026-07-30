-- Schools receive a fixed allocation. Program contacts and instructors can
-- organize that allocation, but cannot create extra classes or seats.
alter table public.organization_entitlements
  add column if not exists class_limit integer not null default 1 check (class_limit > 0),
  add column if not exists class_seat_limit integer;

update public.organization_entitlements
set class_seat_limit = least(coalesce(seat_limit, 30), 30)
where class_seat_limit is null;

alter table public.organization_entitlements
  alter column class_seat_limit set not null,
  add constraint organization_entitlements_class_seat_limit_positive check (class_seat_limit > 0),
  add constraint organization_entitlements_class_seat_limit_within_school check (seat_limit is null or class_seat_limit <= seat_limit);

alter table public.classrooms
  add column if not exists seat_limit integer,
  add column if not exists status text not null default 'active' check (status in ('active', 'closed', 'archived'));

update public.classrooms classroom
set seat_limit = least(coalesce(entitlement.class_seat_limit, entitlement.seat_limit, 30), coalesce(entitlement.seat_limit, 30))
from public.organization_entitlements entitlement
where entitlement.organization_id = classroom.organization_id
  and classroom.seat_limit is null;

update public.classrooms set seat_limit = 30 where seat_limit is null;
alter table public.classrooms
  alter column seat_limit set not null,
  add constraint classrooms_seat_limit_positive check (seat_limit > 0);

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
    raise exception 'This school does not have an active class allocation.';
  end if;

  if new.seat_limit is null then new.seat_limit := entitlement.class_seat_limit; end if;
  if new.seat_limit > entitlement.class_seat_limit then
    raise exception 'Class capacity exceeds this school''s licensed per-class limit.';
  end if;

  if tg_op = 'INSERT' and new.status = 'active' then
    select count(*) into active_classes from public.classrooms
    where organization_id = new.organization_id and status = 'active';
    if active_classes >= entitlement.class_limit then
      raise exception 'This school has reached its licensed class allocation.';
    end if;
  elsif tg_op = 'UPDATE' and old.status <> 'active' and new.status = 'active' then
    select count(*) into active_classes from public.classrooms
    where organization_id = new.organization_id and status = 'active' and id <> old.id;
    if active_classes >= entitlement.class_limit then
      raise exception 'This school has reached its licensed class allocation.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function frontline_private.enforce_school_membership_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, frontline_private
as $$
declare
  entitlement public.organization_entitlements%rowtype;
  active_members integer;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then return new; end if;
  if not exists (select 1 from public.organizations where id = new.organization_id and kind = 'school') then return new; end if;
  select * into entitlement from public.organization_entitlements where organization_id = new.organization_id for update;
  if not found or entitlement.status not in ('trial', 'active') then raise exception 'This school license is not active.'; end if;
  if entitlement.seat_limit is not null then
    select count(*) into active_members from public.organization_memberships where organization_id = new.organization_id and status = 'active';
    if active_members >= entitlement.seat_limit then raise exception 'This school has no remaining licensed seats.'; end if;
  end if;
  return new;
end;
$$;

create or replace function frontline_private.enforce_classroom_membership_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, frontline_private
as $$
declare
  class_capacity integer;
  active_members integer;
  school_id uuid;
begin
  if new.status <> 'active' or (tg_op = 'UPDATE' and old.status = 'active') then return new; end if;
  select organization_id, seat_limit into school_id, class_capacity from public.classrooms where id = new.classroom_id;
  if school_id is null then raise exception 'This classroom no longer exists.'; end if;
  if not exists (select 1 from public.organization_memberships where organization_id = school_id and user_id = new.user_id and status = 'active') then
    raise exception 'Students and instructors must have active school access before joining a class.';
  end if;
  select count(*) into active_members from public.classroom_memberships where classroom_id = new.classroom_id and status = 'active';
  if active_members >= class_capacity then raise exception 'This class has reached its licensed seat limit.'; end if;
  return new;
end;
$$;

drop trigger if exists classrooms_enforce_school_class_allocation on public.classrooms;
create trigger classrooms_enforce_school_class_allocation before insert or update on public.classrooms
for each row execute function frontline_private.enforce_school_class_allocation();

drop trigger if exists organization_memberships_enforce_school_allocation on public.organization_memberships;
create trigger organization_memberships_enforce_school_allocation before insert or update on public.organization_memberships
for each row execute function frontline_private.enforce_school_membership_allocation();

drop trigger if exists classroom_memberships_enforce_capacity on public.classroom_memberships;
create trigger classroom_memberships_enforce_capacity before insert or update on public.classroom_memberships
for each row execute function frontline_private.enforce_classroom_membership_capacity();

revoke all on function frontline_private.enforce_school_class_allocation() from public, anon, authenticated;
revoke all on function frontline_private.enforce_school_membership_allocation() from public, anon, authenticated;
revoke all on function frontline_private.enforce_classroom_membership_capacity() from public, anon, authenticated;
