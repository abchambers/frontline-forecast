-- Academic workspace privacy: instructors/reviewers can identify only the
-- people in workspaces where they have active access. This is required to
-- present a human-readable class review queue without exposing platform-wide
-- account information.

create or replace function public.can_view_workspace_profile(target_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select target_profile = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.classroom_memberships reviewer
      join public.classroom_memberships target
        on target.classroom_id = reviewer.classroom_id
       and target.user_id = target_profile
       and target.status = 'active'
      where reviewer.user_id = auth.uid()
        and reviewer.status = 'active'
        and reviewer.role in ('instructor', 'assistant')
    )
    or exists (
      select 1
      from public.organization_memberships reviewer
      join public.organization_memberships target
        on target.organization_id = reviewer.organization_id
       and target.user_id = target_profile
       and target.status = 'active'
      where reviewer.user_id = auth.uid()
        and reviewer.status = 'active'
        and reviewer.role in ('owner', 'admin', 'instructor', 'reviewer')
    );
$$;

create policy "Workspace reviewers read member profiles" on public.profiles
  for select using (public.can_view_workspace_profile(id));

-- The original first-pass review insert policy was intentionally permissive
-- while the UI was owner-only. Replace it with an author-or-authorized-reviewer
-- rule before the instructor surface is exposed.
drop policy if exists "Users write their reviews" on public.forecast_reviews;

create policy "Authors or authorized reviewers write reviews" on public.forecast_reviews
  for insert with check (
    reviewer_id = auth.uid()
    and (
      public.can_review_forecast_run(run_id)
      or exists (
        select 1 from public.forecast_runs run
        where run.id = run_id and run.user_id = auth.uid()
      )
    )
  );
