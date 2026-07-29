-- Keep the daily observation archive private while allowing the HQ owner to
-- inspect it through authenticated, RLS-protected access.
create policy "Owners read daily observations"
  on public.weather_daily_observations
  for select to authenticated
  using ((select frontline_private.is_owner()));

-- These relationships are used when issuing and reviewing classroom join
-- codes. Covering indexes remove repeated table scans as school use grows.
create index if not exists workspace_join_codes_classroom_id_idx
  on public.workspace_join_codes (classroom_id);

create index if not exists workspace_join_codes_created_by_idx
  on public.workspace_join_codes (created_by);

create index if not exists workspace_join_codes_organization_id_idx
  on public.workspace_join_codes (organization_id);
