"use client";

import { useClerk } from "@clerk/nextjs";

/**
 * Clerk's `<OrganizationProfile />` renders inline and fills whatever it is
 * given, which is far too large for this header. Its modal is the same built-in
 * component, so the header gets a dense trigger that opens it instead.
 */
export function ManageOrganization() {
  const { openOrganizationProfile } = useClerk();

  return (
    <button
      type="button"
      onClick={() => openOrganizationProfile()}
      className="px-1 py-0.5 font-mono text-[11px] text-muted hover:bg-panel hover:text-fg"
    >
      members
    </button>
  );
}
