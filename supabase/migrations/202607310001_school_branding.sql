-- A school controls its own private workspace identity. The mark is public
-- artwork (not account data), while the branding record remains visible only
-- to people who can view that school workspace.
create table if not exists public.organization_branding (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  school_name text,
  logo_path text,
  logo_alt text,
  logo_authorized_at timestamptz,
  logo_authorized_by uuid references auth.users(id) on delete set null,
  department_name text,
  department_logo_path text,
  department_logo_alt text,
  updated_at timestamptz not null default now(),
  constraint organization_branding_school_name_length check (school_name is null or char_length(school_name) <= 160),
  constraint organization_branding_logo_path_length check (logo_path is null or char_length(logo_path) <= 500),
  constraint organization_branding_logo_alt_length check (logo_alt is null or char_length(logo_alt) <= 200)
);

create or replace function public.touch_organization_branding()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_organization_branding on public.organization_branding;
create trigger touch_organization_branding
before update on public.organization_branding
for each row execute function public.touch_organization_branding();

alter table public.organization_branding enable row level security;
grant select, insert, update, delete on public.organization_branding to authenticated;

create policy "School members read their workspace branding" on public.organization_branding
  for select to authenticated
  using ((select frontline_private.can_view_organization(organization_id)));

create policy "Owners manage school workspace branding" on public.organization_branding
  for all to authenticated
  using ((select frontline_private.is_owner()))
  with check (
    (select frontline_private.is_owner())
    and exists (select 1 from public.organizations where id = organization_id and kind = 'school')
  );

insert into storage.buckets (id, name, public)
values ('organization-branding', 'organization-branding', true)
on conflict (id) do update set public = excluded.public;

create policy "Owners upload school branding assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'organization-branding' and (select frontline_private.is_owner()));

create policy "Owners update school branding assets" on storage.objects
  for update to authenticated
  using (bucket_id = 'organization-branding' and (select frontline_private.is_owner()))
  with check (bucket_id = 'organization-branding' and (select frontline_private.is_owner()));

create policy "Owners remove school branding assets" on storage.objects
  for delete to authenticated
  using (bucket_id = 'organization-branding' and (select frontline_private.is_owner()));
