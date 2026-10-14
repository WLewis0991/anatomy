import { OrganizationSwitcher } from "@clerk/nextjs";

/**
 * Clerk's `<OrganizationSwitcher />` is how the organization changes, so it is
 * kept as the component rather than rebuilt. What it cannot do is look like this
 * shell, and `appearance.elements` is where that happens.
 *
 * The values are CSS declaration blocks, not class names — Clerk injects the
 * string into a stylesheet it writes itself, so a Tailwind class name in here is
 * discarded silently. Each one names a token rather than a hex, and the tokens
 * are on `:root`, so they reach the popover wherever Clerk mounts it.
 */
export function OrganizationControl() {
  return (
    <OrganizationSwitcher
      hidePersonal
      afterCreateOrganizationUrl="/"
      afterSelectOrganizationUrl="/"
      appearance={{
        elements: {
          // 30px, to sit on the same line as the appearance control and the
          // account button. `max-width` is what makes the trigger respect the
          // header's width cap for the switcher; `overflow` and `text-overflow`
          // are the only truncation available, because this version of Clerk has
          // no `organizationSwitcherTriggerLabel` element to hang them on.
          organizationSwitcherTrigger:
            "background-color: var(--surface); border: 1px solid var(--line); border-radius: 0.375rem; color: var(--fg); font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif; font-size: 0.75rem; height: 1.875rem; max-width: 100%; overflow: hidden; padding: 0 0.5rem; text-overflow: ellipsis; white-space: nowrap;",
          organizationSwitcherTriggerIcon: "color: var(--fg-muted);",
          organizationSwitcherPopoverRootBox:
            "background-color: var(--surface); border: 1px solid var(--line); border-radius: 0.375rem; box-shadow: none;",
          organizationSwitcherPopoverCard:
            "background-color: var(--surface); border: 1px solid var(--line); border-radius: 0.375rem; box-shadow: none;",
          organizationSwitcherPopoverMain: "color: var(--fg);",
          organizationSwitcherPreviewButton:
            "border-radius: 0.25rem; color: var(--fg); font-size: 0.75rem;",
          organizationSwitcherPopoverActionButton:
            "border-radius: 0.25rem; color: var(--fg); font-size: 0.75rem;",
          organizationSwitcherPopoverActionButtonIcon: "color: var(--fg-muted);",
          organizationSwitcherPopoverFooter: "color: var(--fg-muted);",
        },
      }}
    />
  );
}
