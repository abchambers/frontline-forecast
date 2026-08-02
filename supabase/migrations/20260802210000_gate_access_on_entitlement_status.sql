-- Closes a real gap: can_view_classroom/can_view_organization only ever
-- checked membership status='active', never organization_entitlements.status.
-- A school whose plan lapsed to 'paused' or 'ended' (stopped paying) kept
-- full student/member access indefinitely. This gates the regular
-- member-viewing path on an active entitlement — the *manage* path
-- (can_manage_organization / can_manage_classroom_assignment /
-- can_manage_classroom_roster) is deliberately left untouched, so a
-- school's own staff can still administer, export, or communicate with
-- their roster during a lapse instead of being locked out entirely.
create or replace function frontline_private.organization_entitlement_active(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  -- No entitlement row at all (company/personal-kind orgs never get one)
  -- means "not entitlement-gated," not "blocked" — only school orgs with a
  -- real entitlement row can be lapsed.
  select coalesce(
    (select status in ('trial', 'active') from public.organization_entitlements where organization_id = target_organization),
    true
  );
$$;

-- Matches every sibling RLS-helper function in this schema (is_admin,
-- can_manage_organization, etc.): authenticated needs direct EXECUTE
-- because RLS policy qual/with_check expressions evaluate as the
-- querying role itself, not nested inside another SECURITY DEFINER call.
revoke all on function frontline_private.organization_entitlement_active(uuid) from public, anon, service_role;
grant execute on function frontline_private.organization_entitlement_active(uuid) to authenticated;

create or replace function frontline_private.can_view_classroom(target_classroom uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select frontline_private.is_owner()
    or exists (
      select 1
      from public.classroom_memberships cm
      join public.classrooms c on c.id = cm.classroom_id
      where cm.classroom_id = target_classroom
        and cm.user_id = auth.uid()
        and cm.status = 'active'
        and frontline_private.organization_entitlement_active(c.organization_id)
    )
    or exists (select 1 from public.classrooms c where c.id = target_classroom and frontline_private.can_manage_organization(c.organization_id));
$$;

create or replace function frontline_private.can_view_organization(target_organization uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select frontline_private.is_admin()
    or (
      exists (select 1 from public.organization_memberships where organization_id = target_organization and user_id = auth.uid() and status = 'active')
      and frontline_private.organization_entitlement_active(target_organization)
    )
    or (
      exists (select 1 from public.classroom_memberships cm join public.classrooms c on c.id = cm.classroom_id where c.organization_id = target_organization and cm.user_id = auth.uid() and cm.status = 'active')
      and frontline_private.organization_entitlement_active(target_organization)
    );
$$;
