/**
 * The rail's taxonomy: what categories exist per framework, what they are
 * called, and the order they read in.
 *
 * This file holds data only — no parser, no filesystem, no adapter. A browser
 * component imports it to label and order the rail without dragging a parser
 * into the bundle, which is the whole reason it sits apart from the adapters.
 *
 * The keys here are the role strings the adapters assign and the files table
 * stores. They are matched by name across the parser/browser boundary, so the
 * adapter role literals and these keys must stay the same strings.
 *
 * Order is reading order and it is fixed: the routable surfaces first, then the
 * layers behind them, then plumbing. A framework's categories are listed whole,
 * zero-count included, so the rail always reads as the shape of that framework
 * rather than as whatever happened to be non-empty.
 *
 * A category's colour says which band it belongs to, never which category it
 * is: three hues for three depths, no matter how many categories sit in them.
 * The generic fallback has no framework taxonomy, so it colours by language
 * kind instead — the one place a swatch is a legend in its own right.
 */

/** The three depths a category can sit at. Rail order is this order. */
export type Band = "surface" | "layer" | "plumbing";

/** Reading order of the bands, and the label each section reads under. */
export const BANDS: readonly { band: Band; label: string }[] = [
  { band: "surface", label: "surfaces" },
  { band: "layer", label: "layers" },
  { band: "plumbing", label: "plumbing" },
];

export interface RoleCategory {
  /** The role string the adapter assigns and the database stores. */
  key: string;
  /** The concrete name a developer reads. Never an abstraction like "Handlers". */
  label: string;
  /**
   * Which band the category sits in. Present on a framework's taxonomy, where
   * the rail groups into sections and colour marks the depth. Absent on the
   * generic taxonomy, which is flat and kind-coloured.
   */
  band?: Band;
  /**
   * A generic category's swatch, from its language kind. Framework categories
   * derive theirs from `band` instead, so a colour is never stated twice.
   */
  swatch?: string;
}

/**
 * Colour for a band, as a depth ramp on the accent: a routable surface is the
 * full accent, a layer behind it fades, plumbing is the neutral strong line.
 * Deliberately not the language-kind hues — a rail dot must not look like it
 * predicts a node colour it has nothing to do with.
 */
const BAND_SWATCH: Record<Band, string> = {
  surface: "bg-accent",
  layer: "bg-accent/50",
  plumbing: "bg-line-strong",
};

/** A category's swatch, whether it stated one or derives it from its band. */
export function swatchOf(category: RoleCategory): string {
  if (category.swatch !== undefined) return category.swatch;
  if (category.band !== undefined) return BAND_SWATCH[category.band];
  return "bg-line";
}

/** Whether a taxonomy groups into bands, or is the flat generic list. */
export function isBanded(categories: readonly RoleCategory[]): boolean {
  return categories.some((category) => category.band !== undefined);
}

const GENERIC_CATEGORIES: RoleCategory[] = [
  { key: "typescript", label: "typescript", swatch: "bg-kind-typescript" },
  { key: "javascript", label: "javascript", swatch: "bg-kind-javascript" },
  { key: "python", label: "python", swatch: "bg-kind-other" },
  { key: "style", label: "style", swatch: "bg-kind-style" },
  { key: "json", label: "json", swatch: "bg-kind-json" },
  { key: "markdown", label: "markdown", swatch: "bg-kind-other" },
  { key: "config", label: "config", swatch: "bg-kind-other" },
  { key: "asset", label: "asset", swatch: "bg-kind-other" },
  { key: "other", label: "Unclassified", swatch: "bg-kind-other" },
];

export const FRAMEWORK_CATEGORIES: Record<string, RoleCategory[]> = {
  nextjs: [
    { key: "page", label: "Page routes", band: "surface" },
    { key: "layout", label: "Layouts", band: "surface" },
    { key: "api", label: "API endpoints", band: "surface" },
    { key: "server-action", label: "Server actions", band: "surface" },
    { key: "component", label: "Components", band: "layer" },
    { key: "hook", label: "Hooks", band: "layer" },
    { key: "middleware", label: "Middleware", band: "plumbing" },
    { key: "other", label: "Unclassified", band: "plumbing" },
  ],
  nestjs: [
    { key: "controller", label: "Controllers", band: "surface" },
    { key: "service", label: "Services", band: "layer" },
    { key: "module", label: "Modules", band: "layer" },
    { key: "entity", label: "Entities", band: "layer" },
    { key: "other", label: "Unclassified", band: "plumbing" },
  ],
  react: [
    { key: "component", label: "Components", band: "layer" },
    { key: "hook", label: "Hooks", band: "layer" },
    { key: "context", label: "Contexts", band: "layer" },
    { key: "other", label: "Unclassified", band: "plumbing" },
  ],
  express: [
    { key: "route", label: "Routes", band: "surface" },
    { key: "controller", label: "Controllers", band: "surface" },
    { key: "service", label: "Services", band: "layer" },
    { key: "model", label: "Models", band: "layer" },
    { key: "schema", label: "Schemas", band: "layer" },
    { key: "middleware", label: "Middleware", band: "plumbing" },
    { key: "other", label: "Unclassified", band: "plumbing" },
  ],
  django: [
    { key: "urls", label: "URL configs", band: "surface" },
    { key: "views", label: "Views", band: "surface" },
    { key: "models", label: "Models", band: "layer" },
    { key: "serializers", label: "Serializers", band: "layer" },
    { key: "admin", label: "Admin", band: "layer" },
    { key: "other", label: "Unclassified", band: "plumbing" },
  ],
  fastapi: [
    { key: "router", label: "Routers", band: "surface" },
    { key: "endpoint", label: "Endpoints", band: "surface" },
    { key: "schema", label: "Schemas", band: "layer" },
    { key: "dependency", label: "Dependencies", band: "layer" },
    { key: "other", label: "Unclassified", band: "plumbing" },
  ],
  flask: [
    { key: "blueprint", label: "Blueprints", band: "surface" },
    { key: "route", label: "Routes", band: "surface" },
    { key: "other", label: "Unclassified", band: "plumbing" },
  ],
  generic: GENERIC_CATEGORIES,
  "no-framework": GENERIC_CATEGORIES,
};

/** The role a file takes when the adapter has nothing more specific to say. */
export const GENERIC_ROLE = "other";

/** The ordered categories for an adapter, falling back to the generic taxonomy. */
export function categoriesFor(adapter: string): RoleCategory[] {
  return FRAMEWORK_CATEGORIES[adapter] ?? GENERIC_CATEGORIES;
}

/** How many files fall in each role. */
export function countByRole(roles: Iterable<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const role of roles) counts[role] = (counts[role] ?? 0) + 1;
  return counts;
}

export function labelForRole(adapter: string, role: string): string {
  const category = categoriesFor(adapter).find((entry) => entry.key === role);
  return category?.label ?? role;
}
