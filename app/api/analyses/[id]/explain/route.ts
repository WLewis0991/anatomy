import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import { createSupabaseClient } from "@/lib/supabase";
import { fetchRepositoryHead, normalizeRepositoryUrl } from "@/lib/fetch-repository";
import { explainFile, explainFolder } from "@/lib/ai/explanations";
import { aiTracingEnabled } from "@/lib/ai/explanations";
import type { ExplanationSubjectKind, ExplanationView } from "@/lib/ai/types";

/**
 * One explanation request.
 *
 * Staleness is decided by the repository's current HEAD against the commit the
 * analysis recorded. When they differ the stored answer is returned as stale and
 * the model is not called: explaining code from a commit the map no longer shows
 * would be a fresh-looking answer to the wrong question.
 */

interface StaleResult {
  explanation: ExplanationView | null;
  stale: boolean;
  staleReason: "repository-moved" | null;
  currentHeadSha: string | null;
  tracingEnabled: boolean;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { orgId } = await auth.protect();
  if (!orgId) {
    return NextResponse.json({ error: "No organization selected" }, { status: 401 });
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
  }

  const kind = (body as { kind?: unknown }).kind;
  const path = (body as { path?: unknown }).path;

  if (kind !== "file" && kind !== "folder") {
    return NextResponse.json({ error: "`kind` must be \"file\" or \"folder\"" }, { status: 400 });
  }
  if (typeof path !== "string" || (kind === "file" && path.trim() === "")) {
    return NextResponse.json({ error: "`path` must be a repository path" }, { status: 400 });
  }

  const subjectKind: ExplanationSubjectKind = kind;
  const subjectPath = kind === "folder" ? path.replace(/\/+$/, "") : path;

  const supabase = createSupabaseClient();

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .select("id, organization_id, project_id, head_sha, adapter")
    .eq("id", id)
    .single();

  if (analysisError || !analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("name, url")
    .eq("id", analysis.project_id)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const repositoryName = normalizeRepositoryUrl(project.url);

  // A moved repository is the whole of the staleness check. The analysis pinned
  // one commit; if HEAD is another commit, something inside it may have changed
  // and the answer cannot claim to describe the current code.
  let currentHeadSha: string | null = null;
  try {
    currentHeadSha = await fetchRepositoryHead(project.url);
  } catch (error) {
    console.error("Failed to read repository HEAD:", error);
  }

  const moved =
    currentHeadSha !== null &&
    analysis.head_sha !== null &&
    currentHeadSha !== analysis.head_sha;

  if (moved) {
    const stored =
      subjectKind === "file"
        ? await readStoredFileExplanation(id, subjectPath)
        : await readStoredFolderExplanation(id, subjectPath);

    const result: StaleResult = {
      explanation: stored,
      stale: true,
      staleReason: "repository-moved",
      currentHeadSha,
      tracingEnabled: aiTracingEnabled(),
    };
    return NextResponse.json(result);
  }

  try {
    if (subjectKind === "file") {
      const { data: file, error: fileError } = await supabase
        .from("files")
        .select("id, path, hash")
        .eq("analysis_id", id)
        .eq("path", subjectPath)
        .maybeSingle();

      if (fileError) {
        return NextResponse.json({ error: fileError.message }, { status: 500 });
      }
      if (!file) {
        return NextResponse.json({ error: "File not in this analysis" }, { status: 404 });
      }

      const explanation = await explainFile({
        analysisId: analysis.id,
        organizationId: analysis.organization_id,
        repositoryName,
        repositoryUrl: project.url,
        headSha: analysis.head_sha,
        adapter: analysis.adapter,
        fileId: file.id,
        path: file.path,
        hash: file.hash,
      });

      const result: StaleResult = {
        explanation,
        stale: false,
        staleReason: null,
        currentHeadSha,
        tracingEnabled: aiTracingEnabled(),
      };
      return NextResponse.json(result);
    }

    // A folder must actually hold something. Asking for a path that is not in the
    // analysis would let the model write about a directory that does not exist.
    const { data: held, error: heldError } = await supabase
      .from("files")
      .select("id")
      .eq("analysis_id", id)
      .like("path", subjectPath === "" ? "%" : `${subjectPath}/%`)
      .limit(1);

    if (heldError) {
      return NextResponse.json({ error: heldError.message }, { status: 500 });
    }
    if (!held || held.length === 0) {
      return NextResponse.json({ error: "Folder not in this analysis" }, { status: 404 });
    }

    const explanation = await explainFolder({
      analysisId: analysis.id,
      organizationId: analysis.organization_id,
      repositoryName,
      repositoryUrl: project.url,
      headSha: analysis.head_sha,
      adapter: analysis.adapter,
      folderPath: subjectPath,
    });

    const result: StaleResult = {
      explanation,
      stale: false,
      staleReason: null,
      currentHeadSha,
      tracingEnabled: aiTracingEnabled(),
    };
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Explanation failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function readStoredFileExplanation(
  analysisId: string,
  path: string,
): Promise<ExplanationView | null> {
  const supabase = createSupabaseClient();

  const { data: file } = await supabase
    .from("files")
    .select("id")
    .eq("analysis_id", analysisId)
    .eq("path", path)
    .maybeSingle();

  if (!file) return null;

  const { data } = await supabase
    .from("explanations")
    .select("body, model, subject_hash, head_sha")
    .eq("file_id", file.id)
    .maybeSingle();

  if (!data) return null;

  return {
    kind: "file",
    path,
    body: data.body,
    cached: true,
    model: data.model ?? "",
    subjectHash: data.subject_hash ?? "",
    headSha: data.head_sha,
  };
}

async function readStoredFolderExplanation(
  analysisId: string,
  folderPath: string,
): Promise<ExplanationView | null> {
  const supabase = createSupabaseClient();

  const { data } = await supabase
    .from("folder_explanations")
    .select("body, model, subject_hash, head_sha")
    .eq("analysis_id", analysisId)
    .eq("folder_path", folderPath)
    .maybeSingle();

  if (!data) return null;

  return {
    kind: "folder",
    path: folderPath,
    body: data.body,
    cached: true,
    model: data.model ?? "",
    subjectHash: data.subject_hash ?? "",
    headSha: data.head_sha,
  };
}
