'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Theme = 'dark' | 'dim' | 'light';

export const THEMES: readonly Theme[] = ['dark', 'dim', 'light'] as const;

export const DEFAULT_THEME: Theme = 'dark';

export const THEME_STORAGE_KEY = 'frigat.theme';

function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='dark'&&t!=='dim'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'${DEFAULT_THEME}';}var e=document.documentElement;e.dataset.theme=t;e.classList.remove('dark','dim','light');e.classList.add(t);}catch(_){}})();`;

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  initialTheme = DEFAULT_THEME,
}: {
  children: ReactNode;
  initialTheme?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let resolved: Theme = initialTheme;
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (isTheme(stored)) resolved = stored;
      else if (isTheme(document.documentElement.dataset.theme)) {
        resolved = document.documentElement.dataset.theme as Theme;
      }
    } catch {
      /* no-op */
    }
    setThemeState(resolved);
    setReady(true);
  }, [initialTheme]);

  // Mirror onto <html>. The script already did this for the initial value; from
  // here on it is this effect that keeps the document in sync.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.remove(...THEMES);
    root.classList.add(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* no-op */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, ready }),
    [theme, setTheme, ready]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return context;
}
