import { formatDecimalString, fromUnits, toUnits } from '@/lib/decimal';

export interface LiveBet {
  id: string;
  userId: string;
  username: string;
  gameType: string;
  betAmount: string;
  multiplier: number;
  payout: string;
  timestamp: number;
}

export interface BetFairness {
  hashedServerSeed: string;
  serverSeed: string | null;
  revealed: boolean;
  clientSeed: string;
  nonce: number;
}

export interface BetDetail extends LiveBet {
  fairness: BetFairness;
}

/**
 * Net result of a round: payout − stake, as an exact decimal string.
 *
 * Money never goes through a float here. `toUnits` puts both sides on the same
 * 8-dp integer scale, so the subtraction is exact for any size of bet.
 */
export function betProfit(bet: Pick<LiveBet, 'betAmount' | 'payout'>): string {
  return fromUnits(toUnits(bet.payout) - toUnits(bet.betAmount));
}

export function isWin(bet: Pick<LiveBet, 'betAmount' | 'payout'>): boolean {
  return toUnits(bet.payout) > toUnits(bet.betAmount);
}

export function formatSignedUsd(amount: string, locale?: string): string {
  const negative = amount.startsWith('-');
  const unsigned = negative ? amount.slice(1) : amount;
  return `${negative ? '-' : ''}$${formatDecimalString(unsigned, 2, locale)}`;
}

export function formatUsd(amount: string, locale?: string): string {
  return `$${formatDecimalString(amount.replace(/^-/, ''), 2, locale)}`;
}

/**
 * `2,00×` in ru — the reference uses a comma decimal, which is just the
 * locale's own separator, so this defers to Intl rather than hardcoding it.
 */
export function formatMultiplier(multiplier: number, locale?: string): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(multiplier)}×`;
}

export function formatBetTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} в ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
