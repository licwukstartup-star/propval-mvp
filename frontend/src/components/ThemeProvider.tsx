"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "propval-theme";

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  // On mount, read persisted preference (inline script already set data-theme
  // to prevent flash, so we just sync React state here)
  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-theme") as Theme | null;
    if (stored === "light" || stored === "dark") {
      setThemeState(stored);
    }
  }, []);

  const applyTheme = useCallback((t: Theme) => {
    const root = document.documentElement;
    root.classList.add("theme-transitioning");
    root.setAttribute("data-theme", t);
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
    // Remove after transitions complete — matches the 0.3s in globals.css
    setTimeout(() => root.classList.remove("theme-transitioning"), 350);
  }, []);

  const toggleTheme = useCallback(() => {
    applyTheme(theme === "dark" ? "light" : "dark");
  }, [theme, applyTheme]);

  const setTheme = useCallback((t: Theme) => {
    applyTheme(t);
  }, [applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
