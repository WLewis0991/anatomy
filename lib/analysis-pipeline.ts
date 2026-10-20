import "server-only";

import { createSupabaseClient } from "@/lib/supabase";
import { fetchRepository, cleanupRepository, normalizeRepositoryUrl } from "@/lib/fetch-repository";
import { parseRepository } from "@/parser/parse-repository";
import type { ParseResult, Coverage } from "@/parser/types";
import type { Json } from "@/lib/database.types";
import { assignUnidentifiedRoles } from "@/lib/ai/roles";

export type AnalysisStage = "pending" | "fetching" | "parsing" | "storing" | "succeeded" | "failed";

/**
 * Runs the full analysis pipeline: fetch, parse, store.
 * Updates the analysis row's stage and message as it progresses.
 */
export async function runAnalysisPipeline(
  analysisId: string,
  repositoryUrl: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = createSupabaseClient();

  // Get the organization_id from the analysis row
  const { data: analysis } = await supabase
    .from("analyses")
    .select("organization_id")
    .eq("id", analysisId)
    .single();

  if (!analysis) {
    throw new Error("Analysis not found");
  }

  const organizationId = analysis.organization_id;

  const updateStage = async (stage: AnalysisStage, message: string): Promise<void> => {
    const { error } = await supabase
      .from("analyses")
      .update({ stage, stage_message: message })
      .eq("id", analysisId);
    if (error) {
      console.error(`Failed to update stage to ${stage}:`, error);
    }
  };

  try {
    // Clear whatever a previous run of this analysis stored, before this one
    // writes anything. A run is the whole description of the repository at one
    // commit, so the row must never hold two runs' answers at once: without
    // this, a re-run would insert a second set of files beside the first and
    // the map would draw both. Clearing first rather than last also means a run
    // that fails leaves the analysis empty and failed, rather than holding a
    // result that no longer describes anything.
    await resetForRun(supabase, analysisId);

    // Stage: fetching
    await updateStage("fetching", "Downloading repository archive...");
    const { root, headSha } = await fetchRepository(repositoryUrl);

    try {
      // Update head_sha. A write that failed here has to stop the run: a row
      // that records no commit cannot later tell whether the repository moved.
      const { error: headShaError } = await supabase
        .from("analyses")
        .update({ head_sha: headSha })
        .eq("id", analysisId);
      if (headShaError) {
        throw new Error(`Failed to record head SHA: ${headShaError.message}`);
      }

      // Stage: parsing
      await updateStage("parsing", "Parsing source files...");

      const parseResult = await parseRepository({ root });

      // Stage: storing
      await updateStage("storing", "Storing files and dependencies...");

      const stored = await storeAnalysisResult(supabase, analysisId, organizationId, parseResult);

      // The files, and the roles on them, are now stored. Only here is it true
      // that this run wrote a role for every file, so only here may the row say
      // it did. A run that fails earlier leaves the version at zero.
      const { error: roleVersionError } = await supabase
        .from("analyses")
        .update({ role_schema_version: 1 })
        .eq("id", analysisId);
      if (roleVersionError) {
        throw new Error(`Failed to record role schema version: ${roleVersionError.message}`);
      }

      const { error: adapterError } = await supabase
        .from("analyses")
        .update({ adapter: parseResult.adapter })
        .eq("id", analysisId);
      if (adapterError) {
        throw new Error(`Failed to record adapter: ${adapterError.message}`);
      }

      // Roles are an explanation of files convention could not name. They are
      // not part of the graph, so a missing key or a failed model call must not
      // fail a parse that otherwise produced a complete map. It is reported in
      // the pane as no role rather than quietly guessed at here.
      await assignUnidentifiedRoles({
        organizationId,
        analysisId,
        candidates: parseResult.files
          // Convention has already claimed every file it can prove. What is
          // left is `unclassified`, which is exactly what the AI label is for.
          .filter((file) => file.role === "unclassified")
          .flatMap((file) => {
            const id = stored.fileIdByPath.get(file.path);
            return id === undefined
              ? []
              : [{ fileId: id, path: file.path, hash: file.hash }];
          }),
      }).catch((error: unknown) => {
        console.error("Role assignment failed:", error);
      });

      // Success
      await updateStage("succeeded", "Analysis complete");
      const { error: successError } = await supabase
        .from("analyses")
        .update({ status: "succeeded", stage: "succeeded", stage_message: "Analysis complete" })
        .eq("id", analysisId);
      if (successError) {
        throw new Error(`Failed to record success: ${successError.message}`);
      }

      return { success: true };
    } finally {
      // Clean up temporary directory
      await cleanupRepository(root);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await updateStage("failed", message);
    // The run is already failing; if the failure cannot be written down either,
    // throw rather than return, so the caller never treats the row as settled
    // when it is still sitting mid-stage.
    const { error: failureError } = await supabase
      .from("analyses")
      .update({ status: "failed", stage: "failed", stage_message: message, error_detail: message })
      .eq("id", analysisId);
    if (failureError) {
      throw new Error(`Failed to record failure: ${failureError.message}`);
    }
    return { success: false, error: message };
  }
}

/**
 * Puts an analysis row back to the state a run starts from: no stored result,
 * and no verdict left over from the previous one.
 *
 * `files` is the parent of the edges, explanations and file roles that point at
 * it, and the schema already declares those cascade, so deleting the files is
 * what removes them. The tables that hang off the analysis itself — the routes
 * it recovered, the answers asked of it — have no parent to cascade from and
 * are deleted here. Every table the parse feeds is therefore emptied, which is
 * what lets the rest of this be an insert.
 *
 * Everything the previous run concluded goes too, including its status. A row
 * still reading `failed` while a fresh run was working would show that run as
 * already over, and an adapter or coverage figure left behind would name a
 * parse that no longer exists.
 *
 * This is re-run bookkeeping and nothing else: writing a result is
 * `storeAnalysisResult`, which only ever inserts.
 */
async function resetForRun(
  supabase: ReturnType<typeof createSupabaseClient>,
  analysisId: string,
): Promise<void> {
  for (const table of ["routes", "insights", "folder_explanations"] as const) {
    const { error } = await supabase.from(table).delete().eq("analysis_id", analysisId);
    if (error) {
      throw new Error(`Failed to clear ${table}: ${error.message}`);
    }
  }

  const { error: filesError } = await supabase
    .from("files")
    .delete()
    .eq("analysis_id", analysisId);
  if (filesError) {
    throw new Error(`Failed to clear files: ${filesError.message}`);
  }

  const { error: resetError } = await supabase
    .from("analyses")
    .update({
      coverage_json: null,
      adapter: null,
      head_sha: null,
      frontend: null,
      // A rerun stores new files before it may claim they carry roles.
      role_schema_version: 0,
      status: "pending",
      stage: "pending",
      stage_message: null,
      error_detail: null,
    })
    .eq("id", analysisId);
  if (resetError) {
    throw new Error(`Failed to reset the analysis: ${resetError.message}`);
  }
}

/**
 * Stores the parse result in the database.
 */
async function storeAnalysisResult(
  supabase: ReturnType<typeof createSupabaseClient>,
  analysisId: string,
  organizationId: string,
  result: ParseResult,
): Promise<{ fileIdByPath: Map<string, string> }> {
  // Insert files in batches. A large repository (thousands of files) makes a
  // single insert payload impractical and can exceed request limits.
  const fileInserts = result.files.map((file) => ({
    analysis_id: analysisId,
    organization_id: organizationId,
    path: file.path,
    hash: file.hash,
    kind: file.kind,
    reach: file.reach,
    role: file.role,
    server_action_count: file.serverActionCount,
    flags: file.flags,
  }));

  const insertedFiles: { id: string; path: string }[] = [];
  for (const batch of chunk(fileInserts, INSERT_BATCH_SIZE)) {
    const { data, error } = await supabase.from("files").insert(batch).select("id, path");
    if (error) {
      throw new Error(`Failed to insert files: ${error.message}`);
    }
    insertedFiles.push(...(data ?? []));
  }

  const fileIdByPath = new Map(insertedFiles.map((f) => [f.path, f.id]));

  // Insert edges in batches, after the files they reference.
  const edgeInserts = result.edges
    .map((edge) => {
      const fromFileId = fileIdByPath.get(edge.from);
      const toFileId = fileIdByPath.get(edge.to);
      if (!fromFileId || !toFileId) {
        // This should not happen if the parser resolved correctly
        return null;
      }
      return {
        analysis_id: analysisId,
        organization_id: organizationId,
        from_file_id: fromFileId,
        to_file_id: toFileId,
        kind: edge.kind,
        specifier: edge.specifier,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  for (const batch of chunk(edgeInserts, INSERT_BATCH_SIZE)) {
    const { error: edgesError } = await supabase.from("edges").insert(batch);
    if (edgesError) {
      throw new Error(`Failed to insert edges: ${edgesError.message}`);
    }
  }

  // Insert routes in batches, after the files they describe.
  const routeInserts = result.routes.map((route) => ({
    analysis_id: analysisId,
    organization_id: organizationId,
    method: route.method,
    path: route.path,
  }));

  for (const batch of chunk(routeInserts, INSERT_BATCH_SIZE)) {
    const { error: routesError } = await supabase.from("routes").insert(batch);
    if (routesError) {
      throw new Error(`Failed to insert routes: ${routesError.message}`);
    }
  }

  // Store coverage, and which language frontend and framework adapter
  // classified the run, together so the row is never half-described.
  const coverageJson = coverageToJson(result.coverage) as Json;
  const { error: coverageError } = await supabase
    .from("analyses")
    .update({
      coverage_json: coverageJson,
      adapter: result.adapter,
      frontend: result.frontend,
    })
    .eq("id", analysisId);

  if (coverageError) {
    throw new Error(`Failed to store coverage: ${coverageError.message}`);
  }

  return { fileIdByPath };
}

/** Rows per insert. Keeps a large repository within a sane request size. */
const INSERT_BATCH_SIZE = 500;

/** Splits a list into fixed-size batches. Returns no batches for an empty list. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Converts the Coverage object to a JSON-serializable form.
 * Omits the large arrays that are only useful for debugging.
 */
function coverageToJson(coverage: Coverage): object {
  return {
    filesFound: coverage.filesFound,
    filesParsed: coverage.filesParsed,
    filesSkipped: coverage.filesSkipped,
    importsSeen: coverage.importsSeen,
    edges: coverage.edges,
    internal: coverage.internal,
    external: coverage.external,
    excluded: coverage.excluded,
    excludedImportsCount: coverage.excludedImports.length,
    unresolved: coverage.unresolved,
    reexportsSeen: coverage.reexportsSeen,
    reexportsResolved: coverage.reexportsResolved,
    duplicateImports: coverage.duplicateImports,
    skipped: coverage.skipped,
    unresolvedImportsCount: coverage.unresolvedImports.length,
    unresolvedImportsByReason: groupByReason(coverage.unresolvedImports),
    ignoredDirectories: coverage.ignoredDirectories,
  };
}

function groupByReason(
  imports: readonly { reason: string }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const imp of imports) {
    counts[imp.reason] = (counts[imp.reason] ?? 0) + 1;
  }
  return counts;
}

/**
 * Checks if an analysis already exists for the given repository URL in the
 * current organization. Returns the analysis ID if found, null otherwise.
 */
export async function findExistingAnalysis(repositoryUrl: string): Promise<string | null> {
  const supabase = createSupabaseClient();
  const name = normalizeRepositoryUrl(repositoryUrl);

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("name", name)
    .single();

  if (projectError || !project) {
    return null;
  }

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .select("id")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (analysisError || !analysis) {
    return null;
  }

  return analysis.id;
}

/**
 * Creates a new project and analysis row, or returns the existing analysis.
 * Returns { analysisId, isNew }.
 */
export async function createOrGetAnalysis(
  repositoryUrl: string,
  organizationId: string,
): Promise<{ analysisId: string; isNew: boolean }> {
  const supabase = createSupabaseClient();
  const name = normalizeRepositoryUrl(repositoryUrl);

  // Try to find existing project. `maybeSingle` distinguishes "no such project"
  // from a query that failed: `.single()` reports both as an error and a null
  // row, which would send a genuine failure down the create path.
  const { data: existingProject, error: projectLookupError } = await supabase
    .from("projects")
    .select("id, organization_id")
    .eq("name", name)
    .maybeSingle();

  if (projectLookupError) {
    throw new Error(`Failed to look up project: ${projectLookupError.message}`);
  }

  let project = existingProject;

  if (!project) {
    // Create new project
    const { data: newProject, error: projectError } = await supabase
      .from("projects")
      .insert({ name, url: repositoryUrl, organization_id: organizationId })
      .select("id, organization_id")
      .single();

    if (projectError || !newProject) {
      throw new Error(`Failed to create project: ${projectError?.message}`);
    }
    project = newProject;
  }

  // Check for existing analysis for this project
  const { data: existingAnalysis } = await supabase
    .from("analyses")
    .select("id")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existingAnalysis) {
    return { analysisId: existingAnalysis.id, isNew: false };
  }

  // Create new analysis
  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .insert({ project_id: project.id, organization_id: organizationId, status: "pending", stage: "pending" })
    .select("id")
    .single();

  if (analysisError || !analysis) {
    throw new Error(`Failed to create analysis: ${analysisError?.message}`);
  }

  return { analysisId: analysis.id, isNew: true };
}