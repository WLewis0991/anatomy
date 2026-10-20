-- Phase 11: a role per file, decided by convention or syntax.
--
-- The rail groups by what a file is, so the parse result now carries the role
-- the adapter proved, the file kind and reach it already decided, and how many
-- inline server actions a page hosts. Old analyses keep a null role: that means
-- "not classified", not "unclassified", and the UI must not conflate them.

alter table public.files
  add column if not exists role text;

alter table public.files
  add column if not exists kind text;

alter table public.files
  add column if not exists reach text;

alter table public.files
  add column if not exists server_action_count integer;

alter table public.analyses
  add column if not exists role_schema_version integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'files_role_check'
      and conrelid = 'public.files'::regclass
  ) then
    alter table public.files
      add constraint files_role_check
      check (
        role is null or role in (
          'page', 'layout', 'route-handler', 'middleware', 'action-module',
          'component', 'hook', 'config', 'style', 'asset', 'docs', 'unclassified'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'files_kind_check'
      and conrelid = 'public.files'::regclass
  ) then
    alter table public.files
      add constraint files_kind_check
      check (
        kind is null or kind in (
          'typescript', 'javascript', 'style', 'json', 'markdown',
          'config', 'asset', 'other'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'files_reach_check'
      and conrelid = 'public.files'::regclass
  ) then
    alter table public.files
      add constraint files_reach_check
      check (reach is null or reach in ('none', 'framework', 'entrypoint'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'files_server_action_count_check'
      and conrelid = 'public.files'::regclass
  ) then
    alter table public.files
      add constraint files_server_action_count_check
      check (server_action_count is null or server_action_count >= 0);
  end if;
end
$$;

-- Verify RLS is still enabled on every table, the same guard phase 10 used.
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
