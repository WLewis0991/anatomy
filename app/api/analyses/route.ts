import { auth } from "@clerk/nextjs/server";
import { after, NextRequest, NextResponse } from "next/server";

import { createOrGetAnalysis, runAnalysisPipeline } from "@/lib/analysis-pipeline";
import { normalizeRepositoryUrl } from "@/lib/fetch-repository";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { orgId } = await auth.protect();

  if (!orgId) {
    return NextResponse.json({ error: "No organization selected" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as { url?: unknown }).url !== "string"
  ) {
    return NextResponse.json(
      { error: "Expected a JSON object with a string `url`" },
      { status: 400 },
    );
  }

  const url = (body as { url: string }).url.trim();

  if (!url) {
    return NextResponse.json({ error: "Repository URL is required" }, { status: 400 });
  }

  // A URL the parser cannot read is the caller's error, not a server failure:
  // it fails here as a 400 rather than falling through to the 500 below.
  try {
    normalizeRepositoryUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid repository URL";
    return NextResponse.json({ error: message }, { status: 400 });
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