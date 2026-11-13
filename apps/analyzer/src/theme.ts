/**
 * Hell oder dunkel (seit 13.11.2026, Davids Freigabe des Redesigns). Das Thema steht als
 * `data-theme` auf <html>; base.css setzt daraus alle Farben. Gemerkt nur in diesem Browser -
 * kein Zustand, der irgendwo anders gebraucht wird. Ohne Speicher (privates Fenster) gilt dunkel.
 */
import { useCallback, useState } from "react";

export type Theme = "dark" | "light";
const STORAGE_KEY = "analyzer:theme";

export function loadTheme(): Theme {
  // `?theme=light` bzw. `?theme=dark` in der Adresse geht vor - für Links und Bildschirmfotos.
  const fromUrl = new URLSearchParams(window.location.search).get("theme");
  if (fromUrl === "light" || fromUrl === "dark") return fromUrl;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => loadTheme());
  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ohne Speicher gilt die Wahl nur bis zum Neuladen.
    }
  }, []);
  return [theme, setTheme];
}
