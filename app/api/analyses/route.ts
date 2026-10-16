import { auth } from "@clerk/nextjs/server";
import { after, NextRequest, NextResponse } from "next/server";

import { createOrGetAnalysis, runAnalysisPipeline } from "@/lib/analysis-pipeline";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { orgId } = await auth.protect();

  if (!orgId) {
    return NextResponse.json({ error: "No organization selected" }, { status: 401 });
  }

  let url: string;
  try {
    const body = await request.json();
    url = body.url?.trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!url) {
    return NextResponse.json({ error: "Repository URL is required" }, { status: 400 });
  }

  try {
    const { analysisId, isNew } = await createOrGetAnalysis(url, orgId);

    if (isNew) {
      // The run continues after this response. `after` keeps the request context
      // alive for it, so the Supabase client built inside the pipeline can still
      // read the session token it needs to satisfy the row policies. Firing it
      // unattached instead would race the response teardown and leave the row
      // stuck with no stage at all.
      after(async () => {
        try {
          await runAnalysisPipeline(analysisId, url);
        } catch (error) {
          console.error(`Analysis ${analysisId} failed:`, error);
        }
      });
    }

    return NextResponse.json({ analysisId, isNew });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to create analysis:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}