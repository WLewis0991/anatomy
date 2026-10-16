import "server-only";

import { createSupabaseClient } from "@/lib/supabase";

/**
 * A list read, so it is bounded and named. The dashboard is the only caller and
 * a repository with more runs than this is not a dashboard problem.
 */
const LIST_LIMIT = 50;

/**
 * The stages a run passes through before it ends. A row still sitting in one of
 * these has not finished, and — because there is no queue and no timeout — it may
 * never finish. Ageing is the only signal that separates a working run from an
 * abandoned one.
 */
const UNFINISHED_STAGES = new Set([
  "pending",
  "fetching",
  "selecting",
  "parsing",
  "storing",
]);

/**
 * How old an unfinished run gets before it reads stale. Long enough that a large
 * repository still parsing is not libelled, short enough that an abandoned row is
 * not mistaken for work in progress.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;

export interface AnalysisListItem {
  id: string;
  /** `owner/repo`, as it was normalised onto the project. */
  repository: string;
  /** The repository address as it was given, kept for the title attribute. */
  url: string;
  status: string;
  /** The stage the run is in, or ended in. */
  stage: string;
  /** True when the run has not finished and is old enough to be presumed dead. */
  stale: boolean;
  /** Why a run stopped, if it stopped. Null on every row that is not a failure. */
  errorDetail: string | null;
  /** ISO 8601. Rendered relative, with the absolute value in the title attribute. */
  createdAt: string;
}

export interface AnalysisListResult {
  rows: AnalysisListItem[];
  error: string | null;
}

/**
 * The analyses the signed-in session's organization is allowed to see.
 *
 * There is no `.eq("organization_id", ...)` anywhere in this file, and adding
 * one is the bug this project is built to avoid: the row-level security policy
 * is the authorization layer, so a query that needed a `where` clause to return
 * the right rows would be hiding a policy that does not hold. If another
 * organization's rows ever appear here, the fix is in the migration.
 *
 * Nothing is cached. `cacheComponents` is on, and a cached result survives an
 * organization switch — which would serve the previous organization's rows to
 * whoever switched into this one.
 */
export async function listAnalyses(): Promise<AnalysisListResult> {
  const supabase = createSupabaseClient();

  const { data: analyses, error: analysesError } = await supabase
    .from("analyses")
    .select("id, status, stage, error_detail, created_at, project_id")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (analysesError) {
    return { rows: [], error: analysesError.message };
  }

  if (analyses.length === 0) {
    return { rows: [], error: null };
  }

  const projectIds = [...new Set(analyses.map((analysis) => analysis.project_id))];

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, name, url")
    .in("id", projectIds);

  if (projectsError) {
    return { rows: [], error: projectsError.message };
  }

  const projectsById = new Map(projects.map((project) => [project.id, project]));

  const now = Date.now();
  const rows: AnalysisListItem[] = [];

  for (const analysis of analyses) {
    const project = projectsById.get(analysis.project_id);

    // The project's own policy removed every project belonging to another
    // organization, and the composite foreign key means an analysis's project is
    // always in this organization. So a project that is not here means something
    // is wrong that cannot be rendered. Say so rather than quietly showing a
    // shorter list than the query returned.
    if (!project) {
      return {
        rows: [],
        error: `Analysis ${analysis.id} has no project this session is allowed to see.`,
      };
    }

    rows.push({
      id: analysis.id,
      repository: project.name,
      url: project.url,
      status: analysis.status,
      stage: analysis.stage,
      stale:
        UNFINISHED_STAGES.has(analysis.stage) &&
        now - new Date(analysis.created_at).getTime() > STALE_AFTER_MS,
      errorDetail: analysis.error_detail,
      createdAt: analysis.created_at,
    });
  }

  return { rows, error: null };
}