import { auth } from "@clerk/nextjs/server";

// The session read happens at request time, so this route is never prerendered.
export const instant = false;

export default async function WorkspacePage() {
  // The proxy turns signed-out visitors away before this renders. This reads
  // the same session token the proxy did, and keeps the values below guarded if
  // the route is ever reached another way.
  //
  // Every value comes off that token. Nothing here asks the identity provider a
  // question at runtime: the organization travels in the token.
  const { orgId, orgSlug, orgRole, userId } = await auth.protect();

  return (
    <main className="flex-1 p-3">
      <h1 className="font-mono text-sm text-fg">{orgId}</h1>

      <dl className="mt-3 grid grid-cols-[6rem_auto] items-baseline gap-x-3 gap-y-1 font-mono text-[11px]">
        {/* Slugs are off on this instance, so the token carries none to show. */}
        {orgSlug ? (
          <>
            <dt className="text-muted">slug</dt>
            <dd className="text-fg">{orgSlug}</dd>
          </>
        ) : null}
        <dt className="text-muted">role</dt>
        <dd className="text-fg">{orgRole}</dd>
        <dt className="text-muted">you</dt>
        <dd className="text-fg">{userId}</dd>
      </dl>
    </main>
  );
}
