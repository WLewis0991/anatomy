"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface ReanalyzeButtonProps {
  analysisId: string;
}

/**
 * Runs this analysis again against the repository's current HEAD.
 *
 * A run describes a repository at one commit, and a repository moves. Without
 * this the first answer stands forever, which is not a property of the
 * repository but of the app: a parser that changed how it classifies files
 * could never be asked to re-read anything it had already read.
 *
 * The progress page is where the run reports itself, so this hands over to it
 * rather than waiting here. A failure to *start* is the only thing this page
 * has to show, and it says so in place instead of navigating to a run that
 * never began.
 */
export function ReanalyzeButton({ analysisId }: ReanalyzeButtonProps) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(): Promise<void> {
    if (starting) return;
    setStarting(true);
    setError(null);

    try {
      const response = await fetch(`/api/analyses/${analysisId}/rerun`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not start the run");
      }
      router.push(`/analyses/${analysisId}/progress`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the run");
      setStarting(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={start}
        disabled={starting}
        className="rounded-[3px] text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-50"
      >
        {starting ? "Starting…" : "Re-analyze"}
      </button>
      {error !== null && (
        /* The run never started, so there is no progress page to send anyone to
           and the reason belongs here, under the control that failed. */
        <p className="mt-1 text-xs text-fg-muted" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
