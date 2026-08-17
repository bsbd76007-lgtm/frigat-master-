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

import en from '../../locales/en.json';
import ru from '../../locales/ru.json';

export type Locale = 'en' | 'ru';

export interface LocaleOption {
  code: Locale;
  short: string;
  label: string;
  flag: string;
  dir: 'ltr' | 'rtl';
}

export const LOCALES: readonly LocaleOption[] = [
  { code: 'en', short: 'EN', label: 'English', flag: '🇬🇧', dir: 'ltr' },
  { code: 'ru', short: 'RU', label: 'Русский', flag: '🇷🇺', dir: 'ltr' },
] as const;

export const DEFAULT_LOCALE: Locale = 'en';

const STORAGE_KEY = 'frigat.locale';

/** Nested string tree; `en.json` is the shape every other file must match. */
type Messages = typeof en;

const MESSAGES: Record<Locale, Messages> = { en, ru };

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

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // A dropped locale (hy/ka/fa) fails isLocale and is cleared, so a
      // returning visitor lands on the default rather than a dead value.
      if (isLocale(stored)) setLocaleState(stored);
      else if (stored) window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no-op */
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
      /* no-op */
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
