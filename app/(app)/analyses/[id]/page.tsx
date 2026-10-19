import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database } from "@/lib/database.types";
import { AnalysisClient } from "./analysis-client";

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
    .select("id, status, stage, stage_message, error_detail, head_sha, coverage_json, adapter, frontend, project_id, created_at")
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
  const files: { id: string; path: string; role: string | null; flags: string[] }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("files")
      .select("id, path, role, flags")
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

  const routes: { method: string | null; path: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("routes")
      .select("method, path")
      .eq("analysis_id", id)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data) {
      notFound();
    }

    routes.push(...data);
    if (data.length < PAGE_SIZE) {
      break;
    }
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
      routes={routes}
    />
  );
}