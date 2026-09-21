'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import { loadKeyedSprite, type KeyedSprite } from '@/lib/spriteMask';
import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useLanguage } from '@/components/providers/LanguageProvider';
import { useGameRound } from '@/hooks/useGameRound';
import { compareDecimal, formatDecimalString } from '@/lib/decimal';

import {
  DEFAULT_MODE,
  FOLLOW_GAP,
  GAME_CONFIG,
  HOP_MS,
  LAYOUT,
  SEED_GEOMETRY,
  TRAFFIC_MODES,
  cumulativeChanceAt,
  formatChance,
  formatMultiplier,
  gateFraction,
  laneDirection,
  lastLane,
  money,
  multiplierAt,
  randomBetween,
  type Geometry,
  type Phase,
  type TrafficMode,
} from './chickenRoad/config';
import {
  CAR_UNITS,
  CHICKEN_RENDERER,
  CHICKEN_SPRITE_SRC,
  CHICKEN_UNITS,
  drawAtmosphere,
  drawBarrier,
  drawBarrierShadow,
  drawCar3D,
  drawCarShadow,
  drawChicken,
  drawChickenShadow,
  drawChickenSprite,
  drawCover,
  drawRoad,
  randomCarColour,
  type CarColour,
  type CoverState,
} from './chickenRoad/draw';
import { DEPTH_STRETCH, makeView } from './chickenRoad/view';
import { CSS, STYLE_ID } from './chickenRoad/styles';

// The board's configuration and odds were part of this file before it was split
// four ways; re-exported so nothing that reached for them here has to move.
export {
  GAME_CONFIG,
  TRAFFIC_MODES,
  multiplierAt,
  crossingChanceAt,
  cumulativeChanceAt,
} from './chickenRoad/config';

/** GAME_RESULT fields for this game — see handleChickenStep/Cashout on the server. */
interface ChickenResult {
  bust?: boolean;
  auto?: boolean;
  lane?: number;
  multiplier?: number;
  payout?: string;
}
export type { Phase, TrafficMode } from './chickenRoad/config';
export type { CarColour } from './chickenRoad/draw';

/**
 * Chicken Road — side-scrolling arcade crossing, drawn on a canvas.
 *
 * The chicken starts on the left verge and hops one lane right per tap — the
 * sprite itself is the control, with a hit target the render loop keeps pinned
 * to it. There is no far side: lanes are generated on demand as the camera
 * follows the chicken, so a round only ends when the player cashes out or a car
 * lands. Traffic is one-way, running top to bottom in every lane.
 *
 * Real stakes. The board never decides anything: the server takes the stake on
 * BET, rolls every hop from the round's committed seed
 * (apps/server/src/engines/chicken.engine.ts) and settles through the ledger.
 * The page reads the balance to bound the bet and nothing more.
 *
 * ── On the odds ────────────────────────────────────────────────────────────
 * Traffic is scenery. A tap sends STEP and the hop only starts once the server
 * answers: STATE_UPDATE means the lane was cleared, a bust GAME_RESULT means it
 * was not, and a car is then launched into the target lane timed to arrive as
 * the chicken lands — the animation shows the outcome instead of deciding it.
 * The ladder is priced off survival odds (`rtp / p^lanes`), so the edge stays
 * flat however far the player goes, and the road ends at the lane where the
 * ladder reaches CHICKEN.maxMultiplier, which cashes out automatically.
 *
 * ── The view ───────────────────────────────────────────────────────────────
 * The round is simulated flat — lanes across, `t` down each lane — and drawn
 * in perspective through `chickenRoad/view.ts`: the road recedes to a haze at
 * the far end, cars are extruded boxes driving toward the camera, and every
 * object casts a shadow from one point light, so shadows swing and stretch as
 * the cars move. The multiplier covers and the barriers are canvas too, since
 * DOM laid over the canvas cannot follow the projection.
 *
 * A barrier stands at the far end of each lane the chicken has claimed, and
 * drops across it as the hop lands. Traffic queues at it, which is what makes
 * the lanes behind the chicken safe. It sits upstream of the crossing row
 * because cars come from the far end — put it downstream and they would drive
 * through the chicken before anything stopped them.
 *
 * Styling is injected CSS — this project ships no utility CSS framework, so
 * `bg-[#7c8b9e]` would resolve to nothing.
 */


// ─────────────────────────────────────────────
// Traffic model
// ─────────────────────────────────────────────

