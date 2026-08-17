'use client';

/**
 * FRIGAT — Six-box verification code input
 *
 * Extracted from the passwordless sign-in form once three flows needed it:
 * passwordless login, the second factor after a password, and registration.
 * Keeping one copy is what stops the paste handling and the auto-submit from
 * drifting apart between them.
 *
 * Six inputs rather than one so a pasted code lands correctly and each digit is
 * its own target on a phone — but they behave as a single field: typing
 * advances, backspace on an empty box steps back, arrows move, and a paste
 * fills the row.
 *
 * `onComplete` fires as soon as the sixth digit lands. A code is not a
 * decision; making the player reach for a button after typing it is friction
 * for no gain.
 */

import { useRef, type ClipboardEvent } from 'react';

export const OTP_DIGITS = 6;

export function emptyDigits(): string[] {
  return Array(OTP_DIGITS).fill('');
}

export interface OtpDigitsProps {
  digits: string[];
  onDigitsChange: (digits: string[]) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  /** Distinguishes the boxes when more than one form is on a page. */
  idPrefix?: string;
  label?: string;
}

export function OtpDigits({
  digits,
  onDigitsChange,
  onComplete,
  disabled = false,
  idPrefix = 'otp',
  label = 'Verification code',
}: OtpDigitsProps) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const labelId = `${idPrefix}-code-label`;

  /** Focuses a box, guarding the ends so a paste of six cannot overrun. */
  const focusBox = (index: number) => {
    boxes.current[Math.max(0, Math.min(index, OTP_DIGITS - 1))]?.focus();
  };

  const setDigit = (index: number, raw: string) => {
    const value = raw.replace(/\D/g, '');
    if (!value) {
      onDigitsChange(digits.map((d, i) => (i === index ? '' : d)));
      return;
    }

    const next = [...digits];
    // A paste or a fast typist can deliver several digits to one box; spread
    // them across the row rather than dropping all but the first.
    for (let i = 0; i < value.length && index + i < OTP_DIGITS; i += 1) {
      next[index + i] = value[i];
    }
    onDigitsChange(next);

    // Every box must hold a digit. Testing the joined string for '' would
    // always pass — every string contains the empty string — so the check has
    // to be per box.
    if (next.every((entry) => entry !== '')) onComplete(next.join(''));

    focusBox(index + value.length);
  };

  const onKeyDown = (index: number, key: string) => {
    if (key === 'Backspace' && !digits[index] && index > 0) focusBox(index - 1);
    if (key === 'ArrowLeft' && index > 0) focusBox(index - 1);
    if (key === 'ArrowRight' && index < OTP_DIGITS - 1) focusBox(index + 1);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, OTP_DIGITS);
    if (!pasted) return;
    event.preventDefault();

    const next = emptyDigits();
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i];
    onDigitsChange(next);

    if (pasted.length === OTP_DIGITS) onComplete(pasted);
    else focusBox(pasted.length);
  };

  return (
    <div className="auth__field">
      <span className="auth__label" id={labelId}>
        {label}
      </span>
      <div className="auth__otp" role="group" aria-labelledby={labelId}>
        {digits.map((digit, index) => (
          <input
            // Position is the identity here; the boxes are never reordered.
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            ref={(el) => {
              boxes.current[index] = el;
            }}
            className="auth__otp-box"
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={OTP_DIGITS}
            value={digit}
            disabled={disabled}
            aria-label={`Digit ${index + 1} of ${OTP_DIGITS}`}
            onChange={(event) => setDigit(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event.key)}
            onPaste={onPaste}
            onFocus={(event) => event.currentTarget.select()}
          />
        ))}
      </div>
    </div>
  );
}

/** Focuses the first box of a freshly revealed code step. */
export function focusFirstOtpBox(): void {
  window.setTimeout(() => {
    const first = document.querySelector<HTMLInputElement>('.auth__otp-box');
    first?.focus();
  }, 50);
}

export default OtpDigits;
