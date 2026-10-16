"use client";

import { useEffect, useRef, useState } from "react";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase-browser";

import {
  FailedIcon,
  PendingIcon,
  RunningIcon,
  SucceededIcon,
} from "@/components/icons";

interface StageDisplayProps {
  initialStage: string;
  initialMessage: string | null;
  initialStatus: string;
  analysisId: string;
  supabaseUrl: string;
  supabaseKey: string;
}

/**
 * The stages the runner writes, in the order it writes them. `selecting` is
 * deliberately absent even though the column's check constraint allows it: the
 * runner never writes it — file selection happens inside parsing — and a row that
 * can never tick would be a claim about the run that the run never made.
 */
const STAGES: ReadonlyArray<{ key: string; label: string }> = [
  { key: "pending", label: "Waiting to start" },
  { key: "fetching", label: "Downloading repository" },
  { key: "parsing", label: "Parsing source files" },
  { key: "storing", label: "Storing analysis" },
  { key: "succeeded", label: "Complete" },
];

/**
 * The stages a run passes through before it ends. A failure is shown against one
 * of these, never against the terminal success row.
 */
const WORKING_STAGES = new Set(["pending", "fetching", "parsing", "storing"]);

/** How often to hand Realtime a fresh Clerk token while the page is open. */
const TOKEN_REFRESH_MS = 50_000;

type RowState = "done" | "current" | "pending" | "failed";

/**
 * A row's state is carried by its glyph and by whether it is muted, not by hue:
 * green and amber already mean edge direction on the map, and a failed run is a
 * state, not a severity the page is grading. The four existing glyphs already
 * tell the four states apart by shape.
 */
const ROW_TEXT: Record<RowState, string> = {
  done: "text-fg",
  current: "font-medium text-fg",
  pending: "text-fg-muted",
  failed: "font-medium text-fg",
};

/* The glyph tells a sighted reader which state a row is in, so the same word has
   to reach a screen reader. The icons are aria-hidden and carry nothing. */
const ROW_STATE_LABEL: Record<RowState, string> = {
  done: "done",
  current: "in progress",
  pending: "not started",
  failed: "failed",
};

function RowIcon({ state }: { state: RowState }) {
  if (state === "done") return <SucceededIcon />;
  if (state === "current") return <RunningIcon />;
  if (state === "failed") return <FailedIcon />;
  return <PendingIcon />;
}

