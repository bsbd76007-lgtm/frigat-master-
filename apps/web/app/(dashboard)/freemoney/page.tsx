'use client';

/**
 * /freemoney — the rewards hub.
 *
 * Lives in the `(dashboard)` group, which is stripped from the URL, so the path
 * is still /freemoney. It belongs here rather than at `app/freemoney/`: every
 * section needs a session and a live balance, and the dashboard group is what
 * supplies `GameSocketProvider`, the sign-in gate, the navbar and the sidebar
 * this page is linked from. Outside it, `useGameSocket` throws at prerender.
 *
 * Nothing on this page decides a reward. The wheel animation lands on the
 * segment the server returned, the check-in ladder is priced server-side, and a
 * promo code is validated where the money is. The client is choreography.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { ApiError, apiJson } from '@/lib/api';
import { formatDecimalString } from '@/lib/decimal';
import { consumedAsSessionExpiry } from '@/lib/sessionExpiry';

// ─────────────────────────────────────────────
// Server contracts
// ─────────────────────────────────────────────

interface WheelSegment {
  prize: string;
  weight: number;
}

interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  reward: string | null;
  verifiable: boolean;
  href?: string;
}

interface CheckInStatus {
  available: boolean;
  streak: number;
  nextReward: string;
  nextAvailableAt: string | null;
  ladder: readonly string[];
}

interface Overview {
  wheel: { segments: WheelSegment[] };
  checkIn: CheckInStatus;
  tasks: TaskDefinition[];
  ladder: string[];
}

interface RaffleView {
  id: string;
  title: string;
  prizePool: string;
  prizeValue: string | null;
  endsAt: string;
  totalTickets: number;
  participants: number;
  you?: {
    ticketCount: number;
    ticketNumbers: number[];
    wageredToNextTicket: string;
    checkInTicketAvailable: boolean;
    pendingWagerTickets: number;
    pendingDepositTickets: number;
  };
}

/** Task board, served with the raffle so the UI cannot offer an unpayable task. */
interface RaffleTask {
  id: 'WAGER' | 'DAILY_LOGIN' | 'DEPOSIT' | 'TELEGRAM';
  title: string;
  detail: string;
  reward: string;
  verifiable: boolean;
  href?: string;
}

interface RaffleLeaderboard {
  leaders: { rank: number; player: string; tickets: number }[];
  recent: { player: string; ticketNumber: number; createdAt: string }[];
  past: {
    title: string;
    prizePool: string;
    winningTicketNumber: number | null;
    player: string | null;
    drawnAt: string | null;
  }[];
}

interface SpinResult {
  prize: string;
  segmentIndex: number;
  balance: string;
  nextAvailableAt: string;
}

// ─────────────────────────────────────────────
// Confetti
// ─────────────────────────────────────────────

interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
  spin: number;
}

/**
 * A short WebAudio flourish. Created on the click that triggers it, so the
 * browser's autoplay policy is never tripped, and silently absent where
 * WebAudio is not available.
 */
function useWinSound() {
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(
    () => () => {
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    []
  );

  return useCallback((won: boolean) => {
    if (typeof window === 'undefined') return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const audio = ctxRef.current ?? (ctxRef.current = new Ctor());
    if (audio.state === 'suspended') void audio.resume();

    const notes = won ? [523, 659, 784, 1047] : [330, 262];
    notes.forEach((frequency, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'triangle';
      osc.frequency.value = frequency;
      const at = audio.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.32);
    });
  }, []);
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const STYLE_ID = 'fg-freemoney-styles';

const CSS = `
.fm { display: flex; flex-direction: column; gap: 18px; }
.fm__head h1 { margin: 0 0 4px; font-size: 26px; font-weight: 800; letter-spacing: -.02em;
  color: var(--fg-text); }
.fm__head p { margin: 0; font-size: 13.5px; color: var(--fg-muted); }

.fm__grid { display: grid; gap: 16px; grid-template-columns: 1fr; }
@media (min-width: 900px) { .fm__grid { grid-template-columns: 1.15fr .85fr; } }

.fm__card { display: flex; flex-direction: column; gap: 12px; padding: 16px;
  background: var(--fg-panel); border: 0; border-radius: 12px;
  box-shadow: var(--fg-inset); }
.fm__card h2 { margin: 0; font-size: 16px; font-weight: 800; color: var(--fg-text); }
.fm__card p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--fg-muted); }

.fm__wheel-wrap { position: relative; width: 100%; max-width: 340px; margin-inline: auto;
  aspect-ratio: 1; }
.fm__wheel { display: block; width: 100%; height: 100%; }
.fm__confetti { position: absolute; inset: 0; pointer-events: none; }

.fm__spin { width: 100%; padding: 14px; font: inherit; font-size: 15px; font-weight: 900;
  color: var(--fg-bg); background: var(--fg-accent); border: 0; border-radius: 10px;
  cursor: pointer; box-shadow: var(--fg-glow-accent);
  transition: filter var(--fg-snap), transform var(--fg-snap), box-shadow var(--fg-snap); }
.fm__spin:hover:not(:disabled) { filter: brightness(1.07); box-shadow: var(--fg-cta-glow); }
.fm__spin:active:not(:disabled) { transform: scale(.98) translateY(1px); }
.fm__spin:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
.fm__spin:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245, 158, 11, .45); }

.fm__timer { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
  text-align: center; color: var(--fg-muted); }
.fm__timer b { color: var(--fg-text); }

.fm__row { display: flex; gap: 8px; }
.fm__input { flex: 1 1 auto; min-width: 0; padding: 12px 13px; font: inherit; font-size: 14px;
  font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--fg-text);
  background: color-mix(in srgb, var(--fg-sunken) 90%, transparent);
  border: 1px solid var(--fg-line); border-radius: 8px; outline: none;
  transition: border-color var(--fg-snap), box-shadow var(--fg-snap); }
.fm__input::placeholder { color: var(--fg-placeholder); }
.fm__input:focus-visible { border-color: transparent;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, .5); }
.fm__btn { flex: 0 0 auto; padding: 0 18px; font: inherit; font-size: 13px; font-weight: 800;
  color: var(--fg-bg); background: var(--fg-accent); border: 0; border-radius: 10px;
  cursor: pointer;
  transition: filter var(--fg-snap), transform var(--fg-snap), box-shadow var(--fg-snap); }
.fm__btn:hover:not(:disabled) { box-shadow: var(--fg-cta-glow); }
.fm__btn:active:not(:disabled) { transform: scale(.98) translateY(1px); }
.fm__btn:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
.fm__btn--ghost { color: var(--fg-text); background: var(--fg-hover); }
.fm__btn:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(245, 158, 11, .4); }

.fm__msg { margin: 0; padding: 10px 12px; font-size: 12.5px; font-weight: 600;
  border-radius: 9px; }
.fm__msg--ok { color: var(--fg-pos-soft); background: rgba(245, 158, 11, .1);
  border: 1px solid rgba(245, 158, 11, .3); }
.fm__msg--err { color: #d69199; background: rgba(240, 97, 109, .1);
  border: 1px solid rgba(240, 97, 109, .35); }

.fm__ladder { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.fm__day { padding: 8px 2px; text-align: center; border-radius: 8px;
  background: var(--fg-panel-2); border: 1px solid var(--fg-line); }
.fm__day span { display: block; font-size: 9.5px; font-weight: 700; letter-spacing: .05em;
  text-transform: uppercase; color: var(--fg-dim); }
.fm__day b { display: block; margin-top: 3px; font-size: 12px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: var(--fg-text); }
.fm__day--done { border-color: rgba(245, 158, 11, .45); background: rgba(245, 158, 11, .08); }
.fm__day--done b { color: var(--fg-accent); }

/* ── Raffle ── */
.fm__raffle { display: grid; gap: 16px; grid-template-columns: 1fr; }
@media (min-width: 900px) { .fm__raffle { grid-template-columns: 1.1fr .9fr; } }

.fm__prize { display: flex; flex-direction: column; gap: 10px; padding: 20px;
  text-align: center; border-radius: 12px;
  background:
    radial-gradient(circle at 50% -20%, rgba(245, 158, 11, .22) 0%, transparent 62%),
    var(--fg-panel-2);
  border: 1px solid rgba(245, 158, 11, .35); }
.fm__prize-label { font-size: 10.5px; font-weight: 800; letter-spacing: .12em;
  text-transform: uppercase; color: var(--fg-accent); }
.fm__prize-pool { font-size: 34px; font-weight: 900; letter-spacing: -.03em;
  line-height: 1.05; color: var(--fg-text); }
.fm__prize-title { font-size: 13px; color: var(--fg-muted); }

.fm__countdown { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;
  margin-top: 4px; }
.fm__unit { padding: 8px 2px; border-radius: 9px; background: rgba(11, 14, 20, .6);
  border: 1px solid var(--fg-line); }
.fm__unit b { display: block; font-size: 19px; font-weight: 900;
  font-variant-numeric: tabular-nums; color: var(--fg-text); }
.fm__unit span { display: block; margin-top: 1px; font-size: 9px; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase; color: var(--fg-dim); }

.fm__tickets { display: flex; flex-wrap: wrap; gap: 6px; }
.fm__ticket { padding: 5px 10px; font-size: 12px; font-weight: 800;
  font-family: var(--fg-mono); letter-spacing: .04em; border-radius: 999px;
  color: var(--fg-accent); background: rgba(245, 158, 11, .1);
  border: 1px solid rgba(245, 158, 11, .35); }
.fm__ticket--more { color: var(--fg-dim); background: var(--fg-hover);
  border-color: var(--fg-line); }

.fm__stat-row { display: flex; gap: 8px; }
.fm__stat { flex: 1 1 0; padding: 10px; text-align: center; border-radius: 9px;
  background: var(--fg-panel-2); border: 1px solid var(--fg-line); }
.fm__stat b { display: block; font-size: 16px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: var(--fg-text); }
.fm__stat span { display: block; margin-top: 2px; font-size: 10px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase; color: var(--fg-dim); }

.fm__ticker { display: flex; flex-direction: column; gap: 0; max-height: 190px;
  overflow-y: auto; border-radius: 9px; border: 1px solid var(--fg-line); }
.fm__tick { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; padding: 8px 11px; font-size: 12px; border-bottom: 1px solid var(--fg-line);
  background: var(--fg-panel-2); }
.fm__tick:last-child { border-bottom: 0; }
.fm__tick-player { min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; color: var(--fg-muted); }
.fm__tick-num { flex: 0 0 auto; font-family: var(--fg-mono); font-weight: 800;
  color: var(--fg-accent); }

.fm__board { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.fm__board td { padding: 7px 9px; border-bottom: 1px solid var(--fg-line);
  color: var(--fg-muted); }
.fm__board tr:last-child td { border-bottom: 0; }
.fm__board td:first-child { width: 28px; font-weight: 800; color: var(--fg-dim); }
.fm__board td:last-child { text-align: right; font-weight: 800; color: var(--fg-text); }

.fm__tasks { display: grid; gap: 10px; grid-template-columns: 1fr; }
@media (min-width: 720px) { .fm__tasks { grid-template-columns: 1fr 1fr; } }
.fm__task { display: flex; flex-direction: column; gap: 6px; padding: 14px;
  background: var(--fg-panel-2); border: 1px solid var(--fg-line); border-radius: 10px; }
.fm__task h3 { margin: 0; font-size: 13.5px; font-weight: 800; color: var(--fg-text); }
.fm__task p { margin: 0; font-size: 12px; line-height: 1.55; color: var(--fg-muted); }
.fm__task-foot { display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-top: auto; padding-top: 8px; }
.fm__reward { font-size: 12.5px; font-weight: 800; color: var(--fg-accent); }
.fm__reward--none { color: var(--fg-dim); }
.fm__task-btn { padding: 7px 14px; font: inherit; font-size: 12px; font-weight: 800;
  color: var(--fg-bg); background: var(--fg-accent); border: 0; border-radius: 8px;
  cursor: pointer; }
.fm__task-btn:disabled { opacity: .45; cursor: not-allowed; }
.fm__task-btn--link { color: var(--fg-text); background: var(--fg-hover); }
`;

// ─────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────

/** Where the pointer sits, in radians — straight up. */
const POINTER_ANGLE = -Math.PI / 2;

/** How long the wheel takes to settle, in ms. Shared by the animation and the reveal. */
const SPIN_MS = 4200;

/** `482` → `#00482`. Padded so a wall of badges lines up. */
function formatTicket(n: number): string {
  return `#${String(n).padStart(5, '0')}`;
}

export default function FreeMoneyPage() {
  useInjectedStyles(STYLE_ID, CSS);

  const { balance, token } = useGameSocket();
  const playSound = useWinSound();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spinMessage, setSpinMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [nextSpinAt, setNextSpinAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [promo, setPromo] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMessage, setPromoMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [taskBusy, setTaskBusy] = useState<string | null>(null);
  const [taskMessage, setTaskMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [raffle, setRaffle] = useState<RaffleView | null>(null);
  const [board, setBoard] = useState<RaffleLeaderboard | null>(null);
  const [raffleTasks, setRaffleTasks] = useState<RaffleTask[]>([]);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketMessage, setTicketMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Wheel animation state, held in refs so the render loop never restarts.
  const rotationRef = useRef(0);
  const spinFromRef = useRef(0);
  const spinToRef = useRef(0);
  const spinStartRef = useRef<number | null>(null);
  const confettiRef = useRef<Confetto[]>([]);
  const segmentsRef = useRef<WheelSegment[]>([]);

  const segments = overview?.wheel.segments ?? [];
  segmentsRef.current = segments;

  // ── Load ──
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiJson<Overview>('api/rewards/overview');
      setOverview(data);
    } catch (err) {
      if (consumedAsSessionExpiry(err)) return;
      setSpinMessage({ ok: false, text: 'Could not load rewards. Try again shortly.' });
    }
  }, [token]);

  /**
   * The giveaway loads separately from the rewards overview: it is public
   * (the board renders signed out) and it refreshes on its own after a claim,
   * so coupling the two would reload the wheel every time a ticket is issued.
   */
  const loadRaffle = useCallback(async () => {
    try {
      const [active, leaderboard] = await Promise.all([
        apiJson<{ raffle: RaffleView | null; tasks: RaffleTask[] }>('api/raffles/active'),
        apiJson<RaffleLeaderboard>('api/raffles/leaderboard'),
      ]);
      setRaffle(active.raffle);
      setRaffleTasks(active.tasks ?? []);
      setBoard(leaderboard);
    } catch (err) {
      if (consumedAsSessionExpiry(err)) return;
      // A giveaway that fails to load hides its own section rather than
      // breaking the rest of the hub.
      setRaffle(null);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadRaffle();
  }, [load, loadRaffle]);

  // One clock for both countdowns, ticking only while something is counting.
  useEffect(() => {
    const counting = nextSpinAt ?? overview?.checkIn.nextAvailableAt ?? raffle?.endsAt;
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [nextSpinAt, overview?.checkIn.nextAvailableAt, raffle?.endsAt]);

  const spinCountdown = useMemo(() => {
    if (!nextSpinAt) return null;
    const left = new Date(nextSpinAt).getTime() - now;
    if (left <= 0) return null;
    const h = Math.floor(left / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }, [nextSpinAt, now]);

  // ── Wheel ──
  const spin = useCallback(async () => {
    if (spinning || !token || segments.length === 0) return;
    setSpinning(true);
    setSpinMessage(null);

    try {
      const result = await apiJson<SpinResult>('api/rewards/wheel/spin', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      // The server already decided; the animation is aimed at that segment.
      const slice = (Math.PI * 2) / segments.length;
      // Centre of the winning slice, brought under the pointer, plus whole
      // turns for the sake of the eye.
      const target =
        POINTER_ANGLE - (result.segmentIndex + 0.5) * slice - Math.PI * 2 * 5;
      spinFromRef.current = rotationRef.current;
      spinToRef.current = target;
      spinStartRef.current = performance.now();
      setNextSpinAt(result.nextAvailableAt);

      const won = Number(result.prize) > 0;
      window.setTimeout(() => {
        playSound(won);
        if (won) {
          for (let i = 0; i < 90; i += 1) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 260;
            confettiRef.current.push({
              x: 0.5,
              y: 0.5,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed - 90,
              life: 0,
              maxLife: 1.1 + Math.random() * 0.8,
              hue: Math.random() * 360,
              size: 3 + Math.random() * 5,
              spin: Math.random() * 6 - 3,
            });
          }
        }
        setSpinMessage(
          won
            ? { ok: true, text: `You won ${formatDecimalString(result.prize, 2)} USD!` }
            : { ok: false, text: 'No prize this time — come back tomorrow.' }
        );
        setSpinning(false);
      }, SPIN_MS);
    } catch (err) {
      if (consumedAsSessionExpiry(err)) return;
      if (err instanceof ApiError && err.status === 429) {
        setSpinMessage({ ok: false, text: 'Your next free spin is not ready yet.' });
        void load();
      } else {
        setSpinMessage({
          ok: false,
          text: err instanceof ApiError ? err.message : 'Could not spin the wheel.',
        });
      }
      setSpinning(false);
    }
  }, [spinning, token, segments.length, playSound, load]);

  // ── Promo ──
  const activatePromo = useCallback(async () => {
    const code = promo.trim();
    if (!code || promoBusy) return;
    setPromoBusy(true);
    setPromoMessage(null);
    try {
      const result = await apiJson<{ amount: string; currency: string }>(
        'api/rewards/promocode',
        { method: 'POST', body: JSON.stringify({ code }) }
      );
      setPromoMessage({
        ok: true,
        text: `Credited ${formatDecimalString(result.amount, 2)} ${result.currency}.`,
      });
      setPromo('');
    } catch (err) {
      if (consumedAsSessionExpiry(err)) return;
      setPromoMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Could not activate that code.',
      });
    } finally {
      setPromoBusy(false);
    }
  }, [promo, promoBusy]);

  // ── Tasks ──
  const claimTask = useCallback(
    async (taskId: string) => {
      if (taskBusy) return;
      setTaskBusy(taskId);
      setTaskMessage(null);
      try {
        const result = await apiJson<{ amount: string; streak: number }>(
          'api/rewards/tasks/claim',
          { method: 'POST', body: JSON.stringify({ taskId }) }
        );
        setTaskMessage({
          ok: true,
          text: `Claimed ${formatDecimalString(result.amount, 2)} USD — day ${result.streak} of your streak.`,
        });
        playSound(true);
        await load();
      } catch (err) {
        if (consumedAsSessionExpiry(err)) return;
        setTaskMessage({
          ok: false,
          text: err instanceof ApiError ? err.message : 'Could not claim that task.',
        });
      } finally {
        setTaskBusy(null);
      }
    },
    [taskBusy, playSound, load]
  );

  // ── Raffle tickets ──
  const claimTickets = useCallback(async () => {
    if (ticketBusy || !token) return;
    setTicketBusy(true);
    setTicketMessage(null);
    try {
      const result = await apiJson<{ issued: number; ticketNumbers: number[] }>(
        'api/raffles/claim',
        { method: 'POST', body: JSON.stringify({}) }
      );
      setTicketMessage({
        ok: true,
        text: `${result.issued} ticket${result.issued === 1 ? '' : 's'} claimed: ${result.ticketNumbers
          .slice(0, 4)
          .map(formatTicket)
          .join(', ')}${result.ticketNumbers.length > 4 ? '…' : ''}`,
      });
      playSound(true);
      await loadRaffle();
    } catch (err) {
      if (consumedAsSessionExpiry(err)) return;
      setTicketMessage({
        ok: false,
        text: err instanceof ApiError ? err.message : 'Could not claim tickets.',
      });
    } finally {
      setTicketBusy(false);
    }
  }, [ticketBusy, token, playSound, loadRaffle]);

  /** Remaining time on the giveaway, split for the countdown boxes. */
  const raffleLeft = useMemo(() => {
    if (!raffle) return null;
    const ms = new Date(raffle.endsAt).getTime() - now;
    if (ms <= 0) return null;
    return {
      d: Math.floor(ms / 86_400_000),
      h: Math.floor((ms % 86_400_000) / 3_600_000),
      m: Math.floor((ms % 3_600_000) / 60_000),
      s: Math.floor((ms % 60_000) / 1000),
    };
  }, [raffle, now]);

  // ── Wheel renderer ──
  const draw = useCallback(({ ctx, width, height, delta }: CanvasFrame) => {
    const dt = Math.min(delta, 50) / 1000;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 10;
    const list = segmentsRef.current;

    ctx.clearRect(0, 0, width, height);
    if (list.length === 0) return;

    // Ease the spin out over its duration; idle rotation drifts slowly so the
    // wheel never looks frozen.
    const startedAt = spinStartRef.current;
    if (startedAt !== null) {
      const t = Math.min(1, (performance.now() - startedAt) / SPIN_MS);
      const eased = 1 - Math.pow(1 - t, 4);
      rotationRef.current =
        spinFromRef.current + (spinToRef.current - spinFromRef.current) * eased;
      if (t >= 1) spinStartRef.current = null;
    } else {
      rotationRef.current += dt * 0.12;
    }

    const slice = (Math.PI * 2) / list.length;
    const rotation = rotationRef.current;

    // Every measurement is a fraction of the radius, so the wheel is the same
    // drawing at 240px in the modal and 420px on the page rather than a large
    // one with a hub that shrank.
    const hubR = radius * 0.17;
    const hubRingR = radius * 0.215;
    const hairline = Math.max(1, radius * 0.006);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    // ── Segments ──
    // Each wedge is a radial gradient rather than a flat fill: brighter at the
    // hub, deepening toward the rim. A wheel lit from its centre is the one
    // physical cue that stops eight coloured triangles reading as a pie chart.
    // Alternating accent and slate — a disc filled edge to edge in the brand
    // colour leaves the accent nothing left to signal with.
    const ramp = (from: string, to: string) => {
      const g = ctx.createRadialGradient(0, 0, hubR, 0, 0, radius);
      g.addColorStop(0, from);
      g.addColorStop(0.55, from);
      g.addColorStop(1, to);
      return g;
    };
    const fills = [
      ramp('#fbbf24', '#d97706'),   // accent wedge, lit at the hub
      ramp('#273246', '#161d29'),   // slate wedge
      ramp('#161d29', '#0b0e14'),   // blank
    ];

    list.forEach((segment, i) => {
      const from = i * slice;
      const zero = Number(segment.prize) <= 0;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, from, from + slice);
      ctx.closePath();
      ctx.fillStyle = zero ? fills[2] : i % 2 === 0 ? fills[0] : fills[1];
      ctx.fill();
    });

    // ── Dividers ──
    // Stroked once per boundary, after the fills. The old pass closed and
    // stroked each wedge, so every radius was painted twice — at 2px that
    // stacks into a visibly heavier line than the rim, and the second pass laid
    // dark ink over the anti-aliased edge of the first, which is what made the
    // spokes look ragged rather than crisp.
    ctx.strokeStyle = 'rgba(11, 14, 20,.9)';
    ctx.lineWidth = hairline;
    ctx.beginPath();
    for (let i = 0; i < list.length; i += 1) {
      const angle = i * slice;
      ctx.moveTo(Math.cos(angle) * hubR, Math.sin(angle) * hubR);
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
    ctx.stroke();

    // ── Prize labels ──
    // Set along the radius facing inward: each label starts at the rim and
    // reads toward the hub, the way the numbers on a roulette wheel do. The
    // half of the wheel where that would arrive upside-down is rotated the
    // other way and its alignment swapped, so every label stays upright no
    // matter where the spin stops.
    list.forEach((segment, i) => {
      const mid = i * slice + slice / 2;
      const zero = Number(segment.prize) <= 0;
      const flipped = Math.cos(mid + rotation) < 0;
      const inset = radius - radius * 0.08;

      ctx.save();
      ctx.rotate(flipped ? mid + Math.PI : mid);
      ctx.textAlign = flipped ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.max(11, radius * 0.115)}px ui-sans-serif, system-ui, sans-serif`;

      // A dark wedge takes white text, a lit accent wedge takes the page navy.
      ctx.fillStyle = zero ? '#7c8ea0' : i % 2 === 0 ? '#0b0e14' : '#ffffff';
      ctx.fillText(
        zero ? '—' : formatDecimalString(segment.prize, 2),
        flipped ? -inset : inset,
        0
      );
      ctx.restore();
    });

    ctx.restore();

    // ── Metallic frame ──
    // Two concentric strokes with a linear gradient across them: light at the
    // top-left, dark at the bottom-right, which is where every other bevel in
    // this UI takes its light from. Drawn outside the rotated basis so the
    // highlight stays with the room instead of spinning with the wheel — a
    // rotating specular is the tell that a "metal" ring is just a coloured
    // circle.
    ctx.save();
    ctx.translate(cx, cy);
    const frame = ctx.createLinearGradient(-radius, -radius, radius, radius);
    frame.addColorStop(0, '#6b7688');
    frame.addColorStop(0.35, '#3a4759');
    frame.addColorStop(0.55, '#2a3547');
    frame.addColorStop(1, '#525d70');
    ctx.strokeStyle = frame;
    ctx.lineWidth = Math.max(4, radius * 0.035);
    ctx.beginPath();
    ctx.arc(0, 0, radius + ctx.lineWidth / 2 - hairline, 0, Math.PI * 2);
    ctx.stroke();

    // Inner containment line, so the frame reads as seated on the face rather
    // than floating around it.
    ctx.strokeStyle = 'rgba(11, 14, 20,.85)';
    ctx.lineWidth = hairline;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // ── Hub ──
    // Unrotated: a concentric hub that spins is indistinguishable from one that
    // does not, and drawing it inside the rotated basis meant its ring picked
    // up the wheel's transform for nothing.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, hubRingR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14,26,35,.9)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, hubR, 0, Math.PI * 2);
    ctx.fillStyle = '#152531';
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = Math.max(2, radius * 0.014);
    ctx.stroke();

    // A short highlight arc across the top edge, the same light the panels
    // catch. Enough to read as a machined cap rather than a flat hole.
    ctx.beginPath();
    ctx.arc(0, 0, hubR * 0.62, Math.PI * 1.15, Math.PI * 1.85);
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = Math.max(1, radius * 0.008);
    ctx.stroke();
    ctx.restore();

    // ── Pointer ──
    // Drawn unrotated at the top, with its tip overhanging the rim so it reads
    // as sitting above the wheel rather than cut into it.
    const pw = Math.max(9, radius * 0.055);
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius + pw * 1.15);
    ctx.lineTo(cx - pw, cy - radius - pw * 0.75);
    ctx.lineTo(cx + pw, cy - radius - pw * 0.75);
    ctx.closePath();
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = 'rgba(14,26,35,.85)';
    ctx.lineWidth = hairline;
    ctx.stroke();

    // Confetti, in normalised coordinates so it survives a resize.
    for (const piece of confettiRef.current) {
      piece.life += dt;
      piece.x += (piece.vx * dt) / width;
      piece.y += (piece.vy * dt) / height;
      piece.vy += 320 * dt;
      const t = piece.life / piece.maxLife;
      if (t >= 1) continue;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.translate(piece.x * width, piece.y * height);
      ctx.rotate(piece.life * piece.spin);
      ctx.fillStyle = `hsl(${piece.hue}, 45%, 62%)`;
      ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.6);
      ctx.restore();
    }
    confettiRef.current = confettiRef.current.filter((p) => p.life < p.maxLife);
  }, []);

  const wheelRef = useCanvasRenderer(draw, { maxPixelRatio: 3 });

  const checkIn = overview?.checkIn;
  const ladder = checkIn?.ladder ?? [];

  return (
    <section className="fm">
      <div className="fm__head">
        <h1>Free money</h1>
        <p>
          Daily rewards, promo codes and tasks. Everything here credits your
          real balance — currently {balance.hasSynced ? balance.formatted : '—'}{' '}
          {balance.currency}.
        </p>
      </div>

      <div className="fm__grid">
        {/* ── Section 1: the wheel ── */}
        <div className="fm__card">
          <h2>Daily wheel</h2>
          <p>One free spin every 24 hours. The segment is drawn server-side before the wheel moves.</p>

          <div className="fm__wheel-wrap">
            <canvas ref={wheelRef} className="fm__wheel" />
          </div>

          {spinMessage && (
            <p className={`fm__msg ${spinMessage.ok ? 'fm__msg--ok' : 'fm__msg--err'}`}>
              {spinMessage.text}
            </p>
          )}

          <button
            type="button"
            className="fm__spin"
            onClick={() => void spin()}
            disabled={spinning || !token || segments.length === 0 || spinCountdown !== null}
          >
            {spinning ? 'Spinning…' : spinCountdown ? 'Come back tomorrow' : 'Spin the wheel'}
          </button>

          {spinCountdown && (
            <p className="fm__timer">
              Next free spin in <b>{spinCountdown}</b>
            </p>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* ── Section 2: promo code ── */}
          <div className="fm__card">
            <h2>Promo code</h2>
            <p>Got a code? Redeem it here. One use per account.</p>
            <div className="fm__row">
              <input
                className="fm__input"
                value={promo}
                placeholder="ENTER CODE"
                aria-label="Promo code"
                maxLength={64}
                disabled={promoBusy}
                onChange={(event) => setPromo(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void activatePromo();
                }}
              />
              <button
                type="button"
                className="fm__btn"
                onClick={() => void activatePromo()}
                disabled={promoBusy || !promo.trim() || !token}
              >
                {promoBusy ? '…' : 'Activate'}
              </button>
            </div>
            {promoMessage && (
              <p className={`fm__msg ${promoMessage.ok ? 'fm__msg--ok' : 'fm__msg--err'}`}>
                {promoMessage.text}
              </p>
            )}
          </div>

          {/* ── Check-in ladder ── */}
          <div className="fm__card">
            <h2>Check-in streak</h2>
            <p>
              {checkIn
                ? `Day ${checkIn.streak} of ${ladder.length}. Miss a day and it starts again.`
                : 'Loading your streak…'}
            </p>
            <div className="fm__ladder">
              {ladder.map((amount, i) => (
                <div
                  key={amount + i}
                  className={`fm__day${checkIn && i < checkIn.streak ? ' fm__day--done' : ''}`}
                >
                  <span>D{i + 1}</span>
                  <b>{formatDecimalString(amount, 2)}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Raffle / Розыгрыш ── */}
      {raffle && (
        <div className="fm__card">
          <h2>Giveaway · Розыгрыш</h2>
          <p>
            {raffle.totalTickets.toLocaleString('en-US')} tickets issued across{' '}
            {raffle.participants.toLocaleString('en-US')} players. Tickets are earned,
            never bought.
          </p>

          <div className="fm__raffle">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="fm__prize">
                <span className="fm__prize-label">Grand prize</span>
                <span className="fm__prize-pool">{raffle.prizePool}</span>
                <span className="fm__prize-title">{raffle.title}</span>

                {raffleLeft ? (
                  <div className="fm__countdown">
                    {([
                      ['Days', raffleLeft.d],
                      ['Hrs', raffleLeft.h],
                      ['Min', raffleLeft.m],
                      ['Sec', raffleLeft.s],
                    ] as const).map(([label, value]) => (
                      <div className="fm__unit" key={label}>
                        <b>{String(value).padStart(2, '0')}</b>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="fm__timer">Drawing now — winners announced shortly.</p>
                )}
              </div>

              <div className="fm__stat-row">
                <div className="fm__stat">
                  <b>{raffle.you?.ticketCount ?? 0}</b>
                  <span>Your tickets</span>
                </div>
                <div className="fm__stat">
                  <b>{raffle.totalTickets.toLocaleString('en-US')}</b>
                  <span>In the draw</span>
                </div>
                <div className="fm__stat">
                  <b>
                    {raffle.you && raffle.you.ticketCount > 0 && raffle.totalTickets > 0
                      ? `${((raffle.you.ticketCount / raffle.totalTickets) * 100).toFixed(1)}%`
                      : '—'}
                  </b>
                  <span>Your odds</span>
                </div>
              </div>

              {raffle.you && raffle.you.ticketNumbers.length > 0 && (
                <div className="fm__tickets">
                  {raffle.you.ticketNumbers.map((n) => (
                    <span className="fm__ticket" key={n}>
                      {formatTicket(n)}
                    </span>
                  ))}
                  {raffle.you.ticketCount > raffle.you.ticketNumbers.length && (
                    <span className="fm__ticket fm__ticket--more">
                      +{raffle.you.ticketCount - raffle.you.ticketNumbers.length} more
                    </span>
                  )}
                </div>
              )}

              {ticketMessage && (
                <p className={`fm__msg ${ticketMessage.ok ? 'fm__msg--ok' : 'fm__msg--err'}`}>
                  {ticketMessage.text}
                </p>
              )}

              <button
                type="button"
                className="fm__spin"
                onClick={() => void claimTickets()}
                disabled={ticketBusy || !token}
              >
                {ticketBusy ? 'Claiming…' : 'Claim my tickets'}
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Earn tickets. Rendered from the server's board, so a task the
                  server refuses to pay cannot appear with a Claim button. */}
              <div className="fm__tasks" style={{ gridTemplateColumns: '1fr' }}>
                {raffleTasks.map((task) => {
                  const you = raffle.you;
                  const ready =
                    task.id === 'WAGER'
                      ? (you?.pendingWagerTickets ?? 0)
                      : task.id === 'DEPOSIT'
                        ? (you?.pendingDepositTickets ?? 0)
                        : task.id === 'DAILY_LOGIN'
                          ? you?.checkInTicketAvailable
                            ? 1
                            : 0
                          : 0;
                  return (
                    <article className="fm__task" key={task.id}>
                      <h3>{task.title}</h3>
                      <p>
                        {task.detail}
                        {task.id === 'WAGER' && you
                          ? ` $${you.wageredToNextTicket} to your next one.`
                          : ''}
                      </p>
                      <div className="fm__task-foot">
                        <span
                          className={`fm__reward${task.verifiable ? '' : ' fm__reward--none'}`}
                        >
                          {task.reward}
                        </span>
                        {task.verifiable ? (
                          <button
                            type="button"
                            className="fm__task-btn"
                            disabled={ready === 0 || ticketBusy || !token}
                            onClick={() => void claimTickets()}
                          >
                            {ready > 0 ? `Claim ${ready}` : 'Not yet'}
                          </button>
                        ) : (
                          <a
                            className="fm__task-btn fm__task-btn--link"
                            href={task.href}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Open
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Live ticker */}
              {board && board.recent.length > 0 && (
                <div>
                  <p style={{ marginBottom: 6 }}>Latest tickets</p>
                  <div className="fm__ticker">
                    {board.recent.map((row) => (
                      <div className="fm__tick" key={`${row.ticketNumber}-${row.createdAt}`}>
                        <span className="fm__tick-player">{row.player}</span>
                        <span className="fm__tick-num">{formatTicket(row.ticketNumber)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Leaderboard */}
              {board && board.leaders.length > 0 && (
                <div>
                  <p style={{ marginBottom: 6 }}>Top holders</p>
                  <table className="fm__board">
                    <tbody>
                      {board.leaders.map((row) => (
                        <tr key={row.rank}>
                          <td>{row.rank}</td>
                          <td>{row.player}</td>
                          <td>{row.tickets}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {board && board.past.length > 0 && (
                <div>
                  <p style={{ marginBottom: 6 }}>Past winners</p>
                  <table className="fm__board">
                    <tbody>
                      {board.past.map((row, i) => (
                        <tr key={i}>
                          <td>{row.winningTicketNumber ? formatTicket(row.winningTicketNumber) : '—'}</td>
                          <td>{row.player ?? 'Undrawn'}</td>
                          <td>{row.prizePool}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Section 3: tasks ── */}
      <div className="fm__card">
        <h2>Tasks &amp; bonuses</h2>
        <p>Rewards the server can verify are claimable here.</p>

        {taskMessage && (
          <p className={`fm__msg ${taskMessage.ok ? 'fm__msg--ok' : 'fm__msg--err'}`}>
            {taskMessage.text}
          </p>
        )}

        <div className="fm__tasks">
          {(overview?.tasks ?? []).map((task) => {
            const isCheckIn = task.id === 'daily-checkin';
            const claimable = task.verifiable && (!isCheckIn || checkIn?.available === true);
            return (
              <article className="fm__task" key={task.id}>
                <h3>{task.title}</h3>
                <p>{task.description}</p>
                <div className="fm__task-foot">
                  <span className={`fm__reward${task.reward ? '' : ' fm__reward--none'}`}>
                    {isCheckIn && checkIn
                      ? `+${formatDecimalString(checkIn.nextReward, 2)} USD`
                      : task.reward
                        ? `+${formatDecimalString(task.reward, 2)} USD`
                        : 'No reward yet'}
                  </span>
                  {task.verifiable ? (
                    <button
                      type="button"
                      className="fm__task-btn"
                      disabled={!claimable || taskBusy === task.id || !token}
                      onClick={() => void claimTask(task.id)}
                    >
                      {taskBusy === task.id
                        ? '…'
                        : isCheckIn && checkIn && !checkIn.available
                          ? 'Claimed'
                          : 'Claim'}
                    </button>
                  ) : (
                    <a
                      className="fm__task-btn fm__task-btn--link"
                      href={task.href}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open
                    </a>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
