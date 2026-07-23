-- Supabase grants EXECUTE to anon, authenticated, and service_role for new
-- public functions by default. The redemption RPC must be callable only by a
-- signed-in person; do not rely solely on its internal auth.uid() check.

alter function public.redeem_organization_license(text)
  set search_path = public, extensions, pg_temp;

revoke all on function public.redeem_organization_license(text) from public;
revoke all on function public.redeem_organization_license(text) from anon, service_role;
grant execute on function public.redeem_organization_license(text) to authenticated;
