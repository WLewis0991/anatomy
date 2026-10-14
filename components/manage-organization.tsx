"use client";

import { useClerk } from "@clerk/nextjs";

import { MembersIcon } from "@/components/icons";

/**
 * Clerk's `<OrganizationProfile />` renders inline and fills whatever it is
 * given, which is far too large for this shell. Its modal is the same built-in
 * component, so this gets a dense trigger that opens it instead.
 */
export function ManageOrganization() {
  const { openOrganizationProfile } = useClerk();

  return (
    <button
      type="button"
      onClick={() => openOrganizationProfile()}
      // 30px, the same line as the appearance control and the account button.
      // `aria-label` is not decoration: the word is hidden below the breakpoint,
      // and without it the button would have no accessible name at all there.
      aria-label="Members"
      title="Members"
      className="flex h-7.5 items-center gap-1.5 rounded-md px-1.5 text-fg-muted hover:bg-surface-2 hover:text-fg sm:px-2"
    >
      <MembersIcon />
      <span className="hidden text-sm sm:inline">members</span>
    </button>
  );
}