export function StageDisplay({
  initialStage,
  initialMessage,
  initialStatus,
  analysisId,
  supabaseUrl,
  supabaseKey,
}: StageDisplayProps) {
  const router = useRouter();
  const { getToken } = useAuth();
  const [stage, setStage] = useState(initialStage);
  const [message, setMessage] = useState(initialMessage);
  const [status, setStatus] = useState(initialStatus);
  const [liveUnavailable, setLiveUnavailable] = useState(false);

  // The last stage seen while it was still working. The pipeline overwrites the
  // stage with "failed", which on its own does not say where it stopped, so a
  // failure the run was watched live is shown against this row. A run that failed
  // before the page opened has no such history and is not attributed to a row.
  const [lastActiveStage, setLastActiveStage] = useState<string | null>(
    WORKING_STAGES.has(initialStage) ? initialStage : null,
  );

  // Held in a ref so a new `getToken` identity across renders does not tear the
  // subscription down and rebuild it. Updated in an effect, because a ref is not
  // something render is allowed to write to.
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    let cancelled = false;
    // Set once the channel exists, so cleanup can reach it even though the client
    // is built asynchronously. `teardown` is the one thing cleanup and the async
    // body both close over, which is what makes a StrictMode double-invoke safe.
    let teardown: (() => void) | undefined;

    void (async () => {
      const supabase = await createBrowserSupabaseClient(
        supabaseUrl,
        supabaseKey,
        () => getTokenRef.current(),
      );

      // No token: there is no authenticated socket to subscribe with, so live
      // updates can never arrive. Say so rather than leaving the page on its
      // initial stage forever. Nothing to clean up either way.
      if (!supabase) {
        if (!cancelled) setLiveUnavailable(true);
        return;
      }

      // Torn down while the client was being built: nothing to subscribe, and
      // nothing to clean up.
      if (cancelled) return;

      const channel = supabase
        .channel(`analysis:${analysisId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "analyses",
            filter: `id=eq.${analysisId}`,
          },
          (payload) => {
            const row = payload.new as {
              stage: string;
              stage_message: string | null;
              status: string;
            };
            if (row.stage) {
              setStage(row.stage);
              if (WORKING_STAGES.has(row.stage)) setLastActiveStage(row.stage);
            }
            if (row.stage_message !== undefined) setMessage(row.stage_message);
            if (row.status) setStatus(row.status);
          },
        )
        .subscribe((subscribeStatus) => {
          if (subscribeStatus === "SUBSCRIBED") {
            setLiveUnavailable(false);
            // Realtime fixes its replication slot at the moment it acknowledges
            // the join, so any stage write committed before that — including the
            // terminal one on a fast run — is never replayed. Read the row once to
            // reconcile whatever the subscription was too late to deliver.
            void (async () => {
              const { data } = await supabase
                .from("analyses")
                .select("stage, stage_message, status")
                .eq("id", analysisId)
                .single();
              if (!data) return;
              setStage(data.stage);
              setMessage(data.stage_message);
              setStatus(data.status);
            })();
            return;
          }
          if (
            subscribeStatus === "CHANNEL_ERROR" ||
            subscribeStatus === "TIMED_OUT"
          ) {
            setLiveUnavailable(true);
          }
        });

      // Clerk tokens are short-lived and Realtime authenticates once, on connect.
      // A slow run outlives the first token, so keep handing Realtime a current one.
      const refresh = setInterval(() => {
        getTokenRef
          .current()
          .then((token) => {
            if (token) supabase.realtime.setAuth(token);
          })
          .catch(() => {});
      }, TOKEN_REFRESH_MS);

      teardown = () => {
        clearInterval(refresh);
        supabase.removeChannel(channel);
      };

      // Cleanup may have run while the client was being built, before `teardown`
      // existed to call. It set `cancelled`, so tear the channel down now.
      if (cancelled) teardown();
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [analysisId, supabaseUrl, supabaseKey]);

  // Landing on the map is the point of the run, whether it succeeded just now or
  // was already finished when this page loaded.
  //
  // The pipeline writes `stage = 'succeeded'` in one update and `status =
  // 'succeeded'` in a later one, so the first realtime event can arrive with the
  // stage already succeeded under a still-pending status. Either one finishing
  // the run is enough to leave, and both are watched because the exit must not
  // depend on which of the two writes happens to land last.
  useEffect(() => {
    if (stage === "succeeded" || status === "succeeded") {
      router.replace(`/analyses/${analysisId}`);
    }
  }, [stage, status, router, analysisId]);

  const succeeded = stage === "succeeded" || status === "succeeded";
  const failed = !succeeded && (stage === "failed" || status === "failed");
  const currentIndex = STAGES.findIndex((s) => s.key === stage);
  // -1 when the failure cannot be placed: the row above no longer says which
  // stage it was, and guessing would be worse than showing none.
  const failedIndex = failed
    ? STAGES.findIndex((s) => s.key === lastActiveStage)
    : -1;

  /**
   * A stage before the current one is done, the current one is working, and
   * anything after it has not started. A failure stands where the run stopped and
   * leaves everything after it unstarted.
   */
  function rowState(index: number): RowState {
    if (succeeded) return "done";
    if (failed) {
      if (index < failedIndex) return "done";
      if (index === failedIndex) return "failed";
      return "pending";
    }
    if (index < currentIndex) return "done";
    if (index === currentIndex) return "current";
    return "pending";
  }

  // The message belongs to wherever the run is: under the working row, or under
  // the row the failure is shown against. A failure that could not be placed
  // stands on its own below the list.
  const messageIndex = failed ? failedIndex : succeeded ? -1 : currentIndex;
  const unattributedFailure = failed && failedIndex < 0;

  return (
    <div className="space-y-2">
      <ol className="space-y-1.5">
        {STAGES.map((entry, index) => {
          const state = rowState(index);
          const showsMessage = index === messageIndex && message !== null;
          return (
            <li key={entry.key} className="flex items-start gap-2">
              <span className={`mt-0.5 ${ROW_TEXT[state]}`}>
                <RowIcon state={state} />
              </span>
              <div className="min-w-0">
                <div className={`text-sm ${ROW_TEXT[state]}`}>
                  {entry.label}
                  <span className="sr-only"> — {ROW_STATE_LABEL[state]}</span>
                </div>
                {showsMessage && (
                  <div className="mt-0.5 text-xs text-fg-muted">{message}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {unattributedFailure && (
        <div className="flex items-start gap-2 pl-5 text-fg">
          <span className="mt-0.5">
            <FailedIcon />
          </span>
          <span className="min-w-0 text-xs text-fg-muted">
            {message ?? "Failed"}
          </span>
        </div>
      )}
      {liveUnavailable && (
        <div className="text-sm text-fg-muted">Live updates are unavailable.</div>
      )}
    </div>
  );
}
