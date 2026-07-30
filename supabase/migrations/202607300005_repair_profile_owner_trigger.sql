-- The legacy owner-protection trigger referred to a helper that was moved
-- out of the exposed public schema. Keep the guard and point it at the
-- private authorization helper so owner-authorized role assignments work.
create or replace function public.protect_owner_role()
returns trigger
language plpgsql
security definer
set search_path = public, frontline_private
as $$
begin
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role is distinct from 'owner' then
    raise exception 'The owner role cannot be removed through the application.';
  end if;

  if new.role = 'owner'
    and coalesce(old.role, '') <> 'owner'
    and auth.uid() is not null
    and not frontline_private.is_owner() then
    raise exception 'Only the existing owner can assign the owner role.';
  end if;

  return new;
end;
$$;
