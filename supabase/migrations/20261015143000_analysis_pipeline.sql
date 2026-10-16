-- Phase 7: Analysis pipeline
-- Adds commit tracking, coverage storage, stage progression, and realtime
-- progress over the analyses table.

-- ---------------------------------------------------------------------------
-- analyses: add head_sha and coverage_json
-- ---------------------------------------------------------------------------

-- The commit the archive was fetched at. A later phase uses this to decide
-- whether the repository has moved on.
alter table public.analyses
  add column if not exists head_sha text;

-- Coverage as JSON so the banner can render without a join. The parser writes
-- the whole coverage object; nothing here reshapes it.
alter table public.analyses
  add column if not exists coverage_json jsonb;

-- Stage progression for live progress. Values: 'fetching', 'selecting', 'parsing',
-- 'storing', 'succeeded', 'failed'. The runner updates this column; the change is
-- published to realtime subscribers through the publication added below.
alter table public.analyses
  add column if not exists stage text not null default 'pending'
    check (stage in ('pending', 'fetching', 'selecting', 'parsing', 'storing', 'succeeded', 'failed'));

-- Message shown alongside the stage on the progress page.
alter table public.analyses
  add column if not exists stage_message text;

-- Index for finding stale runs (pending/running past a few minutes).
create index if not exists analyses_stage_created_idx
  on public.analyses (stage, created_at)
  where stage in ('pending', 'fetching', 'selecting', 'parsing', 'storing');

-- ---------------------------------------------------------------------------
-- Realtime: live progress over the analyses table
-- ---------------------------------------------------------------------------

-- Supabase Realtime drives `postgres_changes` subscribers from the
-- `supabase_realtime` publication, so the table is added to it. There is no
-- separate channel to register: the client's topic name is a local label, and
-- delivery comes from the publication rather than from anything the database
-- sends under that name. `pg_notify` belongs to a different mechanism and never
-- reaches a `postgres_changes` subscription, so nothing here publishes by hand.
--
-- Which rows reach a subscriber is decided by row-level security, the same
-- policy that governs a direct select. A subscriber without the owning
-- organization's claim is sent no rows, so the stream is protected exactly as
-- the table is. Nothing filters on a channel name.
alter publication supabase_realtime add table public.analyses;

-- ---------------------------------------------------------------------------
-- Verify RLS is still enabled on all tables
-- ---------------------------------------------------------------------------

do $$
declare
  unguarded text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into unguarded
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if unguarded is not null then
    raise exception 'row level security is not enabled on public.%', unguarded;
  end if;
end
$$;