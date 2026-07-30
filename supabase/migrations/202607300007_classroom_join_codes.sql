-- Controlled classroom enrollment. School staff can issue class codes, but
-- the database remains the source of truth for license, class, and seat limits.

alter table public.workspace_join_codes
  add column if not exists code_hint text,
  add column if not exists active boolean not null default true;

update public.workspace_join_codes
set code_hint = coalesce(code_hint, 'legacy')
where code_hint is null;

alter table public.workspace_join_codes
  alter column code_hint set not null;

create table if not exists public.classroom_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.workspace_join_codes(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);

create index if not exists classroom_code_redemptions_user_idx
  on public.classroom_code_redemptions (user_id, redeemed_at desc);

alter table public.classroom_code_redemptions enable row level security;
grant select on public.classroom_code_redemptions to authenticated;

create policy "People read their classroom code redemptions" on public.classroom_code_redemptions
  for select to authenticated
  using (user_id = (select auth.uid()) or exists (
    select 1
    from public.classrooms classroom
    where classroom.id = classroom_id
      and frontline_private.can_manage_organization(classroom.organization_id)
  ));

-- Returned only once to the authorized school manager. The database stores a
-- digest and a short hint, never the code itself.
create or replace function public.create_classroom_join_code(
  target_classroom uuid,
  code_label text default null,
  code_expires_at timestamptz default null,
  code_max_uses integer default null
)
returns table (raw_code text, code_hint text, expires_at timestamptz, max_uses integer)
language plpgsql
security definer
set search_path = public, frontline_private, extensions, pg_temp
as $$
declare
  classroom public.classrooms%rowtype;
  generated_code text;
  generated_hint text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before creating a class code.';
  end if;
  if code_label is not null and char_length(trim(code_label)) > 120 then
    raise exception 'Class code label is too long.';
  end if;
  if code_expires_at is not null and code_expires_at <= now() then
    raise exception 'Class code expiration must be in the future.';
  end if;
  if code_max_uses is not null and (code_max_uses < 1 or code_max_uses > 100000) then
    raise exception 'Class code use limit is invalid.';
  end if;

  select * into classroom from public.classrooms where id = target_classroom for update;
  if not found or classroom.status <> 'active' then
    raise exception 'This class is not available for enrollment.';
  end if;
  if not frontline_private.can_manage_organization(classroom.organization_id) then
    raise exception 'Only school teaching staff can create class codes.';
  end if;

  generated_code := 'FF-' || upper(encode(extensions.gen_random_bytes(6), 'hex'));
  generated_hint := right(replace(generated_code, 'FF-', ''), 4);
  insert into public.workspace_join_codes (
    classroom_id, code_hash, code_hint, label, default_role, expires_at,
    max_uses, active, created_by
  ) values (
    classroom.id,
    encode(extensions.digest(generated_code, 'sha256'), 'hex'),
    generated_hint,
    nullif(trim(code_label), ''),
    'student',
    code_expires_at,
    code_max_uses,
    true,
    auth.uid()
  );
  return query select generated_code, generated_hint, code_expires_at, code_max_uses;
end;
$$;

-- A code enrolls an authenticated student in both the school and its one
-- classroom. Existing staff records are never downgraded by a student code.
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
  if auth.uid() is null then
    raise exception 'Sign in before joining a class.';
  end if;
  normalized_hash := encode(extensions.digest(upper(trim(raw_code)), 'sha256'), 'hex');
  select * into join_code
  from public.workspace_join_codes
  where code_hash = normalized_hash and classroom_id is not null
  for update;
  if not found or not join_code.active then
    raise exception 'This class code is not active.';
  end if;
  if join_code.expires_at is not null and join_code.expires_at <= now() then
    raise exception 'This class code has expired.';
  end if;

  select * into classroom from public.classrooms where id = join_code.classroom_id for update;
  if not found or classroom.status <> 'active' then
    raise exception 'This class is no longer accepting enrollment.';
  end if;
  select * into entitlement from public.organization_entitlements
  where organization_id = classroom.organization_id
  for update;
  if not found or entitlement.status not in ('trial', 'active')
    or (entitlement.ends_at is not null and entitlement.ends_at <= now()) then
    raise exception 'This school license is not active.';
  end if;

  select id into redemption_id
  from public.classroom_code_redemptions
  where code_id = join_code.id and user_id = auth.uid();
  if redemption_id is null and join_code.max_uses is not null and join_code.use_count >= join_code.max_uses then
    raise exception 'This class code has reached its use limit.';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role, status)
  values (classroom.organization_id, auth.uid(), 'student', 'active')
  on conflict (organization_id, user_id) do update set status = 'active';

  insert into public.classroom_memberships (classroom_id, user_id, role, status)
  values (classroom.id, auth.uid(), 'student', 'active')
  on conflict (classroom_id, user_id) do update set status = 'active';

  if redemption_id is null then
    insert into public.classroom_code_redemptions (code_id, classroom_id, user_id)
    values (join_code.id, classroom.id, auth.uid());
    update public.workspace_join_codes set use_count = use_count + 1 where id = join_code.id;
  end if;

  return query
  select organization.id, organization.name, classroom.id, classroom.name
  from public.organizations organization
  where organization.id = classroom.organization_id;
end;
$$;

revoke all on function public.create_classroom_join_code(uuid, text, timestamptz, integer) from public, anon, service_role;
revoke all on function public.redeem_classroom_join_code(text) from public, anon, service_role;
grant execute on function public.create_classroom_join_code(uuid, text, timestamptz, integer) to authenticated;
grant execute on function public.redeem_classroom_join_code(text) to authenticated;
