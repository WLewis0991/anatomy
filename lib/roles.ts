import type { FileRole } from "../parser/types.ts";

/** The fixed order roles are listed in. Never sorted by count. */
export const ROLE_ORDER: readonly FileRole[] = [
  "page",
  "layout",
  "route-handler",
  "middleware",
  "action-module",
  "component",
  "hook",
  "config",
  "style",
  "asset",
  "docs",
  "unclassified",
] as const;

export function roleLabel(role: FileRole): string {
  switch (role) {
    case "page":
      return "page";
    case "layout":
      return "layout";
    case "route-handler":
      return "route handler";
    case "middleware":
      return "middleware";
    case "action-module":
      return "action module";
    case "component":
      return "component";
    case "hook":
      return "hook";
    case "config":
      return "config";
    case "style":
      return "style";
    case "asset":
      return "asset";
    case "docs":
      return "docs";
    case "unclassified":
      return "unclassified";
  }
}

/**
 * The roles a framework convention can prove. A zero count for one of these is
 * information in a Next repository ("there is no middleware"), which is why they
 * stay visible there and other zero rows do not.
 */
export const STRUCTURAL_ROLES: ReadonlySet<FileRole> = new Set([
  "page",
  "layout",
  "route-handler",
  "middleware",
  "action-module",
]);

export type FilterFacet = "role" | "kind";

/**
 * One filter at a time. The facet and the value are separate so a role and a
 * file-type row with the same spelling can never be confused.
 */
export interface MapFilter {
  facet: FilterFacet;
  value: string;
}
