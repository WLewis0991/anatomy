-- The first migration. Nine tables: a mirror of the Clerk organizations, and the
-- eight tables the product is built out of.
--
-- Two things are load-bearing here and easy to undo by accident:
--
--   1. Row level security is enabled immediately after each `create table`, not
--      collected into one block at the end. A table with security on and no
--      policy returns nothing, which is visible; a table where enabling it was
--      forgotten returns everything, silently.
--   2. Authorization is a policy, never a `where` clause the application
--      remembers to write. If a query needs `.eq("organization_id", ...)` to
--      return the right rows, the policy is wrong.

-- ---------------------------------------------------------------------------
-- The organization claim
-- ---------------------------------------------------------------------------

-- Not in `public`, so PostgREST cannot reach it through the Data API. The
-- policy below is the only thing that calls it.
create schema app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

-- Clerk's session token is the only source of identity. JWT v2 nests the active
-- organization under `o`; the coalesce also accepts the v1-shaped top-level
-- `org_id` so a token from either shape resolves, instead of silently matching
-- nothing. A token with no organization at all yields NULL, the comparison
-- below is NULL, and `using` treats that as false — it fails closed without an
-- extra guard clause.
create function app.current_organization_id() returns text
  language sql
  stable
  set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'org_id', auth.jwt() -> 'o' ->> 'id')
$$;

-- The default is EXECUTE for PUBLIC, and PUBLIC is only barred from the schema
-- above, not from the function itself. `authenticated` needs execute explicitly,
-- or every policy that calls this fails with a permission error.
revoke execute on function app.current_organization_id() from public;
grant execute on function app.current_organization_id() to authenticated;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

-- A foreign key cannot point into Clerk, so the organizations the policies
-- compare against have to exist as rows of their own. The id is the Clerk
-- organization's `org_...` string, which is why it is `text` and why it has no
-- generated uuid default.
--
-- No policy this phase. Nothing reads it, and unreadable is the right state for
-- a table nothing has a use for yet.
create table public.organizations (
  id text primary key,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

-- `name` is the `owner/repo` string, normalised once when the repository is
-- added, and is what a repository is identified by: the same repository cannot
-- be added twice to one organization.
--
-- `url` is the repository address as given, kept because a later phase fetches
-- from it. It is not derived from `name`, because a pasted URL can carry a
-- branch or a subdirectory that `name` does not.
--
-- `unique (id, organization_id)` exists only to be the target of the composite
-- foreign key from `analyses` below. See the note on composite foreign keys
-- before adding one.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  name text not null,
  url text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

alter table public.projects enable row level security;

-- ---------------------------------------------------------------------------
-- analyses
-- ---------------------------------------------------------------------------

-- One run over one repository. Several runs per project is the point: nothing
-- stops a repository being mapped again after it changes, so there is
-- deliberately no unique constraint on `project_id`.
--
-- `status` is text with a check rather than an enum. `ALTER TYPE ... ADD VALUE`
-- cannot run inside a transaction, and migrations are applied inside one, so an
-- enum would mean a migration that cannot be a file. No `queued` and no
-- `cancelled`: cancelled implies a cancel button, and nothing in the product can
-- cancel a run.
--
-- The success value is `succeeded`, not `complete`: whether a graph was produced
-- is a claim about the run, and "complete" says nothing about that.
--
-- `error_detail` is the short human-readable reason a run stopped, and the
-- check keeps it off every row that is not a failure — a reason cannot sit on a
-- row that claims to have succeeded.
create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  project_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  error_detail text null
    check (error_detail is null or status = 'failed'),
  created_at timestamptz not null default now(),
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  unique (id, organization_id)
);

alter table public.analyses enable row level security;

-- The dashboard orders by `created_at desc` with no `where` clause of its own,
-- so `organization_id` leads the index: the policy predicate is the only thing
-- narrowing the scan, and an index not leading with it degrades to a sequential
-- scan. See the note above `unique (id, organization_id)` on `projects` for why
-- the parent unique constraints are the one place the order is the other way
-- round.
create index analyses_organization_created_idx
  on public.analyses (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- files
-- ---------------------------------------------------------------------------

-- One file as it was found in one analysis. `path` is the repository-relative
-- path and is what the map draws and the detail panel shows. No language column:
-- there is no parser yet, and a language this phase cannot produce would be a
-- value invented to fill a column.
create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  path text not null,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  unique (organization_id, analysis_id, path),
  unique (id, organization_id)
);

