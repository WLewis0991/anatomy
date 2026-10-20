import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import type { Database } from "@/lib/database.types";
import { StageDisplay } from "./stage-display";

// This route uses dynamic data (auth, database), so it cannot be prerendered.
export const instant = false;

export default async function ProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { orgId } = await auth.protect();
  const { id } = await params;

  if (!orgId) {
    redirect("/sign-in");
  }

  // Create a server-side Supabase client with the session token
  const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    accessToken: async () => (await auth()).getToken(),
  });

  // Fetch the analysis to verify it exists and belongs to this org
  const { data: analysis, error } = await supabase
    .from("analyses")
    .select("id, stage, stage_message, status, error_detail, project_id")
    .eq("id", id)
    .single();

  if (error || !analysis) {
    notFound();
  }

  // The row-level security policy ensures we only see our org's analyses
  // but we can double-check by fetching the project's org
  const { data: project } = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", analysis.project_id)
    .single();

  if (!project || project.organization_id !== orgId) {
    notFound();
  }

  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        {/* The checklist reads top to bottom, so the page is left-aligned: a list
            centred around a midpoint is a list you have to hunt across to read. */}
        <div className="mb-3 text-sm font-medium text-fg">Analyzing repository…</div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <StageDisplay
            initialStage={analysis.stage}
            initialMessage={analysis.stage_message}
            initialStatus={analysis.status}
            analysisId={analysis.id}
            supabaseUrl={env.supabaseUrl}
            supabaseKey={env.supabasePublishableKey}
          />
        </div>
      </div>
    </div>
  );
}