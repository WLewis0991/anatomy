import { auth } from "@clerk/nextjs/server";
import { after, NextResponse } from "next/server";

import { runAnalysisPipeline } from "@/lib/analysis-pipeline";
import { createSupabaseClient } from "@/lib/supabase";

/**
 * Runs an analysis again against the repository's current HEAD.
 *
 * A run answers "what is in this repository", and that answer is stale the
 * moment the repository moves. Nothing in the app could ask that question a
 * second time, so a repository analyzed once kept the first answer forever —
 * including through parser changes that would have answered it differently.
 *
 * The analysis row is reused rather than replaced. It is the thing the map and
 * the progress page are addressed by, and a re-run is the same question asked
 * again, not a second question: `runAnalysisPipeline` clears the previous
 * result first, so the row never describes two runs at once.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { orgId } = await auth.protect();
  const { id } = await params;

  if (!orgId) {
    return NextResponse.json({ error: "No organization selected" }, { status: 401 });
  }

  // Which rows this session can see is the policy's decision. An analysis
  // belonging to another organization is absent here rather than refused, so
  // there is no branch that could tell the two apart.
  const supabase = createSupabaseClient();

  const { data: analysis, error } = await supabase
    .from("analyses")
    .select("id, project_id")
    .eq("id", id)
    .single();

  if (error || !analysis) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("url")
    .eq("id", analysis.project_id)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  // The run continues after this response. `after` keeps the request context
  // alive for it, so the Supabase client built inside the pipeline can still
  // read the session token it needs to satisfy the row policies.
  after(async () => {
    try {
      await runAnalysisPipeline(id, project.url);
    } catch (error) {
      console.error(`Analysis ${id} failed:`, error);
    }
  });

  return NextResponse.json({ analysisId: id });
}
