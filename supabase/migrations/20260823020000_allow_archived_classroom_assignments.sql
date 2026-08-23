-- Allow archiving a classroom assignment (soft-delete). Archived assignments
-- keep their submission history intact but drop out of the default rail and
-- out of students' visible list, matching this app's archive-not-delete
-- convention used for classrooms/classroom_memberships/forecast archives.
alter table public.classroom_assignments
  drop constraint classroom_assignments_status_check;

alter table public.classroom_assignments
  add constraint classroom_assignments_status_check
  check (status = any (array['draft'::text, 'open'::text, 'closed'::text, 'archived'::text]));
