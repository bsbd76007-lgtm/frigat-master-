'use client';

/**
 * FRIGAT — Game Socket Hook (native WebSocket)
 *
 * Owns a single authenticated connection to the server's `/ws` endpoint and
 * fans inbound events out to subscribers. Deliberately dependency-free: the
 * browser's native WebSocket is enough for this protocol.
 *
 * Behaviour:
 *  - Connects only when a token is present; the server rejects anonymous
 *    upgrades with close code 1008. Omit `token` entirely and the hook reads
 *    `localStorage.token` itself (and follows it when it changes); pass `null`
 *    to hold the connection closed deliberately.
 *  - Reconnects with exponential backoff + jitter, EXCEPT on 1008
 *    (unauthorized) — retrying a rejected token just burns connections.
 *  - Messages sent while the socket is still connecting are queued and
 *    flushed on open, so callers never have to poll `status` before betting.
 *  - Safe under React StrictMode's double-mount: the teardown marks the close
 *    as intentional so no stray reconnect is scheduled.
 *
 * Note: there is no application-level heartbeat because the server has no PING
 * action (it would answer with an ERROR). Liveness relies on the browser's
 * protocol-level ping/pong and the close event.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameType } from '@frigat/shared/types';
import { readStoredToken, subscribeToToken } from '@/lib/token';

export type ClientActionType =
  | 'BET'
  | 'CASHOUT'
  | 'SPIN'
  | 'REVEAL_TILE'
  | 'RESUME'
  | 'CHAT';

export interface ClientMessage {
  type: ClientActionType;
  gameType?: GameType;
  payload: Record<string, unknown>;
}

export type ServerEventType =
  | 'BET_ACCEPTED'
  | 'GAME_RESULT'
  | 'RESUME_NONE'
  | 'STATE_UPDATE'
  | 'SUPPORT_MESSAGE'
  | 'SUPPORT_TICKET'
  | 'BALANCE'
  | 'CRASH_TICK'
  | 'CRASH_ROUND_START'
  | 'CRASH_ROUND_END'
  | 'CHAT_MESSAGE'
  | 'LIVE_BET'
  | 'ERROR';

export interface ServerMessage {
  type: ServerEventType;
  data: Record<string, unknown>;
}

export type SocketStatus =
  | 'idle' // no token / disabled — never attempted
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'unauthorized'; // server rejected the token (1008) — terminal

export type MessageHandler<N extends { type: string } = ServerMessage> = (
  data: Record<string, unknown>,
  message: N
) => void;

export interface UseSocketOptions {
  url: string;
  /**
   * JWT presented to the server. `null` keeps the hook dormant; omitting the
   * field reads `localStorage.token` instead.
   */
  token?: string | null;
  enabled?: boolean;
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxRetries?: number;
}

export interface UseSocketResult<CM extends { type: string } = ClientMessage, SM extends { type: string } = ServerMessage> {
  status: SocketStatus;
  isOpen: boolean;
  error: string | null;
  subscribe: (type: SM['type'], handler: MessageHandler<SM>) => () => void;
  subscribeAll: (handler: MessageHandler<SM>) => () => void;
  send: (message: CM) => void;
  reconnect: () => void;
  disconnect: () => void;
}

function buildUrl(url: string, token: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * Reads the persisted session token and tracks later changes to it (including
 * a sign-out performed in another tab).
 *
 * Starts as `null` and fills in after mount rather than reading during render:
 * localStorage does not exist on the server, and a first client render that
 * disagreed with the server's HTML would be a hydration mismatch.
 */
export function useStoredToken(): string | null {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(readStoredToken());
    return subscribeToToken(setToken);
  }, []);

  return token;
}

