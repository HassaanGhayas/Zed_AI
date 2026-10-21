-- Studify AI: per-user session sync, Q&A history, shared transcript cache.

create table if not exists public.video_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  client_session_id text not null,
  video_id text not null,
  lecture_title text not null default '',
  session jsonb not null,
  progress jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'complete')),
  updated_at timestamptz not null default now(),
  unique (user_id, client_session_id)
);

create index if not exists video_sessions_user_updated_idx
  on public.video_sessions (user_id, updated_at desc);

create table if not exists public.qa_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  client_session_id text not null,
  segment_id int,
  segment_title text,
  question text not null,
  answer text not null check (char_length(answer) <= 5000),
  feedback text,
  score int,
  verdict text,
  needs_review boolean default false,
  understood_concepts jsonb default '[]',
  missing_concepts jsonb default '[]',
  misconceptions jsonb default '[]',
  attempts int default 1,
  created_at timestamptz default now()
);

create index if not exists qa_attempts_user_created_idx
  on public.qa_attempts (user_id, created_at desc);

-- Shared cache, accessed only by the backend with the service role key.
create table if not exists public.transcript_cache (
  video_id text primary key,
  cues jsonb not null,
  segments jsonb,
  segmenter_version text,
  fetched_at timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Keep a client-supplied updated_at (last-write-wins sync); stamp only when unchanged.
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists video_sessions_set_updated_at on public.video_sessions;
create trigger video_sessions_set_updated_at
  before update on public.video_sessions
  for each row execute function public.set_updated_at();

alter table public.video_sessions enable row level security;
alter table public.qa_attempts enable row level security;
alter table public.transcript_cache enable row level security;  -- no policies: service role only

drop policy if exists "video_sessions_select_own" on public.video_sessions;
create policy "video_sessions_select_own" on public.video_sessions
  for select using (user_id = auth.uid());
drop policy if exists "video_sessions_insert_own" on public.video_sessions;
create policy "video_sessions_insert_own" on public.video_sessions
  for insert with check (user_id = auth.uid());
drop policy if exists "video_sessions_update_own" on public.video_sessions;
create policy "video_sessions_update_own" on public.video_sessions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "video_sessions_delete_own" on public.video_sessions;
create policy "video_sessions_delete_own" on public.video_sessions
  for delete using (user_id = auth.uid());

drop policy if exists "qa_attempts_select_own" on public.qa_attempts;
create policy "qa_attempts_select_own" on public.qa_attempts
  for select using (user_id = auth.uid());
drop policy if exists "qa_attempts_insert_own" on public.qa_attempts;
create policy "qa_attempts_insert_own" on public.qa_attempts
  for insert with check (user_id = auth.uid());
drop policy if exists "qa_attempts_update_own" on public.qa_attempts;
create policy "qa_attempts_update_own" on public.qa_attempts
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "qa_attempts_delete_own" on public.qa_attempts;
create policy "qa_attempts_delete_own" on public.qa_attempts
  for delete using (user_id = auth.uid());
