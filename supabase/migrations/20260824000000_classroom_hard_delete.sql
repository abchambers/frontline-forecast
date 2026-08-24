-- Classrooms have supported an archive-not-delete workflow since the school
-- flow shipped, but schools (and our own testing) have no way to actually
-- remove a classroom once it's no longer wanted. Add a genuine hard delete,
-- gated behind two safety rails the existing "for all" policy didn't
-- distinguish: (1) only a classroom already in 'archived' status can be
-- deleted -- archiving remains the reversible first step -- and (2) only an
-- organization owner/admin can do it, not an instructor (the old policy's
-- can_manage_organization() check allowed instructors to manage classrooms
-- broadly, which is fine for select/insert/update but too permissive for a
-- permanent delete).
--
-- Every dependent table already has `on delete cascade` back to
-- classrooms(id) (classroom_memberships, classroom_assignments,
-- assignment_submissions, assignment_references, classroom_official_forecasts,
-- classroom_code_redemptions, workspace_join_codes), except forecast_runs.classroom_id,
-- which is `on delete set null` -- a student's forecast history is detached
-- from the deleted classroom, not deleted with it, matching how a personal
-- forecast already has no classroom_id.

create or replace function frontline_private.can_delete_classroom(target_classroom uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.classrooms c
    where c.id = target_classroom
      and c.status = 'archived'
      and (
        frontline_private.is_owner()
        or frontline_private.is_admin()
        or exists (
          select 1 from public.organization_memberships
          where organization_id = c.organization_id
            and user_id = auth.uid()
            and status = 'active'
            and role in ('owner', 'admin')
        )
      )
  );
$$;

grant execute on function frontline_private.can_delete_classroom(uuid) to authenticated;

drop policy if exists "Organization managers manage classrooms" on public.classrooms;

create policy "Organization managers read classrooms" on public.classrooms
  for select using (frontline_private.can_manage_organization(organization_id));

create policy "Organization managers create classrooms" on public.classrooms
  for insert with check (frontline_private.can_manage_organization(organization_id));

create policy "Organization managers update classrooms" on public.classrooms
  for update using (frontline_private.can_manage_organization(organization_id))
  with check (frontline_private.can_manage_organization(organization_id));

create policy "Organization managers delete archived classrooms" on public.classrooms
  for delete using (frontline_private.can_delete_classroom(id));

-- classroom_code_redemptions only ever had a SELECT policy (its rows are written by a
-- security-definer redeem-code RPC, never by the client directly) -- but ON DELETE CASCADE from
-- classrooms(id) still has to pass RLS on this table when a classroom is deleted, and with no
-- policy permitting that, the cascade was rejected outright. Confirmed live: deleting an archived
-- test classroom failed with no other error until this was added.
create policy "Organization managers delete classroom code redemptions" on public.classroom_code_redemptions
  for delete using (
    exists (
      select 1 from public.classrooms c
      where c.id = classroom_code_redemptions.classroom_id
        and frontline_private.can_manage_organization(c.organization_id)
    )
  );

-- classroom_official_forecasts has the identical gap -- select/insert/update only, no delete
-- policy -- and it's cascade-deleted (classroom_id is its own primary key).
create policy "Organization managers delete official forecasts" on public.classroom_official_forecasts
  for delete using (
    exists (
      select 1 from public.classrooms c
      where c.id = classroom_official_forecasts.classroom_id
        and frontline_private.can_manage_organization(c.organization_id)
    )
  );

-- forecast_runs has TWO separate ON DELETE SET NULL paths off a classroom delete: its own
-- classroom_id FK, and its assignment_id FK (fired transitively once classroom_assignments rows
-- cascade-delete). Each fires as its own implicit UPDATE, still subject to RLS -- and an
-- RLS UPDATE policy scoped by "classroom_id points at a classroom I manage" breaks on ordering:
-- once the first UPDATE nulls classroom_id, that same policy can no longer see the row for the
-- second (assignment_id) UPDATE, so it fails with a dangling foreign key instead of a clean
-- detach. Confirmed live. A security-definer trigger sidesteps RLS ordering entirely by nulling
-- both fields explicitly, atomically, before the classroom row (and its cascades) are even
-- deleted -- the FK's own SET NULL actions then find nothing left to do.
-- Both fields must be nulled in the SAME update, not two separate ones: forecast_runs has its
-- own validate_forecast_assignment() trigger requiring assignment_id's classroom to match
-- classroom_id whenever assignment_id is set, and nulling classroom_id first (while assignment_id
-- is still set) trips that check with a real constraint violation. Confirmed live.
create or replace function frontline_private.detach_classroom_forecast_runs()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  update public.forecast_runs
  set classroom_id = null, assignment_id = null
  where classroom_id = old.id
     or assignment_id in (select id from public.classroom_assignments where classroom_id = old.id);
  return old;
end;
$$;

create trigger classrooms_detach_forecast_runs
  before delete on public.classrooms
  for each row execute function frontline_private.detach_classroom_forecast_runs();
