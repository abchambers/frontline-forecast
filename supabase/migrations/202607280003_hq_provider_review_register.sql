-- A private decision register for weather-data and infrastructure providers.
-- It records commercial readiness without storing tokens, contracts, or secrets.

create table if not exists public.hq_provider_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (char_length(trim(provider)) between 1 and 120),
  purpose text not null default '' check (char_length(purpose) <= 1000),
  commercial_status text not null default 'Not started'
    check (commercial_status in ('Not started', 'In review', 'Approved for pilot', 'Contract needed', 'Not approved')),
  terms_url text,
  attribution_requirement text,
  rate_limit text,
  cache_policy text,
  evidence_url text,
  decision_owner text,
  reviewed_at date,
  next_review_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.hq_provider_reviews enable row level security;

grant select, insert, update, delete on public.hq_provider_reviews to authenticated;

create policy "Platform owners manage provider reviews"
on public.hq_provider_reviews
for all
to authenticated
using ((select frontline_private.is_owner()) and (select auth.uid()) = user_id)
with check ((select frontline_private.is_owner()) and (select auth.uid()) = user_id);

create index if not exists hq_provider_reviews_owner_next_review_idx
  on public.hq_provider_reviews (user_id, next_review_date);
