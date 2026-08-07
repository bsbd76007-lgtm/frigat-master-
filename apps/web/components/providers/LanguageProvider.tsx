'use client';

/**
 * FRIGAT — Language provider
 *
 * A deliberately small i18n layer: five bundled locale files, a React context
 * holding the active one, and a `t()` that walks a dot path. No routing
 * segments and no extra dependency — the whole app is one client tree under
 * the root layout, so a context switch re-renders every translated string
 * (header, game cards, carousel) in a single pass.
 *
 * The choice is persisted to localStorage so it survives a reload, and mirrored
 * onto <html lang>/<html dir> so Persian renders right-to-left and screen
 * readers announce the correct language.
 *
 * The first paint is always English: reading localStorage during render would
 * make the server and client markup disagree. The stored locale is applied in
 * an effect right after mount instead.
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

import en from '../../locales/en.json';
import hy from '../../locales/hy.json';
import ru from '../../locales/ru.json';
import ka from '../../locales/ka.json';
import fa from '../../locales/fa.json';
export type Locale = 'en' | 'hy' | 'ru' | 'ka' | 'fa';

export interface LocaleOption {
  code: Locale;
  short: string;
  label: string;
  flag: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALES: readonly LocaleOption[] = [
  { code: 'en', short: 'ENG', label: 'English', flag: '🇬🇧', dir: 'ltr' },
  { code: 'hy', short: 'ARM', label: 'Հայերեն', flag: '🇦🇲', dir: 'ltr' },
  { code: 'ru', short: 'RUS', label: 'Русский', flag: '🇷🇺', dir: 'ltr' },
  { code: 'ka', short: 'GEO', label: 'ქართული', flag: '🇬🇪', dir: 'ltr' },
  { code: 'fa', short: 'FAS', label: 'فارسی', flag: '🇮🇷', dir: 'rtl' },
] as const;

export const DEFAULT_LOCALE: Locale = 'en';

const STORAGE_KEY = 'frigat.locale';

/** Nested string tree; `en.json` is the shape every other file must match. */
type Messages = typeof en;

const MESSAGES: Record<Locale, Messages> = { en, hy, ru, ka, fa };

function isLocale(value: unknown): value is Locale {
  return LOCALES.some((option) => option.code === value);
}

export function localeOption(code: Locale): LocaleOption {
  return LOCALES.find((option) => option.code === code) ?? LOCALES[0];
}

export type TranslateVars = Record<string, string | number>;

function lookup(messages: Messages, path: string): string | undefined {
  const value = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[key]
          : undefined,
      messages
    );
  return typeof value === 'string' ? value : undefined;
}

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  );
}

export interface LanguageContextValue {
  locale: Locale;
  option: LocaleOption;
  setLocale: (next: Locale) => void;
  t: (path: string, vars?: TranslateVars) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Restore the stored preference once, after hydration has matched the
  // server's English markup.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isLocale(stored)) setLocaleState(stored);
    } catch {
    }
  }, []);

  useEffect(() => {
    const { dir } = localeOption(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
    }
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const messages = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
    return {
      locale,
      option: localeOption(locale),
      setLocale,
      t: (path, vars) =>
        interpolate(
          lookup(messages, path) ?? lookup(MESSAGES[DEFAULT_LOCALE], path) ?? path,
          vars
        ),
    };
  }, [locale, setLocale]);

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used inside <LanguageProvider>');
  }
  return context;
}

export function useTranslation(): LanguageContextValue['t'] {
  return useLanguage().t;
}
