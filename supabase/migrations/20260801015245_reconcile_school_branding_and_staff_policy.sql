-- This is a forward-only reconciliation. School branding was applied directly
-- before it was entered in migration history, and the staff-seat policy was
-- applied remotely as apply_staff_seat_policy. Do not replay either history.

create table if not exists public.organization_branding (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  school_name text,
  logo_path text,
  logo_alt text,
  logo_authorized_at timestamptz,
  logo_authorized_by uuid references auth.users(id) on delete set null,
  department_name text,
  department_logo_path text,
  department_logo_alt text,
  updated_at timestamptz not null default now(),
  constraint organization_branding_school_name_length check (school_name is null or char_length(school_name) <= 160),
  constraint organization_branding_logo_path_length check (logo_path is null or char_length(logo_path) <= 500),
  constraint organization_branding_logo_alt_length check (logo_alt is null or char_length(logo_alt) <= 200)
);

create or replace function public.touch_organization_branding()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_organization_branding on public.organization_branding;
create trigger touch_organization_branding
before update on public.organization_branding
for each row execute function public.touch_organization_branding();

alter table public.organization_branding enable row level security;
grant select, insert, update, delete on public.organization_branding to authenticated;

drop policy if exists "School members read their workspace branding" on public.organization_branding;
create policy "School members read their workspace branding" on public.organization_branding
  for select to authenticated
  using ((select frontline_private.can_view_organization(organization_id)));

drop policy if exists "Owners manage school workspace branding" on public.organization_branding;
create policy "Owners manage school workspace branding" on public.organization_branding
  for all to authenticated
  using ((select frontline_private.is_owner()))
  with check (
    (select frontline_private.is_owner())
    and exists (select 1 from public.organizations where id = organization_id and kind = 'school')
  );

insert into storage.buckets (id, name, public)
values ('organization-branding', 'organization-branding', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Owners upload school branding assets" on storage.objects;
create policy "Owners upload school branding assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'organization-branding' and (select frontline_private.is_owner()));

drop policy if exists "Owners update school branding assets" on storage.objects;
create policy "Owners update school branding assets" on storage.objects
  for update to authenticated
  using (bucket_id = 'organization-branding' and (select frontline_private.is_owner()))
  with check (bucket_id = 'organization-branding' and (select frontline_private.is_owner()));

drop policy if exists "Owners remove school branding assets" on storage.objects;
create policy "Owners remove school branding assets" on storage.objects
  for delete to authenticated
  using (bucket_id = 'organization-branding' and (select frontline_private.is_owner()));

-- Licensed seats are learner seats. School staff may organize their school and
-- classrooms without consuming the student allocation they administer.
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

drop trigger if exists organization_memberships_enforce_school_allocation on public.organization_memberships;
create trigger organization_memberships_enforce_school_allocation
before insert or update on public.organization_memberships
for each row execute function frontline_private.enforce_school_membership_allocation();

drop trigger if exists classroom_memberships_enforce_capacity on public.classroom_memberships;
create trigger classroom_memberships_enforce_capacity
before insert or update on public.classroom_memberships
for each row execute function frontline_private.enforce_classroom_membership_capacity();

-- These are the only public licensing RPCs intentionally callable by signed-in
-- users. Keep anon and service_role outside their execution grants.
revoke all on function frontline_private.enforce_school_membership_allocation() from public, anon, authenticated;
revoke all on function frontline_private.enforce_classroom_membership_capacity() from public, anon, authenticated;
revoke all on function public.create_classroom_join_code(uuid, text, timestamptz, integer) from public, anon, service_role;
revoke all on function public.redeem_classroom_join_code(text) from public, anon, service_role;
revoke all on function public.redeem_organization_license(text) from public, anon, service_role;
grant execute on function public.create_classroom_join_code(uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.redeem_classroom_join_code(text) to authenticated;
grant execute on function public.redeem_organization_license(text) to authenticated;
