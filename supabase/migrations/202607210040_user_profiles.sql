-- Rich but minimal internal profiles. Email remains the authenticated sign-in
-- identity; these fields support people management without publishing PII.

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists person_type text check (person_type in ('employee', 'student', 'instructor', 'other')),
  add column if not exists employee_id text,
  add column if not exists student_id text,
  add column if not exists title text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.protect_profile_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    raise exception 'Email is managed by the authentication account.';
  end if;
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'Only an owner or administrator can change platform roles.';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_protect_identity on public.profiles;
create trigger profiles_protect_identity
  before update on public.profiles
  for each row execute procedure public.protect_profile_identity();

grant update on public.profiles to authenticated;

create policy "Users update their profile details" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
