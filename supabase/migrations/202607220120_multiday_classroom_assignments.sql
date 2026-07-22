alter table public.classroom_assignments
  add column if not exists target_dates jsonb not null default '[]'::jsonb;

update public.classroom_assignments
set target_dates = jsonb_build_array(target_date)
where jsonb_array_length(target_dates) = 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'classroom_assignments_target_dates_array'
      and conrelid = 'public.classroom_assignments'::regclass
  ) then
    alter table public.classroom_assignments
      add constraint classroom_assignments_target_dates_array
      check (jsonb_typeof(target_dates) = 'array');
  end if;
end $$;
