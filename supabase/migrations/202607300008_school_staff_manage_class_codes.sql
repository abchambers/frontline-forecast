-- Let designated school staff see and retire their classroom codes without
-- exposing any raw code values. Only code hashes and short hints are stored.

drop policy if exists "Owners manage join codes" on public.workspace_join_codes;
grant select, update on public.workspace_join_codes to authenticated;

create policy "School staff manage classroom codes" on public.workspace_join_codes
  for all to authenticated
  using (
    (organization_id is not null and frontline_private.can_manage_organization(organization_id))
    or exists (
      select 1 from public.classrooms classroom
      where classroom.id = workspace_join_codes.classroom_id
        and frontline_private.can_manage_organization(classroom.organization_id)
    )
  )
  with check (
    (organization_id is not null and frontline_private.can_manage_organization(organization_id))
    or exists (
      select 1 from public.classrooms classroom
      where classroom.id = workspace_join_codes.classroom_id
        and frontline_private.can_manage_organization(classroom.organization_id)
    )
  );
