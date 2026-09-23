'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { gameErrorKey, useGameRound } from '@/hooks/useGameRound';
import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import {
  compareDecimal,
  formatDecimalString,
  isDecimalString,
  safeDecimal,
  sanitizeDecimalInput,
  toFixedDecimal,
} from '@/lib/decimal';
import { useLanguage } from '@/components/providers/LanguageProvider';

import {
  GAME_CONFIG,
  ON_DECK,
  PICKUPS,
  altitudeAt,
  formatMetres,
  formatMultiplier,
  payoutFor,
  planFlight,
  specFor,
  type FlightPlan,
  type Phase,
  type ServerEvent,
} from './aviaMasters/config';
import {
  drawBomb,
  drawCarrier,
  drawFinishMarker,
  drawPickup,
  drawPlane,
} from './aviaMasters/draw';
import { CSS, STYLE_ID } from './aviaMasters/styles';

// Configuration was part of this file before it was split three ways;
// re-exported so nothing that reached for it here has to move.
export { GAME_CONFIG, PICKUPS, payoutFor } from './aviaMasters/config';
export type { Phase, PickupSpec } from './aviaMasters/config';

/**
 * Avia Masters — one bet, one flight, drawn on a canvas.
 *
 * The player sets a stake and presses Fly; there is no input after that. The
 * red biplane leaves the launch carrier, flies through a string of pickups and
 * rockets, and either lands on the finish carrier — paying what it collected —
 * or ditches in the sea short of it.
 *
 * ── What is server-decided ─────────────────────────────────────────────────
 * All of it. BET goes to the game socket, and the server's engine
 * (apps/server/src/engines/avia.engine.ts) rolls the whole flight from the
 * round's committed seed and settles it through the ledger in the same frame.
 * GAME_RESULT carries every event and whether the flight lands; this component
 * lays that out (`planFlight`) and flies it. The landing chance is priced off
 * the pickup table so the round returns 97.5% — see AVIA in @frigat/shared.
 *
 * The result is known before take-off, so the panel shows the balance as it
 * stood at launch until the plane is down, rather than giving the ending away.
 *
 * Styling is injected CSS: this project ships no utility CSS framework, so a
 * class like `bg-[#0b1622]` would resolve to nothing.
 */


// ─────────────────────────────────────────────
// World objects
// ─────────────────────────────────────────────

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  hue: number;
  size: number;
  /**
   * Sparks are lit debris and fall under gravity; smoke is the damage trail,
   * drifting back off the airframe, expanding and thinning as it goes.
   */
  kind: 'spark' | 'smoke';
}

/** Call-out text that rises off the plane and fades. */
interface Floater {
  /** Screen coordinates, fixed at spawn — it marks where the event landed. */
  x: number;
  y: number;
  life: number;
  maxLife: number;
  text: string;
  sub: string;
  /** Pickups call out in green, rockets and the splash in red. */
  good: boolean;
}

/** What the server settled, held until the plane is down to show it. */
interface Settlement {
  landed: boolean;
  multiplier: number;
  payout: string;
}


// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function AviaMasters() {
  const { t } = useLanguage();
  useInjectedStyles(STYLE_ID, CSS);

  const { balance } = useGameSocket();

  const [phase, setPhase] = useState<Phase>('IDLE');
  const [bet, setBet] = useState('10.00');
  const [settled, setSettled] = useState<Settlement | null>(null);
  /** Why the last Fly press was refused, if it was. */
  const [serverError, setServerError] = useState<string | null>(null);
  /** The balance as it stood when Fly was pressed — shown until touchdown. */
  const [launchBalance, setLaunchBalance] = useState<string | null>(null);

  /** Telemetry mirrored out of the loop for the HUD, at a readable rate. */
  const [hud, setHud] = useState({ altitude: 0, distance: 0, multiplier: 1 });

  // The render loop reads refs, so it never restarts and never closes over a
  // stale value.
  const phaseRef = useRef<Phase>('IDLE');
  const planRef = useRef<FlightPlan | null>(null);
  const resultRef = useRef<Settlement | null>(null);
  const flightClockRef = useRef(0);
  const altitudeRef = useRef<number>(ON_DECK);
  const distanceRef = useRef(0);
  const multiplierRef = useRef(1);
  /** Index of the next event the plane has not reached yet. */
  const nextEventRef = useRef(0);
  /** Seconds since each event was collected, for the pop; -1 while ahead. */
  const eventAgeRef = useRef<number[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const landingStartedRef = useRef<number | null>(null);
  const shakeRef = useRef(0);
  const hudClockRef = useRef(0);
  const propellerRef = useRef(0);
  const waveRef = useRef(0);
  const settleRoundRef = useRef<() => void>(() => {});

  // ── Damage feedback ──
  /** Seconds of red screen flash left after a hit. */
  const flashRef = useRef(0);
  /** Seconds the engine keeps trailing smoke after a hit. */
  const smokeRef = useRef(0);
  const floatersRef = useRef<Floater[]>([]);

  /** Rendered pitch in radians, eased toward the path's slope. */
  const pitchRef = useRef(0);

  const isAirborne = phase === 'WAITING' || phase === 'FLYING' || phase === 'LANDING';
  const isOver = phase === 'LANDED' || phase === 'CRASHED';

  // ── Stake, checked against the wallet in exact decimal ──
  //
  // `safeBet` is what the decimal helpers see. The raw field passes through
  // states they cannot parse — `""`, `"1."` on the way to `"1.5"` — and
  // `Number.isNaN(Number(bet))` does not catch them: `Number("1.")` is 1, so
  // the old guard waved a trailing dot straight into `compareDecimal`, which
  // threw during render and took the board down.
  const safeBet = useMemo(() => safeDecimal(bet, GAME_CONFIG.minBet), [bet]);

  const betError = useMemo(() => {
    if (!isDecimalString(bet.trim())) return 'Enter a valid amount';
    if (compareDecimal(safeBet, GAME_CONFIG.minBet) < 0) {
      return `Minimum bet is $${formatDecimalString(GAME_CONFIG.minBet, 2)}`;
    }
    if (compareDecimal(safeBet, GAME_CONFIG.maxBet) > 0) {
      return `Maximum bet is $${formatDecimalString(GAME_CONFIG.maxBet, 2)}`;
    }
    // Only meaningful once a balance has actually arrived; before that the
    // wallet is unknown rather than empty, and blocking play on "unknown" would
    // lock the board on a slow socket.
    if (balance.hasSynced && balance.balance && compareDecimal(safeBet, balance.balance) > 0) {
      return 'Not enough balance — deposit to keep playing';
    }
    return null;
  }, [bet, safeBet, balance.hasSynced, balance.balance]);

  // What the flight would pay right now. Once it has ditched it pays nothing,
  // whatever it collected on the way down.
  const payout = useMemo(
    () => (phase === 'CRASHED' ? '0' : payoutFor(safeBet, hud.multiplier)),
    [phase, safeBet, hud.multiplier]
  );

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // ── Particles ──
  const burst = useCallback((x: number, y: number, count: number, hue: number) => {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 180;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.4 + Math.random() * 0.5,
        hue: hue + Math.random() * 30 - 15,
        size: 2 + Math.random() * 4,
        kind: 'spark',
      });
    }
  }, []);

  /** One puff off the engine. Called every frame while the plane is smoking. */
  const emitSmoke = useCallback((x: number, y: number) => {
    particlesRef.current.push({
      x: x - 4 + Math.random() * 6,
      y: y + Math.random() * 6 - 3,
      // Drifts back and slightly up, the way a trail hangs behind an airframe.
      vx: -70 - Math.random() * 60,
      vy: -14 - Math.random() * 22,
      life: 0,
      maxLife: 0.75 + Math.random() * 0.6,
      hue: 0,
      size: 3 + Math.random() * 4,
      kind: 'smoke',
    });
  }, []);

  /**
   * Everything a bomb hit does that the player should *see*: a red flash, a
   * shake, sparks, a smoking engine, and the damage called out in words above
   * the plane. Kept in one place so the visual and the mechanical penalty can
   * never drift apart — and it is called from exactly one place, the bounding
   * box test, so nothing else can shake the screen.
   */
  const registerHit = useCallback(
    (screenX: number, screenY: number, multiplierLost: number) => {
      flashRef.current = 0.32;
      shakeRef.current = 0.5;
      smokeRef.current = 2.4;
      burst(screenX, screenY, 26, 25);
      floatersRef.current.push({
        x: screenX,
        y: screenY - 26,
        life: 0,
        maxLife: 1.15,
        text: 'ROCKET!',
        // The honest number: what the hit actually took off the multiplier.
        sub: `−${multiplierLost.toFixed(2)}x`,
        good: false,
      });
    },
    [burst]
  );

  // ── Round flow ──
  const { busy, settle: releaseControls, bet: placeBet } = useGameRound('AVIA', {
    // The flight plays out after the frame lands; the controls stay locked
    // until the plane is down, or a second bet would take off mid-flight.
    autoSettle: false,
    onResult: ({ raw }) => {
      if (phaseRef.current !== 'WAITING') return;
      const data = (raw.resultData ?? {}) as { landed?: boolean; events?: ServerEvent[] };
      const plan = planFlight(data.events ?? [], Boolean(data.landed));
      planRef.current = plan;
      resultRef.current = {
        landed: plan.landed,
        multiplier: typeof raw.multiplier === 'number' ? raw.multiplier : 0,
        payout: typeof raw.payout === 'string' ? raw.payout : '0',
      };
      eventAgeRef.current = plan.events.map(() => -1);
      flightClockRef.current = 0;
      setPhaseBoth('FLYING');
    },
    onError: ({ code }) => {
      if (phaseRef.current === 'WAITING') setPhaseBoth('IDLE');
      setLaunchBalance(null);
      setServerError(t(gameErrorKey(code)));
    },
  });

  /** The plane is down: reveal what the server settled and free the controls. */
  const settleRound = useCallback(() => {
    const result = resultRef.current;
    if (!result) return;
    setSettled(result);
    setPhaseBoth(result.landed ? 'LANDED' : 'CRASHED');
    setLaunchBalance(null);
    releaseControls();
  }, [releaseControls, setPhaseBoth]);
  settleRoundRef.current = settleRound;

  const launch = useCallback(() => {
    if (betError || busy) return;
    if (phaseRef.current !== 'IDLE' && phaseRef.current !== 'LANDED' && phaseRef.current !== 'CRASHED') {
      return;
    }
    planRef.current = null;
    resultRef.current = null;
    altitudeRef.current = ON_DECK;
    distanceRef.current = 0;
    multiplierRef.current = 1;
    nextEventRef.current = 0;
    eventAgeRef.current = [];
    particlesRef.current = [];
    landingStartedRef.current = null;
    pitchRef.current = 0;
    shakeRef.current = 0;
    flashRef.current = 0;
    smokeRef.current = 0;
    floatersRef.current = [];
    setSettled(null);
    setServerError(null);
    setLaunchBalance(balance.balance);
    setHud({ altitude: ON_DECK, distance: 0, multiplier: 1 });
    setPhaseBoth('WAITING');
    placeBet('BET', {
      amount: toFixedDecimal(safeBet, 2),
      currency: balance.currency,
      params: {},
    });
  }, [betError, busy, balance.balance, balance.currency, placeBet, safeBet, setPhaseBoth]);

  /** The board, Space and Enter all do one thing: launch when grounded. */
  const onCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      launch();
    },
    [launch]
  );

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      // Leave Space and Enter alone in the stake field and on buttons.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|BUTTON|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      if (!event.repeat) launch();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [launch]);

  // ── Renderer ──
  const draw = useCallback(
    ({ ctx, width, height, delta }: CanvasFrame) => {
      const dt = Math.min(delta, 50) / 1000;
      const now = performance.now();

      const seaY = height * 0.84;
      const skyTop = height * 0.1;
      const scale = Math.max(4, Math.min(9, height / 52));
      /** Screen x the plane is pinned to; the world scrolls past it. */
      const planeX = width * 0.3;
      /** Screen pixels per world metre. */
      const pxPerMetre = width / 620;

      const altToY = (alt: number) =>
        seaY - (alt / GAME_CONFIG.maxAltitude) * (seaY - skyTop);
      /** The baseline every deck and the finish marker are drawn from. */
      const deckY = altToY(GAME_CONFIG.deckAltitude);

      const plan = planRef.current;
      const phaseNow = phaseRef.current;
      const flying = phaseNow === 'FLYING' && plan !== null;
      const landing = phaseNow === 'LANDING' && plan !== null;
      waveRef.current += dt;

      // ── Playback ──
      if (flying) {
        flightClockRef.current += dt;
        // The catapult: ease up to cruise instead of leaving at full speed.
        const launchT = Math.min(1, flightClockRef.current / GAME_CONFIG.catapultSeconds);
        const speed = GAME_CONFIG.cruiseSpeed * (0.35 + 0.65 * launchT);
        const before = distanceRef.current;
        distanceRef.current = Math.min(plan.endX, before + speed * dt);
        altitudeRef.current = altitudeAt(plan, distanceRef.current);

        // Events are met in order; a long frame may pass more than one.
        while (
          nextEventRef.current < plan.events.length &&
          distanceRef.current >= plan.events[nextEventRef.current].x
        ) {
          const i = nextEventRef.current;
          const event = plan.events[i];
          const spec = specFor(event.kind);
          const previous = multiplierRef.current;
          multiplierRef.current = event.multiplier;
          eventAgeRef.current[i] = 0;
          const y = altToY(event.alt);
          if (spec.hazard) {
            registerHit(planeX, y, Math.max(0, previous - event.multiplier));
          } else {
            burst(planeX, y, 12, 130);
            floatersRef.current.push({
              x: planeX,
              y: y - 30,
              life: 0,
              maxLife: 0.9,
              text: spec.label,
              sub: formatMultiplier(event.multiplier),
              good: true,
            });
          }
          nextEventRef.current += 1;
        }

        if (distanceRef.current >= plan.endX) {
          if (plan.landed) {
            landingStartedRef.current = now;
            burst(planeX, deckY, 14, 130);
            floatersRef.current.push({
              x: planeX,
              y: deckY - 46,
              life: 0,
              maxLife: 1.4,
              text: 'TOUCHDOWN',
              sub: `${formatMultiplier(multiplierRef.current)} banked`,
              good: true,
            });
            setPhaseBoth('LANDING');
          } else {
            // Short of the deck: the one way to lose, so it gets the full
            // splash, a long shake and a call-out.
            altitudeRef.current = 0;
            burst(planeX, seaY, 34, 200);
            burst(planeX, seaY, 20, 40);
            flashRef.current = 0.4;
            shakeRef.current = 0.7;
            floatersRef.current.push({
              x: planeX,
              y: seaY - 42,
              life: 0,
              maxLife: 1.3,
              text: 'SPLASHDOWN',
              sub: 'Short of the deck',
              good: false,
            });
            settleRoundRef.current();
          }
        }
      }

      if (landing && landingStartedRef.current !== null) {
        const t = Math.min(1, (now - landingStartedRef.current) / GAME_CONFIG.landingMs);
        const eased = 1 - Math.pow(1 - t, 3);
        // Roll forward along the deck and stop, rather than freezing the
        // instant the wheels touch.
        distanceRef.current = plan.endX + GAME_CONFIG.carrierLength * 0.4 * eased;
        altitudeRef.current = ON_DECK;
        if (t >= 1) settleRoundRef.current();
      }

      const distance = distanceRef.current;

      for (const [i, age] of eventAgeRef.current.entries()) {
        if (age >= 0) eventAgeRef.current[i] = age + dt;
      }

      // Damage trail: the engine keeps smoking for a couple of seconds after a
      // hit, so the plane carries visible evidence of it rather than the whole
      // event being over inside one frame.
      if (smokeRef.current > 0) {
        smokeRef.current = Math.max(0, smokeRef.current - dt);
        if (flying) emitSmoke(planeX - 6, altToY(altitudeRef.current));
      }

      for (const particle of particlesRef.current) {
        particle.life += dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        // Sparks fall; smoke is buoyant and just slows down.
        if (particle.kind === 'spark') particle.vy += 260 * dt;
        else {
          particle.vx *= 1 - 0.9 * dt;
          particle.vy -= 8 * dt;
        }
      }
      particlesRef.current = particlesRef.current.filter((p) => p.life < p.maxLife);

      for (const floater of floatersRef.current) floater.life += dt;
      floatersRef.current = floatersRef.current.filter((f) => f.life < f.maxLife);

      if (flashRef.current > 0) flashRef.current = Math.max(0, flashRef.current - dt);

      // ── HUD, at a rate a human can read ──
      hudClockRef.current += dt;
      if (hudClockRef.current > 0.08) {
        hudClockRef.current = 0;
        setHud({
          altitude: altitudeRef.current,
          distance: distanceRef.current,
          multiplier: multiplierRef.current,
        });
      }

      // ── Paint ──
      ctx.save();
      if (shakeRef.current > 0) {
        shakeRef.current = Math.max(0, shakeRef.current - dt);
        const power = shakeRef.current * 14;
        ctx.translate((Math.random() - 0.5) * power, (Math.random() - 0.5) * power);
      }

      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, seaY);
      sky.addColorStop(0, '#0b2545');
      sky.addColorStop(0.55, '#1d4e89');
      sky.addColorStop(1, '#4a90c2');
      ctx.fillStyle = sky;
      ctx.fillRect(-20, -20, width + 40, seaY + 20);

      // Parallax clouds, tied to distance so they scroll with the run
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      for (let i = 0; i < 7; i += 1) {
        const seedX = ((i * 613) % 1000) / 1000;
        const cloudX =
          ((seedX * width * 2 - distance * pxPerMetre * 0.22) % (width * 1.6) + width * 1.6) %
            (width * 1.6) -
          width * 0.3;
        const cloudY = skyTop + ((i * 137) % 100) / 100 * (seaY - skyTop) * 0.55;
        const r = 18 + ((i * 71) % 40);
        ctx.beginPath();
        ctx.ellipse(cloudX, cloudY, r * 1.9, r * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Sea
      const sea = ctx.createLinearGradient(0, seaY, 0, height);
      sea.addColorStop(0, '#0e4a6b');
      sea.addColorStop(1, '#062033');
      ctx.fillStyle = sea;
      ctx.fillRect(-20, seaY, width + 40, height - seaY + 20);

      // Swell
      ctx.strokeStyle = 'rgba(148,197,231,.22)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i += 1) {
        const y = seaY + 8 + i * ((height - seaY) / 5);
        const offset = (distance * pxPerMetre * (0.4 + i * 0.12)) % 60;
        ctx.beginPath();
        for (let x = -60; x < width + 60; x += 30) {
          ctx.moveTo(x - offset, y);
          ctx.quadraticCurveTo(x - offset + 9, y - 3, x - offset + 18, y);
        }
        ctx.stroke();
      }

      const toScreenX = (x: number) => planeX + (x - distance) * pxPerMetre;
      const carrierPx = GAME_CONFIG.carrierLength * pxPerMetre;

      // Launch carrier: the plane starts near its bow and it scrolls away.
      const launchX = toScreenX(-GAME_CONFIG.carrierLength * 0.85);
      if (launchX + carrierPx > -40) {
        drawCarrier(ctx, launchX, deckY, seaY, carrierPx, '#e0b055');
      }

      // Finish carrier and its flag, on the same baseline as the launch deck.
      if (plan) {
        const finishLeft = toScreenX(plan.finishX - GAME_CONFIG.carrierLength / 2);
        if (finishLeft < width + 40 && finishLeft + carrierPx > -40) {
          drawCarrier(ctx, finishLeft, deckY, seaY, carrierPx, '#22c55e');
          drawFinishMarker(ctx, finishLeft + carrierPx * 0.9, deckY, scale, waveRef.current);
        }
      }

      // Pickups and rockets, where the path will meet them. Collected ones pop
      // and fade; rockets that have gone off simply vanish into the smoke.
      if (plan) {
        for (const [i, event] of plan.events.entries()) {
          const x = toScreenX(event.x);
          if (x < -60 || x > width + 60) continue;
          const age = eventAgeRef.current[i] ?? -1;
          const spec = specFor(event.kind);
          if (spec.hazard) {
            if (age < 0) drawBomb(ctx, x, altToY(event.alt), scale, waveRef.current + i);
          } else {
            drawPickup(ctx, x, altToY(event.alt), scale * 2.1, spec, Math.max(0, age));
          }
        }
      }

      // Plane — banked by what the player is asking for, so input reads visually
      if (phaseNow !== 'CRASHED' || particlesRef.current.length > 0) {
        // ── Pitch ──
        // The nose follows the path's slope a few metres ahead, eased so a
        // change of direction reads as a plane pulling up, not a flick. The
        // slope is measured on screen, not in metres: the two axes are scaled
        // differently, and a world-space angle points the nose several times
        // steeper than the line the plane is visibly flying.
        let targetPitch = 0;
        if (plan && flying) {
          const rise = altToY(altitudeAt(plan, distance)) - altToY(altitudeAt(plan, distance + 25));
          const slope = Math.atan2(rise, 25 * pxPerMetre);
          targetPitch = Math.max(-GAME_CONFIG.maxPitchUp, Math.min(GAME_CONFIG.maxPitchDown, -slope));
        } else if (landing) {
          targetPitch = -0.05;
        }
        pitchRef.current += (targetPitch - pitchRef.current) * Math.min(1, dt * 9);
        const climbing = pitchRef.current;
        propellerRef.current += dt * 34;
        drawPlane(
          ctx,
          planeX,
          altToY(altitudeRef.current),
          scale,
          phaseNow === 'CRASHED' ? 0.9 : climbing,
          propellerRef.current
        );
      }

      // Particles. Sparks shrink and brighten out; smoke expands and thins,
      // which is what separates the two at a glance.
      for (const particle of particlesRef.current) {
        const t = particle.life / particle.maxLife;
        if (particle.kind === 'smoke') {
          ctx.fillStyle = `rgba(120,132,148,${(1 - t) * 0.5})`;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * (1 + t * 2.4), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = `hsla(${particle.hue}, 95%, ${60 - t * 25}%, ${1 - t})`;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * (1 - t * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Call-outs, rising and fading above the plane.
      for (const floater of floatersRef.current) {
        const t = floater.life / floater.maxLife;
        const rise = t * 34;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t * t);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // A dark stroke under the type: the sky behind it runs from pale blue
        // to near-black depending on altitude, and red alone disappears against
        // the top of that range.
        ctx.lineWidth = Math.max(2, scale * 0.5);
        ctx.strokeStyle = 'rgba(8,17,27,.85)';
        ctx.font = `900 ${scale * 2.1}px ui-sans-serif, system-ui, sans-serif`;
        ctx.strokeText(floater.text, floater.x, floater.y - rise);
        ctx.fillStyle = floater.good ? '#4ade80' : '#ef4444';
        ctx.fillText(floater.text, floater.x, floater.y - rise);

        ctx.font = `800 ${scale * 1.5}px ui-sans-serif, system-ui, sans-serif`;
        ctx.strokeText(floater.sub, floater.x, floater.y - rise + scale * 2);
        ctx.fillStyle = floater.good ? '#bbf7d0' : '#d69199';
        ctx.fillText(floater.sub, floater.x, floater.y - rise + scale * 2);
        ctx.restore();
      }

      ctx.restore();

      // Impact flash. Outside the shake transform so the wash covers the whole
      // canvas rather than sliding with it and leaving an unpainted edge.
      if (flashRef.current > 0) {
        ctx.fillStyle = `rgba(239,68,68,${(flashRef.current / 0.32) * 0.3})`;
        ctx.fillRect(0, 0, width, height);
      }
    },
    [burst, emitSmoke, registerHit, setPhaseBoth]
  );

  const canvasRef = useCanvasRenderer(draw, { maxPixelRatio: 3 });

  // ── Stake controls ──
  const scaleBet = (factor: number) => {
    setBet((current) => {
      const value = Number(current || '0') * factor;
      return value.toFixed(2);
    });
  };

  const maxStake = () => {
    const ceiling =
      balance.hasSynced && balance.balance && compareDecimal(balance.balance, GAME_CONFIG.maxBet) < 0
        ? balance.balance
        : GAME_CONFIG.maxBet;
    setBet(toFixedDecimal(ceiling, 2));
  };

  // Until the plane is down the panel shows the balance from take-off: the
  // ledger has already settled the flight, and the live figure would give the
  // ending away. It is still a ledger-reported value — nothing is computed.
  const shownBalance = isAirborne && launchBalance !== null ? launchBalance : balance.balance;

  return (
    <div className="avia">
      {/* ---------- Stage ---------- */}
      <div className="avia__stage">
        {/* A tap on the board launches when the plane is on deck. There is
            nothing to steer: the flight is decided at take-off. */}
        <canvas
          ref={canvasRef}
          className="avia__canvas"
          onPointerDown={onCanvasPointerDown}
          role="application"
          aria-label={t('gameUi.aviaFlightAria')}
        />

        <div className="avia__hud" aria-live="off">
          <div className="avia__tile">
            <span className="avia__tile-label">{t('gameUi.aviaAltitude')}</span>
            <span className="avia__tile-value">{formatMetres(hud.altitude)}</span>
          </div>
          <div className="avia__tile">
            <span className="avia__tile-label">{t('gameUi.aviaDistance')}</span>
            <span className="avia__tile-value">{formatMetres(hud.distance)}</span>
          </div>
          <div className="avia__tile avia__tile--mult">
            <span className="avia__tile-label">{t('gameUi.aviaMultiplier')}</span>
            <span className="avia__tile-value">{formatMultiplier(hud.multiplier)}</span>
          </div>
          <div className="avia__tile avia__tile--payout">
            <span className="avia__tile-label">{t('gameUi.aviaPayout')}</span>
            <span className="avia__tile-value">${formatDecimalString(payout, 2)}</span>
          </div>
        </div>

        {isOver && settled && (
          <div
            className={`avia__banner ${
              settled.landed ? 'avia__banner--won' : 'avia__banner--lost'
            }`}
            role="status"
          >
            {settled.landed ? (
              <>
                {t('gameUi.aviaLanded', { multiplier: formatMultiplier(settled.multiplier) })}
                <small>+${formatDecimalString(settled.payout, 2)}</small>
              </>
            ) : (
              <>
                {t('gameUi.aviaDitched')}
                <small>{t('gameUi.aviaStakeLost')}</small>
              </>
            )}
          </div>
        )}

        <p className="avia__hint">
          {isAirborne ? t('gameUi.aviaHintFlying') : t('gameUi.aviaHintIdle')}
        </p>
      </div>

      {/* ---------- Panel ---------- */}
      <div className="avia__panel">
        <div>
          <div className="avia__label">
            <span>{t('gameUi.betAmount')}</span>
            <b>
              {balance.hasSynced && shownBalance
                ? `${formatDecimalString(shownBalance, 2)} ${balance.currency}`
                : '—'}
            </b>
          </div>
          <div className="avia__inputs">
            <input
              className="avia__input"
              inputMode="decimal"
              value={bet}
              disabled={isAirborne}
              aria-invalid={betError !== null}
              aria-label={t('gameUi.betAmount')}
              onChange={(event) => setBet(sanitizeDecimalInput(event.target.value))}
            />
            <button
              type="button"
              className="avia__mod"
              disabled={isAirborne}
              aria-label={t('gameUi.halveBet')}
              onClick={() => scaleBet(0.5)}
            >
              ½
            </button>
            <button
              type="button"
              className="avia__mod"
              disabled={isAirborne}
              aria-label={t('gameUi.doubleBet')}
              onClick={() => scaleBet(2)}
            >
              2x
            </button>
            <button
              type="button"
              className="avia__mod"
              disabled={isAirborne}
              aria-label={t('gameUi.maxBet')}
              onClick={maxStake}
            >
              Max
            </button>
          </div>
        </div>

        <div className="avia__legend" aria-hidden="true">
          {PICKUPS.map((spec) => (
            <span
              key={spec.kind}
              className={`avia__chip${spec.hazard ? ' avia__chip--bad' : ''}`}
            >
              {spec.label}
            </span>
          ))}
        </div>

        {!isAirborne && (betError || serverError) && (
          <p className="avia__error" role="alert">
            {betError ?? serverError}
          </p>
        )}

        {isAirborne ? (
          // Not a button: one bet is one flight, and nothing can change it
          // once the plane has left the deck.
          <div className="avia__standing" role="status">
            <span>
              {phase === 'WAITING'
                ? t('gameUi.aviaWaiting')
                : phase === 'LANDING'
                  ? t('gameUi.aviaTouchdown')
                  : t('gameUi.aviaInFlight')}
            </span>
            <b>
              {formatMultiplier(hud.multiplier)} · ${formatDecimalString(payout, 2)}
            </b>
            <small>
              {phase === 'LANDING' ? t('gameUi.aviaAutoCashout') : t('gameUi.aviaLandToBank')}
            </small>
          </div>
        ) : (
          <button
            type="button"
            className="avia__action"
            onClick={launch}
            disabled={betError !== null || busy}
          >
            {isOver ? t('gameUi.aviaFlyAgain') : t('gameUi.aviaFly')}
          </button>
        )}

        <p className="avia__note">{t('gameUi.aviaNote')}</p>
      </div>
    </div>
  );
}
