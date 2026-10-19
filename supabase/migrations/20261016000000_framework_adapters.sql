-- Phase 8: Framework adapters, roles, and routes.

-- ---------------------------------------------------------------------------
-- routes: Django binds no HTTP method to a URL pattern, so the method is
-- optional. TypeScript and JavaScript routes always carry one, so their rows
-- are unchanged; Django routes render as ANY. Routes stay exact-or-absent.
-- ---------------------------------------------------------------------------

alter table public.routes
  alter column method drop not null;

-- ---------------------------------------------------------------------------
-- files: the role an adapter (or the generic fallback) assigns to a file.
-- Additive: files, edges and coverage for TypeScript/JavaScript repositories
-- are unchanged; newly selected Python files are additions.
-- ---------------------------------------------------------------------------

alter table public.files
  add column if not exists role text;

-- ---------------------------------------------------------------------------
-- analyses: which language frontend and which framework adapter classified
-- the run, so the rail and the detail pane can reshape themselves per
-- framework without re-deriving anything.
-- ---------------------------------------------------------------------------

alter table public.analyses
  add column if not exists adapter text;

alter table public.analyses
  add column if not exists frontend text;
