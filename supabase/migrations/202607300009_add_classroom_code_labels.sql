-- Earlier workspace codes did not include a human-facing label. Classroom
-- enrollment codes use it only for staff organization; never for authorization.
alter table public.workspace_join_codes
  add column if not exists label text;
