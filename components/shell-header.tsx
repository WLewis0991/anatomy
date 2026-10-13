import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

import { ManageOrganization } from "@/components/manage-organization";
import { ThemeControl } from "@/components/theme-control";

export function ShellHeader() {
  return (
    <header className="flex h-8 shrink-0 items-center gap-3 border-b border-line px-3">
      <span className="font-mono text-xs text-fg">anatomy</span>
      <OrganizationSwitcher
        hidePersonal
        afterCreateOrganizationUrl="/"
        afterSelectOrganizationUrl="/"
        appearance={{
          elements: {
            organizationSwitcherTrigger:
              "font-mono text-xs text-muted hover:text-fg",
            organizationSwitcherPopover: "text-xs",
          },
        }}
      />
      <div className="flex-1" />
      <ManageOrganization />
      <ThemeControl />
      <UserButton
        // Clerk shows the signed-in account's avatar image here, and falls back
        // to initials when there isn't one. The default avatar is larger than
        // this header, so it is pinned to the header's own type scale.
        appearance={{
          elements: {
            userButtonAvatarBox: "h-5 w-5",
            userButtonTrigger: "focus:shadow-none",
          },
        }}
      />
    </header>
  );
}
