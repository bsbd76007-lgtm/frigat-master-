'use client';

/**
 * Slot machine — spin timing and sound.
 *
 * The reels animate over an outcome the server already settled, so everything
 * here is presentation: how long a reel spins, how far it overshoots, and what
 * it sounds like when it stops. None of it can change what the reels land on.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { SlotSymbol } from '@frigat/shared';

// ─────────────────────────────────────────────
// Spin choreography
// ─────────────────────────────────────────────

export const TIMING = {
  /** Ramp from rest to full speed. */
  accelerateMs: 380,
  /** Reels keep turning at least this long, however fast the server answers. */
  minSpinMs: 950,
  /** Gap between one reel stopping and the next. */
  stagger: 200,
  /** Length of the settle, including the elastic overshoot. */
  settleMs: 520,
  /** Symbols per second at full speed. */
  topSpeed: 26,
} as const;

/** Cells of runway a reel covers while settling — enough to stay a blur. */
export const SETTLE_TRAVEL = 7;

/** Strip length per reel. Long enough that the landing window is never seen twice. */
export const STRIP_LENGTH = 64;

export type ReelPhase = 'idle' | 'accelerating' | 'spinning' | 'settling' | 'stopped';

export interface Reel {
  /** Symbols the reel is carrying; the landing window is written in on stop. */
  strip: SlotSymbol[];
  /** Scroll position in symbol cells. */
  offset: number;
  velocity: number;
  phase: ReelPhase;
  /** When this reel should begin settling (performance.now), once known. */
  settleAt: number | null;
  settleFrom: number;
  settleTo: number;
  settleStartedAt: number;
}

export interface SlotSpinResponse {
  sessionId: string;
  reelMatrix: SlotSymbol[][];
  winningLines: Array<{
    lineIndex: number;
    symbol: SlotSymbol;
    count: number;
    cells: Array<[number, number]>;
    payout: string;
  }>;
  totalWin: string;
  newBalance: string;
  betAmount: string;
  multiplier: number;
  hashedServerSeed: string;
  clientSeed: string;
  nonce: number;
}

/**
 * Sound triggers. Left as injectable no-ops so a host app can drop in real
 * samples without this component owning an asset pipeline; the built-in
 * fallback synthesises tones with WebAudio and is muted until asked for.
 */
export interface SlotSounds {
  onSpinStart: () => void;
  onReelStop: (reelIndex: number) => void;
  onWin: (totalWin: string) => void;
  onLose: () => void;
}

export const SILENT: SlotSounds = {
  onSpinStart: () => {},
  onReelStop: () => {},
  onWin: () => {},
  onLose: () => {},
};

/**
 * Minimal WebAudio blips, created lazily on the first *user-gesture-driven*
 * play so the browser's autoplay policy is never tripped.
 */
export function useDefaultSounds(enabled: boolean): SlotSounds {
  const ctxRef = useRef<AudioContext | null>(null);

  const tone = useCallback(
    (frequency: number, durationMs: number, type: OscillatorType = 'triangle', gain = 0.05) => {
      if (!enabled || typeof window === 'undefined') return;
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) return;
      const audio: AudioContext = ctxRef.current ?? (ctxRef.current = new Ctor());
      if (audio.state === 'suspended') void audio.resume();

      const osc = audio.createOscillator();
      const amp = audio.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      amp.gain.setValueAtTime(gain, audio.currentTime);
      amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + durationMs / 1000);
      osc.connect(amp).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + durationMs / 1000);
    },
    [enabled]
  );

  useEffect(
    () => () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    []
  );

  return useMemo<SlotSounds>(
    () => ({
      onSpinStart: () => tone(180, 140, 'sawtooth', 0.035),
      onReelStop: (reel) => tone(300 + reel * 45, 90, 'square', 0.03),
      onWin: () => {
        tone(660, 140);
        window.setTimeout(() => tone(880, 180), 120);
        window.setTimeout(() => tone(1180, 260), 260);
      },
      onLose: () => tone(140, 180, 'sine', 0.02),
    }),
    [tone]
  );
}

