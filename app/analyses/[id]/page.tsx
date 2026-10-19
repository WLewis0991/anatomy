import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database } from "@/lib/database.types";
import { AnalysisClient } from "./analysis-client";
import { tracingConfigured } from "@/lib/ai/config";

// This route uses dynamic data (auth, database), so it cannot be prerendered.
export const instant = false;

// PostgREST's maximum response size. Reads page in slices of this until a short
// page arrives, so every row reaches the map.
const PAGE_SIZE = 1000;

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { orgId } = await auth.protect();
  const { id } = await params;

  if (!orgId) {
    redirect("/sign-in");
  }

  const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken: async () => (await auth()).getToken(),
  });

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .select("id, status, stage, stage_message, error_detail, head_sha, adapter, coverage_json, project_id, created_at")
    .eq("id", id)
    .single();

  if (analysisError || !analysis) {
    notFound();
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, url, organization_id")
    .eq("id", analysis.project_id)
    .single();

  if (projectError || !project || project.organization_id !== orgId) {
    notFound();
  }

  // Fetch files and edges for the map. PostgREST caps a response at 1000 rows,
  // so paging is required or a large repository renders a silently truncated
  // map. Each page is ordered by id so ranges are stable across requests.
  // Authorization stays with the RLS policy, not a where clause.
  const files: { id: string; path: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("files")
      .select("id, path")
      .eq("analysis_id", id)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data) {
      notFound();
    }

    files.push(...data);
    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  // Roles hang off files rather than the analysis, so they are read after the
  // file ids are known. One chunked read, not a query per file.
  const roles: Array<{ file_id: string; role: string; source: string }> = [];
  for (let index = 0; index < files.length; index += 200) {
    const ids = files.slice(index, index + 200).map((file) => file.id);
    const { data, error } = await supabase
      .from("file_roles")
      .select("file_id, role, source")
      .in("file_id", ids);

    if (error) {
      notFound();
    }
    roles.push(...(data ?? []));
  }

  const edges: {
    id: string;
    from_file_id: string;
    to_file_id: string;
    kind: string;
    specifier: string;
  }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("edges")
      .select("id, from_file_id, to_file_id, kind, specifier")
      .eq("analysis_id", id)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data) {
      notFound();
    }

    edges.push(...data);
    if (data.length < PAGE_SIZE) {
      break;
    }
  }

  return (
    <AnalysisClient
      analysis={analysis}
      project={project}
      files={files}
      edges={edges}
      roles={roles}
      tracingEnabled={tracingConfigured()}
    />
  );
}