-- Control Center roster management. Platform administrators can operate all
-- organization/classroom records; ordinary users remain limited to memberships.

create or replace function public.can_view_organization(target_organization uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.organization_memberships
    where organization_id = target_organization and user_id = auth.uid() and status = 'active'
  ) or exists (
    select 1
    from public.classroom_memberships cm
    join public.classrooms c on c.id = cm.classroom_id
    where c.organization_id = target_organization
      and cm.user_id = auth.uid()
      and cm.status = 'active'
  );
$$;

-- Do not allow a manager to silently remove their own last platform-owner
-- membership through the roster UI. Platform Owner is protected separately.
create or replace function public.protect_workspace_owner_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and old.role = 'owner' and old.user_id = auth.uid() then
    raise exception 'Remove or transfer an organization owner through a deliberate ownership workflow.';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists organization_memberships_protect_owner on public.organization_memberships;
create trigger organization_memberships_protect_owner
  before delete on public.organization_memberships
  for each row execute procedure public.protect_workspace_owner_membership();
