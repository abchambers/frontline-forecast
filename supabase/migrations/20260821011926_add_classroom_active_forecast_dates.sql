alter table public.classrooms
  add column if not exists active_forecast_dates text[] not null default '{}';

comment on column public.classrooms.active_forecast_dates is
  'Dates the instructor has designated as counting toward the live class forecast aggregate. Student forecasts submitted for other dates still belong to the classroom but are not aggregated.';
