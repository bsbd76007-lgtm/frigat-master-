'use client';

/**
 * FRIGAT — Game Socket Provider
 *
 * Owns the single authenticated WebSocket for the whole dashboard. The header
 * (balance, fairness modal) and the active game page all read from here — if
 * each mounted its own `useSocket`, the server would see several connections
 * per player and balance frames would race between them.
 *
 * Also accumulates round history, which is only ever delivered *inside* game
 * events (GAME_RESULT, plus CRASH_ROUND_END for the crash strip).
 *
 * The active seed triple arrives two ways: GET /api/seeds/active gives the
 * player's current commitment before they have bet at all, and BET_ACCEPTED /
 * GAME_RESULT carry it forward as the nonce advances — so the fairness dialog
 * stays current without polling.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { GameType } from '@frigat/shared/types';

import type { GameHistoryEntry } from '@/components/games/GameHistoryBar';

import { useSocket, type ClientActionType, type UseSocketResult } from '@/hooks/useSocket';
import { useBalance, type UseBalanceResult } from '@/hooks/useBalance';
import { readStoredToken, subscribeToToken, writeStoredToken } from '@/lib/token';

const MAX_HISTORY = 40;

export interface SeedInfo {
  clientSeed: string;
  hashedServerSeed: string;
  nonce: number;
}

export interface CrashRound {
  id: string;
  crashPoint: number;
  serverSeed?: string;
  clientSeed?: string;
}

export interface GameSocketContextValue {
  socket: UseSocketResult;
  balance: UseBalanceResult;
  token: string | null;
  setToken: (token: string | null) => void;
  seed: SeedInfo | null;
  seedLoading: boolean;
  seedError: string | null;
  /** Server seed revealed by the most recent rotation, if any. */
  revealedServerSeed: string | null;
  revealedHashedServerSeed: string | null;
  history: GameHistoryEntry[];
  historyFor: (gameType: GameType) => GameHistoryEntry[];
  crashRounds: CrashRound[];
  send: (type: ClientActionType, gameType: GameType, payload?: Record<string, unknown>) => void;
  fairnessOpen: boolean;
  setFairnessOpen: (open: boolean) => void;
  rotateSeed: (clientSeed: string) => Promise<void>;
  rotating: boolean;
  rotateError: string | null;
}

const GameSocketContext = createContext<GameSocketContextValue | null>(null);

