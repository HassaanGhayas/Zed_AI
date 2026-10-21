-- Analytics: concept mastery, spaced-repetition scheduling, study time, settings.
-- Idempotent: safe to re-run. Client writes to concepts/review_events/study_days are
-- not allowed; the backend writes them with the service role.

alter table public.qa_attempts
  add column if not exists time_spent_ms int check (time_spent_ms is null or time_spent_ms between 0 and 86400000),
  add column if not exists concept_keys text[] default '{}';

-- Source-question details (set by /record so /due can rebuild cards cheaply) and attempt origin.
alter table public.qa_attempts
  add column if not exists expected_concept text check (expected_concept is null or char_length(expected_concept) <= 500),
  add column if not exists hints jsonb,
  add column if not exists source text check (source is null or source in ('video', 'review'));

create index if not exists qa_attempts_concept_keys_idx
  on public.qa_attempts using gin (concept_keys);

alter table public.video_sessions
  add column if not exists domain text check (domain is null or char_length(domain) <= 100);

-- Optional cached domain classification next to the shared segment cache.
alter table public.transcript_cache
  add column if not exists domain text check (domain is null or char_length(domain) <= 100);

create table if not exists public.concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  concept_key text not null check (char_length(concept_key) between 1 and 200),
  label text not null check (char_length(label) between 1 and 300),
  domain text check (domain is null or char_length(domain) <= 100),
  strength real not null default 0 check (strength between 0 and 1),
  stability_days real not null default 1 check (stability_days > 0),
  reps int default 0,
  lapses int default 0,
  last_reviewed timestamptz,
  next_due timestamptz,
  unique (user_id, concept_key)
);

-- Optimistic-concurrency counter used by /record (compare-and-swap on update).
alter table public.concepts add column if not exists version int not null default 0;

create index if not exists concepts_user_next_due_idx
  on public.concepts (user_id, next_due);

create table if not exists public.review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  concept_key text not null check (char_length(concept_key) between 1 and 200),
  score int check (score is null or score between 0 and 100),
  status text check (status is null or char_length(status) <= 32),
  source text check (source in ('video', 'review')),
  interval_days_before real,
  reviewed_at timestamptz default now()
);

create index if not exists review_events_user_reviewed_idx
  on public.review_events (user_id, reviewed_at desc);

-- Client-generated attempt id: /record is idempotent per (user, attempt_id). One attempt can
-- touch several concepts, so uniqueness includes concept_key.
alter table public.review_events add column if not exists attempt_id text
  check (attempt_id is null or char_length(attempt_id) <= 100);
create unique index if not exists review_events_user_attempt_concept_uidx
  on public.review_events (user_id, attempt_id, concept_key) where attempt_id is not null;

create table if not exists public.study_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  seconds int not null default 0 check (seconds between 0 and 86400),
  primary key (user_id, day)
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_target_hours int not null default 20 check (monthly_target_hours between 1 and 744),
  updated_at timestamptz default now()
);

alter table public.concepts enable row level security;
alter table public.review_events enable row level security;
alter table public.study_days enable row level security;
alter table public.user_settings enable row level security;

-- Read-only for clients (writes via service role only).
drop policy if exists "concepts_select_own" on public.concepts;
create policy "concepts_select_own" on public.concepts
  for select using (user_id = auth.uid());

drop policy if exists "review_events_select_own" on public.review_events;
create policy "review_events_select_own" on public.review_events
  for select using (user_id = auth.uid());

drop policy if exists "study_days_select_own" on public.study_days;
create policy "study_days_select_own" on public.study_days
  for select using (user_id = auth.uid());

-- Full own-row access.
drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own" on public.user_settings
  for select using (user_id = auth.uid());
drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own" on public.user_settings
  for insert with check (user_id = auth.uid());
drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own" on public.user_settings
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own" on public.user_settings
  for delete using (user_id = auth.uid());

-- Atomic per-day accumulation, capped at 24h. Callable only with the service role.
create or replace function public.add_study_seconds(p_user uuid, p_day date, p_seconds int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  total int;
begin
  insert into public.study_days as sd (user_id, day, seconds)
  values (p_user, p_day, least(greatest(p_seconds, 0), 86400))
  on conflict (user_id, day)
  do update set seconds = least(sd.seconds + greatest(p_seconds, 0), 86400)
  returning sd.seconds into total;
  return total;
end;
$$;

revoke all on function public.add_study_seconds(uuid, date, int) from public, anon, authenticated;
grant execute on function public.add_study_seconds(uuid, date, int) to service_role;
