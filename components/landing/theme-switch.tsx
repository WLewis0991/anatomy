"use client";

import { useEffect, useSyncExternalStore } from "react";

import { styles } from "@/components/landing/styles";
import {
  applyTheme,
  currentTheme,
  storeTheme,
  subscribeTheme,
  THEMES,
  type Theme,
} from "@/lib/theme";

const LABEL: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function ThemeSwitch() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    () => "system" as const,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (currentTheme() === "system") applyTheme("system");
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return (
    <div className={styles.segmented} role="group" aria-label="Colour theme">
      {THEMES.map((value) => (
        <button
          key={value}
          className={styles.segmentedButton}
          type="button"
          aria-pressed={theme === value}
          onClick={() => storeTheme(value)}
        >
          {LABEL[value]}
        </button>
      ))}
    </div>
  );
}
