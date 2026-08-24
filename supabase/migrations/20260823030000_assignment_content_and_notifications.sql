-- Assignments become their own self-contained thing, independent of
-- forecast_runs/forecast_reviews: their own attached reference material,
-- their own lightweight per-day submissions, their own review/grading
-- table. Plus a generic notifications table + a trigger that notifies a
-- classroom's active students the moment an assignment opens.

create table public.assignment_references (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.classroom_assignments(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  kind text not null check (kind in ('link', 'observation', 'model')),
  label text not null check (char_length(trim(label)) between 1 and 140),
  url text,
  detail jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index assignment_references_assignment_idx on public.assignment_references (assignment_id, created_at);

create table public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.classroom_assignments(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  responses jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index assignment_submissions_assignment_idx on public.assignment_submissions (assignment_id, updated_at desc);
create index assignment_submissions_student_idx on public.assignment_submissions (student_id, updated_at desc);

create or replace function public.touch_assignment_submission_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger assignment_submissions_touch_updated_at
  before update on public.assignment_submissions
  for each row execute procedure public.touch_assignment_submission_updated_at();

create table public.assignment_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.assignment_submissions(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  comment text,
  manual_score numeric(5,2) check (manual_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (comment is not null or manual_score is not null)
);

create index assignment_reviews_submission_idx on public.assignment_reviews (submission_id, created_at desc);

create or replace function public.touch_assignment_review_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger assignment_reviews_touch_updated_at
  before update on public.assignment_reviews
  for each row execute procedure public.touch_assignment_review_updated_at();

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx on public.notifications (user_id, read_at) where read_at is null;
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

-- RLS: assignment_references
alter table public.assignment_references enable row level security;
grant select, insert, update, delete on public.assignment_references to authenticated;

create policy "Classroom members read visible assignment references" on public.assignment_references
  for select using (
    frontline_private.can_manage_classroom_assignment(classroom_id)
    or (
      frontline_private.can_view_classroom(classroom_id)
      and exists (
        select 1 from public.classroom_assignments a
        where a.id = assignment_id and a.status in ('open', 'closed')
      )
    )
  );

create policy "Instructors manage assignment references" on public.assignment_references
  for all using (frontline_private.can_manage_classroom_assignment(classroom_id))
  with check (frontline_private.can_manage_classroom_assignment(classroom_id));

-- RLS: assignment_submissions
alter table public.assignment_submissions enable row level security;
grant select, insert, update on public.assignment_submissions to authenticated;

create policy "Students manage their own assignment submission" on public.assignment_submissions
  for all using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy "Instructors read classroom assignment submissions" on public.assignment_submissions
  for select using (frontline_private.can_manage_classroom_assignment(classroom_id));

-- RLS: assignment_reviews -- students never get write access here; grading
-- lives in its own table specifically so it can be withheld from the
-- student-writable assignment_submissions policy above.
alter table public.assignment_reviews enable row level security;
grant select, insert, update on public.assignment_reviews to authenticated;

create policy "Instructors manage assignment reviews" on public.assignment_reviews
  for all using (
    exists (
      select 1 from public.assignment_submissions s
      where s.id = submission_id and frontline_private.can_manage_classroom_assignment(s.classroom_id)
    )
  )
  with check (
    exists (
      select 1 from public.assignment_submissions s
      where s.id = submission_id and frontline_private.can_manage_classroom_assignment(s.classroom_id)
    )
  );

create policy "Students read their own assignment reviews" on public.assignment_reviews
  for select using (
    exists (
      select 1 from public.assignment_submissions s
      where s.id = submission_id and s.student_id = auth.uid()
    )
  );

-- RLS: notifications -- select/update own row only; NO insert/delete grant
-- to authenticated at all. Rows are created exclusively by the
-- security-definer trigger below, so a client-side insert is structurally
-- impossible, not just policy-blocked.
alter table public.notifications enable row level security;
grant select, update on public.notifications to authenticated;

create policy "Users read their own notifications" on public.notifications
  for select using (user_id = auth.uid());

create policy "Users mark their own notifications read" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Notify every active student in a classroom the moment its assignment
-- opens (on creation already-open, or on a later draft/closed -> open
-- transition).
create or replace function public.notify_students_of_open_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    insert into public.notifications (user_id, kind, payload)
    select membership.user_id, 'assignment_created',
      jsonb_build_object('assignment_id', new.id, 'classroom_id', new.classroom_id, 'title', new.title)
    from public.classroom_memberships membership
    where membership.classroom_id = new.classroom_id
      and membership.status = 'active'
      and membership.role = 'student';
  end if;
  return new;
end;
$$;

drop trigger if exists classroom_assignments_notify_open on public.classroom_assignments;
create trigger classroom_assignments_notify_open
  after insert or update of status on public.classroom_assignments
  for each row execute procedure public.notify_students_of_open_assignment();
