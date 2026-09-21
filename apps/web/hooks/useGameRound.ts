'use client';

/**
 * FRIGAT — one round of a socket game.
 *
 * Every instant-bet page repeated the same three-part preamble: subscribe to
 * GAME_RESULT, drop every frame whose `gameType` belongs to another game,
 * and keep a `busy` flag that ERROR has to remember to clear. Forgetting the
 * gameType guard is the interesting bug — the socket is shared across the whole
 * dashboard, so a plinko result would otherwise render on the dice page.
 *
 * What stays in the page is what actually differs: how a result is drawn, and
 * how long the drawing takes.
 *
 * `busy` and the reveal animation are deliberately separate. A game that plays
 * the result out (the roulette ball, the limbo count-up, the plinko drop) has a
 * gap between "the server has decided" and "the player can see it", and the
 * controls must stay locked across that gap or a second bet lands mid-round.
 * Those games pass `autoSettle: false` and call `settle()` when the animation
 * ends; games that render the result immediately get the default.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { GameType } from '@frigat/shared/types';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import type { ClientActionType, ServerEventType } from '@/hooks/useSocket';

export interface GameResultFrame<TResult> {
  /** `resultData` from the server frame — the per-game payload. */
  result: TResult | undefined;
  win: boolean;
  /** Decimal string, or null when the server sent no payout. */
  payout: string | null;
  /** The whole frame, for the rare field not worth promoting. */
  raw: Record<string, unknown>;
}

export interface UseGameRoundOptions<TResult> {
  /** A GAME_RESULT for this game — and only this game — has arrived. */
  onResult?: (frame: GameResultFrame<TResult>) => void;
  /**
   * The server rejected the bet. `busy` is already false by the time this runs,
   * so a handler only needs to undo whatever else `begin()` set up.
   */
  onError?: () => void;
  /** Clear `busy` as soon as the result lands. Default true — see above. */
  autoSettle?: boolean;
  /**
   * Any other server frame this game cares about — BET_ACCEPTED and
   * STATE_UPDATE for the multi-step games, the CRASH_* round frames for crash.
   * Handlers are free of the resubscribe problem the same way onResult is, but
   * `busy` is left alone: a multi-step round decides for itself when the player
   * may act again.
   *
   * A frame is dropped only when it names a *different* game. Frames that carry
   * no gameType at all — the crash round broadcasts — are not game-scoped, so
   * there is nothing to filter and they pass through.
   *
   * ERROR does not belong here: `onError` clears `busy` first, which is what
   * a rejected bet almost always needs.
   */
  on?: Partial<Record<ServerEventType, (data: Record<string, unknown>) => void>>;
}

export interface UseGameRoundResult {
  /** A bet is in flight, or its result is still being revealed. */
  busy: boolean;
  /** Locks the controls without sending anything — for multi-step games. */
  begin: () => void;
  /** Unlocks the controls. Call when the reveal animation finishes. */
  settle: () => void;
  /** Locks the controls and sends the bet in one step. */
  bet: (action: ClientActionType, payload: Record<string, unknown>) => void;
}

export function useGameRound<TResult = Record<string, unknown>>(
  gameType: GameType,
  options: UseGameRoundOptions<TResult> = {}
): UseGameRoundResult {
  const { socket, send } = useGameSocket();
  const { subscribe } = socket;

  const [busy, setBusy] = useState(false);

  // Held in a ref so a page can close over fresh state in its handlers without
  // tearing down and re-establishing the subscription on every render — which
  // would drop a frame that arrives during the swap.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Read once on mount: adding or removing an event mid-life would mean
  // resubscribing, and the set a game listens to is fixed by the game.
  const extraEventsRef = useRef(Object.keys(options.on ?? {}) as ServerEventType[]);

  useEffect(() => {
    const off = [
      ...extraEventsRef.current.map((event) =>
        subscribe(event, (data) => {
          if (data.gameType !== undefined && data.gameType !== gameType) return;
          optionsRef.current.on?.[event]?.(data as Record<string, unknown>);
        })
      ),
      subscribe('GAME_RESULT', (data) => {
        if (data.gameType !== gameType) return;

        const { onResult, autoSettle = true } = optionsRef.current;
        onResult?.({
          result: data.resultData as TResult | undefined,
          win: Boolean(data.win),
          payout: typeof data.payout === 'string' ? data.payout : null,
          raw: data as Record<string, unknown>,
        });

        if (autoSettle) setBusy(false);
      }),
      subscribe('ERROR', () => {
        setBusy(false);
        optionsRef.current.onError?.();
      }),
    ];
    return () => off.forEach((fn) => fn());
  }, [subscribe, gameType]);

  const begin = useCallback(() => setBusy(true), []);
  const settle = useCallback(() => setBusy(false), []);

  const bet = useCallback(
    (action: ClientActionType, payload: Record<string, unknown>) => {
      setBusy(true);
      send(action, gameType, payload);
    },
    [send, gameType]
  );

  return { busy, begin, settle, bet };
}

export default useGameRound;
