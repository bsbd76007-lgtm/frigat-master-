'use client';

import { useEffect, useState } from 'react';

import { apiFetch } from '@/lib/api';
import type { GameEngineType } from '@/lib/gameCatalogue';
export type RtpMap = Partial<Record<GameEngineType, number>>;

let cache: RtpMap | null = null;
let inFlight: Promise<RtpMap> | null = null;

function load(): Promise<RtpMap> {
  if (cache) return Promise.resolve(cache);
  if (inFlight) return inFlight;

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
