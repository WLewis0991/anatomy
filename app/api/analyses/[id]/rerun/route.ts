import { auth } from "@clerk/nextjs/server";
import { after, NextRequest, NextResponse } from "next/server";

import { createSupabaseClient } from "@/lib/supabase";
import { runAnalysisPipeline } from "@/lib/analysis-pipeline";

/**
 * Re-analyses one repository at its current HEAD. The stale explanation notice
 * calls this, and so does anything else that needs the map to catch up.
 *
 * The work runs after the response, through `after`, so the request context (and
 * the Supabase session token the pipeline reads) stays alive for the whole run.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { orgId } = await auth.protect();
  if (!orgId) {
    return NextResponse.json({ error: "No organization selected" }, { status: 401 });
  }

  const { id } = await context.params;
  const supabase = createSupabaseClient();

  const { data: analysis, error } = await supabase
    .from("analyses")
    .select("id, project_id, status, stage")
    .eq("id", id)
    .single();

  if (error || !analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  if (
    analysis.status === "pending" &&
    (analysis.stage === "fetching" || analysis.stage === "parsing" || analysis.stage === "storing")
  ) {
    return NextResponse.json({ error: "This analysis is already running" }, { status: 409 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("url")
    .eq("id", analysis.project_id)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  after(async () => {
    try {
      await runAnalysisPipeline(analysis.id, project.url);
    } catch (pipelineError) {
      console.error(`Re-analysis ${analysis.id} failed:`, pipelineError);
    }
  });

  return NextResponse.json({ status: "queued" }, { status: 202 });
}
