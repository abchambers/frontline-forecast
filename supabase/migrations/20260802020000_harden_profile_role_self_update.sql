-- Role-escalation on profiles is currently blocked only by the protect_profile_identity()
-- trigger, not by the "Users update their profile details" RLS policy's with_check itself. The
-- trigger is solid (raises on any role change by a non-admin), but this adds a matching guard at
-- the RLS layer so the two mechanisms don't silently diverge if one is ever changed without the
-- other. The subquery reads the pre-update row (self-referencing subqueries in an UPDATE's WITH
-- CHECK see the statement-start snapshot, not the row's own in-flight new value), so this rejects
-- any self-update that changes role without touching the trigger's behavior for admins, who are
-- still covered separately by the "Admins manage profiles" policy.
drop policy if exists "Users update their profile details" on public.profiles;
create policy "Users update their profile details" on public.profiles
  for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );
