'use client';

/**
 * FRIGAT — Provably Fair Modal
 *
 * Surfaces the fairness commitment for the player's active seed pair:
 *
 *   hashedServerSeed  SHA256(serverSeed), published BEFORE any bet
 *   clientSeed        player-supplied entropy
 *   nonce             per-bet counter within the active pair
 *
 * Rotating the seed deactivates the current pair and REVEALS its serverSeed,
 * letting the player recompute every past outcome and check it against the
 * commitment they were shown up front. That reveal is the whole point of the
 * scheme, so the UI states it plainly before the player confirms.
 *
 * Mirrors the server contract in provableFair.service.ts: `setClientSeed`
 * requires 4–128 characters.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useLanguage } from '@/components/providers/LanguageProvider';

import { useInjectedStyles } from '@/lib/useInjectedStyles';
import {

  calculateOutcome,
  verifyCoinflip,
  verifyCommitment,
  verifyCrash,
  verifyDice,
  verifyLimbo,
  verifyMines,
  verifyRoulette,
  VERIFIABLE_GAMES,
  type VerifiableGame,
} from '@/lib/verify';
/** Matches the bounds enforced by setClientSeed() on the server. */
export const CLIENT_SEED_MIN_LENGTH = 4;
export const CLIENT_SEED_MAX_LENGTH = 128;

export interface ProvablyFairModalProps {
  open: boolean;
  onClose: () => void;
  clientSeed: string;
  hashedServerSeed: string;
  nonce: number;
  loading?: boolean;
  previousServerSeed?: string | null;
  previousHashedServerSeed?: string | null;
  onRotateSeed: (clientSeed: string) => void | Promise<void>;
  rotating?: boolean;
  error?: string | null;
  className?: string;
}

