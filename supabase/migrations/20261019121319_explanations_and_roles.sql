-- Phase 10: explanations, their cache, and AI-assigned roles.
--
-- The cache is the row. An explanation is only valid for the content it was
-- written from and the model that wrote it, so both are stored beside the body
-- and compared on every read. A folder has no `files` row to hang from, which is
-- why folder explanations get a table of their own rather than a synthetic file.

-- ---------------------------------------------------------------------------
-- files: the content hash the parser already computes.
-- ---------------------------------------------------------------------------

-- Nullable because rows stored before this migration have no hash. An
-- explanation for one of those is treated as a miss rather than trusted.
alter table public.files
  add column if not exists hash text;

-- ---------------------------------------------------------------------------
-- analyses: the adapter that classified the run.
-- ---------------------------------------------------------------------------

-- The explanation prompt names the framework the parse used. No adapter name
-- means the generic fallback, which is what the old rows were parsed with.
alter table public.analyses
  add column if not exists adapter text;

-- ---------------------------------------------------------------------------
-- explanations: what the body was written from, and by which model.
-- ---------------------------------------------------------------------------

alter table public.explanations
  add column if not exists subject_hash text;

alter table public.explanations
  add column if not exists model text;

alter table public.explanations
  add column if not exists head_sha text;

alter table public.explanations
  add column if not exists created_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- file_roles: the provenance of an AI role.
-- ---------------------------------------------------------------------------

-- `source` already records who wrote the label. The model and hash are what let
-- a re-pin or a changed file replace an old label rather than keep it forever.
alter table public.file_roles
  add column if not exists model text;

alter table public.file_roles
  add column if not exists subject_hash text;

-- ---------------------------------------------------------------------------
-- folder_explanations
-- ---------------------------------------------------------------------------

-- One explanation per folded folder. The folder's hash is the hash of every
-- file hash beneath it, so adding or changing a file invalidates the cache even
-- when no single file was the subject.
create table public.folder_explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  folder_path text not null,
  body text not null,
  subject_hash text not null,
  model text not null,
  head_sha text,
  created_at timestamptz not null default now(),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  unique (organization_id, analysis_id, folder_path)
);

alter table public.folder_explanations enable row level security;

revoke all on table public.folder_explanations from anon;
grant select, insert, update, delete on table public.folder_explanations to authenticated;

create policy folder_explanations_organization_isolation on public.folder_explanations
  for all to authenticated
  using (organization_id = (select app.current_organization_id()))
  with check (organization_id = (select app.current_organization_id()));

-- ---------------------------------------------------------------------------
-- Verify RLS is still enabled on all tables.
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
