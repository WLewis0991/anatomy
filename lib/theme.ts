export const THEME_STORAGE_KEY = "anatomy.theme";

export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

/** Resolves a preference to the `dark` class that every colour token keys off. */
function resolve(preference: Theme): boolean {
  return (
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

export function applyTheme(preference: Theme): void {
  document.documentElement.classList.toggle("dark", resolve(preference));
}

const listeners = new Set<() => void>();

export function currentTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(stored) ? stored : "system";
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function storeTheme(preference: Theme): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  applyTheme(preference);
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Inlined into the document before anything paints. It repeats the resolution
 * above on purpose: the preference lives in localStorage, so the server cannot
 * know it, and applying it after hydration would flash the wrong palette.
 */
export const themeScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p!=="light"&&p!=="dark"){p="system"}var d=p==="dark"||(p==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
