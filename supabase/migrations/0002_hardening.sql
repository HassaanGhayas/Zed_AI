-- Hardening: ignore stale writes, clamp future timestamps, bound payload sizes.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  -- Stale write (older than the stored row): ignore it, keep the old row.
  if new.updated_at < old.updated_at then
    return old;
  end if;
  -- Unchanged timestamp: server stamps it. Client-supplied values are kept but
  -- clamped so a bad clock cannot pin a row in the future and block later writes.
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at = now();
  end if;
  if new.updated_at > now() + interval '1 minute' then
    new.updated_at = now() + interval '1 minute';
  end if;
  return new;
end;
$$;

alter table public.video_sessions
  add constraint video_sessions_session_size check (pg_column_size(session) < 2000000);
alter table public.video_sessions
  add constraint video_sessions_progress_size check (pg_column_size(progress) < 1000000);
alter table public.qa_attempts
  add constraint qa_attempts_text_size
  check (char_length(question) <= 2000 and char_length(coalesce(feedback, '')) <= 10000);
