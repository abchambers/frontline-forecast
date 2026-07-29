-- Cover archive-author lookups used by the Company HQ request history.
create index if not exists hq_user_access_requests_archived_by_idx
  on public.hq_user_access_requests (archived_by);
