# Anatomy

Sign in, paste a public GitHub repository URL, and get it drawn as a dependency
map: folders as boxes, imports as lines between them. Open a folder into its
files, select a file to see what it imports, what imports it, and what breaks
two levels out if it changes — and ask for an explanation written from that file
and its real neighbours.

Every box and every line comes from really parsing the code. The AI explains
what the parser found; it never decides what's there.

- **What it is and why** — [docs/project-doc.md](docs/project-doc.md)
- **How we build it** — [AGENTS.md](AGENTS.md)
- **Phase specs** — [docs/specs/](docs/specs/)

## Features

- **A real parse, not a model's guess.** `ts-morph` extracts imports,
  re-exports, dynamic imports and `require()` calls; Python imports are read
  too. An edge exists only where an import resolved to a real file. Unresolved
  imports are reported with a reason, never guessed.
- **Framework adapters.** Next.js pages/app routes, Nest, React, Express,
  Django URLs, FastAPI and Flask route tables are recognised in adapters, so
  framework knowledge never leaks into the parser.
- **The map.** Folders fold into readable boxes and open into files (React Flow
  + dagre), with selection, direction-coloured edges, a role/kind rail that
  filters, fan-in/fan-out, blast radius and dependency chains as pure
  arithmetic over the edge list.
- **Coverage you can trust.** Every run reports files found, parsed and
  skipped — and why the rest weren't.
- **Live progress.** Parsing runs in stages (`fetching → parsing → storing`)
  with progress streamed over Supabase Realtime.
- **Cached, traced explanations.** Each explanation is stored against a content
  hash and the model name; every AI call runs through one wrapped client
  traced with LangSmith, with the cache read inside the trace — a cache hit
  shows up as a run containing no model call. Stale answers (repository moved
  since the analysis) are flagged instead of refreshed silently.
- **File roles.** Every file gets one role — page, layout, route handler,
  middleware, action module, component, hook, config, and so on — decided by
  adapter convention or syntax, with an honest `unclassified` when neither
  proves anything.
- **Organizations.** Analyses belong to an org; what you can see follows from
  which one you're in, enforced by Postgres row-level security reading the
  org claim off the session token — not by application `where` clauses.

## Stack

| Layer | |
| --- | --- |
| App | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind v4 |
| Parser | ts-morph, standalone — no Next, React or DB imports |
| Map | React Flow, dagre |
| Auth / orgs | Clerk (deny-by-default middleware in `proxy.ts`) |
| Data | Supabase Postgres, RLS on every table, Realtime for progress |
| AI | OpenAI SDK pointed at OpenRouter, LangSmith tracing, one client in `lib/ai/client.ts` |
| Tooling | pnpm, Node ≥ 22.6, ESLint 9 |

## Getting started

### Prerequisites

- Node 22.6+ and pnpm
- A [Clerk](https://clerk.com) application with **Organizations** enabled
- A [Supabase](https://supabase.com) project
- An [OpenRouter](https://openrouter.ai) API key (optional — the map works
  without it; explanations and role labels won't)
- A [LangSmith](https://langsmith.langchain.com) API key (optional — enables
  tracing)

### 1. Install

```bash
pnpm install
```

### 2. Environment

Create `.env.local`:

```bash
# Required — the server refuses to boot without these
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# Clerk route configuration
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/analyses
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/analyses

# Optional — AI explanations and file roles
OPENROUTER_API_KEY=sk-or-...

# Optional — tracing
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=anatomy
```

### 3. Database

Apply every migration in [`supabase/migrations/`](supabase/migrations) to your
Supabase project, in filename order. Row-level security is enabled inside the
migrations themselves — a table without a policy returns nothing, which is the
intended failure mode.

Optionally run [`supabase/seed.sql`](supabase/seed.sql) for fixture rows. Read
its header first: it runs as `postgres` and proves constraints, not policies,
and every seeded analysis is deliberately `failed`.

### 4. Run

```bash
pnpm dev
```

Open http://localhost:3000 — landing page at `/`, workspace at `/analyses`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Development server |
| `pnpm build` | Production build |
| `pnpm start` | Serve the production build |
| `pnpm lint` | ESLint |
| `pnpm parse <dir> [--out file]` | Run the parser standalone from a plain script and print its coverage report |
| `pnpm report:canvas [parse-output.json]` | Derive the canvas from a parse result and print the counts (defaults to `data/typeorm.json`) |

The parser runs with nothing else started — that is the layering check. If
`pnpm parse` needs the app running, something has gone wrong.

## Layout

```
parser/            Path in, data out. No Next, React or DB imports.
  adapters/        Framework knowledge (routes, pages) — never inside the parser
  language/        TypeScript and Python frontends
lib/graph/         Pure functions over a file list and an edge list
lib/ai/            The one AI client, explanations, roles — server only
lib/               Server code: pipeline, queries, env validation
app/               Routes: landing, /analyses, API handlers
components/        UI — the map, detail pane, rail, shell
supabase/          Migrations (RLS on by default) and seed
deep-agent/        Standalone agent experiment — not part of the app build
docs/project-doc.md  Every product decision and its reasoning
docs/specs/          One spec per phase
```

## Documentation

- [docs/project-doc.md](docs/project-doc.md) — what this is, why the parser is
  never allowed to guess, and what must be true before it ships
- [docs/specs/](docs/specs/) — phase-by-phase behaviour specs
- [AGENTS.md](AGENTS.md) — the rules the code is built under
