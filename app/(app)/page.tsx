import type { ReactNode } from "react";

import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

import {
  BracesIcon,
  FailedIcon,
  InfoIcon,
  PendingIcon,
  RunningIcon,
  SucceededIcon,
} from "@/components/icons";
import { listAnalyses, type AnalysisListItem } from "@/lib/queries";
import { RepositoryForm } from "@/components/repository-form";

// The query reads the session, so this route is never prerendered and a
// navigation into it is allowed to wait.
export const instant = false;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export default async function WorkspacePage() {
  // The proxy turns signed-out visitors away before this renders, and this
  // repeats the check for its own reason: without a session the query below
  // carries no organization claim, every row is filtered out by the policy, and
  // an empty list would be indistinguishable from an organization with nothing
  // mapped in it.
  //
  // `protect()` hands back the claims it already read, and only the slug is
  // taken off it. The slug names the organization in the heading and is never
  // compared against anything: which rows come back is the policy's decision, so
  // switching organization changes what the same query returns rather than which
  // query gets written.
  const { orgSlug } = await auth.protect();

  const { rows, error } = await listAnalyses();

  return (
    <main className="mx-auto w-full max-w-[68rem] px-4 py-6 lg:px-8 lg:py-8">
      {/* The organization this page is scoped to is named in the sentence below
          and switched from the header, so there is nothing to line up beside the
          title here any more. */}
      <header className="mb-4">
        <h1 className="text-lg font-semibold tracking-tight">analyses</h1>
        <p className="mt-1 text-sm text-fg-muted">
          {orgSlug ? (
            <>
              Every row below belongs to{" "}
              <span className="font-mono text-fg">{orgSlug}</span> and to no
              other organization.
            </>
          ) : (
            "No organization is selected, so no row can be visible here."
          )}
        </p>
      </header>

      <RepositoryForm />

      <Panel count={error ? null : rows.length}>
        {error ? (
          <LoadFailure message={error} />
        ) : rows.length === 0 ? (
          <NothingMapped />
        ) : (
          <AnalysisTable rows={rows} />
        )}
      </Panel>
    </main>
  );
}

/**
 * The surface the list lives on, and the strip that names what is inside it.
 *
 * The strip's note says the rows are seeded. It goes away the moment a real parse
 * exists; until then it is the difference between a screen that is empty of
 * results and one that is showing results nobody produced.
 */
function Panel({ count, children }: { count: number | null; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-2">
        <span className="micro-label">
          {count === null ? "analyses" : `${count} ${count === 1 ? "analysis" : "analyses"}`}
        </span>
        {count !== null && (
          <span className="text-xs text-fg-muted">Seeded sample data</span>
        )}
      </div>
      {children}
    </section>
  );
}

