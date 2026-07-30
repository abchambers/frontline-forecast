-- The redemption function returns organization_id, which is also a PL/pgSQL
-- variable. Qualify the entitlement lookup to keep the transaction unambiguous.
create or replace function public.redeem_classroom_join_code(raw_code text)
returns table (organization_id uuid, organization_name text, classroom_id uuid, classroom_name text)
language plpgsql
security definer
set search_path = public, frontline_private, extensions, pg_temp
as $$
declare
  join_code public.workspace_join_codes%rowtype;
  classroom public.classrooms%rowtype;
  entitlement public.organization_entitlements%rowtype;
  normalized_hash text;
  redemption_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before joining a class.'; end if;
  normalized_hash := encode(extensions.digest(upper(trim(raw_code)), 'sha256'), 'hex');
  select * into join_code from public.workspace_join_codes
  where workspace_join_codes.code_hash = normalized_hash and workspace_join_codes.classroom_id is not null for update;
  if not found or not join_code.active then raise exception 'This class code is not active.'; end if;
  if join_code.expires_at is not null and join_code.expires_at <= now() then raise exception 'This class code has expired.'; end if;
  select * into classroom from public.classrooms where id = join_code.classroom_id for update;
  if not found or classroom.status <> 'active' then raise exception 'This class is no longer accepting enrollment.'; end if;
  select * into entitlement from public.organization_entitlements
  where organization_entitlements.organization_id = classroom.organization_id for update;
  if not found or entitlement.status not in ('trial', 'active') or (entitlement.ends_at is not null and entitlement.ends_at <= now()) then raise exception 'This school license is not active.'; end if;
  select id into redemption_id from public.classroom_code_redemptions where code_id = join_code.id and user_id = auth.uid();
  if redemption_id is null and join_code.max_uses is not null and join_code.use_count >= join_code.max_uses then raise exception 'This class code has reached its use limit.'; end if;
  insert into public.organization_memberships (organization_id, user_id, role, status) values (classroom.organization_id, auth.uid(), 'student', 'active') on conflict (organization_id, user_id) do update set status = 'active';
  insert into public.classroom_memberships (classroom_id, user_id, role, status) values (classroom.id, auth.uid(), 'student', 'active') on conflict (classroom_id, user_id) do update set status = 'active';
  if redemption_id is null then
    insert into public.classroom_code_redemptions (code_id, classroom_id, user_id) values (join_code.id, classroom.id, auth.uid());
    update public.workspace_join_codes set use_count = use_count + 1 where id = join_code.id;
  end if;
  return query select organization.id, organization.name, classroom.id, classroom.name from public.organizations organization where organization.id = classroom.organization_id;
end;
$$;
