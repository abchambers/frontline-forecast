-- Hardening pass on 20260823030000: the security advisor flagged two real
-- gaps introduced by that migration.
--
-- 1. touch_assignment_submission_updated_at / touch_assignment_review_updated_at
--    were missing `set search_path`, unlike every other trigger function in
--    this codebase (e.g. touch_scenario_updated_at).
-- 2. notify_students_of_open_assignment is SECURITY DEFINER but had no
--    explicit EXECUTE revocation, so it was directly callable via
--    /rest/v1/rpc/notify_students_of_open_assignment by anon and
--    authenticated -- it's a trigger-only function and must never be
--    invoked directly by a client. Matches the explicit revoke/grant
--    pattern already used for frontline_private.organization_entitlement_active.

create or replace function public.touch_assignment_submission_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_assignment_review_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.notify_students_of_open_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    insert into public.notifications (user_id, kind, payload)
    select membership.user_id, 'assignment_created',
      jsonb_build_object('assignment_id', new.id, 'classroom_id', new.classroom_id, 'title', new.title)
    from public.classroom_memberships membership
    where membership.classroom_id = new.classroom_id
      and membership.status = 'active'
      and membership.role = 'student';
  end if;
  return new;
end;
$$;

revoke all on function public.notify_students_of_open_assignment() from public, anon, authenticated;
