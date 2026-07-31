-- Licensed seats represent learners. School coordinators and teaching staff
-- need to organize classes without consuming the student allocation they
-- administer. Capacity remains enforced for every student enrollment.

create or replace function frontline_private.enforce_school_membership_allocation()
returns trigger
language plpgsql
security definer
set search_path = public, frontline_private
as $$
declare
  entitlement public.organization_entitlements%rowtype;
  active_learners integer;
begin
  if new.status <> 'active' then return new; end if;
  if not exists (select 1 from public.organizations where id = new.organization_id and kind = 'school') then return new; end if;

  -- Owner, coordinator, instructor, and reviewer access is staff access. It
  -- is deliberately separate from the school's purchased learner seats.
  if new.role in ('owner', 'admin', 'instructor', 'reviewer') then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.role not in ('owner', 'admin', 'instructor', 'reviewer') then return new; end if;

  select * into entitlement from public.organization_entitlements where organization_id = new.organization_id for update;
  if not found or entitlement.status not in ('trial', 'active') then raise exception 'This school license is not active.'; end if;
  if entitlement.seat_limit is not null then
    select count(*) into active_learners
    from public.organization_memberships
    where organization_id = new.organization_id
      and status = 'active'
      and role not in ('owner', 'admin', 'instructor', 'reviewer')
      and (tg_op = 'INSERT' or id <> old.id);
    if active_learners >= entitlement.seat_limit then raise exception 'This school has no remaining licensed seats.'; end if;
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
  active_students integer;
  school_id uuid;
begin
  if new.status <> 'active' then return new; end if;
  select organization_id, seat_limit into school_id, class_capacity from public.classrooms where id = new.classroom_id;
  if school_id is null then raise exception 'This classroom no longer exists.'; end if;
  if not exists (select 1 from public.organization_memberships where organization_id = school_id and user_id = new.user_id and status = 'active') then
    raise exception 'Students and instructors must have active school access before joining a class.';
  end if;

  -- Instructors and assistants do not use a student place in their own class.
  if new.role in ('instructor', 'assistant') then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.role = 'student' then return new; end if;
  select count(*) into active_students
  from public.classroom_memberships
  where classroom_id = new.classroom_id
    and status = 'active'
    and role = 'student'
    and (tg_op = 'INSERT' or id <> old.id);
  if active_students >= class_capacity then raise exception 'This class has reached its licensed seat limit.'; end if;
  return new;
end;
$$;

create or replace function public.redeem_organization_license(raw_code text)
returns table (organization_id uuid, organization_name text, membership_role text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  license public.organization_license_codes%rowtype;
  entitlement public.organization_entitlements%rowtype;
  normalized_hash text;
  current_learners integer;
begin
  if auth.uid() is null then raise exception 'Sign in before redeeming a school code.'; end if;
  normalized_hash := encode(extensions.digest(upper(trim(raw_code)), 'sha256'), 'hex');
  select * into license from public.organization_license_codes where code_hash = normalized_hash for update;
  if not found or not license.active then raise exception 'This school code is not active.'; end if;
  if license.expires_at is not null and license.expires_at <= now() then raise exception 'This school code has expired.'; end if;
  if license.max_redemptions is not null and license.redemption_count >= license.max_redemptions then raise exception 'This school code has reached its redemption limit.'; end if;

  select * into entitlement from public.organization_entitlements
  where id = license.entitlement_id or (license.entitlement_id is null and organization_id = license.organization_id)
  order by starts_at desc limit 1 for update;
  if found and (entitlement.status not in ('trial', 'active') or (entitlement.ends_at is not null and entitlement.ends_at <= now())) then
    raise exception 'This school license is not currently active.';
  end if;

  select count(*) into current_learners
  from public.organization_memberships
  where organization_id = license.organization_id
    and status = 'active'
    and role not in ('owner', 'admin', 'instructor', 'reviewer');
  if found and entitlement.seat_limit is not null and current_learners >= entitlement.seat_limit
    and not exists (select 1 from public.organization_memberships where organization_id = license.organization_id and user_id = auth.uid() and status = 'active') then
    raise exception 'This school license has no remaining seats.';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (license.organization_id, auth.uid(), license.default_role, 'active')
  on conflict (organization_id, user_id) do update set status = 'active';
  insert into public.organization_license_redemptions (license_code_id, organization_id, user_id)
  values (license.id, license.organization_id, auth.uid()) on conflict (license_code_id, user_id) do nothing;
  if found then update public.organization_license_codes set redemption_count = redemption_count + 1 where id = license.id; end if;
  return query select organization.id, organization.name, license.default_role from public.organizations organization where organization.id = license.organization_id;
end;
$$;

revoke all on function frontline_private.enforce_school_membership_allocation() from public, anon, authenticated;
revoke all on function frontline_private.enforce_classroom_membership_capacity() from public, anon, authenticated;
revoke all on function public.redeem_organization_license(text) from public, anon, service_role;
grant execute on function public.redeem_organization_license(text) to authenticated;
