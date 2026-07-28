-- Frontline Forecast operating workflow hardening.
--
-- This is the canonical migration source for the shared Frontline Forecast
-- Supabase project. Company HQ does not maintain a separate schema history.

-- Preserve operating records instead of deleting them from the owner console.
alter table public.hq_expenses
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.hq_tasks
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

alter table public.hq_calendar_events
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists hq_expenses_active_created_idx
  on public.hq_expenses (user_id, created_at desc)
  where archived_at is null;

create index if not exists hq_tasks_active_due_idx
  on public.hq_tasks (user_id, status, due_at)
  where archived_at is null;

create index if not exists hq_calendar_events_active_date_idx
  on public.hq_calendar_events (user_id, event_date)
  where archived_at is null;

-- A decision is retained with every access request. Role changes are applied
-- by the HQ server action only after the owner approves the request.
alter table public.hq_user_access_requests
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists resolution_note text;

create index if not exists hq_user_access_requests_open_idx
  on public.hq_user_access_requests (user_id, created_at desc)
  where status = 'Pending';

-- These helpers are evaluated inside RLS policies. They are not application
-- RPC endpoints, so authenticated clients do not need EXECUTE privileges.
revoke all on function public.is_owner() from authenticated;
revoke all on function public.is_admin() from authenticated;
revoke all on function public.can_view_organization(uuid) from authenticated;
revoke all on function public.can_manage_organization(uuid) from authenticated;
revoke all on function public.can_view_classroom(uuid) from authenticated;
revoke all on function public.can_manage_classroom_assignment(uuid) from authenticated;
revoke all on function public.can_review_forecast_run(uuid) from authenticated;
revoke all on function public.can_view_workspace_profile(uuid) from authenticated;
