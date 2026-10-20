# Phase 11 — Categories that say what a file is

**Goal.** The left rail stops grouping by language and groups by role, with every
file accounted for.

## Build

- **A role per file**, single-valued, so counts add up and a filter dims exactly
  one set. The role is decided where the evidence is:
  - Framework convention, in an adapter. A Next adapter is chosen when a
    `next.config` or an `app`/`src/app` tree exists; nothing else claims the
    repository.
  - Syntax, for a component or a hook. A component is an exported function
    that returns JSX. A hook is an exported function whose name begins `use`
    followed by an uppercase letter or digit.
  - An honest `unclassified` when neither proves anything.
- **The vocabulary, in fixed order:** page, layout, route handler, middleware,
  action module, component, hook, config, style, asset, docs, unclassified.
  - **layout** covers the route-segment files: layout, template, default,
    loading, error, global-error and not-found. The pane names the exact one.
  - **route handler** covers an app-router route file and a pages-router API
    file. It counts files, not HTTP methods.
  - **middleware** covers a root or `src` proxy or middleware file. Next 16
    renamed the convention to proxy; both are middleware.
  - **action module** covers a file whose first statement is the module-level
    `"use server"` directive. It counts modules, not actions.
  - **config** covers a framework config, a TypeScript config and the usual
    tool configs.
- **A page that also exports inline server actions stays a page.** The actions
  are a capability the pane reports, never a second rail row.
- **Precedence, highest first:** route handler, middleware, page, layout, action
  module, component, hook, config, style, asset, docs, unclassified.
- **The adapter sees the source.** Detection of a directive, JSX or a hook
  export is syntax, not a string search, and every file is parsed once. The
  source already read by the walk is handed to the adapter, and the syntax tree
  the import extractor built is reused rather than rebuilt.
- **Persist what the parse found:** role, kind, reach, and the count of inline
  server actions on a page. New runs write a role for every file. The analysis
  records which role schema it was stored with.
- **Old analyses are not guessed.** A file stored before this phase has no role.
  That is different from a file this phase could not classify. The rail and the
  pane say roles are unavailable and offer re-analysis; they never turn a
  missing role into an `unclassified` count.
- **The left rail has two facets.** Role is primary and always visible. File
  type is secondary and collapsed. Exactly one facet is active at a time; the
  active one is forced open. Choosing a row in one facet clears the other.
- **Clicking dims, never removes.** Clicking the active row clears the filter.
  Each folder panel's match count uses the same set as the rail's count, so the
  numbers agree. A closed folder's direct matches count, as they do today.
- **Role rows carry a label and a count, no colour.** The map keeps its
  existing file-type colours. Counts are tabular and right-aligned.
- **Zero rows are disabled.** A zero-count structural row is shown only when a
  Next adapter ran, because "no middleware" is information there. `unclassified`
  is always shown, even at zero. Zero rows are out of the tab order and do not
  respond to a click.
- **The detail pane separates the convention role from the AI label.** A page
  that hosts inline server actions names how many. The AI label keeps its own
  line.
- **Reach is fixed where it is written.** A root proxy is framework-reached; a
  page, layout, route or other route-segment file is framework-reached only
  inside the app tree; an action module is reached by import like any other
  module. Phase 6's "nothing imports this" list must not report framework
  files as unused.

## Constraints

- The parser stays standalone. It imports no Next, React or database code.
  Framework knowledge lives in the adapter, never in a branch in the walker.
- **Never invent a role.** If convention or syntax cannot prove it, it is
  `unclassified`. A role is not a review score and carries no severity.
- **One set drives every count.** The rail count, the dimmed map and each
  panel's match count are derived from one role-to-path set. Null roles are
  excluded from every set, never coerced.
- `file_roles` stays what it is: the AI or human label, a different axis, shown
  in the pane. The rail does not read it.
- A failed role decision must not fail the parse. `unclassified` is a valid
  outcome and is written.
- The migration is idempotent, verifies RLS is still enabled on every table, and
  the generated database types are regenerated from the project, not hand-edited.
- A rerun resets the role schema version before it stores new files, so a failed
  run cannot leave a row claiming roles it does not have.
- No new package. No test runner or browser driver is installed for this.

## Acceptance check

1. Analyse a Next repository containing a page, a layout, an app route handler,
   a root proxy, a module-level action module, an exported component, an
   exported hook, a config file, a stylesheet, an image, a README and a plain
   utility. The rail shows role rows, no language rows, and the role counts add
   up to the number of files.
2. Each of those files lands in the bucket named above. The plain utility is
   `unclassified`, not guessed into `component` or `logic`.
3. The page that also exports inline server actions stays `page`; its pane says
   how many actions it hosts. The root proxy is `middleware`. The route handler
   is one row even when it exports several methods.
4. Click a role row: only its files stay at full strength, everything else
   dims but remains, every open panel's match count adds up to the rail count,
   and a second click clears it. No network request is made.
5. Expand file type: it lists every file, its counts add up, and choosing a type
   clears the active role. The active facet cannot be collapsed out of sight.
6. Open an analysis stored before this phase: the role section says roles are
   unavailable and offers re-analysis. It shows no `unclassified` count and no
   guessed role. The map and the file-type facet still work.
7. A repository with no Next config and no app tree still renders: the fallback
   roles apply, the file-type facet is complete, and roles that cannot be
   proven are `unclassified`.
8. Types, lint and build pass.

## Not in this phase

Tests, services, repositories and models as rail roles; AI-written roles in the
rail; backfilling old analyses; route tables; per-method endpoint counting.
