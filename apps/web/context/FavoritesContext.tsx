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

import { CATALOGUE, type CatalogueEntry } from '@/lib/gameCatalogue';

/**
 * FRIGAT — Favourite games
 *
 * Held in localStorage under one key, shared across tabs through the `storage`
 * event so hearting a game in one tab lights up in the other.
 *
 * Deliberately not server-backed yet: there is no favourites column or
 * endpoint on the API, and inventing one client-side would give players a list
 * that silently disappears when they sign in on another device. When that
 * endpoint exists, this provider is the single place to sync from — every
 * consumer already reads through the hook.
 *
 * Stored ids are validated against the catalogue on read, so a stale entry
 * from a removed game cannot render a broken card.
 */

const STORAGE_KEY = 'frigat.favorites';

export type GameId = CatalogueEntry['slug'];

interface FavoritesContextValue {
  /** Favourited ids, in the order the player added them. */
  favorites: GameId[];
  isFavorite: (gameId: string) => boolean;
  toggleFavorite: (gameId: string) => void;
  clearFavorites: () => void;
  /** Catalogue entries for the favourites, in catalogue order. */
  favoriteGames: CatalogueEntry[];
  count: number;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

const KNOWN = new Set<string>(CATALOGUE.map((entry) => entry.slug));

function isKnownGame(id: unknown): id is GameId {
  return typeof id === 'string' && KNOWN.has(id);
}

function read(): GameId[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Drop anything that is not a game we still ship.
    return Array.isArray(parsed) ? parsed.filter(isKnownGame) : [];
  } catch {
    return [];
  }
}

export function FavoritesProvider({ children }: { children: ReactNode }) {
  // Starts empty on both server and first client render; localStorage is read
  // in an effect so the two markups match and hydration cannot mismatch.
  const [favorites, setFavorites] = useState<GameId[]>([]);

  useEffect(() => setFavorites(read()), []);

  // Another tab changed the list.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      setFavorites(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((next: GameId[]) => {
    setFavorites(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode or a full quota — the session still works in memory */
    }
  }, []);

  const isFavorite = useCallback(
    (gameId: string) => favorites.includes(gameId as GameId),
    [favorites]
  );

  const toggleFavorite = useCallback(
    (gameId: string) => {
      if (!isKnownGame(gameId)) return;
      setFavorites((current) => {
        const next = current.includes(gameId)
          ? current.filter((id) => id !== gameId)
          : [...current, gameId];
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* no-op */
        }
        return next;
      });
    },
    []
  );

  const clearFavorites = useCallback(() => persist([]), [persist]);

  const favoriteGames = useMemo(
    () => CATALOGUE.filter((entry) => favorites.includes(entry.slug)),
    [favorites]
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({
      favorites,
      isFavorite,
      toggleFavorite,
      clearFavorites,
      favoriteGames,
      count: favorites.length,
    }),
    [favorites, isFavorite, toggleFavorite, clearFavorites, favoriteGames]
  );

  return (
    <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesContextValue {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error('useFavorites must be used inside <FavoritesProvider>');
  }
  return context;
}
