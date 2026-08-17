'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

/** Presence changes slowly; a tighter poll would be traffic for nothing. */
const POLL_MS = 30_000;

export function PlayersOnline() {
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    const read = () => {
      apiFetch('api/presence')
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { online?: number } | null) => {
          if (!active) return;
          const value = body?.online;
          // The server reports a Set size, so this is belt and braces: a
          // malformed or negative payload must never render as "-1 players".
          if (typeof value !== 'number' || !Number.isFinite(value)) return;
          setOnline(Math.max(0, Math.floor(value)));
        })
        .catch(() => {
          /* no-op */
        });
    };

    read();
    const id = setInterval(read, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (online === null) return null;

  return (
    <span
      className="presence"
      title="Players with a live connection right now"
      aria-live="polite"
    >
      <span
        className={`presence__dot${online > 0 ? ' presence__dot--live' : ''}`}
        aria-hidden="true"
      />
      <span className="presence__count">{online.toLocaleString()}</span>
      <span className="presence__label">
        {online === 1 ? 'Player Online' : 'Players Online'}
      </span>
    </span>
  );
}

export default PlayersOnline;