alter table public.files enable row level security;

-- ---------------------------------------------------------------------------
-- edges
-- ---------------------------------------------------------------------------

-- One resolved import from one file to another. This table is the graph, and
-- the rule the whole product rests on is that a row here exists because an
-- import was resolved to a real file. Nothing infers one.
--
-- `kind` is in the unique key because a file can both `import { a } from "./m"`
-- and `import type { T } from "./m"` — two real imports, and without it in the
-- key one of them is silently dropped rather than recorded.
--
-- `specifier` is deliberately outside the key: the graph draws dependencies, not
-- statements, and two imports of the same module by the same file are one line
-- on screen. It is deliberately stored: it is the evidence of what the author
-- wrote, and it is not recoverable from the two endpoints.
--
-- No `resolved_path`: it would be a second copy of `files.path` for
-- `to_file_id`, and a second copy can disagree with the first.
--
-- This table has two foreign keys to `files`. PostgREST therefore needs a hint
-- to embed either side, for example
-- `from:files!edges_from_file_id_fkey(*)` and `to:files!edges_to_file_id_fkey(*)`.
create table public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  from_file_id uuid not null,
  to_file_id uuid not null,
  kind text not null,
  specifier text not null,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (from_file_id, organization_id)
    references public.files (id, organization_id) on delete cascade,
  foreign key (to_file_id, organization_id)
    references public.files (id, organization_id) on delete cascade,
  unique (organization_id, analysis_id, from_file_id, to_file_id, kind)
);

alter table public.edges enable row level security;

-- ---------------------------------------------------------------------------
-- routes
-- ---------------------------------------------------------------------------

-- A route recovered from the syntax. Both halves of it have to be recoverable
-- or there is no row: a partial route is a wrong route, which is the same
-- failure as an invented edge.
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  method text not null,
  path text not null,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  unique (organization_id, analysis_id, method, path)
);

alter table public.routes enable row level security;

-- ---------------------------------------------------------------------------
-- explanations
-- ---------------------------------------------------------------------------

-- Prose written about one file, from that file and its real neighbours. One per
-- file: a second explanation of the same file would be a cache miss dressed up
-- as a row.
create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  file_id uuid not null,
  body text not null,
  foreign key (file_id, organization_id)
    references public.files (id, organization_id) on delete cascade,
  unique (organization_id, file_id)
);

alter table public.explanations enable row level security;

-- ---------------------------------------------------------------------------
-- file_roles
-- ---------------------------------------------------------------------------

-- A label for a file whose role convention could not identify. `source` records
-- who wrote the label, which is provenance and not a score.
--
-- There is no confidence column. A confidence number is a score, and scores are
-- out of scope for this product permanently.
create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  file_id uuid not null,
  role text not null,
  source text not null default 'ai' check (source in ('ai', 'human')),
  foreign key (file_id, organization_id)
    references public.files (id, organization_id) on delete cascade,
  unique (organization_id, file_id)
);

alter table public.file_roles enable row level security;

-- ---------------------------------------------------------------------------
-- insights
-- ---------------------------------------------------------------------------

-- A question asked of one analysis and the answer looked up from it. Not unique
-- on anything: the same question asked twice is two records, and asking again
-- is expected.
create table public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null,
  analysis_id uuid not null,
  question text not null,
  answer text not null,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

alter table public.insights enable row level security;

create index insights_organization_analysis_idx
  on public.insights (organization_id, analysis_id);

-- Supabase's database linter will report every composite foreign key here as
-- "unindexed", because the check wants the foreign key's first column to lead an
-- index and these lead with `organization_id` instead. The indexes do cover
-- them: a cascade delete arrives with *both* columns equal — the parent row
-- supplies its id and its organization — so `organization_id` equality narrows
-- the scan and the foreign key's own column is found inside the organization.
-- Adding a second index per foreign key, leading with the id, would satisfy the
-- linter and double the write cost of every table for no read that this schema
-- can issue.
--
-- If that ever stops being true — a query that looks a row up by id alone, with
-- no organization beside it — that query needs an index, and it should say so
-- rather than the linter's opinion.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Per table, deliberately. The project's default ACL grants `anon` and
-- `authenticated` `arwdDxtm` on every new table in `public`, which would let an
-- anonymous caller write everything and leave row level security as the only
-- thing standing between it and the data. A schema-wide revoke would not fix
-- that: it does not touch the default ACL, so next month's tables would regain
-- the grant with nobody noticing.
--
-- Only `anon` is revoked from. `authenticated` keeps the default ACL's write
-- privileges, which nothing in this phase uses; the policies' `with check` is
-- what confines a write to the caller's own organization. Tightening
-- `authenticated` to select-only is a change to make deliberately when the first
-- writer arrives and a phase decides what it is allowed to write, not something
-- to do here while the grant is unused either way.
revoke all on table public.organizations from anon;
revoke all on table public.projects from anon;
revoke all on table public.analyses from anon;
revoke all on table public.files from anon;
revoke all on table public.edges from anon;
revoke all on table public.routes from anon;
revoke all on table public.explanations from anon;
revoke all on table public.file_roles from anon;
revoke all on table public.insights from anon;

