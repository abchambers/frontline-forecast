-- A classroom-level instructor/assistant (added via classroom_memberships with role
-- 'instructor'/'assistant', without also holding an org-level owner/admin/instructor role) could
-- already manage assignments for their class (can_manage_classroom_assignment) but could not
-- add/remove students on their own roster, since classroom_memberships' RLS policy only accepted
-- an org-level can_manage_organization() check. This adds a helper that accepts either the
-- existing org-level path or classroom-level instructor/assistant, and repoints the roster policy
-- at it. Purely additive: no existing permitted caller loses access.

create or replace function frontline_private.can_manage_classroom_roster(target_classroom uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select frontline_private.can_manage_classroom_assignment(target_classroom)
    or exists (
      select 1 from public.classrooms c
      where c.id = target_classroom
        and frontline_private.can_manage_organization(c.organization_id)
    );
$$;

drop policy if exists "Classroom managers manage roster" on public.classroom_memberships;
create policy "Classroom managers manage roster" on public.classroom_memberships
  for all
  using (frontline_private.can_manage_classroom_roster(classroom_id))
  with check (frontline_private.can_manage_classroom_roster(classroom_id));
