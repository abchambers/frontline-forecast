-- Focused indexes for the active HQ, licensing, and forecast workflows.
-- These cover foreign-key joins called by the owner dashboard and production
-- control paths without altering access policies or public behavior.

create index if not exists site_content_updated_by_idx on public.site_content (updated_by);
create index if not exists classroom_assignments_created_by_idx on public.classroom_assignments (created_by);
create index if not exists classroom_official_forecasts_updated_by_idx on public.classroom_official_forecasts (updated_by);
create index if not exists classrooms_created_by_idx on public.classrooms (created_by);
create index if not exists forecast_reviews_reviewer_id_idx on public.forecast_reviews (reviewer_id);
create index if not exists forecast_runs_parent_run_id_idx on public.forecast_runs (parent_run_id);
create index if not exists forecast_runs_published_by_idx on public.forecast_runs (published_by);
create index if not exists forecasts_parent_forecast_id_idx on public.forecasts (parent_forecast_id);
create index if not exists organization_license_codes_created_by_idx on public.organization_license_codes (created_by);
create index if not exists organization_license_codes_entitlement_id_idx on public.organization_license_codes (entitlement_id);
create index if not exists organization_license_redemptions_organization_id_idx on public.organization_license_redemptions (organization_id);
create index if not exists organizations_created_by_idx on public.organizations (created_by);
