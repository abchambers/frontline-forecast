-- Cover foreign keys used by the private HQ lifecycle views and owner actions.

create index if not exists hq_user_access_requests_target_profile_idx
  on public.hq_user_access_requests (target_profile_id)
  where target_profile_id is not null;

create index if not exists hq_user_access_requests_resolved_by_idx
  on public.hq_user_access_requests (resolved_by)
  where resolved_by is not null;

create index if not exists hq_user_access_requests_invite_sent_by_idx
  on public.hq_user_access_requests (invite_sent_by)
  where invite_sent_by is not null;

create index if not exists hq_expenses_archived_by_idx
  on public.hq_expenses (archived_by)
  where archived_by is not null;

create index if not exists hq_tasks_archived_by_idx
  on public.hq_tasks (archived_by)
  where archived_by is not null;

create index if not exists hq_calendar_events_archived_by_idx
  on public.hq_calendar_events (archived_by)
  where archived_by is not null;

create index if not exists site_content_drafts_updated_by_idx
  on public.site_content_drafts (updated_by);
