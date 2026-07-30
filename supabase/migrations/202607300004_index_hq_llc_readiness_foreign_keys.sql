-- Cover lifecycle references used by the private operating registers.
create index if not exists hq_documents_archived_by_idx on public.hq_documents (archived_by) where archived_by is not null;
create index if not exists hq_roadmap_items_archived_by_idx on public.hq_roadmap_items (archived_by) where archived_by is not null;
create index if not exists hq_roadmap_items_task_id_idx on public.hq_roadmap_items (task_id) where task_id is not null;
create index if not exists hq_employee_records_manager_profile_idx on public.hq_employee_records (manager_profile_id) where manager_profile_id is not null;
