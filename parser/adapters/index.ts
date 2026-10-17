import type { FrameworkAdapter } from "../adapter.ts";
import type { FileSymbols } from "../language/types.ts";
import { urlconfAdapter } from "./urlconf.ts";
import { fastapiAdapter } from "./routers.ts";
import { flaskAdapter } from "./routes.ts";
import { pageAdapter } from "./page.ts";
import { nestjsAdapter } from "./nest.ts";
import { reactAdapter } from "./react.ts";
import { fallbackAdapter } from "../adapter.ts";

const TYPESCRIPT_ADAPTERS: readonly FrameworkAdapter[] = [
  pageAdapter,
  nestjsAdapter,
  reactAdapter,
];

const PYTHON_ADAPTERS: readonly FrameworkAdapter[] = [
  urlconfAdapter,
  fastapiAdapter,
  flaskAdapter,
];

/** Detect the framework for a repository, language considered first. */
export function detectAdapter(
  symbols: ReadonlyMap<string, FileSymbols>,
  language: "typescript" | "python",
): FrameworkAdapter {
  const candidates =
    language === "python" ? PYTHON_ADAPTERS : TYPESCRIPT_ADAPTERS;
  for (const adapter of candidates) {
    if (adapter.detect(symbols)) return adapter;
  }
  return fallbackAdapter(language);
}

export {
  urlconfAdapter,
  fastapiAdapter,
  flaskAdapter,
  pageAdapter,
  nestjsAdapter,
  reactAdapter,
  fallbackAdapter,
};
