'use client';

/**
 * FRIGAT — Theme provider
 *
 * Three themes — dark, dim and light — expressed purely as CSS variable sets
 * in globals.css. This provider owns which one is active: it stamps the name
 * onto <html> as both `data-theme="…"` (what the stylesheet selects on) and a
 * bare class (`.dark`/`.dim`/`.light`, for anything that prefers class-based
 * targeting), persists the choice to localStorage, and hands the rest of the
 * tree a setter through context.
 *
 * Deliberately hand-rolled rather than next-themes: the dependency would earn
 * its weight if we needed system-preference syncing across frameworks, but the
 * whole behaviour here is ~60 lines and this app is already one client tree
 * under the root layout — the same reason LanguageProvider is homegrown.
 *
 * Two details worth keeping:
 *
 * 1. `THEME_SCRIPT` runs before first paint (see app/layout.tsx) so the stored
 *    theme is on <html> by the time the first pixels land. Without it every
 *    reload flashes dark before the effect catches up.
 * 2. Because of that script, React must not render anything theme-dependent
 *    during SSR — the server cannot know the stored value. The toggle's active
 *    state therefore stays neutral until `ready` flips after mount, which is
 *    the same hydration-safety trick LanguageProvider uses for the locale.
 */

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

/**
 * Inlined into <head> and run synchronously before the body paints. Kept as a
 * single expression string — it is injected via dangerouslySetInnerHTML, so it
 * must stay free of anything a bundler would need to transform, and free of
 * characters that would need escaping inside a <script>.
 */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='dark'&&t!=='dim'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'${DEFAULT_THEME}';}var e=document.documentElement;e.dataset.theme=t;e.classList.remove('dark','dim','light');e.classList.add(t);}catch(_){}})();`;

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
  /**
   * False until the stored theme has been read after mount. Consumers that
   * render differently per theme should treat this as "don't commit yet" so
   * server and client markup agree on the first pass.
   */
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
