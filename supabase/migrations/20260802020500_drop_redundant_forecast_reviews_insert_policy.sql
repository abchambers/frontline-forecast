-- "Authorized reviewers write written reviews" (with_check: reviewer_id = auth.uid() and
-- can_review_forecast_run(run_id)) is a strict subset of "Authors or authorized reviewers write
-- reviews" (with_check: reviewer_id = auth.uid() and (can_review_forecast_run(run_id) or is the
-- run's author)) — every insert the first policy permits, the second also permits. Permissive
-- policies are OR'd, so the first is dead weight; dropping it removes duplicate evaluation and a
-- confusing pair of near-identically-named policies with no behavior change.
drop policy if exists "Authorized reviewers write written reviews" on public.forecast_reviews;
