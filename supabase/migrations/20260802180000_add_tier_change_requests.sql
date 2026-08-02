-- Product-side tier-change requests. Distinct from any HQ/company role-change
-- process: this is a personal-tier (free -> paid) request a product user files
-- and a product admin approves, with no billing integration yet — approval
-- flips personal_tier directly via a SECURITY DEFINER RPC so the two can't
-- drift out of sync.
create table if not exists public.tier_change_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_tier text not null check (requested_tier in ('paid')),
  note text check (note is null or char_length(note) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

create index if not exists tier_change_requests_user_idx on public.tier_change_requests (user_id, status);

alter table public.tier_change_requests enable row level security;

create policy "Users file their own tier requests" on public.tier_change_requests
  for insert
  with check (user_id = auth.uid());

create policy "Users see their own tier requests" on public.tier_change_requests
  for select
  using (user_id = auth.uid());

create policy "Admins manage tier requests" on public.tier_change_requests
  for all
  using ((select frontline_private.is_admin()))
  with check ((select frontline_private.is_admin()));

create or replace function public.resolve_tier_change_request(request_id uuid, approve boolean)
returns void
language plpgsql
security definer
set search_path = public, frontline_private
as $$
declare
  target_user uuid;
begin
  if not frontline_private.is_admin() then
    raise exception 'Only an owner or administrator can resolve tier requests.';
  end if;

  select user_id into target_user from public.tier_change_requests where id = request_id and status = 'pending';
  if target_user is null then
    raise exception 'That request is no longer pending.';
  end if;

  update public.tier_change_requests
    set status = case when approve then 'approved' else 'denied' end,
        resolved_at = now(),
        resolved_by = auth.uid()
    where id = request_id;

  if approve then
    update public.profiles set personal_tier = 'paid' where id = target_user;
  end if;
end;
$$;

revoke all on function public.resolve_tier_change_request(uuid, boolean) from public, anon, service_role;
grant execute on function public.resolve_tier_change_request(uuid, boolean) to authenticated;
