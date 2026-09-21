/**
 * FRIGAT — Avia Masters Engine
 *
 * One bet is one flight, decided whole before the client draws a frame. The
 * player launches and watches; there is no input mid-air.
 *
 * Draws come from the round's provable float stream (see `provable.ts`):
 *
 *     cursor 0          landing draw — the flight lands when it is < P(land)
 *     cursor 1          flight length, uniform over AVIA.flightEvents
 *     cursor 2 + 2i     kind of event i, weighted by AVIA.events
 *     cursor 3 + 2i     altitude of event i, in [0, 1) — trajectory only
 *
 * Each event applies m ← m · mul + add, starting from m = 1. Because the kind
 * of every event is independent of the multiplier it lands on, the expectation
 * is exact by linearity:
 *
 *     E[m_{i+1}] = E[mul] · E[m_i] + E[add]
 *
 * and averaging over the flight length gives E[M]. The landing draw is then
 * priced so that P(land) · E[M] = 1 - houseEdge. Flooring to 2 dp and the
 * AVIA.maxMultiplier cap only ever lower a payout, so the RTP sits at or just
 * under target — never over.
 */

import { AVIA, type AviaEventKind } from '@frigat/shared';
import { HOUSE_EDGE } from '../config/game.config';
import { floatAt } from './provable';
import type { EngineResult, SeedContext } from '../types/engine.types';

const EDGE = HOUSE_EDGE.AVIA;
const WEIGHT_TOTAL = AVIA.events.reduce((sum, e) => sum + e.weight, 0);

export interface AviaEvent {
  kind: AviaEventKind;
  /** Where on the flight path the event sits, 0 (sea) to 1 (ceiling). */
  altitude: number;
  /** Running multiplier once this event is applied, floored to 2 dp. */
  multiplier: number;
}

export interface AviaFlight {
  landed: boolean;
  events: AviaEvent[];
  /** What the flight collected, whether or not it landed. */
  flightMultiplier: number;
}

/** E[M] over the whole flight — exact, from the table alone. */
export function expectedMultiplier(): number {
  const meanMul = AVIA.events.reduce((s, e) => s + e.weight * e.mul, 0) / WEIGHT_TOTAL;
  const meanAdd = AVIA.events.reduce((s, e) => s + e.weight * e.add, 0) / WEIGHT_TOTAL;
  const { min, max } = AVIA.flightEvents;
  let total = 0;
  for (let n = min; n <= max; n += 1) {
    let m = 1;
    for (let i = 0; i < n; i += 1) m = meanMul * m + meanAdd;
    total += m;
  }
  return total / (max - min + 1);
}

/** The chance a flight lands, priced so the round returns 1 - edge. */
export function landingChance(): number {
  return (1 - EDGE) / expectedMultiplier();
}

function eventAt(u: number): (typeof AVIA.events)[number] {
  let roll = u * WEIGHT_TOTAL;
  for (const event of AVIA.events) {
    roll -= event.weight;
    if (roll < 0) return event;
  }
  return AVIA.events[AVIA.events.length - 1];
}

const floor2 = (m: number) => Math.floor(m * 100) / 100;

export function fly(seed: SeedContext): AviaFlight {
  const draw = (cursor: number) =>
    floatAt(seed.serverSeed, seed.clientSeed, seed.nonce, cursor);

  const landed = draw(0) < landingChance();
  const { min, max } = AVIA.flightEvents;
  const length = min + Math.floor(draw(1) * (max - min + 1));

  let m = 1;
  const events: AviaEvent[] = [];
  for (let i = 0; i < length; i += 1) {
    const spec = eventAt(draw(2 + 2 * i));
    m = m * spec.mul + spec.add;
    events.push({
      kind: spec.kind,
      altitude: draw(3 + 2 * i),
      multiplier: floor2(Math.min(m, AVIA.maxMultiplier)),
    });
  }

  return { landed, events, flightMultiplier: floor2(Math.min(m, AVIA.maxMultiplier)) };
}

/** Instant-engine entry point. There are no parameters: the stake is the bet. */
export function play(_params: Record<string, unknown>, seed: SeedContext): EngineResult {
  const flight = fly(seed);
  return {
    win: flight.landed,
    // A landing pays what the flight collected — below 1x after enough rockets,
    // which is a partial return, not a loss. A ditch pays nothing.
    multiplier: flight.landed ? flight.flightMultiplier : 0,
    resultData: { ...flight },
  };
}