const STYLE_ID = 'fg-pf-modal-styles';
const CSS = `
.fg-pf__backdrop { position: fixed; inset: 0; z-index: 1000; display: flex;
  align-items: center; justify-content: center; padding: 16px;
  background: rgba(5, 8, 12, .72); backdrop-filter: blur(3px);
  animation: fg-pf-fade .16s ease-out; }
.fg-pf { width: 100%; max-width: 520px; max-height: calc(100vh - 32px);
  overflow-y: auto; box-sizing: border-box; padding: 20px;
  background: var(--fg-panel); border: 1px solid var(--fg-line); border-radius: 16px;
  box-shadow: 0 24px 60px rgba(0,0,0,.55); color: var(--fg-text);
  font-family: var(--fg-font);
  animation: fg-pf-rise .18s ease-out; }
.fg-pf__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.fg-pf__title { margin: 0; font-size: 17px; font-weight: 700; }
.fg-pf__sub { margin: 6px 0 0; font-size: 13px; line-height: 1.5; color: var(--fg-muted); }
.fg-pf__close { flex: 0 0 auto; width: 32px; height: 32px; display: grid; place-items: center;
  font-size: 18px; line-height: 1; color: var(--fg-text); background: var(--fg-line-2);
  border: 1px solid var(--fg-line); border-radius: 8px; cursor: pointer;
  transition: color .15s ease, border-color .15s ease; }
.fg-pf__close:hover { color: var(--fg-text); border-color: var(--fg-line-2); }
.fg-pf__close:focus-visible { outline: none; border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(245, 158, 11,.2); }
.fg-pf__list { display: flex; flex-direction: column; gap: 12px; margin: 18px 0 0; }
.fg-pf__item { display: flex; flex-direction: column; gap: 5px; }
.fg-pf__key { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600;
  letter-spacing: .05em; text-transform: uppercase; color: var(--fg-muted); }
.fg-pf__val { display: flex; align-items: center; gap: 8px; }
.fg-pf__hint { display: inline-grid; place-items: center; width: 14px; height: 14px;
  font-size: 9.5px; font-weight: 700; letter-spacing: 0; color: var(--fg-muted);
  background: var(--fg-line-2); border-radius: 50%; cursor: help; }
.fg-pf__hint:hover { color: var(--fg-text); }
.fg-pf__hint:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(245, 158, 11,.45); }
.fg-pf__code { flex: 1 1 auto; min-width: 0; padding: 9px 11px; font-size: 12.5px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fg-text);
  background: var(--fg-bg); border: 1px solid var(--fg-hover-2); border-radius: 7px;
  overflow-wrap: anywhere; }
.fg-pf__code--muted { color: #6b7787; font-style: italic; }
.fg-pf__copy { flex: 0 0 auto; padding: 8px 11px; font-size: 12px; font-weight: 600;
  color: var(--fg-text); background: var(--fg-panel-2); border: 1px solid var(--fg-line); border-radius: 7px;
  cursor: pointer; transition: background .15s ease, color .15s ease; }
.fg-pf__copy:hover { background: var(--fg-hover-2); color: #fff; }
.fg-pf__copy:focus-visible { outline: none; border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(245, 158, 11,.2); }
.fg-pf__rotate { margin: 20px 0 0; padding: 16px 0 0; border-top: 1px solid var(--fg-hover-2); }
.fg-pf__row { display: flex; gap: 8px; margin-top: 9px; }
.fg-pf__input { flex: 1 1 auto; min-width: 0; box-sizing: border-box; padding: 10px 12px;
  font-size: 14px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--fg-text); background: var(--fg-bg); border: 1px solid var(--fg-line); border-radius: 10px;
  outline: none; transition: border-color .15s ease, box-shadow .15s ease; }
.fg-pf__input:focus-visible { border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(245, 158, 11,.18); }
.fg-pf__input[aria-invalid="true"] { border-color: var(--fg-red); }
.fg-pf__dice { flex: 0 0 auto; padding: 0 12px; font-size: 15px; color: var(--fg-text);
  background: var(--fg-panel-2); border: 1px solid var(--fg-line); border-radius: 8px; cursor: pointer; }
.fg-pf__dice:hover { background: var(--fg-hover-2); }
.fg-pf__dice:focus-visible { outline: none; border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(245, 158, 11,.2); }
.fg-pf__warn { margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: var(--fg-muted); }
.fg-pf__err { margin: 10px 0 0; font-size: 12.5px; font-weight: 500; color: var(--fg-red); }
.fg-pf__submit { width: 100%; margin-top: 12px; padding: 12px 16px; font-size: 14px;
  font-weight: 700; color: var(--fg-bg); background: var(--fg-accent); border: none; border-radius: 8px;
  cursor: pointer; transition: filter .15s ease; }
.fg-pf__submit:hover:not(:disabled) { filter: brightness(1.08); }
.fg-pf__submit:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245, 158, 11,.35); }
.fg-pf__submit:disabled { opacity: .5; cursor: not-allowed; }
@keyframes fg-pf-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes fg-pf-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) {
  .fg-pf__backdrop, .fg-pf { animation: none; }
}
`;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function randomClientSeed(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function CopyableField({
  label,
  value,
  placeholder,
  hint,
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  hint?: string;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [value]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="fg-pf__item">
      <span className="fg-pf__key">
        {label}
        {hint && (
          // `title` carries the text for keyboard and assistive tech; `.tip`
          // styles the pointer version from that same attribute, so the two
          // can never disagree. tabIndex makes it reachable without a mouse.
          <span className="fg-pf__hint tip" title={hint} tabIndex={0} role="note">
            ?
          </span>
        )}
      </span>
      <div className="fg-pf__val">
        <code className={value ? 'fg-pf__code' : 'fg-pf__code fg-pf__code--muted'}>
          {value || placeholder || '—'}
        </code>
        {value && (
          <button
            type="button"
            className="fg-pf__copy"
            onClick={copy}
            aria-label={t('fair.copy', { label })}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  );
}

export function ProvablyFairModal({
  open,
  onClose,
  clientSeed,
  hashedServerSeed,
  nonce,
  loading = false,
  previousServerSeed = null,
  previousHashedServerSeed = null,
  onRotateSeed,
  rotating = false,
  error = null,
  className,
}: ProvablyFairModalProps) {
  const { t } = useLanguage();
  useInjectedStyles(STYLE_ID, CSS);

  const titleId = useId();
  const seedInputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [nextSeed, setNextSeed] = useState(clientSeed);
  const [touched, setTouched] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    if (open) {
      setNextSeed(clientSeed);
      setTouched(false);
    }
  }, [open, clientSeed]);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const node = dialogRef.current;
    node?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !node) return;

      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  const trimmed = nextSeed.trim();
  const tooShort = trimmed.length < CLIENT_SEED_MIN_LENGTH;
  const tooLong = trimmed.length > CLIENT_SEED_MAX_LENGTH;
  const invalid = tooShort || tooLong;
  const validationMessage = tooShort
    ? `Client seed must be at least ${CLIENT_SEED_MIN_LENGTH} characters`
    : tooLong
      ? `Client seed must be at most ${CLIENT_SEED_MAX_LENGTH} characters`
      : null;

  const [verifierServerSeed, setVerifierServerSeed] = useState('');
  const [verifierClientSeed, setVerifierClientSeed] = useState(clientSeed);
  const [verifierNonce, setVerifierNonce] = useState(nonce.toString());
  const [verifierGame, setVerifierGame] = useState<VerifiableGame>('CRASH');
  const [verifierMines, setVerifierMines] = useState('3');
  const [verificationResult, setVerificationResult] = useState<string | null>(null);
  const [computedOutcome, setComputedOutcome] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setVerifierServerSeed('');
      setVerifierClientSeed(clientSeed);
      setVerifierNonce(nonce.toString());
      setVerificationResult(null);
      setComputedOutcome(null);
      setVerificationError(null);
    }
  }, [open, clientSeed, nonce]);

  /**
   * Recomputes a round from the seed triple and reports the game-specific
   * result, not just the raw float — "your crash point was 2.47x" is something
   * a player can check against what they saw; "0.5983…" is not.
   *
   * The maths lives in lib/verify.ts, which is pinned by a parity test against
   * the server engines, so what this prints is what the server computed.
   */
  const verifyOutcome = useCallback(async () => {
    setVerificationResult(null);
    setComputedOutcome(null);
    setVerificationError(null);

    const serverSeed = verifierServerSeed.trim();
    const clientSeed = verifierClientSeed.trim();
    const nonceValue = Number(verifierNonce);

    if (!serverSeed || !clientSeed || !Number.isInteger(nonceValue) || nonceValue < 0) {
      setVerificationError('Please provide valid server seed, client seed and nonce.');
      return;
    }

    try {
      const commitment = previousHashedServerSeed ?? hashedServerSeed;
      const matches = commitment
        ? await verifyCommitment(serverSeed, commitment)
        : null;

      setVerificationResult(
        matches === null
          ? 'No commitment available to check this seed against.'
          : matches
            ? 'Seed commitment is valid — this server seed matches the published hash.'
            : 'Seed commitment does NOT match the published hash.'
      );

      const raw = await calculateOutcome(serverSeed, clientSeed, nonceValue);
      let detail: string;

      switch (verifierGame) {
        case 'CRASH':
          detail = `${(await verifyCrash(serverSeed, clientSeed, nonceValue)).toFixed(2)}×`;
          break;
        case 'ROULETTE':
          detail = `pocket ${await verifyRoulette(serverSeed, clientSeed, nonceValue)}`;
          break;
        case 'MINES': {
          const count = Math.min(24, Math.max(1, Number(verifierMines) || 3));
          const tiles = await verifyMines(serverSeed, clientSeed, nonceValue, count);
          detail = `mines at tiles ${tiles.join(', ')}`;
          break;
        }
        case 'DICE':
          detail = `roll ${(await verifyDice(serverSeed, clientSeed, nonceValue)).toFixed(2)}`;
          break;
        case 'LIMBO':
          detail = `${(await verifyLimbo(serverSeed, clientSeed, nonceValue)).toFixed(2)}×`;
          break;
        case 'COINFLIP':
          detail = await verifyCoinflip(serverSeed, clientSeed, nonceValue);
          break;
        default:
          detail = raw.toFixed(12);
      }

      setComputedOutcome(`${detail}  (raw ${raw.toFixed(12)})`);
    } catch (err) {
      setVerificationError(err instanceof Error ? err.message : 'Verification failed.');
    }
  }, [
    hashedServerSeed,
    previousHashedServerSeed,
    verifierServerSeed,
    verifierClientSeed,
    verifierNonce,
    verifierGame,
    verifierMines,
  ]);

  const handleRotate = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      setTouched(true);
      if (invalid || rotating) return;
      void onRotateSeed(trimmed);
    },
    [invalid, rotating, onRotateSeed, trimmed]
  );

  if (!open || !isMounted) return null;

  return createPortal(
    <div
      className="fg-pf__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={className ? `fg-pf ${className}` : 'fg-pf'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="fg-pf__head">
          <div>
            <h2 className="fg-pf__title" id={titleId}>
              {t('fair.title')}
            </h2>
            <p className="fg-pf__sub">
              Every outcome is derived from HMAC-SHA256(server seed, client
              seed:nonce). The server publishes the hash of its seed before you
              bet, so it cannot change the result afterwards.
            </p>
          </div>
          <button
            type="button"
            className="fg-pf__close"
            onClick={onClose}
            aria-label={t('fair.close')}
          >
            ×
          </button>
        </div>

        <div className="fg-pf__list">
          <CopyableField
            hint="Your half of the randomness. You choose it, so the server cannot know the outcome in advance."
            label="Client seed"
            value={clientSeed}
            placeholder={loading ? t('fair.loading') : undefined}
          />
          <CopyableField
            hint="The server's half, published as a hash before you bet. It commits to a seed that cannot be changed afterwards."
            label="Server seed (hashed)"
            value={hashedServerSeed}
            placeholder={loading ? t('fair.loading') : undefined}
          />
          <div className="fg-pf__item">
            <span className="fg-pf__key">
              {t('fair.nonce')}
              <span
                className="fg-pf__hint tip"
                title={t('fair.nonceHint')}
                tabIndex={0}
                role="note"
              >
                ?
              </span>
            </span>
            <div className="fg-pf__val">
              <code className={loading ? 'fg-pf__code fg-pf__code--muted' : 'fg-pf__code'}>
                {loading ? 'Loading…' : nonce}
              </code>
            </div>
          </div>
          <CopyableField
            hint="The seed behind your earlier rounds, revealed now that the pair is retired. Hash it to check it matches the commitment shown at the time."
            label="Previous server seed (revealed)"
            value={previousServerSeed}
            placeholder={t('fair.previousSeedPlaceholder')}
          />
          {previousHashedServerSeed && (
            <CopyableField
              label="Previous server seed (hash)"
              value={previousHashedServerSeed}
            />
          )}
        </div>

        <form className="fg-pf__rotate" onSubmit={handleRotate} noValidate>
          <label className="fg-pf__key" htmlFor={seedInputId}>
            {t('fair.rotatePair')}
          </label>
          <div className="fg-pf__row">
            <input
              id={seedInputId}
              className="fg-pf__input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={nextSeed}
              maxLength={CLIENT_SEED_MAX_LENGTH}
              placeholder={t('fair.newClientSeed')}
              onChange={(event) => setNextSeed(event.target.value)}
              onBlur={() => setTouched(true)}
              disabled={rotating || loading}
              aria-invalid={touched && invalid}
              aria-describedby={touched && validationMessage ? `${seedInputId}-err` : undefined}
            />
            <button
              type="button"
              className="fg-pf__dice"
              onClick={() => setNextSeed(randomClientSeed())}
              disabled={rotating || loading}
              aria-label={t('fair.randomSeed')}
            >
              ⟳
            </button>
          </div>

          <p className="fg-pf__warn">
            Rotating reveals your current server seed so you can verify past
            bets, issues a new commitment, and resets the nonce to 0.
          </p>

          {touched && validationMessage && (
            <p className="fg-pf__err" id={`${seedInputId}-err`} role="alert">
              {validationMessage}
            </p>
          )}
          {error && (
            <p className="fg-pf__err" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="fg-pf__submit"
            disabled={rotating || loading || (touched && invalid)}
          >
            {rotating ? 'Rotating…' : 'Rotate & reveal server seed'}
          </button>
        </form>

        <section className="fg-pf__verify">
          <h3 className="fg-pf__title">{t('fair.verifier')}</h3>
          <p className="fg-pf__sub">
            Paste a revealed server seed, your client seed, and the nonce to recompute a round outcome.
          </p>
          <div className="fg-pf__item">
            <span className="fg-pf__key">{t('fair.revealedServerSeed')}</span>
            <input
              className="fg-pf__input"
              value={verifierServerSeed}
              onChange={(event) => setVerifierServerSeed(event.target.value)}
              placeholder={t('fair.revealedPlaceholder')}
            />
          </div>
          <div className="fg-pf__item">
            <span className="fg-pf__key">{t('fair.clientSeed')}</span>
            <input
              className="fg-pf__input"
              value={verifierClientSeed}
              onChange={(event) => setVerifierClientSeed(event.target.value)}
            />
          </div>
          <div className="fg-pf__item">
            <span className="fg-pf__key">{t('fair.nonce')}</span>
            <input
              className="fg-pf__input"
              value={verifierNonce}
              onChange={(event) => setVerifierNonce(event.target.value)}
              type="number"
              min="0"
            />
          </div>
          <div className="fg-pf__item">
            <span className="fg-pf__key">{t('fair.game')}</span>
            <select
              className="fg-pf__input"
              value={verifierGame}
              onChange={(event) =>
                setVerifierGame(event.target.value as VerifiableGame)
              }
            >
              {VERIFIABLE_GAMES.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.label}
                </option>
              ))}
            </select>
          </div>
          {verifierGame === 'MINES' && (
            <div className="fg-pf__item">
              <span className="fg-pf__key">{t('fair.minesInPlay')}</span>
              <input
                className="fg-pf__input"
                value={verifierMines}
                onChange={(event) => setVerifierMines(event.target.value)}
                type="number"
                min="1"
                max="24"
              />
            </div>
          )}
          <button
            type="button"
            className="fg-pf__submit"
            onClick={verifyOutcome}
          >
            {t('fair.verifyOutcome')}
          </button>

          {verificationError && (
            <p className="fg-pf__err" role="alert">
              {verificationError}
            </p>
          )}
          {verificationResult && (
            <p className="fg-pf__warn">{verificationResult}</p>
          )}
          {computedOutcome && (
            <p className="fg-pf__note">{t('fair.computedOutcome', { outcome: computedOutcome })}</p>
          )}
        </section>
      </div>
    </div>,
    document.body
  );
}

export default ProvablyFairModal;
