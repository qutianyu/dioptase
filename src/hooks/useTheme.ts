export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "dioptase-theme";

export function getStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY) as ThemeMode | null;
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // ignore
  }
  return "system";
}

export function setStoredTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // ignore
  }
  applyTheme(mode);
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

export function initTheme() {
  applyTheme(getStoredTheme());
}
