'use client';

/**
 * FRIGAT — Daily faucet wheel
 *
 * One free spin every 24 hours. The wheel is an SVG driven by a CSS transform,
 * which keeps the animation on the compositor — a canvas redraw loop would
 * burn a frame budget for what is a single rotating layer.
 *
 * The outcome is decided by the server, never here. The spin animation is
 * scheduled to *land* on the segment the server returned, so the visual is a
 * presentation of an already-settled result rather than a draw in its own
 * right. That ordering matters: a client-side draw would be trivially riggable
 * and would disagree with the credited balance.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';

import { apiJson, ApiError } from '@/lib/api';
import { API_URL } from '@/lib/token';
import { formatDecimalString } from '@/lib/decimal';
import { useLanguage } from '@/components/providers/LanguageProvider';

const SEGMENTS = [
  { prize: '1', color: '#334155' },
  { prize: '5', color: '#1e3a5f' },
  { prize: '10', color: '#0f766e' },
  { prize: '50', color: '#a16207' },
  { prize: '100', color: '#9333ea' },
] as const;

const SLICE_DEG = 360 / SEGMENTS.length;
const SPIN_TURNS = 6;
const SPIN_MS = 4200;

interface SpinResponse {
  prize: string;
  segmentIndex: number;
  balance: string;
  nextAvailableAt: string;
}

interface VipStatus {
  dailyWheelAvailable: boolean;
  dailyWheelNextAvailableAt: string | null;
}

function countdownTo(target: string | null): string | null {
  if (!target) return null;
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${h}h ${m}m ${s}s`;
}

function wedgePath(index: number): string {
  const start = (index * SLICE_DEG - 90) * (Math.PI / 180);
  const end = ((index + 1) * SLICE_DEG - 90) * (Math.PI / 180);
  const r = 96;
  const x1 = 100 + r * Math.cos(start);
  const y1 = 100 + r * Math.sin(start);
  const x2 = 100 + r * Math.cos(end);
  const y2 = 100 + r * Math.sin(end);
  const largeArc = SLICE_DEG > 180 ? 1 : 0;
  return `M100,100 L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`;
}

export default function DailyWheelModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { balance } = useGameSocket();
  const { t } = useLanguage();

  const [available, setAvailable] = useState(false);
  const [nextAt, setNextAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [won, setWon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);

  const landingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (landingTimer.current) clearTimeout(landingTimer.current);
    },
    []
  );

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await apiJson<VipStatus>(`${API_URL}/api/vip/me`);
      setAvailable(status.dailyWheelAvailable);
      setNextAt(status.dailyWheelNextAvailableAt);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load wheel status.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setWon(null);
      setError(null);
      return;
    }
    void loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    if (!open || available || !nextAt) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      const next = countdownTo(nextAt);
      setCountdown(next);
      if (next === null) setAvailable(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [open, available, nextAt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !spinning) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, spinning]);

  const spin = useCallback(async () => {
    if (!available || spinning) return;
    setSpinning(true);
    setError(null);
    setWon(null);

    try {
      const result = await apiJson<SpinResponse>(`${API_URL}/api/bonus/spin`, {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const target = -(result.segmentIndex + 0.5) * SLICE_DEG;
      setRotation((prev) => {
        const turns = Math.ceil(prev / 360) + SPIN_TURNS;
        return turns * 360 + target;
      });

      landingTimer.current = setTimeout(() => {
        setWon(result.prize);
        setAvailable(false);
        setNextAt(result.nextAvailableAt);
        setSpinning(false);
      }, SPIN_MS);
    } catch (err) {
      if (err instanceof ApiError && err.message === 'wheel_not_ready') {
        setError('Your next spin is not ready yet.');
        void loadStatus();
      } else {
        setError(
          err instanceof ApiError ? err.message : 'Could not spin the wheel.'
        );
      }
      setSpinning(false);
    }
  }, [available, spinning, loadStatus]);

  const wedges = useMemo(
    () =>
      SEGMENTS.map((segment, index) => ({
        ...segment,
        d: wedgePath(index),
        angle: index * SLICE_DEG + SLICE_DEG / 2,
      })),
    []
  );

  if (!open) return null;

  return (
    <div
      className="wheel__overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !spinning) onClose();
      }}
    >
      <div
        className="wheel__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wheel-title"
      >
        <div className="wheel__head">
          <h2 id="wheel-title">{t('wheel.title')}</h2>
          <button
            type="button"
            className="wheel__close"
            onClick={onClose}
            disabled={spinning}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>

        <div className="wheel__stage">
          <div className="wheel__pointer" aria-hidden="true" />
          <svg
            className="wheel__svg"
            viewBox="0 0 200 200"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: spinning
                ? `transform ${SPIN_MS}ms cubic-bezier(.17,.67,.16,1)`
                : 'none',
            }}
            role="img"
            aria-label={t('wheel.aria')}
          >
            {wedges.map((wedge) => (
              <g key={wedge.prize}>
                <path d={wedge.d} fill={wedge.color} stroke="#0f172a" strokeWidth="1.5" />
                <text
                  x="100"
                  y="34"
                  textAnchor="middle"
                  className="wheel__label"
                  transform={`rotate(${wedge.angle} 100 100)`}
                >
                  ${wedge.prize}
                </text>
              </g>
            ))}
            <circle cx="100" cy="100" r="26" fill="#0f172a" stroke="#334155" strokeWidth="2" />
          </svg>
        </div>

        {won && (
          <p className="wheel__won" role="status">
            You won ${Number(won)}!
          </p>
        )}
        {error && <p className="wheel__error">{error}</p>}

        <div className="wheel__foot">
          <div className="wheel__stat">
            <span>{t('common.balance')}</span>
            <b>
              {balance.hasSynced
                ? formatDecimalString(balance.balance ?? '0', 2)
                : '—'}{' '}
              {balance.currency}
            </b>
          </div>

          <button
            type="button"
            className="wheel__spin"
            onClick={spin}
            disabled={!available || spinning || loading}
          >
            {loading
              ? 'Loading…'
              : spinning
                ? 'Spinning…'
                : available
                  ? 'Spin to win'
                  : (countdown ?? 'Not ready')}
          </button>
        </div>

        {!available && countdown && (
          <p className="wheel__next">Next free spin in {countdown}</p>
        )}
      </div>
    </div>
  );
}
