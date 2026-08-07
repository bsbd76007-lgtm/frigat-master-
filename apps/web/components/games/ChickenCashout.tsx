'use client';

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
