'use client';

/**
 * FRIGAT — "N Players Online" chip
 *
 * Polls /api/presence, which reports the real number of distinct users holding
 * an authenticated socket. Nothing here pads, floors or animates the figure
 * upward: an inflated presence count is invented social proof, and it is read
 * by players as evidence the room is worth joining.
 *
 * Because it is real, it can be small — 1, or 0 on a quiet night. So the chip
 * renders nothing at all until the first successful poll, and shows a neutral
 * dot rather than a "live" pulse when the count is zero. It never claims a
 * crowd it does not have, and it never looks broken for telling the truth.
 */

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
          if (!active || typeof body?.online !== 'number') return;
          setOnline(body.online);
        })
        .catch(() => {
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
      // Presence updates on a timer the user did not trigger; polite so it does
      // not interrupt whatever a screen reader is currently reading.
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
