# Phase 9 — CommonJS, Express and Python imports

**Goal.** Codebases that resolve dependencies at load time with `require()`, and
codebases written in Python, stop drawing empty graphs.

## Build

- Collecting `require()` calls with a literal string argument, resolving them the
  same way imports are resolved, and reading the names a CommonJS module exports.
- Collecting Python imports — `import a`, `import a.b`, `from a import x`, and
  the relative forms `from . import x` / `from ..pkg import y` — and resolving
  each against Python's rules: a dotted name is a package when a directory of
  that name holds an `__init__.py`, a module when a matching `.py` file exists,
  and a namespace package when the directory exists without one.
- Relative imports resolve against the importing file's package, counting the
  leading dots as levels to climb, and are reported unresolved with a reason when
  they climb past the repository root.
- The Python graph and the TypeScript graph share the resolver's output types and
  the coverage record. Neither frontend reads the other's syntax.
- An Express adapter — roles from directory convention, accepting both singular
  and plural folder names, because real repositories use both.

## Constraints

- This touches the parser core, which nothing else in the build does. **Nothing
  from phases 1–8 changes behaviour.** Parsing a TypeScript repository before and
  after this phase yields a byte-identical edge list for the files it had, and a
  Python repository keeps the roles and routes it gained in phase 8.
- The contract holds for both new module systems at once: the TypeScript edge
  list is byte-identical before and after `require()` support, and before and
  after Python support.
- A file that mixes `require()` and `import` reports both, without duplicates.
- Coverage gains a real denominator for CommonJS and Python, and every unresolved
  import carries a reason in that language's terms — module not found, relative
  import beyond the top-level package, excluded directory — never a bare count.
- Express routes are **not** extracted. They're assembled at runtime from
  routers, variables and middleware chains, and the route rule says exact or
  absent. An Express repository gets roles and an empty route table.
- Python roles and routes are **not** re-derived here. They belong to the adapter
  phase; this phase adds edges only.

## Acceptance check

1. Analyse an Express repository that previously drew nothing. It now draws a
   real graph with a believable number of edges.
2. Analyse a Django or FastAPI repository that previously drew roles and routes
   but no edges. It now draws a real import graph, and its route table is
   unchanged from phase 8.
3. Take a Python file using a relative import: confirm the resolved edge points
   at the file the interpreter would import. Take one that climbs out of the
   repository: confirm it is reported unresolved, with a reason.
4. That same Express repository previously reported **100% coverage** — because
   it resolved 100% of the zero imports it knew how to look for. Confirm coverage
   now reports a real denominator.
5. Parse a TypeScript repository analysed before this change. The edge list is
   byte-identical.

## Not in this phase

Express route extraction. Python frameworks beyond roles and routes. Any other
module system.
