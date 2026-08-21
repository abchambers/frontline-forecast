-- Reverts 20260821011926_add_classroom_active_forecast_dates.sql: the class
-- forecast is now always the rolling current-day-through-day+6 window, with
-- no instructor date selection, so this column is no longer used.
alter table public.classrooms drop column if exists active_forecast_dates;
