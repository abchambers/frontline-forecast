-- Authorized forecast review is intentionally separate from publication.
-- A reviewer can only see forecast records belonging to an organization or
-- classroom where they have an active instructional/review role.

create or replace function public.can_review_forecast_run(target_run uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1
    from public.forecast_runs run
    where run.id = target_run
      and (
        (
          run.classroom_id is not null
          and exists (
            select 1
            from public.classroom_memberships membership
            where membership.classroom_id = run.classroom_id
              and membership.user_id = auth.uid()
              and membership.status = 'active'
              and membership.role in ('instructor', 'assistant')
          )
        )
        or (
          run.classroom_id is null
          and run.organization_id is not null
          and exists (
            select 1
            from public.organization_memberships membership
            where membership.organization_id = run.organization_id
              and membership.user_id = auth.uid()
              and membership.status = 'active'
              and membership.role in ('owner', 'admin', 'instructor', 'reviewer')
          )
        )
      )
  );
$$;

create policy "Authorized reviewers read forecast runs" on public.forecast_runs
  for select using (public.can_review_forecast_run(id));

create policy "Authorized reviewers read forecast periods" on public.forecast_periods
  for select using (public.can_review_forecast_run(run_id));

create policy "Authorized reviewers read forecast verification" on public.forecast_verifications
  for select using (
    exists (
      select 1 from public.forecast_periods period
      where period.id = forecast_period_id
        and public.can_review_forecast_run(period.run_id)
    )
  );

create policy "Authorized reviewers read written reviews" on public.forecast_reviews
  for select using (public.can_review_forecast_run(run_id));

create policy "Authorized reviewers write written reviews" on public.forecast_reviews
  for insert with check (
    reviewer_id = auth.uid()
    and public.can_review_forecast_run(run_id)
  );
