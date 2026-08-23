-- Surfaces last-sign-in and last-forecast-activity per account so HQ can flag
-- inactive personal accounts for manual review -- never an automated purge.
-- auth.users isn't exposed to PostgREST directly, so this is a narrow,
-- admin-gated read of exactly the two timestamps HQ needs, nothing else from
-- auth.users leaks through.
create or replace function public.hq_personal_account_activity()
returns table(profile_id uuid, last_sign_in_at timestamptz, last_forecast_at timestamptz)
language sql
security definer
set search_path = public, auth
as $$
  select
    p.id,
    u.last_sign_in_at,
    (select max(fr.created_at) from public.forecast_runs fr where fr.user_id = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where (select frontline_private.is_admin());
$$;

revoke all on function public.hq_personal_account_activity() from public, anon;
grant execute on function public.hq_personal_account_activity() to authenticated;
