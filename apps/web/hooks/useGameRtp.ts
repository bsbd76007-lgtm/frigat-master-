'use client';

/**
 * FRIGAT — Per-game RTP
 *
 * Reads `GET /api/games/rtp`, which derives its figures from the same
 * HOUSE_EDGE constant the engines settle against. Fetching rather than
 * hardcoding is the point: an RTP baked into the client goes stale the moment
 * an edge is retuned, and a stale RTP is a false claim about a payout.
 *
 * Module-level cache: RTP does not change within a session, and the launcher
 * modal mounts once per game opened. One request per page load, shared by
 * every caller — including the ones that mount while the first is still in
 * flight, which is what the promise (rather than the result) is cached for.
 */

import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';
import type { GameEngineType } from '@/lib/gameCatalogue';
export type RtpMap = Partial<Record<GameEngineType, number>>;

let cache: RtpMap | null = null;
let inFlight: Promise<RtpMap> | null = null;

function load(): Promise<RtpMap> {
  if (cache) return Promise.resolve(cache);
  if (inFlight) return inFlight;

  // No leading slash: in apiFetch, a path starting with '/' stays same-origin
  // and hits the Next dev server (404), while a bare path is sent to the
  // Fastify API where this route actually lives.
  inFlight = apiFetch('api/games/rtp')
    .then((res) => res.json())
    .then((body: { rtp?: RtpMap }) => {
      cache = body.rtp ?? {};
      return cache;
    })
    .catch(() => {
      inFlight = null;
      return {} as RtpMap;
    });

  return inFlight;
}

/**
 * Returns the RTP percentage for one game, or null while loading and if the
 * lookup failed. Callers render nothing rather than a placeholder: a blank
 * space is honest, "--%" looks like a real value that happens to be missing.
 */
export function useGameRtp(engine: GameEngineType | null): number | null {
  const [rtp, setRtp] = useState<number | null>(
    engine && cache ? (cache[engine] ?? null) : null
  );

  useEffect(() => {
    if (!engine) {
      setRtp(null);
      return;
    }
    let active = true;
    load().then((map) => {
      if (active) setRtp(map[engine] ?? null);
    });
    return () => {
      active = false;
    };
  }, [engine]);

  return rtp;
}