interface Car {
  /** Position along the lane's travel axis, as a fraction of stage height. */
  t: number;
  /** Lane lengths per second, always positive; the lane carries direction. */
  speed: number;
  /** Cars already past a closing gate clear out rather than freeze mid-lane. */
  fleeing: boolean;
  /** The one car allowed to hit the chicken, on a failed crossing roll. */
  doomed: boolean;
  /** Fixed at spawn, so a car never changes colour as it drives. */
  colour: CarColour;
}

interface LaneTraffic {
  dir: 1 | -1;
  cars: Car[];
  /** `performance.now()` stamp of the next spawn. */
  nextSpawnAt: number;
}


// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function ChickenRoad() {
  const { t } = useLanguage();
  useInjectedStyles(STYLE_ID, CSS);

  const [phase, setPhase] = useState<Phase>('IDLE');
  const [lane, setLane] = useState(0);
  const [bet, setBet] = useState(10);
  const [mode, setMode] = useState<TrafficMode>(DEFAULT_MODE);
  const [hopping, setHopping] = useState(false);
  /** Settled payout as the server reported it — an exact decimal string. */
  const [lastWin, setLastWin] = useState<string | null>(null);

  // The render loop reads these rather than state, so it never restarts and
  // never closes over a stale value.
  const phaseRef = useRef<Phase>('IDLE');
  const laneRef = useRef(0);
  const modeRef = useRef<TrafficMode>(DEFAULT_MODE);
  const lanesRef = useRef<Map<number, LaneTraffic>>(new Map());
  /** Sprite sizes in lane fractions, refreshed from the drawn scale each frame. */
  const geomRef = useRef<Geometry>({ ...SEED_GEOMETRY });
  const stageRef = useRef<HTMLDivElement>(null);
  /**
   * The player's chicken. Held in a ref rather than state: the render loop is
   * the only reader, and re-rendering the tree when it arrives would restart
   * nothing useful. Null until the image has loaded and been keyed, and if that
   * ever fails it simply stays null and the vector fallback keeps drawing.
   */
  const chickenSpriteRef = useRef<KeyedSprite | null>(null);
  /** When each lane's barrier started to drop, so the arm animates down once. */
  const gateClosedAtRef = useRef<Map<number, number>>(new Map());
  /** Honoured by the decorative motion only — the cover pulse, the barrier bounce. */
  const reducedMotionRef = useRef(false);
  const cameraRef = useRef(0);
  /** Lane the sprite occupies, as a float while a hop is in flight. */
  const visualLaneRef = useRef(0);
  const hopRef = useRef<{ from: number; to: number; startedAt: number } | null>(null);
  /** Set when the crossing roll failed: the lane, and when the car should land. */
  const doomedRef = useRef<{ lane: number; at: number } | null>(null);
  const crashAtRef = useRef<number | null>(null);
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A STEP is on the wire. Set synchronously, so a key held down cannot send a
   * second hop before React has re-rendered with `busy`.
   */
  const stepPendingRef = useRef(false);

  const { balance, send, socket } = useGameSocket();

  const isPlaying = phase === 'PLAYING';
  const isOver = phase === 'WON' || phase === 'LOST';
  const multiplier = multiplierAt(lane, mode);
  // Display only: the amount credited is the server's, reported in GAME_RESULT.
  const payout = Number((bet * multiplier).toFixed(2));

  /** The stake as the ledger expects it: a 2 dp decimal string. */
  const stake = Number.isFinite(bet) ? bet.toFixed(2) : '';

  // The server enforces all of this again; checking here just saves a round
  // trip and says why the button is off.
  const betError = useMemo(() => {
    if (!Number.isFinite(bet) || bet < GAME_CONFIG.minBet) {
      return `Minimum bet is ${money(GAME_CONFIG.minBet)}`;
    }
    if (bet > GAME_CONFIG.maxBet) return `Maximum bet is ${money(GAME_CONFIG.maxBet)}`;
    if (balance.balance !== null && compareDecimal(stake, balance.balance) > 0) {
      return t('gameUi.chickenInsufficient');
    }
    return null;
  }, [bet, stake, balance.balance, t]);

  const maxBet = GAME_CONFIG.maxBet;

  const setPhaseBoth = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const setLaneBoth = useCallback((next: number) => {
    laneRef.current = next;
    setLane(next);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = query.matches;
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Load the chicken art once per mount. The keying is a one-off cost of a few
  // tens of milliseconds; the vector chicken covers the frames until it lands.
  useEffect(() => {
    // Nothing to fetch or key when the vector rooster is drawing: the keying
    // pass walks ~450k pixels, which is not a cost to pay for an unused sprite.
    if (CHICKEN_RENDERER !== 'image') return;

    let cancelled = false;
    void loadKeyedSprite(CHICKEN_SPRITE_SRC).then((sprite) => {
      if (!cancelled) chickenSpriteRef.current = sprite;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    },
    []
  );

  // ── Traffic ────────────────────────────────────────

  /** Just past the top edge: a car eases in nose first, never popping in. */
  const spawnPoint = useCallback((dir: 1 | -1): number => {
    const clearance = geomRef.current.carHalf + 0.04;
    return dir > 0 ? -clearance : 1 + clearance;
  }, []);

  const makeCar = useCallback(
    (dir: 1 | -1, overrides: Partial<Car> = {}): Car => ({
      t: spawnPoint(dir),
      speed: randomBetween(modeRef.current.speed),
      fleeing: false,
      doomed: false,
      colour: randomCarColour(),
      ...overrides,
    }),
    [spawnPoint]
  );

  const ensureLane = useCallback(
    (l: number, now: number): LaneTraffic => {
      let traffic = lanesRef.current.get(l);
      if (!traffic) {
        const dir = laneDirection(l);
        traffic = {
          dir,
          cars: [],
          // Stagger the first spawn so a freshly revealed lane is not a wall.
          nextSpawnAt: now + randomBetween(modeRef.current.gap) * 1000 * Math.random(),
        };
        // Seed a car mid-lane so a lane never looks empty the moment it appears.
        if (Math.random() < 0.6) {
          traffic.cars.push(makeCar(dir, { t: 0.2 + Math.random() * 0.6 }));
        }
        lanesRef.current.set(l, traffic);
      }
      return traffic;
    },
    [makeCar]
  );

  /**
   * Advances every visible lane. Cars move at a constant speed scaled by dt, so
   * the board runs at the same pace on any refresh rate.
   *
   * Every car is clamped against the one in front of it, not just at gates —
   * speeds are randomised per car, so without that a fast car would drive
   * straight through a slow one. The clamp is monotonic (a car is never pushed
   * back, only held), which is what keeps a queue from oscillating: a follower
   * pinned behind a leader simply inherits its pace until the road clears.
   */
  const stepTraffic = useCallback(
    (now: number, dt: number, first: number, last: number) => {
      const settled = laneRef.current;
      const { carLen, carHalf } = geomRef.current;

      for (const key of Array.from(lanesRef.current.keys())) {
        if (key < first - 2) lanesRef.current.delete(key);
      }

      for (let l = first; l <= last; l += 1) {
        const traffic = ensureLane(l, now);
        const closed = l <= settled;
        const dir = traffic.dir;
        const ahead = (a: number, b: number) => (dir > 0 ? a > b : a < b);
        // The nose stops at the gate, so the bar is never overlapped.
        const stopLine = gateFraction(l) - dir * (carHalf + 0.008);

        // Leading car first, so followers can clamp against the one ahead.
        traffic.cars.sort((a, b) => (dir > 0 ? b.t - a.t : a.t - b.t));

        if (closed) {
          // Nothing new enters a lane the chicken has claimed.
          traffic.nextSpawnAt = now + randomBetween(modeRef.current.gap) * 1000;
        } else if (now >= traffic.nextSpawnAt) {
          // Hold the spawn if the entry is still occupied, rather than dropping
          // a car on top of the last one.
          const entry = spawnPoint(dir);
          const last_ = traffic.cars[traffic.cars.length - 1];
          if (!last_ || ahead(last_.t, entry + dir * (carLen + FOLLOW_GAP))) {
            traffic.cars.push(makeCar(dir));
            traffic.nextSpawnAt = now + randomBetween(modeRef.current.gap) * 1000;
          } else {
            traffic.nextSpawnAt = now + 120;
          }
        }

        /** Furthest a follower may travel: the tail of the car ahead. */
        let limit: number | null = null;
        for (const car of traffic.cars) {
          const speed = car.speed * (car.fleeing ? 3.2 : 1);
          let next = car.t + dir * speed * dt;

          const holdAtGate =
            closed && !car.doomed && !car.fleeing && !ahead(car.t, stopLine);
          const bound = holdAtGate
            ? limit === null
              ? stopLine
              : ahead(stopLine, limit)
                ? limit
                : stopLine
            : limit;

          if (bound !== null && ahead(next, bound)) {
            // Hold, never shove backwards — a car that spawned tight behind
            // another would otherwise jump back a frame and jitter.
            next = ahead(bound, car.t) ? bound : car.t;
          }

          car.t = next;
          limit = car.t - dir * (carLen + FOLLOW_GAP);
        }

        // Despawn a full car-length clear of the edge it drives off.
        const exit = 1 + carHalf + 0.05;
        const entry = -(carHalf + 0.05);
        traffic.cars = traffic.cars.filter((car) => car.t > entry - 0.1 && car.t < exit);
      }
    },
    [ensureLane, makeCar, spawnPoint]
  );

  const resetTraffic = useCallback(() => {
    lanesRef.current.clear();
    gateClosedAtRef.current.clear();
    cameraRef.current = 0;
  }, []);

  // ── Round flow ─────────────────────────────────────

  const crash = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    landingTimerRef.current = null;
    doomedRef.current = null;
    hopRef.current = null;
    crashAtRef.current = performance.now();
    // The bird goes back to the verge, so the lanes it had claimed reopen.
    gateClosedAtRef.current.clear();
    setHopping(false);
    setPhaseBoth('LOST');
    // The chicken returns to the verge when the round ends.
    visualLaneRef.current = 0;
    setLaneBoth(0);
  }, [setPhaseBoth, setLaneBoth]);

  /** Clears the board back to the verge, ready for a round to begin. */
  const resetBoard = useCallback(() => {
    if (landingTimerRef.current) clearTimeout(landingTimerRef.current);
    landingTimerRef.current = null;
    resetTraffic();
    setLaneBoth(0);
    setHopping(false);
    visualLaneRef.current = 0;
    hopRef.current = null;
    doomedRef.current = null;
    crashAtRef.current = null;
    stepPendingRef.current = false;
  }, [resetTraffic, setLaneBoth]);

  /**
   * One lane right, with an outcome the server has already decided. On a miss a
   * car is launched into the target lane timed to arrive as the chicken lands,
   * so the collision the player sees is the outcome, not the cause.
   * `onLanded` runs once a surviving hop touches down.
   */
  const playHop = useCallback(
    (survived: boolean, onLanded?: () => void) => {
      if (phaseRef.current !== 'PLAYING') return;

      const from = laneRef.current;
      const to = from + 1;
      const now = performance.now();
      hopRef.current = { from, to, startedAt: now };
      setHopping(true);

      const traffic = ensureLane(to, now);

      if (!survived) {
        const speed = randomBetween(modeRef.current.speed);
        const travel = speed * (HOP_MS / 1000);
        const { carHalf, chickenHalf } = geomRef.current;
        // Placed so the car's *nose* — not its centre — reaches the chicken's box
        // exactly as the hop lands. With the sprites this large the difference is
        // half a car, which is the gap between a hit on landing and one that
        // fires while the bird is still mid-air.
        traffic.cars.push({
          t: LAYOUT.chickenY - traffic.dir * (travel + carHalf + chickenHalf),
          speed,
          fleeing: false,
          doomed: true,
          colour: randomCarColour(),
        });
        doomedRef.current = { lane: to, at: now + HOP_MS };
        return;
      }

      landingTimerRef.current = setTimeout(() => {
        landingTimerRef.current = null;
        if (phaseRef.current !== 'PLAYING') return;
        hopRef.current = null;
        visualLaneRef.current = to;
        setHopping(false);
        // The lane is now the chicken's, so it is cleared of traffic outright.
        //
        // Holding cars at the gate looked wrong in two ways: a queue pressed up
        // against the barrier read as cars driving *through* it, and anything
        // already past the gate was left crawling over the line the chicken is
        // standing on. Emptying the lane is what "closed" should look like, and
        // `closed` already stops the lane respawning, so nothing refills it.
        //
        // Cars past the gate are set fleeing first: they are downstream of the
        // barrier and drive themselves off, which covers the frame where the rest
        // disappear behind the bar slamming down.
        const gate = gateFraction(to);
        const escaping = traffic.cars.filter((car) =>
          traffic.dir > 0 ? car.t >= gate : car.t <= gate
        );
        for (const car of escaping) car.fleeing = true;
        traffic.cars = escaping;
        gateClosedAtRef.current.set(to, performance.now());
        setLaneBoth(to);
        onLanded?.();
      }, HOP_MS);
    },
    [ensureLane, setLaneBoth]
  );

  // ── Server round ───────────────────────────────────
  //
  // A round spans several frames, so `busy` means "a message is in flight", not
  // "a round is running" — `phase` is the round.
  const { busy, begin, settle, bet: placeBet } = useGameRound<ChickenResult>('CHICKEN', {
    on: {
      BET_ACCEPTED: (data) => {
        resetBoard();
        setLastWin(null);
        if (data.resumed) {
          // Re-attached to a round the server is still holding: restore the
          // stake, mode and lane rather than starting over.
          const resumedMode = TRAFFIC_MODES.find((m) => m.id === data.mode);
          if (resumedMode) {
            modeRef.current = resumedMode;
            setMode(resumedMode);
          }
          if (typeof data.amount === 'string') setBet(Number(data.amount));
          const at = typeof data.lane === 'number' ? data.lane : 0;
          visualLaneRef.current = at;
          cameraRef.current = Math.max(0, at - 1.4);
          // Lanes already crossed have their barriers down — no animation.
          for (let l = 1; l <= at; l += 1) gateClosedAtRef.current.set(l, 0);
          setLaneBoth(at);
        }
        setPhaseBoth('PLAYING');
        settle();
      },
      STATE_UPDATE: () => {
        stepPendingRef.current = false;
        settle();
        playHop(true);
      },
    },
    onResult: ({ raw }) => {
      stepPendingRef.current = false;
      const settled = typeof raw.payout === 'string' ? raw.payout : null;
      if (raw.bust) {
        // The collision in the render loop moves the phase to LOST.
        playHop(false);
        return;
      }
      const finish = () => {
        setLastWin(settled);
        setPhaseBoth('WON');
      };
      // The last lane cashes out on the server as the hop lands; play the hop
      // first so the win does not arrive with the chicken still on the verge.
      if (raw.auto) playHop(true, finish);
      else finish();
    },
    onError: () => {
      stepPendingRef.current = false;
    },
  });

  // A reload mid-round would otherwise strand the stake: the server holds the
  // round and refuses a new bet, and a fresh page has nothing to cash out of.
  useEffect(() => {
    if (!socket.isOpen) return;
    send('RESUME', 'CHICKEN');
  }, [socket.isOpen, send]);

  const startRound = useCallback(() => {
    if (betError || busy) return;
    resetBoard();
    setLastWin(null);
    placeBet('BET', {
      amount: stake,
      currency: balance.currency,
      params: { mode: modeRef.current.id },
    });
  }, [betError, busy, resetBoard, placeBet, stake, balance.currency]);

  const cashOut = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    if (laneRef.current === 0 || hopRef.current || doomedRef.current) return;
    if (stepPendingRef.current || busy) return;
    begin();
    send('CASHOUT', 'CHICKEN');
  }, [busy, begin, send]);

  /** One lane right — asks the server, and hops when it answers. */
  const advance = useCallback(() => {
    if (phaseRef.current !== 'PLAYING') return;
    if (hopRef.current || doomedRef.current || stepPendingRef.current) return;
    stepPendingRef.current = true;
    begin();
    send('STEP', 'CHICKEN');
  }, [begin, send]);

  // Arrow keys / W, as well as the on-screen control and the canvas itself.
  useEffect(() => {
    if (!isPlaying) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowRight' ||
        event.key === 'd' ||
        event.key === 'D' ||
        event.key === 'w' ||
        event.key === 'W'
      ) {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, advance]);

  // ── Renderer ───────────────────────────────────────
  //
  // One canvas, painted back to front: the road and everything lying on it,
  // then every shadow, then the standing objects — barriers, cars and the
  // chicken — sorted by how far down the road they are, then the haze. The
  // simulation stays in flat (u, t) space; `view` is only where it is drawn.
  const draw = useCallback(
    ({ ctx, width, height, delta }: CanvasFrame) => {
      const now = performance.now();
      const dt = Math.min(delta, 50) / 1000;

      const laneW = width / GAME_CONFIG.visibleLanes;
      /** World pixels in one lane length — see DEPTH_STRETCH. */
      const depthPx = height * DEPTH_STRETCH;

      // ── Sprite scales, and the lane geometry that follows from them ──
      // Published before the traffic steps, so spawning, following distance,
      // gate stops and the collision box all use the sizes actually drawn at
      // the chicken's depth, where the collision happens.
      const carScale = Math.max(4, Math.min(8, height / 58));
      const chickenScale = Math.max(3, Math.min(6, height / 100));
      const carLenPx = CAR_UNITS.len * carScale;
      const carWidthPx = CAR_UNITS.width * carScale;

      // The chicken's drawn size, decided once and used for both the sprite and
      // its hitbox. Height drives the box and the sprite's own aspect ratio
      // gives the width, so the image is never stretched; the lane cap stops a
      // narrow stage letting the bird spill over the dividers.
      const chickenSprite = chickenSpriteRef.current;
      const spriteAspect = chickenSprite
        ? chickenSprite.width / chickenSprite.height
        : CHICKEN_UNITS.w / CHICKEN_UNITS.h;
      const chickenDrawH = Math.min(chickenScale * 11, (laneW * 0.82) / spriteAspect);
      const chickenDrawW = chickenDrawH * spriteAspect;
      // A forgiving hitbox — 0.6 of the drawn size — kept tied to what is
      // actually on screen.
      const chickenBoxW = chickenDrawW * 0.6;
      const chickenBoxH = chickenDrawH * 0.6;
      geomRef.current = {
        carLen: carLenPx / depthPx,
        carHalf: carLenPx / depthPx / 2,
        chickenHalf: chickenBoxH / depthPx / 2,
      };

      // ── Camera: keeps the chicken ~1.4 lanes in from the left edge ──
      const hop = hopRef.current;
      if (hop) {
        const t = Math.min(1, (now - hop.startedAt) / HOP_MS);
        const smooth = t * t * (3 - 2 * t);
        visualLaneRef.current = hop.from + (hop.to - hop.from) * smooth;
        if (t >= 1 && !doomedRef.current) hopRef.current = null;
      }
      const target = Math.max(0, visualLaneRef.current - 1.4);
      cameraRef.current += (target - cameraRef.current) * Math.min(1, dt * 7);
      const camera = cameraRef.current;
      const view = makeView(width, height, laneW, camera);

      /** World u of a lane's centre; lane 0 is the starting verge. */
      const laneCentre = (l: number) => (l + 0.5 - camera) * laneW;

      // Perspective widens the view toward the far end, so the lanes to step
      // and draw are the ones visible *there*, not just at the chicken's row.
      const farScale = view.scale(0);
      const uMin = view.vanishX - view.vanishX / farScale;
      const uMax = view.vanishX + (width - view.vanishX) / farScale;
      const roadEnd = lastLane(modeRef.current);
      const firstLane = Math.max(1, Math.floor(uMin / laneW + camera) - 1);
      const lastVisible = Math.min(roadEnd, Math.ceil(uMax / laneW + camera) + 1);

      stepTraffic(now, dt, firstLane, lastVisible);

      // ── Ground layer ──
      drawRoad(ctx, view, { firstLane: 1, lastLane: roadEnd });

      const settled = laneRef.current;
      const playing = phaseRef.current === 'PLAYING';
      const mode = modeRef.current;
      const coverR = Math.min(laneW * 0.34, 40);
      for (let l = firstLane; l <= lastVisible; l += 1) {
        const state: CoverState =
          l < settled ? 'cleared' : l === settled ? 'stand' : playing && l === settled + 1 ? 'next' : 'ahead';
        drawCover(
          ctx,
          view,
          laneCentre(l),
          LAYOUT.chickenY,
          coverR,
          state,
          `${formatMultiplier(multiplierAt(l, mode))}x`,
          formatChance(cumulativeChanceAt(l, mode)),
          reducedMotionRef.current ? 0 : now / 1000
        );
      }

      /** 0 = arm up, 1 = down; overshoots a touch on the way so it lands with a bounce. */
      const closedOf = (l: number) => {
        const at = gateClosedAtRef.current.get(l);
        if (at === undefined) return 0;
        if (reducedMotionRef.current) return 1;
        const k = Math.min(1, (now - at) / 380);
        const c1 = 1.7;
        return 1 + (c1 + 1) * (k - 1) ** 3 + c1 * (k - 1) ** 2;
      };

      // ── Chicken, placed ──
      const hopAge = hop ? now - hop.startedAt : Infinity;
      const lift = hopAge < HOP_MS ? Math.sin((hopAge / HOP_MS) * Math.PI) * 18 : 0;
      const chickenU = laneCentre(visualLaneRef.current);
      const feet = view.project(chickenU, LAYOUT.chickenY);
      const chickenX = feet.x;
      // drawChicken's feet sit 0.45 of its box below its centre.
      const chickenY = feet.y - chickenDrawH * 0.45 - lift;

      // The sprite is the step control, so its hit target rides along with it.
      const stage = stageRef.current;
      if (stage) {
        stage.style.setProperty('--chr-chick-x', `${chickenX.toFixed(1)}px`);
        stage.style.setProperty('--chr-chick-y', `${chickenY.toFixed(1)}px`);
      }

      // ── Shadows, all on the ground before anything stands on it ──
      const gateT = (l: number) => gateFraction(l);
      // Barriers stand on the lanes behind the chicken and the one it faces;
      // a raised arm on every lane ahead would be a picket fence of poles.
      const lastBarrier = Math.min(lastVisible, settled + 1);
      for (let l = firstLane; l <= lastBarrier; l += 1) {
        drawBarrierShadow(ctx, view, l, gateT(l), closedOf(l));
      }
      const standing: Array<{ t: number; paint: () => void }> = [];
      for (let l = firstLane - 1; l <= lastVisible + 1; l += 1) {
        const traffic = lanesRef.current.get(l);
        if (!traffic) continue;
        const cu = laneCentre(l);
        for (const car of traffic.cars) {
          drawCarShadow(ctx, view, cu, car.t, carScale);
          standing.push({ t: car.t, paint: () => drawCar3D(ctx, view, cu, car.t, carScale, car.colour) });
        }
      }
      drawChickenShadow(ctx, view, chickenU, LAYOUT.chickenY, chickenDrawH, lift);

      // ── Standing objects, far to near ──
      for (let l = firstLane; l <= lastBarrier; l += 1) {
        standing.push({ t: gateT(l), paint: () => drawBarrier(ctx, view, l, gateT(l), closedOf(l)) });
      }
      standing.push({
        t: LAYOUT.chickenY,
        paint: () => {
          const sprite = chickenSpriteRef.current;
          if (sprite) drawChickenSprite(ctx, sprite, chickenX, chickenY, chickenDrawH);
          else drawChicken(ctx, chickenX, chickenY, chickenDrawH, now / 1000);
        },
      });
      standing.sort((a, b) => a.t - b.t);
      for (const item of standing) item.paint();

      drawAtmosphere(ctx, view);

      // ── Collision ──
      // Only the doomed car can land a hit; every other lane the chicken stands
      // in is gated shut, so nothing else is in reach. Tested in flat world
      // space — the projection is only how it looks.
      const doomed = doomedRef.current;
      if (phaseRef.current === 'PLAYING' && doomed) {
        const traffic = lanesRef.current.get(doomed.lane);
        const car = traffic?.cars.find((c) => c.doomed);
        if (car && traffic) {
          const overlaps =
            Math.abs(laneCentre(doomed.lane) - chickenU) < (carWidthPx + chickenBoxW) / 2 &&
            Math.abs(car.t - LAYOUT.chickenY) * depthPx < (carLenPx + chickenBoxH) / 2;
          if (overlaps) crash();
        } else if (now > doomed.at + 500) {
          // The car left the board without connecting; the roll still stands.
          crash();
        }
      }

      // ── Crash burst ──
      if (crashAtRef.current !== null) {
        const age = now - crashAtRef.current;
        if (age < 700) {
          const t = age / 700;
          ctx.fillStyle = `rgba(239,68,68,${0.35 * (1 - t)})`;
          ctx.fillRect(0, 0, width, height);
          const at = view.project(laneCentre(0), LAYOUT.chickenY);
          ctx.beginPath();
          ctx.arc(at.x, at.y - chickenDrawH * 0.4, 12 + t * 70, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,220,180,${0.9 * (1 - t)})`;
          ctx.lineWidth = 5 * (1 - t) + 1;
          ctx.stroke();
        } else {
          crashAtRef.current = null;
        }
      }
    },
    [crash, stepTraffic]
  );

  // Every sprite on this board is a vector path, so it costs nothing to render
  // it at the display's full pixel ratio — that is what keeps the cars, lane
  // markings and the chicken from looking stepped on a retina screen.
  const canvasRef = useCanvasRenderer(draw, { maxPixelRatio: 3 });

  const canStep = isPlaying && !hopping && !busy;
  const canCash = isPlaying && lane > 0 && !hopping && !busy;

  return (
    <div className="chr">
      {/* ---------- Stage ---------- */}
      <div className="chr__stage" ref={stageRef}>
        <canvas ref={canvasRef} className="chr__canvas" />

        {/* Live readout over the board. Multiplier and *profit* rather than
            lane and gross payout: the lane number is already legible from the
            bird's position, and a player deciding whether to take the next
            step is weighing what they stand to gain against what they would
            lose — gross payout buries the stake inside the number. */}
        <div className="chr__hud">
          <span className="chr__chip">
            <i>{t('gameUi.chickenHudMultiplier')}</i>
            <b>{formatMultiplier(multiplier)}x</b>
          </span>
          <span className="chr__chip chr__chip--profit">
            <i>{t('gameUi.chickenHudProfit')}</i>
            <b>{money(lane === 0 ? 0 : payout - bet)}</b>
          </span>
        </div>

        {/* Tap the chicken to send it across. The render loop keeps this pinned
            to the sprite, so the hit target is always where the bird is. */}
        <button
          type="button"
          className="chr__chick"
          onClick={advance}
          disabled={!canStep}
          aria-label={t('gameUi.chickenAria')}
        />
      </div>

      {/* ---------- Controls ---------- */}
      <div className="chr__panel">
        <div>
          <div className="chr__label">
            <span>{t('gameUi.chickenTraffic')}</span>
            <b>{mode.label}</b>
          </div>
          <div className="chr__modes">
            {TRAFFIC_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chr__mode${m.id === mode.id ? ' chr__mode--on' : ''}`}
                disabled={isPlaying}
                aria-pressed={m.id === mode.id}
                onClick={() => setMode(m)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="chr__label" htmlFor="chr-bet">
            <span>{t('gameUi.betAmount')}</span>
            <b>{formatMultiplier(multiplier)}x</b>
          </label>
          <div className="chr__inputs">
            <input
              id="chr-bet"
              className="chr__input"
              type="number"
              inputMode="decimal"
              min={GAME_CONFIG.minBet}
              max={GAME_CONFIG.maxBet}
              step={1}
              value={Number.isFinite(bet) ? bet : ''}
              disabled={isPlaying}
              aria-invalid={betError !== null}
              onChange={(e) => setBet(Number(e.target.value))}
            />
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label={t('gameUi.halveBet')}
              onClick={() =>
                setBet((b) => Math.max(GAME_CONFIG.minBet, Number((b / 2).toFixed(2))))
              }
            >
              ½
            </button>
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label={t('gameUi.doubleBet')}
              onClick={() => setBet((b) => Math.min(maxBet, Number((b * 2).toFixed(2))))}
            >
              2x
            </button>
            <button
              type="button"
              className="chr__mod"
              disabled={isPlaying}
              aria-label={t('gameUi.maxBet')}
              onClick={() => setBet(maxBet)}
            >
              Max
            </button>
          </div>
        </div>

        {!isPlaying && betError && <p className="chr__error">{betError}</p>}

        {phase === 'LOST' && (
          <div className="chr__banner chr__banner--lost" role="status">
            Hit by a car — the round ends here
          </div>
        )}
        {phase === 'WON' && (
          <div className="chr__banner chr__banner--won" role="status">
            {t('gameUi.chickenCashedOut', {
              amount: `${GAME_CONFIG.currency}${formatDecimalString(lastWin ?? '0')}`,
            })}
          </div>
        )}

        {isPlaying ? (
          <button
            type="button"
            className="chr__action chr__action--cash"
            onClick={cashOut}
            disabled={!canCash}
          >
            Cash Out ({money(payout)})
          </button>
        ) : (
          <button
            type="button"
            className="chr__action"
            onClick={startRound}
            disabled={betError !== null || busy}
          >
            {isOver ? t('gameUi.chickenPlayAgain') : t('gameUi.chickenStartRound')}
          </button>
        )}

        <p className="chr__hint">
          {isPlaying
            ? t('gameUi.chickenHintPlaying')
            : t('gameUi.chickenHintIdle')}
        </p>
      </div>
    </div>
  );
}

