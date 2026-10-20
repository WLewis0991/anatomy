-- Phase 8: facets. A flag is a fact about a file that is true alongside its
-- role, not instead of it: a .test.tsx is a test and a component. Flags are a
-- set the parser decides from the path, so they live in an array rather than a
-- column per facet.
--
-- Additive: existing rows default to the empty set, and a file with no flags
-- reads exactly as it did before. Analyses stored before this migration show a
-- Tests count of zero until the repository is parsed again, because the flags
-- are recorded at parse time and never re-derived in the browser.

alter table public.files
  add column if not exists flags text[] not null default '{}';
