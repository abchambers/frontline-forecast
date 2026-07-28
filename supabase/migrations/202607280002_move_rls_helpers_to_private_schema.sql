-- RLS policy helpers must be executable while a policy is evaluated, but they
-- do not belong on the public RPC surface. Moving the existing functions keeps
-- policy dependencies intact and removes them from the exposed schema.

create schema if not exists frontline_private;
revoke all on schema frontline_private from public;

alter function public.is_owner() set schema frontline_private;
alter function public.is_admin() set schema frontline_private;
alter function public.can_view_organization(uuid) set schema frontline_private;
alter function public.can_manage_organization(uuid) set schema frontline_private;
alter function public.can_view_classroom(uuid) set schema frontline_private;
alter function public.can_manage_classroom_assignment(uuid) set schema frontline_private;
alter function public.can_review_forecast_run(uuid) set schema frontline_private;
alter function public.can_view_workspace_profile(uuid) set schema frontline_private;

create or replace function frontline_private.is_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner'); $$;

create or replace function frontline_private.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.profiles where id = auth.uid() and role in ('owner', 'admin')); $$;

create or replace function frontline_private.can_manage_classroom_assignment(target_classroom uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select frontline_private.is_admin() or exists (select 1 from public.classroom_memberships membership where membership.classroom_id = target_classroom and membership.user_id = auth.uid() and membership.status = 'active' and membership.role in ('instructor', 'assistant')); $$;

create or replace function frontline_private.can_manage_organization(target_organization uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select frontline_private.is_owner() or frontline_private.is_admin() or exists (select 1 from public.organization_memberships where organization_id = target_organization and user_id = auth.uid() and status = 'active' and role in ('owner', 'admin', 'instructor')); $$;

create or replace function frontline_private.can_review_forecast_run(target_run uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select frontline_private.is_admin() or exists (select 1 from public.forecast_runs run where run.id = target_run and ((run.classroom_id is not null and exists (select 1 from public.classroom_memberships membership where membership.classroom_id = run.classroom_id and membership.user_id = auth.uid() and membership.status = 'active' and membership.role in ('instructor', 'assistant'))) or (run.classroom_id is null and run.organization_id is not null and exists (select 1 from public.organization_memberships membership where membership.organization_id = run.organization_id and membership.user_id = auth.uid() and membership.status = 'active' and membership.role in ('owner', 'admin', 'instructor', 'reviewer'))))); $$;

create or replace function frontline_private.can_view_classroom(target_classroom uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select frontline_private.is_owner() or exists (select 1 from public.classroom_memberships where classroom_id = target_classroom and user_id = auth.uid() and status = 'active') or exists (select 1 from public.classrooms c where c.id = target_classroom and frontline_private.can_manage_organization(c.organization_id)); $$;

create or replace function frontline_private.can_view_organization(target_organization uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select frontline_private.is_admin() or exists (select 1 from public.organization_memberships where organization_id = target_organization and user_id = auth.uid() and status = 'active') or exists (select 1 from public.classroom_memberships cm join public.classrooms c on c.id = cm.classroom_id where c.organization_id = target_organization and cm.user_id = auth.uid() and cm.status = 'active'); $$;

create or replace function frontline_private.can_view_workspace_profile(target_profile uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select target_profile = auth.uid() or frontline_private.is_admin() or exists (select 1 from public.classroom_memberships reviewer join public.classroom_memberships target on target.classroom_id = reviewer.classroom_id and target.user_id = target_profile and target.status = 'active' where reviewer.user_id = auth.uid() and reviewer.status = 'active' and reviewer.role in ('instructor', 'assistant')) or exists (select 1 from public.organization_memberships reviewer join public.organization_memberships target on target.organization_id = reviewer.organization_id and target.user_id = target_profile and target.status = 'active' where reviewer.user_id = auth.uid() and reviewer.status = 'active' and reviewer.role in ('owner', 'admin', 'instructor', 'reviewer')); $$;

revoke all on all functions in schema frontline_private from public;
grant usage on schema frontline_private to authenticated;
grant execute on all functions in schema frontline_private to authenticated;
