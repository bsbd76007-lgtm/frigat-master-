'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useLanguage } from '@/components/providers/LanguageProvider';
import { CATALOGUE, type CatalogueEntry } from '@/lib/gameCatalogue';

/**
 * FRIGAT — Game search
 *
 * One query, shared by the header input and the home grid: the dropdown shows
 * matches while typing, and the grid behind it narrows to the same set, so the
 * two can never disagree about what "matching" means.
 *
 * Matching runs over the translated name as well as the slug, because a player
 * reading the site in Russian searches in Russian — "Мины" has to find Mines,
 * and `slug` alone would never match it.
 */

export interface SearchMatch {
  entry: CatalogueEntry;
  name: string;
}

interface SearchContextValue {
  query: string;
  setQuery: (next: string) => void;
  clear: () => void;
  /** Games matching the current query, in catalogue order. */
  matches: SearchMatch[];
  /** True once the query has any non-whitespace content. */
  isSearching: boolean;
}

const SearchContext = createContext<SearchContextValue | null>(null);

/** Case- and diacritic-insensitive, so "menu" matches "Menü" and "МИНЫ" "Мины". */
function normalise(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const { t, locale } = useLanguage();
  const [query, setQuery] = useState('');

  const clear = useCallback(() => setQuery(''), []);

  const matches = useMemo(() => {
    const needle = normalise(query);
    // Every game, in catalogue order, once the box is empty.
    const all = CATALOGUE.map((entry) => ({
      entry,
      name: t(`games.${entry.slug}.name`),
    }));
    if (!needle) return all;
    return all.filter(
      ({ entry, name }) =>
        normalise(name).includes(needle) || normalise(entry.slug).includes(needle)
    );
    // `locale` is a dependency in substance: t() returns different names per
    // language, and the list must re-match when the language changes.
  }, [query, t, locale]);

  const value = useMemo<SearchContextValue>(
    () => ({
      query,
      setQuery,
      clear,
      matches,
      isSearching: query.trim().length > 0,
    }),
    [query, clear, matches]
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchContextValue {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used inside <SearchProvider>');
  }
  return context;
}
