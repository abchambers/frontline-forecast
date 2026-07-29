-- Complete the private HQ approval and publishing lifecycle.
-- All changes remain owner-gated through the existing RLS policies.

alter table public.hq_user_access_requests
  add column if not exists invite_sent_at timestamptz,
  add column if not exists invite_sent_by uuid references auth.users(id) on delete set null;

create index if not exists hq_user_access_requests_invite_ready_idx
  on public.hq_user_access_requests (user_id, created_at desc)
  where request_type = 'invite' and status = 'Approved' and invite_sent_at is null;

alter table public.site_content_drafts
  add column if not exists is_public boolean not null default true;

-- A draft is private, but it must retain the desired public visibility so a
-- reviewer sees exactly what publishing will do.
comment on column public.site_content_drafts.is_public is
  'Requested public visibility applied only when this draft is published.';

create index if not exists site_content_versions_created_by_idx
  on public.site_content_versions (created_by, created_at desc);
