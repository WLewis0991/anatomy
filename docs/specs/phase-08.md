# Phase 8 — Framework adapters, in more than one language

**Goal.** The application recognises what kind of codebase it's looking at,
whether it's written in TypeScript, JavaScript or Python.

## Build

- A **language frontend** as a named concept: a set of file extensions, a walker,
  and a syntax reader that yields files and their symbols — decorators, function
  and class definitions, and the literal string arguments inside calls.
  TypeScript and JavaScript share one frontend; Python is a second.
- The Python frontend reads structure for roles and routes only. It does not
  resolve imports; the module graph is the next phase.
- File selection gains Python: `.py` files are walked, `__init__.py` marks a
  package, and a directory without one is a namespace package.
- Python entry points for seeding the walk: `manage.py`, `main.py`, `app.py`,
  `wsgi.py`, `asgi.py`, and the `project.scripts` / `tool.poetry.scripts` tables
  in `pyproject.toml`. When neither is found, the walk keeps whole directories,
  the same fallback phase 3 already uses.
- An adapter for Next.js — roles from path conventions, and routes derived from
  those same paths.
- An adapter for NestJS — roles from filename suffixes, and routes assembled from
  decorators on the controller and the method together.
- An adapter for React, which is nearly free once Next.js exists.
- An adapter for Django — roles from module convention (`urls.py`, `views.py`,
  `models.py`, `serializers.py`, `admin.py`), and routes from `path()` calls whose
  pattern is a literal. A `re_path()` is absent. An `include()` prefix is joined
  only when the included module and the prefix are both literal strings and the
  included module is found by literal dotted-name lookup.
- An adapter for FastAPI — roles from router and filename convention, and routes
  assembled from the HTTP-method decorator on the handler (`@app.get`,
  `@router.post`) when its path is a string literal, with an `include_router()`
  prefix joined under the same literal-only rule.
- An adapter for Flask — roles from blueprint and filename convention, and routes
  from `@app.route()` / `@bp.route()` when the path is a string literal and the
  methods list, if present, is literal.
- Extracted routes, stored and shown as a table.
- The left rail reshaping itself per framework: a NestJS repository shows
  Controllers, Services, Modules, Entities. A Next.js one shows Page routes, API
  endpoints, Server actions. A Django one shows URL configs, Views, Models,
  Serializers. A FastAPI one shows Routers, Endpoints, Schemas, Dependencies.

## Constraints

- **Nothing from phases 1–7 changes behaviour.** Everything here is additive. A
  TypeScript or JavaScript repository parsed after this phase yields the same
  files, edges and coverage it did before, for the files it had; newly selected
  Python files are additions. The existing frontend is named, not edited.
- **Routes are exact or absent.** Emit a route only when the pattern, and the
  method where the framework binds one, are recoverable from the parsed syntax
  with no inference. A Django `re_path()` with a regex pattern emits nothing. A
  FastAPI or Flask path assembled from an f-string, a concatenation or a variable
  emits nothing. A wrong route pattern is the same failure as an invented edge.
- **An unbound method is recorded, not guessed.** Django binds no HTTP method to
  a URL pattern; the method is dispatched in the view. The routes table gains an
  optional method — an additive migration — and such a row renders as `ANY`.
  TypeScript and JavaScript routes always carry a method, so their rows are
  unchanged.
- **A language frontend is not a framework.** The Python frontend knows how
  Python is written — decorators, definitions, `__init__.py`. It does not know
  the word `django`. Recognising a framework is the adapter's job, and adapters
  sit apart from frontends.
- **The literal include join is not the import graph.** It resolves a literal
  dotted name to a file by name, shares the same "unresolved, with reason"
  vocabulary, and never guesses. It reads no imports.
- **Python's structural exclusions are named, not discovered.** `.venv`, `venv`,
  `__pycache__`, `.tox`, `.mypy_cache`, `.pytest_cache`, `build`, `dist`,
  `*.egg-info` and any `site-packages` are excluded from the walk and reported in
  coverage as excluded, like every other deliberate exclusion. `.pyi` stubs are
  excluded in this phase.
- Detection runs in a fixed order and the first match wins, language considered
  before framework. A repository matching nothing still renders, with generic
  roles and an empty route table.
- The rail taxonomy lives apart from the adapters themselves, so a browser
  component can read the list of category names without pulling a parser and a
  filesystem library into the bundle.
- Category names are the concrete role names, not abstractions. Someone reading
  a Django repository wants "Views 12", never "Handlers 12".
- Rail order is reading order and it stays fixed — routable surfaces first, then
  the layers behind them, then plumbing.
- **A Python repository read here produces roles and routes and an empty graph**,
  exactly as a `require()`-only repository does today. That gap closes next.

## Acceptance check

1. Analyse a Next.js repository: the rail says Page routes, API endpoints,
   Server actions, and the counts are right.
2. Analyse a NestJS repository: the rail says Controllers, Services, Modules,
   and the route table shows methods and full patterns.
3. Re-parse a repository that was analysed before this phase and contains no
   Python files. Files, edges and coverage are byte-identical. For a repository
   that does contain Python files, every TypeScript and JavaScript node, edge and
   coverage record is unchanged; the Python files are additions.
4. Analyse a Django repository: the rail says URL configs, Views, Models,
   Serializers, and the route table shows literal patterns with `ANY` where
   Django binds no method. A `re_path()` endpoint is absent.
5. Analyse a FastAPI repository: routes come from decorators, an endpoint whose
   path was an f-string is absent, and an `include_router()` prefix is joined only
   where both literals were available.
6. Open three routes from a Python table and confirm by hand that the pattern,
   and the method where one is bound, match the code exactly.
7. Analyse something that matches no adapter — it renders, roles are generic, the
   route table is empty rather than wrong.
8. Search the parser core for the words "nextjs" and "django". Each appears in
   its adapter and nowhere else.

## Not in this phase

AI classification of the files no adapter matched. They stay generic for now.
The Python import graph. Express. `require()`.
