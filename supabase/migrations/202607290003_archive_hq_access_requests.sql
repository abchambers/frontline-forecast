-- Keep resolved access decisions in the audit record without leaving them in the active queue.
alter table public.hq_user_access_requests
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references auth.users(id) on delete set null;

create index if not exists hq_user_access_requests_active_queue_idx
  on public.hq_user_access_requests (user_id, status, created_at desc)
  where archived_at is null;
