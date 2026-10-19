import "server-only";

/**
 * The one model this build explains with. The name is stored beside every
 * answer, so a cache entry is only reused when the content hash and this name
 * both match. `openrouter/free` is a router, not a snapshot: the underlying
 * model can change between runs, so an unchanged name is not by itself proof
 * the answer came from the same weights.
 */
export const EXPLANATION_MODEL = "openrouter/free";

/**
 * Enough of a file to explain it without turning a generated provider file into
 * the whole context window. The head and tail are kept, because generated files
 * tend to put their shape at one end and their exports at the other.
 */
export const MAX_SOURCE_CHARS = 16_000;

/**
 * The only roles classification may answer with. Page, route and controller are
 * deliberately absent: routing is convention's job and decides the route table
 * and entry-point colouring, so a model must never be able to relabel it.
 */
export const CLASSIFIABLE_ROLES = [
  "service",
  "repository",
  "model",
  "util",
  "config",
  "component",
  "hook",
] as const;

export type ClassifiableRole = (typeof CLASSIFIABLE_ROLES)[number];

const TRACING_KEYS = ["LANGSMITH_API_KEY", "LANGCHAIN_API_KEY"] as const;

function keyOf(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Tracing is on when a key exists. The explicit flag can turn it off, but its
 * absence does not turn a configured key into silence: an API key that produces
 * no traces is the exact state the project doc calls indistinguishable from a
 * broken cache.
 */
export function tracingConfigured(): boolean {
  const key = keyOf(TRACING_KEYS);
  if (key === null) return false;
  const flag = process.env.LANGSMITH_TRACING ?? process.env.LANGCHAIN_TRACING_V2;
  return flag !== "false" && flag !== "0";
}

/**
 * LangSmith reads its environment when a trace starts. Normalising it here means
 * a key is enough to make tracing work, and the project has a stable name to
 * find in the dashboard.
 */
export function ensureTracingEnv(): void {
  if (!tracingConfigured()) return;
  if (process.env.LANGSMITH_TRACING === undefined && process.env.LANGCHAIN_TRACING_V2 === undefined) {
    process.env.LANGSMITH_TRACING = "true";
  }
  if (!process.env.LANGSMITH_PROJECT?.trim()) {
    process.env.LANGSMITH_PROJECT = "anatomy";
  }
}

export function openRouterApiKey(): string | null {
  return keyOf(["OPENROUTER_API_KEY"]);
}

// Set the tracing environment at import, before any LangSmith module can read
// it. Importing the configuration is enough to make a key behave like tracing.
ensureTracingEnv();
