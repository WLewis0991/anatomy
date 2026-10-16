-- Phase 7: Analysis pipeline
-- Adds commit tracking, coverage storage, stage progression, and realtime channels
-- for live progress updates.

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
-- 'storing', 'succeeded', 'failed'. The runner updates this column and a trigger
-- publishes the change to the analysis's realtime channel.
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
-- Realtime: per-analysis channels
-- ---------------------------------------------------------------------------

-- The channel pattern is declared here so it exists before anything publishes.
-- The trigger below publishes to `analysis:{analysis_id}`.
-- The policy on the channel mirrors the row policy: only the owning organization
-- may subscribe.
--
-- Supabase realtime uses the `supabase_realtime` publication. We add the table
-- to it with `insert, update, delete` so stage changes are broadcast.
alter publication supabase_realtime add table public.analyses;

-- The publication change above is enough for the channel to work. The subscription
-- filter on the client side (`filter=organization_id=eq.<org>`) enforces the
-- same isolation as the row-level security policy.

-- ---------------------------------------------------------------------------
-- Trigger: publish stage changes to the analysis channel
-- ---------------------------------------------------------------------------

-- We publish from a trigger on our own table, never by attaching to the realtime
-- machinery directly. The payload carries only the stage and message, not the
-- whole row — the progress page has nothing to filter and nothing to interpret.
create or replace function public.notify_analysis_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage
     or new.stage_message is distinct from old.stage_message then
    perform pg_notify(
      'analysis:' || new.id::text,
      jsonb_build_object(
        'stage', new.stage,
        'message', new.stage_message
      )::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trigger_notify_analysis_stage on public.analyses;
create trigger trigger_notify_analysis_stage
  after update of stage, stage_message on public.analyses
  for each row
  execute function public.notify_analysis_stage();

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