export function useGameSocket(): GameSocketContextValue {
  const ctx = useContext(GameSocketContext);
  if (!ctx) {
    throw new Error('useGameSocket must be used inside <GameSocketProvider>');
  }
  return ctx;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function GameSocketProvider({
  children,
  socketUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000/ws',
  apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
}: {
  children: ReactNode;
  socketUrl?: string;
  apiUrl?: string;
}) {
  const [token, setTokenState] = useState<string | null>(null);
  const [seed, setSeed] = useState<SeedInfo | null>(null);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [revealedServerSeed, setRevealedServerSeed] = useState<string | null>(null);
  const [revealedHashedServerSeed, setRevealedHashedServerSeed] = useState<string | null>(
    null
  );
  const [history, setHistory] = useState<GameHistoryEntry[]>([]);
  const [crashRounds, setCrashRounds] = useState<CrashRound[]>([]);
  const [fairnessOpen, setFairnessOpen] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  // The token is written by the sign-in pages, so on load it is simply read
  // back from localStorage. `?token=…` still works as a development escape
  // hatch for a hand-signed JWT, and is stripped from the URL immediately so
  // it does not end up in history or a referrer header.
  //
  // Reading happens after mount, never during render: localStorage does not
  // exist on the server, and disagreeing with the server's HTML would be a
  // hydration mismatch.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const fromUrl = new URLSearchParams(window.location.search).get('token');
    if (fromUrl) {
      writeStoredToken(fromUrl);
      setTokenState(fromUrl);
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
    } else {
      setTokenState(readStoredToken());
    }

    return subscribeToToken(setTokenState);
  }, []);

  const setToken = useCallback((next: string | null) => {
    setTokenState(next);
    writeStoredToken(next);
  }, []);

  const socket = useSocket({ url: socketUrl, token });
  const balance = useBalance(socket, { fractionDigits: 2 });
  const { subscribe, send: rawSend } = socket;

  /**
   * Every write to `seed` bumps this. A GET that started before a bet
   * acknowledgement or a rotation landed is stale by the time it resolves —
   * applying it would roll the displayed nonce backwards — so responses check
   * that nothing overtook them first.
   */
  const seedEpoch = useRef(0);

  const applySeed = useCallback((next: SeedInfo) => {
    seedEpoch.current += 1;
    setSeed(next);
  }, []);

  useEffect(() => {
    const capture = (data: Record<string, unknown>) => {
      const clientSeed = data.clientSeed;
      const hashedServerSeed = data.hashedServerSeed;
      const nonce = readNumber(data.nonce);
      if (
        typeof clientSeed === 'string' &&
        typeof hashedServerSeed === 'string' &&
        nonce !== null
      ) {
        // The bet consumed this nonce, so the next one is already one higher.
        applySeed({ clientSeed, hashedServerSeed, nonce: nonce + 1 });
      }
    };
    const off = [subscribe('GAME_RESULT', capture), subscribe('BET_ACCEPTED', capture)];
    return () => off.forEach((fn) => fn());
  }, [subscribe, applySeed]);

  useEffect(() => {
    const onResult = (data: Record<string, unknown>) => {
      const multiplier = readNumber(data.multiplier) ?? 0;
      const gameType = data.gameType as GameType | undefined;
      const payout = typeof data.payout === 'string' ? data.payout : null;
      const id =
        typeof data.sessionId === 'string'
          ? data.sessionId
          : `${gameType ?? 'GAME'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setHistory((prev) => [{ id, multiplier, gameType, payout }, ...prev].slice(0, MAX_HISTORY));
    };
    return subscribe('GAME_RESULT', onResult);
  }, [subscribe]);

  useEffect(() => {
    const onRoundEnd = (data: Record<string, unknown>) => {
      const crashPoint = readNumber(data.crashPoint);
      if (crashPoint === null) return;
      const id = typeof data.roundId === 'string' ? data.roundId : `${Date.now()}`;
      setCrashRounds((prev) =>
        [
          {
            id,
            crashPoint,
            serverSeed: typeof data.serverSeed === 'string' ? data.serverSeed : undefined,
            clientSeed: typeof data.clientSeed === 'string' ? data.clientSeed : undefined,
          },
          ...prev,
        ].slice(0, MAX_HISTORY)
      );
    };
    return subscribe('CRASH_ROUND_END', onRoundEnd);
  }, [subscribe]);

  const send = useCallback(
    (type: ClientActionType, gameType: GameType, payload: Record<string, unknown> = {}) => {
      rawSend({ type, gameType, payload });
    },
    [rawSend]
  );

  const historyFor = useCallback(
    (gameType: GameType) => history.filter((entry) => entry.gameType === gameType),
    [history]
  );

  const refreshSeed = useCallback(async () => {
    if (!token) return;
    const epoch = seedEpoch.current;
    setSeedLoading(true);
    setSeedError(null);
    try {
      const response = await fetch(`${apiUrl}/api/seeds/active`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`Could not load seed (${response.status})`);

      const body = (await response.json()) as Partial<SeedInfo>;
      if (
        typeof body.clientSeed !== 'string' ||
        typeof body.hashedServerSeed !== 'string' ||
        typeof body.nonce !== 'number'
      ) {
        throw new Error('Malformed seed response');
      }
      if (seedEpoch.current !== epoch) return;
      applySeed({
        clientSeed: body.clientSeed,
        hashedServerSeed: body.hashedServerSeed,
        nonce: body.nonce,
      });
    } catch (error) {
      setSeedError(error instanceof Error ? error.message : 'Could not load seed');
    } finally {
      setSeedLoading(false);
    }
  }, [apiUrl, applySeed, token]);

  // Load once the player is known, and again whenever they open the dialog —
  // the nonce only advances client-side on games this tab actually played.
  useEffect(() => {
    if (!token) {
      seedEpoch.current += 1;
      setSeed(null);
      setRevealedServerSeed(null);
      setRevealedHashedServerSeed(null);
      return;
    }
    void refreshSeed();
  }, [token, refreshSeed]);

  useEffect(() => {
    if (fairnessOpen) void refreshSeed();
  }, [fairnessOpen, refreshSeed]);

  /**
   * Rotation retires the current pair and reveals its server seed, so the
   * player can recompute every bet made under the commitment they were shown.
   */
  const rotateSeed = useCallback(
    async (clientSeed: string) => {
      setRotating(true);
      setRotateError(null);
      try {
        const response = await fetch(`${apiUrl}/api/seeds/rotate`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ clientSeed }),
        });
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;
          throw new Error(detail?.message ?? `Rotation failed (${response.status})`);
        }
        const body = (await response.json()) as Partial<SeedInfo> & {
          serverSeed?: string | null;
          previousHashedServerSeed?: string | null;
        };
        if (body.serverSeed) setRevealedServerSeed(body.serverSeed);
        if (body.previousHashedServerSeed) {
          setRevealedHashedServerSeed(body.previousHashedServerSeed);
        }
        if (body.clientSeed && body.hashedServerSeed && typeof body.nonce === 'number') {
          applySeed({
            clientSeed: body.clientSeed,
            hashedServerSeed: body.hashedServerSeed,
            nonce: body.nonce,
          });
        }
      } catch (error) {
        setRotateError(
          error instanceof Error ? error.message : 'Could not rotate seed'
        );
      } finally {
        setRotating(false);
      }
    },
    [apiUrl, applySeed, token]
  );

  const value = useMemo<GameSocketContextValue>(
    () => ({
      socket,
      balance,
      token,
      setToken,
      seed,
      seedLoading,
      seedError,
      revealedServerSeed,
      revealedHashedServerSeed,
      history,
      historyFor,
      crashRounds,
      send,
      fairnessOpen,
      setFairnessOpen,
      rotateSeed,
      rotating,
      rotateError,
    }),
    [
      socket,
      balance,
      token,
      setToken,
      seed,
      seedLoading,
      seedError,
      revealedServerSeed,
      revealedHashedServerSeed,
      history,
      historyFor,
      crashRounds,
      send,
      fairnessOpen,
      rotateSeed,
      rotating,
      rotateError,
    ]
  );

  return (
    <GameSocketContext.Provider value={value}>{children}</GameSocketContext.Provider>
  );
}