grant select on table public.organizations to authenticated;
grant select on table public.projects to authenticated;
grant select on table public.analyses to authenticated;
grant select on table public.files to authenticated;
grant select on table public.edges to authenticated;
grant select on table public.routes to authenticated;
grant select on table public.explanations to authenticated;
grant select on table public.file_roles to authenticated;
grant select on table public.insights to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- One predicate, eight times. `(select ...)` is not decoration: it wraps the
-- call in an InitPlan evaluated once per query instead of once per row, which is
-- the difference between one JWT parse and one per row of the table.
--
-- `with check` is the same expression, because a row whose organization does not
-- match the token must not be written under the other one's either.
--
-- `organizations` has no policy. It is the input to the comparison, not the
-- subject of it. Supabase's linter reports that as "RLS enabled, no policy",
-- which is the intended state of a table nothing reads yet.
create policy projects_organization_isolation on public.projects
  for all to authenticated
  using (organization_id = (select app.current_organization_id()))
  with check (organization_id = (select app.current_organization_id()));

create policy analyses_organization_isolation on public.analyses
  for all to authenticated
  using (organization_id = (select app.current_organization_id()))
  with check (organization_id = (select app.current_organization_id()));

create policy files_organization_isolation on public.files
  for all to authenticated
  using (organization_id = (select app.current_organization_id()))
  with check (organization_id = (select app.current_organization_id()));

create policy edges_organization_isolation on public.edges
  for all to authenticated
  using (organization_id = (select app.current_organization_id()))
  with check (organization_id = (select app.current_organization_id()));

create policy routes_organization_isolation on public.routes
  for all to authenticated
  using (organization_id = (select app.current_organization_id()))
  with check (organization_id = (select app.current_organization_id()));

create policy explanations_organization_isolation on public.explanations
  for all to authenticated
  using (organization_id = (select app.current_organization_id()))
  with check (organization_id = (select app.current_organization_id()));

create policy file_roles_organization_isolation on public.file_roles
  for all to authenticated
  using (organization_id = (select app.current_organization_id()))
  with check (organization_id = (select app.current_organization_id()));

create policy insights_organization_isolation on public.insights
  for all to authenticated
  using (organization_id = (select app.current_organization_id()))
  with check (organization_id = (select app.current_organization_id()));

-- ---------------------------------------------------------------------------
-- The check this file exists to make true
-- ---------------------------------------------------------------------------

-- `force row level security` is deliberately not used. The table owner here is
-- a superuser, and forcing the policy onto the owner would only add a way for
-- migrations to start failing; nothing reaches this database as the owner.
--
-- What matters is that every table in `public` has security on, so a table
-- added in a later migration without it fails this file's successor loudly
-- rather than reading silently.
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

-- Deliberately absent, because this phase has no producer for any of it and a
-- shape guessed now is a shape a later phase has to live with:
--   coverage reporting (how much of a repository was parsed, and why the rest
--     was not) — a phase of its own, with a real parser to report from;
--   the chat lookup record — what an answer looked up before answering it;
--   `head_sha` or `root_commit` on an analysis;
--   `files.language`;
--   `explanations.model`;
--   `projects.default_branch`.

-- A note for whoever edits the composite foreign keys above: never declare a
-- single-column foreign key *and* a composite foreign key between the same pair
-- of tables. Both exist, PostgREST finds two relationships where it wants one,
-- and every embed between the pair fails with a 300 "more than one relationship
-- was found". The composite foreign key already guarantees the single column
-- exists, so there is never a reason to add the second.