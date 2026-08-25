-- Extends the notification system (20260823030000_assignment_content_and_notifications.sql)
-- with a second event: notify a student the moment their OWN forecast finishes automatic
-- scoring, whether that forecast lives on their personal desk or was submitted as part of a
-- classroom assignment. This is always about the individual's own day/night score, never the
-- class-wide aggregate grade.
--
-- Automatic scoring is currently triggered by the user themselves clicking "Collect actuals" in
-- Verify (src/app/page.tsx collectActuals()), which upserts forecast_verifications directly. A
-- database trigger (rather than client-side notification logic) is used here so this keeps
-- working unchanged if scoring is later automated server-side (e.g. a scheduled job) instead of
-- being purely user-initiated -- the notification fires from the data change itself, not from
-- who/what caused it.
--
-- Fires once per forecast date, not once per period: a single "Collect actuals" click writes two
-- rows (day, night) as two separate statements, and firing on each would create two notifications
-- for one user action. This waits until BOTH periods for that date have a score, then inserts one
-- notification carrying both. A dedupe check (by run_id + target_date) keeps a later re-collect
-- (e.g. after a forecast revision) from spamming a duplicate.

create or replace function frontline_private.notify_forecast_period_scored()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_run_id uuid;
  target_date date;
  run_user_id uuid;
  run_classroom_id uuid;
  day_score numeric;
  night_score numeric;
begin
  if (new.score_data->>'automaticScore') is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.score_data->>'automaticScore' is not distinct from new.score_data->>'automaticScore' then
    return new;
  end if;

  select fp.run_id, fp.valid_date, fr.user_id, fr.classroom_id
    into target_run_id, target_date, run_user_id, run_classroom_id
  from public.forecast_periods fp
  join public.forecast_runs fr on fr.id = fp.run_id
  where fp.id = new.forecast_period_id;

  if run_user_id is null then
    return new;
  end if;

  select
    max(case when fp.period = 'day' then (fv.score_data->>'automaticScore')::numeric end),
    max(case when fp.period = 'night' then (fv.score_data->>'automaticScore')::numeric end)
    into day_score, night_score
  from public.forecast_periods fp
  join public.forecast_verifications fv on fv.forecast_period_id = fp.id
  where fp.run_id = target_run_id and fp.valid_date = target_date;

  if day_score is null or night_score is null then
    return new;
  end if;

  if exists (
    select 1 from public.notifications
    where user_id = run_user_id and kind = 'forecast_scored'
      and (payload->>'run_id') = target_run_id::text
      and (payload->>'target_date') = target_date::text
  ) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, payload)
  values (run_user_id, 'forecast_scored', jsonb_build_object(
    'run_id', target_run_id,
    'classroom_id', run_classroom_id,
    'target_date', target_date,
    'day_score', day_score,
    'night_score', night_score
  ));

  return new;
end;
$$;

drop trigger if exists forecast_verifications_notify_scored on public.forecast_verifications;
create trigger forecast_verifications_notify_scored
  after insert or update of score_data on public.forecast_verifications
  for each row execute procedure frontline_private.notify_forecast_period_scored();

-- Second half of "grading notifications": tell a student the moment an instructor leaves
-- feedback on their assignment submission. INSERT only (not UPDATE) -- the first time feedback
-- lands is the notification-worthy moment; a later edit to the same comment/score isn't.
create or replace function frontline_private.notify_student_of_assignment_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_user_id uuid;
  target_classroom_id uuid;
  target_assignment_id uuid;
begin
  select s.user_id, s.classroom_id, s.assignment_id
    into target_user_id, target_classroom_id, target_assignment_id
  from public.assignment_submissions s
  where s.id = new.submission_id;

  if target_user_id is null then
    return new;
  end if;

  insert into public.notifications (user_id, kind, payload)
  values (target_user_id, 'assignment_reviewed', jsonb_build_object(
    'assignment_id', target_assignment_id,
    'classroom_id', target_classroom_id,
    'submission_id', new.submission_id,
    'manual_score', new.manual_score
  ));

  return new;
end;
$$;

drop trigger if exists assignment_reviews_notify_student on public.assignment_reviews;
create trigger assignment_reviews_notify_student
  after insert on public.assignment_reviews
  for each row execute procedure frontline_private.notify_student_of_assignment_review();
