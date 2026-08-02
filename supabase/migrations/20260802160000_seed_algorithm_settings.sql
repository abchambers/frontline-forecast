-- Internal-only site_content row backing the HQ "Algorithms" page: the tunable parameters behind
-- the automatic forecast verification score. Never public — students/instructors see the
-- documentation and the resulting score, not a knob to change their own grade.
insert into public.site_content (key, section, label, description, value, is_public)
values (
  'hq.algorithms',
  'Algorithms',
  'Automatic verification scoring',
  'Weights and thresholds behind the automatic forecast accuracy score. Read by the verification cron job at run time.',
  '{"temperatureWeight":70,"temperaturePenaltyPerDegree":10,"precipitationWeight":30,"precipitationThresholdPercent":50}'::jsonb,
  false
)
on conflict (key) do nothing;
