-- Personal-tier gates model-data access for individual (non-school) accounts.
-- This is deliberately separate from profiles.role, which governs platform/HQ
-- administration, not product features. School access to model data is not a
-- tier flag at all — it's already fully derivable from an active
-- organization_memberships/classroom_memberships row, so no new field is
-- needed for that path.
alter table public.profiles
  add column if not exists personal_tier text not null default 'free' check (personal_tier in ('free', 'paid'));

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

  if new.personal_tier is distinct from old.personal_tier
    and not frontline_private.is_admin() then
    raise exception 'Only an owner or administrator can change a personal tier directly.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.protect_profile_identity() from public, anon, authenticated, service_role;

-- Mirrors the role guard added in harden_profile_role_self_update.sql: block
-- tier escalation at the RLS layer too, not just in the trigger, so a future
-- change to one can't silently diverge from the other.
drop policy if exists "Users update their profile details" on public.profiles;
create policy "Users update their profile details" on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    and personal_tier = (select p.personal_tier from public.profiles p where p.id = auth.uid())
  );

-- Callable by any signed-in user to check their own access without exposing
-- personal_tier, membership tables, or the admin bypass to client-side logic.
create or replace function public.has_model_data_access()
returns boolean
language sql
stable
security definer
set search_path = public, frontline_private
as $$
  select
    frontline_private.is_admin()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and personal_tier = 'paid'
    )
    or exists (
      select 1
      from public.organization_memberships om
      join public.organizations o on o.id = om.organization_id
      where om.user_id = auth.uid() and om.status = 'active' and o.kind = 'school'
    )
    or exists (
      select 1 from public.classroom_memberships
      where user_id = auth.uid() and status = 'active'
    );
$$;

revoke all on function public.has_model_data_access() from public, anon, service_role;
grant execute on function public.has_model_data_access() to authenticated;