export function useSocket(options: UseSocketOptions): UseSocketResult {
  const {
    url,
    enabled = true,
    baseDelayMs = 500,
    maxDelayMs = 15_000,
    maxRetries = Number.POSITIVE_INFINITY,
  } = options;

  const storedToken = useStoredToken();
  const token = options.token === undefined ? storedToken : options.token;

  const [status, setStatus] = useState<SocketStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Map<string | '*', Set<MessageHandler>>());
  const outboxRef = useRef<string[]>([]);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  // Keep tuning knobs in refs so the connect effect depends only on identity
  // (url/token/enabled) and never tears the socket down over a changed number.
  const tuningRef = useRef({ baseDelayMs, maxDelayMs, maxRetries });
  tuningRef.current = { baseDelayMs, maxDelayMs, maxRetries };

  const dispatch = useCallback((message: ServerMessage) => {
    const byType = listenersRef.current.get(message.type);
    if (byType) {
      for (const handler of [...byType]) handler(message.data, message);
    }
    const wildcard = listenersRef.current.get('*');
    if (wildcard) {
      for (const handler of [...wildcard]) handler(message.data, message);
    }
  }, []);

  const addListener = useCallback((key: string | '*', handler: MessageHandler) => {
    let set = listenersRef.current.get(key);
    if (!set) {
      set = new Set();
      listenersRef.current.set(key, set);
    }
    set.add(handler);
    return () => {
      const current = listenersRef.current.get(key);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) listenersRef.current.delete(key);
    };
  }, []);

  const subscribe = useCallback(
    (type: ServerEventType, handler: MessageHandler) => addListener(type, handler),
    [addListener]
  );

  const subscribeAll = useCallback(
    (handler: MessageHandler) => addListener('*', handler),
    [addListener]
  );

  const send = useCallback((message: ClientMessage) => {
    const raw = JSON.stringify(message);
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(raw);
    } else {
      outboxRef.current.push(raw);
      if (outboxRef.current.length > 64) outboxRef.current.shift();
    }
  }, []);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    socketRef.current?.close(1000, 'client disconnect');
    socketRef.current = null;
    setStatus('closed');
  }, []);

  const reconnect = useCallback(() => {
    attemptsRef.current = 0;
    setError(null);
    setReconnectNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !token) {
      setStatus('idle');
      return;
    }

    let disposed = false;
    intentionalCloseRef.current = false;

    const open = () => {
      if (disposed) return;

      let socket: WebSocket;
      try {
        socket = new WebSocket(buildUrl(url, token));
      } catch (err) {
        setStatus('closed');
        setError(err instanceof Error ? err.message : 'Invalid socket URL');
        return;
      }
      socketRef.current = socket;
      setStatus(attemptsRef.current === 0 ? 'connecting' : 'reconnecting');

      socket.onopen = () => {
        if (disposed) return;
        attemptsRef.current = 0;
        setStatus('open');
        setError(null);
        const queued = outboxRef.current;
        outboxRef.current = [];
        for (const raw of queued) socket.send(raw);
      };

      socket.onmessage = (event: MessageEvent) => {
        if (disposed) return;
        let parsed: ServerMessage;
        try {
          parsed = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (!parsed || typeof parsed.type !== 'string') return;
        if (parsed.type === 'ERROR') {
          const message = parsed.data?.message;
          setError(typeof message === 'string' ? message : 'Server error');
        }
        dispatch({ type: parsed.type, data: parsed.data ?? {} });
      };

      socket.onerror = () => {
        if (!disposed) setError((prev) => prev ?? 'Socket connection error');
      };

      socket.onclose = (event: CloseEvent) => {
        if (disposed || intentionalCloseRef.current) return;
        socketRef.current = null;

        // 1008 = policy violation; the server uses it for a rejected token.
        // Retrying cannot succeed until the caller supplies a new one.
        if (event.code === 1008) {
          setStatus('unauthorized');
          setError(event.reason || 'Unauthorized');
          return;
        }

        const { baseDelayMs: base, maxDelayMs: max, maxRetries: cap } = tuningRef.current;
        if (attemptsRef.current >= cap) {
          setStatus('closed');
          setError((prev) => prev ?? 'Connection lost');
          return;
        }

        const backoff = Math.min(max, base * 2 ** attemptsRef.current);
        const jittered = backoff * (0.75 + Math.random() * 0.5);
        attemptsRef.current += 1;
        setStatus('reconnecting');
        retryTimerRef.current = setTimeout(open, jittered);
      };
    };

    open();

    return () => {
      disposed = true;
      intentionalCloseRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState <= WebSocket.OPEN) {
        socket.close(1000, 'client unmount');
      }
    };
  }, [url, token, enabled, reconnectNonce, dispatch]);

  return useMemo(
    () => ({
      status,
      isOpen: status === 'open',
      error,
      subscribe,
      subscribeAll,
      send,
      reconnect,
      disconnect,
    }),
    [status, error, subscribe, subscribeAll, send, reconnect, disconnect]
  );
}

export default useSocket;
