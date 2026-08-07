/**
 * FRIGAT — Roulette Engine (European, single zero: pockets 0–36)
 * Pocket = floor(outcome * 37). The single green zero supplies the house edge,
 * so no extra edge factor is applied to individual payouts.
 *
 * Supported bet positions:
 *   'straight:<0-36>'  35:1
 *   'red' | 'black'    1:1
 *   'odd' | 'even'     1:1
 *   'low'  (1-18)      1:1
 *   'high' (19-36)     1:1
 *   'dozen:1|2|3'      2:1
 *   'column:1|2|3'     2:1
 */

import { calculateOutcome } from '@frigat/shared';
import { ROULETTE_PAYOUTS, ROULETTE_RED } from '../config/game.config';
import type { EngineResult, SeedContext } from '../types/engine.types';

export interface RouletteBet {
  position: string;
  amount: string; // decimal string
}

export interface RouletteParams {
  bets: RouletteBet[];
}

function colorOf(pocket: number): 'GREEN' | 'RED' | 'BLACK' {
  if (pocket === 0) return 'GREEN';
  return ROULETTE_RED.has(pocket) ? 'RED' : 'BLACK';
}

/** Gross payout multiplier for a bet on `position` given the winning pocket (0 if it loses). */
function grossMultiplier(position: string, pocket: number): number {
  const [kind, arg] = position.split(':');

  switch (kind) {
    case 'straight':
      return Number(arg) === pocket ? ROULETTE_PAYOUTS.straight : 0;
    case 'red':
      return colorOf(pocket) === 'RED' ? ROULETTE_PAYOUTS.color : 0;
    case 'black':
      return colorOf(pocket) === 'BLACK' ? ROULETTE_PAYOUTS.color : 0;
    case 'odd':
      return pocket !== 0 && pocket % 2 === 1 ? ROULETTE_PAYOUTS.parity : 0;
    case 'even':
      return pocket !== 0 && pocket % 2 === 0 ? ROULETTE_PAYOUTS.parity : 0;
    case 'low':
      return pocket >= 1 && pocket <= 18 ? ROULETTE_PAYOUTS.range : 0;
    case 'high':
      return pocket >= 19 && pocket <= 36 ? ROULETTE_PAYOUTS.range : 0;
    case 'dozen': {
      const d = Number(arg);
      const lo = (d - 1) * 12 + 1;
      return pocket >= lo && pocket <= lo + 11 ? ROULETTE_PAYOUTS.dozen : 0;
    }
    case 'column': {
      const c = Number(arg); // 1,2,3 → pocket % 3 == c%3 pattern
      return pocket !== 0 && pocket % 3 === c % 3 ? ROULETTE_PAYOUTS.column : 0;
    }
    default:
      throw new Error(`roulette: unknown bet position "${position}"`);
  }
}

export function spin(params: RouletteParams, seed: SeedContext): EngineResult {
  const bets = params.bets ?? [];
  if (bets.length === 0) throw new Error('roulette: at least one bet required');

  const u = calculateOutcome(seed.serverSeed, seed.clientSeed, seed.nonce);
  const pocket = Math.floor(u * 37); // 0..36

  let totalStake = 0;
  let totalReturn = 0;
  const perBet = bets.map((b) => {
    const stake = Number(b.amount);
    if (!(stake > 0)) throw new Error('roulette: bet amount must be positive');
    const gm = grossMultiplier(b.position, pocket);
    totalStake += stake;
    totalReturn += stake * gm;
    return { position: b.position, stake: b.amount, grossMultiplier: gm };
  });

  const effectiveMultiplier = totalStake > 0 ? totalReturn / totalStake : 0;

  return {
    win: totalReturn > totalStake,
    multiplier: Math.floor(effectiveMultiplier * 100) / 100,
    resultData: { pocket, color: colorOf(pocket), perBet },
  };
}