function AnalysisTable({ rows }: { rows: AnalysisListItem[] }) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">
        Analyses in this organization, newest first
      </caption>
      <thead>
        <tr>
          {/* The first column takes the leftover width, which is what lets a long
              repository name truncate inside the cell rather than the table
              widening to fit it. */}
          <th scope="col" className="micro-label w-full px-4 py-2 text-left">
            repository
          </th>
          <th scope="col" className="micro-label w-36 px-4 py-2 text-left">
            state
          </th>
          <th scope="col" className="micro-label w-32 px-4 py-2 text-right">
            created
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          // The repository name carries the link rather than the row: a <tr>
          // cannot wrap one, and the name is the row's identity. The state and
          // the time beside it describe that analysis, they are not
          // destinations of their own.
          <tr key={row.id} className="border-t border-line">
            <td className="max-w-0 truncate px-4 py-2">
              <Link
                href={`/analyses/${row.id}`}
                className="block truncate font-medium text-fg hover:underline"
              >
                {row.repository}
              </Link>
              <span className="block truncate font-mono text-xs text-fg-muted">
                {row.url}
              </span>
            </td>
            {/* The reason a run stopped, on the state rather than in a column of
                its own: four identical lines of it would be noise, and one that
                is worth reading is worth reading where the word is. */}
            <td
              className="px-4 py-2"
              title={row.errorDetail ?? (row.stale ? `stuck in ${row.stage}` : undefined)}
            >
              <StateBadge status={row.status} stale={row.stale} />
            </td>
            <td
              className="px-4 py-2 text-right tabular-nums text-fg-muted"
              title={formatAbsolute(row.createdAt)}
            >
              {formatRelative(row.createdAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Four shapes, one outline, no fill. The reference tints these green, amber, grey
 * and red; none of those are available here, because two of them already mean
 * which way an edge points on the map and the other two would turn this table
 * into a severity report, which is the thing this product refuses to be.
 *
 * Anything the schema does not name renders as its own word with no glyph at
 * all, rather than borrowing one of the four.
 *
 * A run that has not finished and is old enough reads "stale" instead of the
 * stage it is stuck in. The stage word on its own says a run is working when the
 * only evidence is that it stopped; the stage stays reachable in the title.
 */
const STATE_GLYPHS: Record<string, () => ReactNode> = {
  pending: PendingIcon,
  running: RunningIcon,
  succeeded: SucceededIcon,
  failed: FailedIcon,
};

function StateBadge({ status, stale }: { status: string; stale: boolean }) {
  const Glyph = stale ? PendingIcon : STATE_GLYPHS[status];

  // The reference's pill, at its 24px, without its uppercase: the words here are
  // the schema's, and the schema is lowercase.
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-line pr-2 pl-1.5 text-xs text-fg leading-none">
      {Glyph ? <Glyph /> : null}
      {stale ? "stale" : status}
    </span>
  );
}

function NothingMapped() {
  return (
    <StateMessage
      title="no analyses yet"
      body="Nothing has been mapped for this organization. Analyses belong to the organization you are in, so another organization's rows are absent here rather than hidden."
      note="There is nothing to run from this screen yet."
    />
  );
}

function LoadFailure({ message }: { message: string }) {
  return (
    <StateMessage
      title="could not be read"
      body={message}
      note="This is the database's answer, not the interface's. Nothing is being hidden."
    />
  );
}

function StateMessage({
  title,
  body,
  note,
}: {
  title: string;
  body: string;
  note: string;
}) {
  return (
    // The same shape in all three states, so a team that has never run an analysis
    // sees the screen they will see again rather than a different one.
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <span className="text-fg-muted">
        <BracesIcon size={24} />
      </span>
      <p className="text-md font-medium text-fg">{title}</p>
      <p className="max-w-[34rem] text-sm text-fg-muted">{body}</p>
      <p className="flex max-w-[34rem] items-start gap-1.5 text-xs text-fg-muted">
        <span className="mt-0.5">
          <InfoIcon />
        </span>
        {note}
      </p>
    </div>
  );
}

/**
 * Absolute, in UTC, to the minute. This is the title attribute, so the exact
 * instant stays recoverable under the relative reading below.
 */
function formatAbsolute(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Relative, because a column of timestamps answers "which of these is oldest"
 * only if you read all of them, and ten of them is ten reads.
 *
 * The rule is deliberately small. Under a minute is "just now"; then whole
 * minutes, whole hours, whole days. Anything from a day to two days back reads as
 * "yesterday" rather than "1 day ago": at that distance nobody needs the hour, and
 * "1 day ago" states a duration where "yesterday" states a place in the recent
 * past, which is the thing being asked. Past a week the relative reading stops
 * being useful and the date itself is shown. Every figure is floored, so an
 * elapsed span never rounds up into the unit it hasn't reached yet.
 *
 * A timestamp in the future means the clock disagreed with the database's, and is
 * reported as "just now" rather than as a negative age.
 */
function formatRelative(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();

  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (elapsed < 2 * DAY) return "yesterday";
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}