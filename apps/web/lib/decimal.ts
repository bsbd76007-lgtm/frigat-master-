/**
 * FRIGAT — Decimal String Arithmetic (browser-safe)
 *
 * Money in this platform is Postgres `Decimal(18, 8)` serialized as strings.
 * Every helper here works on scaled BigInt units so bet-sizing math (2x, ½,
 * Max) stays exact. Converting to a JS `number` anywhere in this path would
 * reintroduce the float drift the schema exists to prevent.
 *
 * Rounding is always toward zero (truncation), matching the ledger's
 * ROUND_DOWN policy in socket.server.ts — a client-side quote can never
 * overstate what the server will actually settle.
 */

export const DECIMAL_SCALE = 8;

const SCALE_FACTOR = 10n ** BigInt(DECIMAL_SCALE);
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function isDecimalString(value: string): boolean {
  return DECIMAL_PATTERN.test(value);
}

export function toUnits(value: string): bigint {
  if (!isDecimalString(value)) {
    throw new Error(`decimal: invalid value "${value}"`);
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart = '0', fracPart = ''] = unsigned.split('.');
  const frac = fracPart.slice(0, DECIMAL_SCALE).padEnd(DECIMAL_SCALE, '0');
  const units = BigInt(intPart) * SCALE_FACTOR + BigInt(frac || '0');
  return negative ? -units : units;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const intPart = abs / SCALE_FACTOR;
  const frac = (abs % SCALE_FACTOR)
    .toString()
    .padStart(DECIMAL_SCALE, '0')
    .replace(/0+$/, '');
  const body = frac ? `${intPart}.${frac}` : `${intPart}`;
  return negative && abs !== 0n ? `-${body}` : body;
}

export function normalizeDecimal(value: string): string | null {
  if (!isDecimalString(value)) return null;
  return fromUnits(toUnits(value));
}

export function compareDecimal(a: string, b: string): -1 | 0 | 1 {
  const left = toUnits(a);
  const right = toUnits(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function multiplyDecimal(value: string, factor: bigint): string {
  return fromUnits(toUnits(value) * factor);
}

export function divideDecimal(value: string, divisor: bigint): string {
  if (divisor === 0n) throw new Error('decimal: division by zero');
  return fromUnits(toUnits(value) / divisor);
}

export function minDecimal(a: string, b: string): string {
  return compareDecimal(a, b) <= 0 ? a : b;
}

export function maxDecimal(a: string, b: string): string {
  return compareDecimal(a, b) >= 0 ? a : b;
}

/** Clamps a value into [min, max]. */
export function clampDecimal(value: string, min: string, max: string): string {
  if (compareDecimal(value, min) < 0) return normalizeDecimal(min)!;
  if (compareDecimal(value, max) > 0) return normalizeDecimal(max)!;
  return normalizeDecimal(value)!;
}

/**
 * Formats a decimal string for display without ever touching a float.
 *
 * The integer part is grouped via `Intl` using a BigInt (exact at any size);
 * the fraction is truncated rather than rounded up, so a displayed balance can
 * never overstate the real one.
 */
export function formatDecimalString(
  raw: string,
  fractionDigits = 2,
  locale?: string
): string {
  if (!isDecimalString(raw)) return raw;

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [intPart = '0', fracPart = ''] = unsigned.split('.');

  const formatter = new Intl.NumberFormat(locale);
  const groupedInt = formatter.format(BigInt(intPart));

  if (fractionDigits <= 0) {
    return `${negative && BigInt(intPart) !== 0n ? '-' : ''}${groupedInt}`;
  }

  const truncated = fracPart.slice(0, fractionDigits).padEnd(fractionDigits, '0');

  // Use the locale's own decimal separator rather than assuming '.'.
  const decimalSeparator =
    formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.';

  const isZero = BigInt(intPart) === 0n && /^0*$/.test(truncated);
  const sign = negative && !isZero ? '-' : '';
  return `${sign}${groupedInt}${decimalSeparator}${truncated}`;
}

export function sanitizeDecimalInput(input: string): string {
  let next = input.replace(/[^\d.]/g, '');
  if (next.startsWith('.')) next = `0${next}`;

  const firstDot = next.indexOf('.');
  if (firstDot !== -1) {
    next =
      next.slice(0, firstDot + 1) + next.slice(firstDot + 1).replace(/\./g, '');
  }

  const [intPart, fracPart] = next.split('.');
  if (fracPart !== undefined) {
    next = `${intPart}.${fracPart.slice(0, DECIMAL_SCALE)}`;
  }
  return next;
}
