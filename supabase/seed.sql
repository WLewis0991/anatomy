-- Fixture data. Not part of the migration history: seed rows describe what the
-- schema looks like when it has rows in it, they are not schema, and re-running
-- this file must be a no-op rather than a second set of rows.
--
-- Run it with `supabase_execute_sql`, not `apply_migration`.
--
-- Two things to know before reading anything it produces as evidence:
--
--   * This runs as `postgres`, which owns the tables and bypasses row level
--     security. It proves the constraints and the foreign keys hold. It proves
--     nothing whatever about the policies. Those are checked by setting claims
--     as `authenticated`, not by whether seed rows appear.
--
--   * Every analysis here is `failed`. Nothing has ever parsed a repository, and
--     a `succeeded` row would be a fabricated claim in the one column this phase
--     exists to get right. A dashboard of seeded rows should say so.

insert into public.organizations (id) values
  ('org_3KhBH8l1wzw0OmtdgOKfDshc7FO'),
  ('org_3KedVdzMHfdeEaWZOgHmKXtOq5A')
on conflict (id) do nothing;

-- The repositories are real public repositories, because a dashboard of
-- placeholders teaches nothing about what the list looks like. They have not
-- been fetched, which is what the failed analyses below say.
insert into public.projects (id, organization_id, name, url, created_at) values
  ('11111111-1111-4111-8111-111111111101', 'org_3KhBH8l1wzw0OmtdgOKfDshc7FO',
   'vercel/next.js', 'https://github.com/vercel/next.js', '2026-09-02T09:14:00Z'),
  ('11111111-1111-4111-8111-111111111102', 'org_3KhBH8l1wzw0OmtdgOKfDshc7FO',
   'facebook/react', 'https://github.com/facebook/react', '2026-09-19T16:41:00Z'),
  ('33333333-3333-4333-8333-333333333301', 'org_3KedVdzMHfdeEaWZOgHmKXtOq5A',
   'withastro/astro', 'https://github.com/withastro/astro', '2026-08-28T11:02:00Z'),
  ('33333333-3333-4333-8333-333333333302', 'org_3KedVdzMHfdeEaWZOgHmKXtOq5A',
   'sveltejs/svelte', 'https://github.com/sveltejs/svelte', '2026-10-06T08:25:00Z')
on conflict (id) do nothing;

insert into public.analyses
  (id, organization_id, project_id, status, error_detail, created_at)
values
  ('22222222-2222-4222-8222-222222222201', 'org_3KhBH8l1wzw0OmtdgOKfDshc7FO',
   '11111111-1111-4111-8111-111111111101',
   'failed', 'Seeded row. No parse was run for this analysis.', '2026-09-02T09:14:00Z'),
  ('22222222-2222-4222-8222-222222222202', 'org_3KhBH8l1wzw0OmtdgOKfDshc7FO',
   '11111111-1111-4111-8111-111111111102',
   'failed', 'Seeded row. No parse was run for this analysis.', '2026-09-19T16:41:00Z'),
  ('44444444-4444-4444-8444-444444444401', 'org_3KedVdzMHfdeEaWZOgHmKXtOq5A',
   '33333333-3333-4333-8333-333333333301',
   'failed', 'Seeded row. No parse was run for this analysis.', '2026-08-28T11:02:00Z'),
  ('44444444-4444-4444-8444-444444444402', 'org_3KedVdzMHfdeEaWZOgHmKXtOq5A',
   '33333333-3333-4333-8333-333333333302',
   'failed', 'Seeded row. No parse was run for this analysis.', '2026-10-06T08:25:00Z')
on conflict (id) do nothing;