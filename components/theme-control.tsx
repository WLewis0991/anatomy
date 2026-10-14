"use client";

import { useEffect, useSyncExternalStore, type ComponentType } from "react";

import { DarkIcon, LightIcon, SystemIcon } from "@/components/icons";
import {
  applyTheme,
  currentTheme,
  storeTheme,
  subscribeTheme,
  type Theme,
} from "@/lib/theme";

const OPTIONS = [
  { value: "system", label: "follow the system", Icon: SystemIcon },
  { value: "light", label: "light", Icon: LightIcon },
  { value: "dark", label: "dark", Icon: DarkIcon },
] as const satisfies ReadonlyArray<{
  value: Theme;
  label: string;
  Icon: ComponentType<Record<string, never>>;
}>;

// The server knows nothing about localStorage, so hydration renders with the
// system default and picks the stored preference up immediately afterwards.
const SERVER_THEME = "system";

export function ThemeControl() {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => SERVER_THEME);

  useEffect(() => {
    // Following the system means the system can still change under us, but only
    // while the preference really is the system's.
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (currentTheme() === "system") {
        applyTheme("system");
      }
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <div
      role="group"
      aria-label="Appearance"
      className="flex w-fit items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5"
    >
      {/* Real radios behind sr-only labels, because a group of them is one control
          and the browser already knows how a single-choice group answers arrow
          keys. A row of buttons with aria-pressed would not. */}
      {OPTIONS.map(({ value, label, Icon }) => (
        <label key={value} className="group/opt relative">
          <input
            type="radio"
            name="appearance"
            value={value}
            checked={theme === value}
            onChange={() => storeTheme(value)}
            // The ring is drawn on the cell beside it; the input is inside the
            // shell's focus rule as well and would otherwise outline its own
            // one-pixel clipped box.
            className="peer sr-only focus-visible:outline-none"
          />
          <span
            className="flex h-6 w-7 items-center justify-center rounded-[3px] text-fg-muted group-hover/opt:text-fg peer-checked:bg-surface peer-checked:text-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent"
          >
            <Icon />
            <span className="sr-only">{label}</span>
          </span>
        </label>
      ))}
    </div>
  );
}