import Link from "next/link";

import { UserButton } from "@clerk/nextjs";

import { BracesIcon } from "@/components/icons";
import { ManageOrganization } from "@/components/manage-organization";
import { OrganizationControl } from "@/components/organization-control";
import { ThemeControl } from "@/components/theme-control";

/**
 * The shell's permanent strip across the top: who you are, which organization the
 * rows below belong to, and the three controls that are not about either.
 *
 * Nothing here routes. The one link is the wordmark, and it goes home rather than
 * sideways, so it is not a second route in a nav — a link to `/` beside a link to
 * `/` is a control that appears to do nothing.
 *
 * All three controls in the right cluster are 30px. `ManageOrganization` and
 * Clerk's trigger were 28px and the step is visible across a 40px bar, so they
 * were raised to meet `ThemeControl`. The theme cells stay 24px inside a 30px
 * box: shrinking them to match 28px would leave a 22px pointer target and fail
 * WCAG 2.5.8.
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-4">
      {/* The way home from any panel that later gets added to this shell, which is
          why it is a link at all. The mark carries the 40px row by itself now
          that the nav's smaller use of it is gone. */}
      <Link href="/" className="flex shrink-0 items-center gap-1.5 rounded-md text-fg">
        <BracesIcon size={14} />
        <span className="hidden font-mono text-sm font-semibold tracking-tight sm:inline">
          anatomy
        </span>
      </Link>

      {/* A rule rather than a gap, so the wordmark and the organization it scopes
          read as one thing and the right cluster reads as another. */}
      <span aria-hidden className="hidden h-4 w-px shrink-0 bg-line sm:block" />

      {/* `flex-1` is scoped below 640px on purpose. Above it the switcher is
          `flex-none` with a width cap, so a long organization name truncates
          inside its own box instead of widening the bar and pushing the controls
          off it — and so the middle of the bar stays free for whatever comes
          next rather than the switcher being the one element that grows. */}
      <div className="flex min-w-0 flex-1 items-center sm:max-w-48 sm:flex-none">
        <OrganizationControl />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <ManageOrganization />
        <ThemeControl />
        <UserButton
          // Clerk shows the signed-in account's avatar image and falls back to
          // initials. Pinned to the shell's own type scale so the fallback
          // initials match the wordmark beside it, and to the same 30px as the
          // two controls next to it.
          appearance={{
            elements: {
              userButtonAvatarBox: "width: 22px; height: 22px;",
              userButtonTrigger:
                "outline-offset: 2px; box-shadow: none; height: 1.875rem;",
            },
          }}
        />
      </div>
    </header>
  );
}
