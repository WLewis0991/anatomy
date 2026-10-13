"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  applyTheme,
  currentTheme,
  storeTheme,
  subscribeTheme,
  type Theme,
} from "@/lib/theme";

const LABELS: Record<Theme, string> = {
  system: "auto",
  light: "light",
  dark: "dark",
};

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
      aria-label="Theme"
      className="flex items-center border border-line font-mono text-[11px]"
    >
      {(["system", "light", "dark"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          onClick={() => storeTheme(option)}
          className={
            theme === option
              ? "bg-fg px-1.5 py-0.5 text-bg"
              : "px-1.5 py-0.5 text-muted hover:bg-panel hover:text-fg"
          }
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
