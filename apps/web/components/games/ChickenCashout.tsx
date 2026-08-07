'use client';

/**
 * FRIGAT — Chicken Road cash-out button
 *
 * The glowing teal control from the reference: the live cash-out value in the
 * centre, the multiplier that earned it underneath.
 *
 * The figure is `stake × multiplier`, where the multiplier is the server's
 * running value from STEP_RESULT — not a locally-extrapolated one. What the
 * button shows is what CASHOUT settles at, so the number a player acts on is
 * the number they receive.
 *
 * Disabled until at least one lane is behind them, because the server rejects
 * a zero-lane cash-out; offering a button that is guaranteed to fail is worse
 * than not offering it.
 */

interface ChickenCashoutProps {
  amount: string;
  multiplier: number;
  crossed: number;
  disabled?: boolean;
  onCashout: () => void;
}

export function ChickenCashout({
  amount,
  multiplier,
  crossed,
  disabled,
  onCashout,
}: ChickenCashoutProps) {
  const value = (Number(amount) || 0) * multiplier;
  const ready = crossed > 0 && !disabled;

  return (
    <button
      type="button"
      className="cashout"
      onClick={onCashout}
      disabled={!ready}
      aria-label={`Cash out $${value.toFixed(2)} at ${multiplier.toFixed(2)} times`}
    >
      <span className="cashout__label">Cash Out</span>
      <b className="cashout__value">${value.toFixed(2)}</b>
      <small className="cashout__mult">{multiplier.toFixed(2)}×</small>
    </button>
  );
}

export default ChickenCashout;
