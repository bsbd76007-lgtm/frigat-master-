'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useGameSocket } from '@/components/providers/GameSocketProvider';
import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';
import { useInjectedStyles } from '@/lib/useInjectedStyles';
import {

  compareDecimal,
  divideDecimal,
  formatDecimalString,
  isDecimalString,
  multiplyDecimal,
  safeDecimal,
  sanitizeDecimalInput,
} from '@/lib/decimal';

/**
 * Avia Masters — carrier-launch multiplier run, drawn on a canvas.
 *
 * A red biplane leaves the deck and flies right forever. The player holds the
 * altitude: the airframe sinks on its own, so staying up is an active choice,
 * and the whole game is deciding how long to keep climbing through the pickup
 * lane before taking the multiplier home.
 *
 * ── What is server-decided, and what is not ────────────────────────────────
 * NOTHING here is. There is no `AVIA` engine in `apps/server/src/engines/`, no
 * socket frame, and no ledger call: pickups, bombs and the landing are rolled
 * in the browser, so this is a **practice board**, exactly like ChickenRoad.
 * It reads the wallet to size the stake and to stop a player betting more than
 * they hold, and it never moves a balance — `useBalance` is read-only by
 * design and the only thing that can debit a player is a server-settled bet.
 *
 * Before this becomes a real-stakes game, three things have to happen:
 *   1. an engine under `apps/server/src/engines/` owns the run, seeded from
 *      the committed server seed (`services/provableFair.service.ts`);
 *   2. `processBet` / `processWin` in `services/ledger.service.ts` settle it;
 *   3. **the paytable is calibrated.** The pickup table below is tuned to feel
 *      right, not to hold a house edge — the multiplier compounds (`x5` on top
 *      of `x5`) with no survival-probability pricing behind it, so wiring this
 *      to the ledger as it stands would pay out an uncapped edge to the player.
 *      This is the same trap the multiplier ladder note in CLAUDE.md describes.
 *
 * Styling is injected CSS: this project ships no utility CSS framework, so a
 * class like `bg-[#0b1622]` would resolve to nothing.
 */

// ─────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────

export const GAME_CONFIG = {
  currency: 'USD',
  minBet: '1.00',
  maxBet: '1000.00',
  /** Ceiling of the flyable column, in metres. */
  maxAltitude: 1000,
  /** Deck height above the sea, where a launch begins and a landing ends. */
  deckAltitude: 120,
  /**
   * Downward acceleration, in metres per second squared.
   *
   * The plane has no lift of its own: altitude is entirely the residue of the
   * last jump, which is what makes every tap a decision rather than a nudge on
   * a steering rate.
   */
  gravity: 240,
  /** Upward velocity a tap sets, in metres per second. Not added — set. */
  jumpImpulse: 240,
  /** The catapult shot off the deck, which has to clear the launch carrier. */
  launchImpulse: 330,
  /**
   * Terminal velocity on the way down.
   *
   * Free fall from the ceiling would otherwise arrive at ~690 m/s, which is
   * both unreadable and unrecoverable — the clamp is what keeps a long drop
   * survivable if the player starts tapping again.
   */
  maxFallSpeed: 420,
  /** Nose-up and nose-down limits, in radians. */
  maxPitchUp: 0.5,
  maxPitchDown: 0.85,
  /** Ground speed at launch, in metres per second. */
  baseSpeed: 115,
  /** Ground speed gained per 1000 m travelled — the run tightens as it goes. */
  speedRamp: 26,
  /**
   * Ceiling on ground speed.
   *
   * The ramp is unbounded on its own: a long run reaches ~550 m/s by 16 km,
   * at which point pickups and bombs arrive faster than they can be read
   * and the board stops being a game. The cap keeps the escalation without the
   * runaway.
   */
  maxSpeed: 300,
  /**
   * Distance between landing platforms.
   *
   * This is the whole risk curve: overfly a deck and the next chance to bank
   * the multiplier is a full span away, with more bombs in between.
   */
  platformSpacing: 900,
  /** The first platform sits further out, so the launch is not an instant exit. */
  firstPlatformAt: 700,
  /** Half-width of a deck, in metres. */
  platformHalfWidth: 95,
  /**
   * How far below the deck a descending plane still counts as touching down.
   * Wide enough that a fast descent cannot tunnel through the deck between two
   * frames — at terminal velocity the plane covers ~7m per frame.
   */
  touchdownBand: 26,
  /** Plane bounding box, in metres. Used for bombs and for touchdown alike. */
  planeHalfWidth: 30,
  planeHalfHeight: 18,
  /** How long the landing animation runs before the round settles. */
  landingMs: 1250,
} as const;

export type Phase = 'IDLE' | 'FLYING' | 'LANDING' | 'LANDED' | 'CRASHED';

/**
 * Pickup table.
 *
 * `weight` is relative spawn frequency, not odds of anything — see the header:
 * nothing here is priced against survival probability.
 */
export type PickupKind = 'x2' | 'x3' | 'x5' | 'add2' | 'add10' | 'half';

interface PickupSpec {
  kind: PickupKind;
  label: string;
  weight: number;
  /** Applied to the running multiplier on pickup. */
  apply: (multiplier: number) => number;
  hazard: boolean;
}

const PICKUPS: readonly PickupSpec[] = [
  { kind: 'add2', label: '+2', weight: 12, apply: (m) => m + 2, hazard: false },
  { kind: 'x2', label: 'x2', weight: 10, apply: (m) => m * 2, hazard: false },
  { kind: 'x3', label: 'x3', weight: 5, apply: (m) => m * 3, hazard: false },
  { kind: 'add10', label: '+10', weight: 3, apply: (m) => m + 10, hazard: false },
  { kind: 'x5', label: 'x5', weight: 2, apply: (m) => m * 5, hazard: false },
  // The only pickup worth dodging, and deliberately common: without a reason to
  // steer *away* from something, the pickup lane is just a collection chore.
  { kind: 'half', label: '/2', weight: 12, apply: (m) => Math.max(1, m / 2), hazard: true },
];

const PICKUP_WEIGHT_TOTAL = PICKUPS.reduce((sum, p) => sum + p.weight, 0);

/**
 * What a bomb costs.
 *
 * Multiplier rather than altitude: with the round now ending only at a deck or
 * in the sea, an altitude penalty would be a stealth instant-loss at low
 * height. Halving the multiplier hurts exactly as much as the player has to
 * lose, which is the point of flying on.
 */
const BOMB_MULTIPLIER_PENALTY = 0.5;

function rollPickup(): PickupSpec {
  let roll = Math.random() * PICKUP_WEIGHT_TOTAL;
  for (const spec of PICKUPS) {
    roll -= spec.weight;
    if (roll <= 0) return spec;
  }
  return PICKUPS[0];
}

// ─────────────────────────────────────────────
// World objects
// ─────────────────────────────────────────────

interface Pickup {
  /** Distance along the run, in metres — the same axis as `distance`. */
  x: number;
  /** Altitude in metres. */
  y: number;
  spec: PickupSpec;
  taken: boolean;
  /** Seconds since collection, for the pop animation. */
  age: number;
}

/**
 * An airborne mine. It does not chase the plane — it hangs at its altitude and
 * drifts, so hitting one is the player's own doing rather than something aimed
 * at them.
 */
interface Bomb {
  x: number;
  y: number;
  /** Metres per second of vertical drift; small, and it reverses at the ends. */
  drift: number;
  /** Bob phase, so a field of bombs does not pulse in unison. */
  phase: number;
  spent: boolean;
}

/** A floating deck the plane can land on to bank the round. */
interface Platform {
  /** Centre of the deck along the run, in metres. */
  x: number;
  deckAltitude: number;
  /** Set once landed on, so the same deck cannot settle the round twice. */
  used: boolean;
}

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

/** Damage text that rises off the plane and fades. */
interface Floater {
  /** Screen coordinates, fixed at spawn — it marks where the hit landed. */
  x: number;
  y: number;
  life: number;
  maxLife: number;
  text: string;
  sub: string;
}

// ─────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────

function formatMultiplier(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 1000)}Kx`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}Kx`;
  if (value >= 100) return `${value.toFixed(0)}x`;
  return `${value.toFixed(2)}x`;
}

function formatMetres(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} m`;
}

/**
 * Stake times multiplier, in exact decimal.
 *
 * The multiplier is a float, so it is taken to two places and folded in as an
 * integer — parsing the *stake* into a JS number would reintroduce exactly the
 * drift `Decimal(18,8)` and `lib/decimal.ts` exist to prevent.
 */
function payoutFor(bet: string, multiplier: number): string {
  const hundredths = BigInt(Math.max(0, Math.round(multiplier * 100)));
  return divideDecimal(multiplyDecimal(bet, hundredths), 100n);
}

// ─────────────────────────────────────────────
// Painting
// ─────────────────────────────────────────────

/** The red vintage biplane, nose right, banked by its climb rate. */
function drawPlane(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  bank: number,
  propellerPhase: number
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(bank);

  const L = scale * 4.6; // nose-to-tail
  const H = scale * 1.15; // fuselage depth

  // Tailplane
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.moveTo(-L * 0.5, 0);
  ctx.lineTo(-L * 0.5, -H * 1.5);
  ctx.lineTo(-L * 0.24, -H * 0.2);
  ctx.closePath();
  ctx.fill();

  // Lower wing, drawn before the fuselage so the body sits on top
  ctx.fillStyle = '#e5e7eb';
  roundRect(ctx, -L * 0.12, H * 0.25, L * 0.5, H * 0.42, H * 0.2);
  ctx.fill();

  // Fuselage
  const body = ctx.createLinearGradient(0, -H, 0, H);
  body.addColorStop(0, '#c25560');
  body.addColorStop(0.55, '#dc2626');
  body.addColorStop(1, '#991b1b');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(L * 0.52, 0);
  ctx.quadraticCurveTo(L * 0.35, -H, -L * 0.1, -H * 0.85);
  ctx.lineTo(-L * 0.5, -H * 0.3);
  ctx.lineTo(-L * 0.5, H * 0.35);
  ctx.lineTo(-L * 0.1, H * 0.8);
  ctx.quadraticCurveTo(L * 0.35, H * 0.9, L * 0.52, 0);
  ctx.closePath();
  ctx.fill();

  // Upper wing
  ctx.fillStyle = '#f3f4f6';
  roundRect(ctx, -L * 0.18, -H * 1.55, L * 0.56, H * 0.4, H * 0.2);
  ctx.fill();
  // Wing struts
  ctx.strokeStyle = 'rgba(15,23,42,.55)';
  ctx.lineWidth = Math.max(1, scale * 0.12);
  ctx.beginPath();
  ctx.moveTo(-L * 0.1, -H * 1.2);
  ctx.lineTo(-L * 0.06, -H * 0.7);
  ctx.moveTo(L * 0.28, -H * 1.2);
  ctx.lineTo(L * 0.24, -H * 0.7);
  ctx.stroke();

  // Cockpit
  ctx.fillStyle = 'rgba(15,23,42,.8)';
  ctx.beginPath();
  ctx.ellipse(L * 0.02, -H * 0.55, scale * 0.42, scale * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Propeller disc — the blur is the phase, so it reads as spinning
  ctx.strokeStyle = 'rgba(250,204,21,.85)';
  ctx.lineWidth = Math.max(1, scale * 0.14);
  ctx.beginPath();
  const spin = Math.sin(propellerPhase) * H * 1.5;
  ctx.moveTo(L * 0.54, -spin);
  ctx.lineTo(L * 0.54, spin);
  ctx.stroke();

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x, y + radius);
  ctx.closePath();
}

/** An aircraft carrier seen side-on: the launch deck and the landing target. */
function drawCarrier(
  ctx: CanvasRenderingContext2D,
  x: number,
  deckY: number,
  seaY: number,
  width: number,
  accent: string
) {
  const hullH = Math.max(10, (seaY - deckY) * 0.9);

  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(x, deckY);
  ctx.lineTo(x + width, deckY);
  ctx.lineTo(x + width * 0.9, deckY + hullH);
  ctx.lineTo(x + width * 0.08, deckY + hullH);
  ctx.closePath();
  ctx.fill();

  // Deck surface
  ctx.fillStyle = '#334155';
  ctx.fillRect(x, deckY - Math.max(3, hullH * 0.08), width, Math.max(3, hullH * 0.08));

  // Centreline markings
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.5, width * 0.008);
  ctx.setLineDash([width * 0.05, width * 0.04]);
  ctx.beginPath();
  ctx.moveTo(x + width * 0.06, deckY - Math.max(3, hullH * 0.08) / 2);
  ctx.lineTo(x + width * 0.94, deckY - Math.max(3, hullH * 0.08) / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Island superstructure
  ctx.fillStyle = '#475569';
  roundRect(ctx, x + width * 0.7, deckY - hullH * 0.55, width * 0.12, hullH * 0.55, 2);
  ctx.fill();
}

/** A pickup badge: the label is the whole point, so it leads. */
function drawPickup(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  spec: PickupSpec,
  age: number
) {
  // Collected badges pop and fade rather than vanishing on the frame they land.
  const pop = age > 0 ? 1 + age * 3 : 1;
  const alpha = age > 0 ? Math.max(0, 1 - age * 3.5) : 1;
  if (alpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(pop, pop);

  const fill = spec.hazard ? '#ef4444' : '#f59e0b';
  const ring = spec.hazard ? '#7f1d1d' : '#14532d';

  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.beginPath();
  ctx.arc(2, 3, radius, 0, Math.PI * 2);
  ctx.fill();

  const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.4, radius * 0.2, 0, 0, radius);
  grad.addColorStop(0, spec.hazard ? '#d69199' : '#86bda6');
  grad.addColorStop(1, fill);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ring;
  ctx.lineWidth = Math.max(1.5, radius * 0.14);
  ctx.stroke();

  ctx.fillStyle = '#0b0e14';
  ctx.font = `800 ${radius * 0.92}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.label, 0, radius * 0.06);

  ctx.restore();
}

/**
 * A floating mine: dark sphere, spikes, and a slow blinking fuse light.
 *
 * Deliberately unlike the old missile — nothing about it should read as
 * "incoming". It is scenery the player flies into.
 */
function drawBomb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  phase: number
) {
  const r = scale * 1.5;

  ctx.save();
  ctx.translate(x, y);

  // Spikes first, so the body caps them.
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = Math.max(1.4, scale * 0.34);
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + phase * 0.15;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * r * 0.85, Math.sin(angle) * r * 0.85);
    ctx.lineTo(Math.cos(angle) * r * 1.45, Math.sin(angle) * r * 1.45);
    ctx.stroke();
  }

  const shell = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r);
  shell.addColorStop(0, '#64748b');
  shell.addColorStop(0.55, '#334155');
  shell.addColorStop(1, '#111827');
  ctx.fillStyle = shell;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(8,17,27,.9)';
  ctx.lineWidth = Math.max(1, scale * 0.2);
  ctx.stroke();

  // Fuse light — the one warm thing on it, so a bomb is legible against a dark
  // sky at small sizes.
  const pulse = 0.55 + Math.sin(phase * 3.2) * 0.45;
  ctx.fillStyle = `rgba(239,68,68,${pulse})`;
  ctx.beginPath();
  ctx.arc(r * 0.28, -r * 0.34, r * 0.24, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * A floating landing deck.
 *
 * Drawn from its *centre* so the world position and the collision span are the
 * same number — an x that means "left edge" in the renderer and "centre" in the
 * physics is exactly how a plane lands on thin air.
 */
function drawPlatform(
  ctx: CanvasRenderingContext2D,
  cx: number,
  deckY: number,
  halfWidth: number,
  used: boolean
) {
  const w = halfWidth * 2;
  const thickness = Math.max(7, w * 0.055);
  const accent = used ? '#64748b' : '#f59e0b';

  ctx.save();

  // Hull under the deck, tapering, so it reads as a vessel rather than a bar.
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, deckY);
  ctx.lineTo(cx + halfWidth, deckY);
  ctx.lineTo(cx + halfWidth * 0.74, deckY + thickness * 2.4);
  ctx.lineTo(cx - halfWidth * 0.74, deckY + thickness * 2.4);
  ctx.closePath();
  ctx.fill();

  // Deck surface — the line the plane actually lands on.
  ctx.fillStyle = used ? '#334155' : '#3f4d5c';
  ctx.fillRect(cx - halfWidth, deckY - thickness, w, thickness);

  // Centreline markings.
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.5, thickness * 0.22);
  ctx.setLineDash([w * 0.06, w * 0.05]);
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth * 0.88, deckY - thickness / 2);
  ctx.lineTo(cx + halfWidth * 0.88, deckY - thickness / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Threshold bars at both ends, and a glow while the deck is still live.
  ctx.fillStyle = accent;
  ctx.fillRect(cx - halfWidth, deckY - thickness * 1.5, w * 0.06, thickness * 1.5);
  ctx.fillRect(cx + halfWidth - w * 0.06, deckY - thickness * 1.5, w * 0.06, thickness * 1.5);

  if (!used) {
    ctx.strokeStyle = 'rgba(34,197,94,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, deckY - thickness - 3);
    ctx.lineTo(cx + halfWidth, deckY - thickness - 3);
    ctx.stroke();
  }

  ctx.restore();
}

// ─────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────

const STYLE_ID = 'fg-avia-masters-styles';

const CSS = `
.avia { display: flex; flex-direction: column; align-items: center; gap: 20px;
  width: 100%; max-width: 1180px; margin-inline: auto; padding: 16px;
  box-sizing: border-box; color: #e2e8f0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
@media (min-width: 1024px) {
  .avia { flex-direction: row; align-items: flex-start; justify-content: center; }
}

.avia__stage { position: relative; width: 100%; max-width: 820px; min-width: 0;
  aspect-ratio: 16 / 9; background: #0b1622; border: 1px solid #1e293b;
  border-radius: 16px; overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,.65); }
/* touch-action: none — the canvas is a steering surface, so a drag across it
   must not be interpreted as a page scroll or a pinch. cursor stays a pointer
   so it reads as interactive on desktop. */
.avia__canvas { display: block; width: 100%; height: 100%; touch-action: none;
  cursor: pointer; }

/* ── Telemetry ── */
.avia__hud { position: absolute; left: 12px; right: 12px; top: 12px; display: flex;
  flex-wrap: wrap; gap: 8px; pointer-events: none; }
.avia__tile { flex: 1 1 auto; min-width: 84px; padding: 7px 11px;
  background: rgba(8,17,27,.72); border: 1px solid rgba(148,163,184,.22);
  border-radius: 10px; backdrop-filter: blur(6px); }
.avia__tile-label { display: block; font-size: 9.5px; font-weight: 700;
  letter-spacing: .1em; text-transform: uppercase; color: #64748b; }
.avia__tile-value { display: block; margin-top: 2px; font-size: 15px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: #f1f5f9; }
.avia__tile--mult .avia__tile-value { color: var(--fg-pos); }
.avia__tile--payout .avia__tile-value { color: var(--fg-gold); }

/* ── Steering, for touch ── */
.avia__banner { position: absolute; left: 50%; top: 46%; transform: translate(-50%,-50%);
  padding: 14px 24px; text-align: center; font-size: 17px; font-weight: 800;
  border-radius: 14px; pointer-events: none; }
.avia__banner--won { color: #0b0e14; background: rgba(74,222,128,.94); }
.avia__banner--lost { color: #450a0a; background: rgba(248,113,113,.94); }
.avia__banner small { display: block; margin-top: 3px; font-size: 12px; font-weight: 700;
  opacity: .8; }

.avia__hint { position: absolute; left: 12px; bottom: 12px; margin: 0; font-size: 11px;
  color: rgba(226,232,240,.6); pointer-events: none; }

/* ── Panel ── */
.avia__panel { display: flex; flex-direction: column; gap: 15px; width: 100%;
  max-width: 820px; min-width: 0; flex: 0 0 auto; padding: 20px; box-sizing: border-box;
  background: #101a22; border: 1px solid #1e293b; border-radius: 16px; }
@media (min-width: 1024px) { .avia__panel { width: 320px; } }

.avia__label { display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 7px; font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: #64748b; }
.avia__label b { font-size: 12.5px; color: #cbd5e1; letter-spacing: 0; }

.avia__inputs { display: flex; gap: 6px; }
.avia__input { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box;
  padding: 11px 12px; font-family: inherit; font-size: 15px; font-weight: 700;
  font-variant-numeric: tabular-nums; color: #f1f5f9; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; outline: none; }
.avia__input:focus-visible { border-color: var(--fg-accent); box-shadow: 0 0 0 3px rgba(34,197,94,.22); }
.avia__input:disabled { opacity: .5; cursor: not-allowed; }
.avia__mod { flex: 0 0 auto; min-width: 42px; padding: 0 9px; font-family: inherit;
  font-size: 12px; font-weight: 800; color: #cbd5e1; background: #0b141b;
  border: 1px solid #1e293b; border-radius: 10px; cursor: pointer;
  transition: background .15s ease, color .15s ease; }
.avia__mod:hover:not(:disabled) { color: #fff; background: #1e293b; }
.avia__mod:disabled { opacity: .45; cursor: not-allowed; }
.avia__mod:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.3); }

.avia__action { width: 100%; padding: 15px; font-family: inherit; font-size: 16px;
  font-weight: 900; color: #0b0e14;
  background: linear-gradient(90deg, var(--fg-accent), var(--fg-accent-deep)); border: none;
  border-radius: 12px; cursor: pointer; box-shadow: 0 10px 20px -6px rgba(34,197,94,.45);
  transition: background .15s ease, transform .1s ease; }
.avia__action:hover:not(:disabled) { background: linear-gradient(90deg, var(--fg-pos), var(--fg-accent)); }
.avia__action:active:not(:disabled) { transform: translateY(1px); }
.avia__action:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.avia__action:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(34,197,94,.45); }
/* In-flight standing. Replaces the old Land button: the deck banks the round,
   so this reports rather than offers. */
.avia__standing { display: flex; flex-direction: column; gap: 2px; width: 100%;
  padding: 13px 15px; text-align: center; border-radius: 12px;
  background: rgba(250,204,21,.1); border: 1px solid rgba(250,204,21,.35); }
.avia__standing span { font-size: 10.5px; font-weight: 800; letter-spacing: .1em;
  text-transform: uppercase; color: var(--fg-gold); }
.avia__standing b { font-size: 19px; font-weight: 900; font-variant-numeric: tabular-nums;
  color: var(--fg-gold-soft); }
.avia__standing small { font-size: 11px; color: rgba(253,224,71,.75); }

.avia__error { margin: 0; font-size: 12px; font-weight: 600; color: #c25560;
  text-align: center; }
.avia__note { margin: 0; font-size: 10.5px; line-height: 1.5; color: #475569;
  text-align: center; }

.avia__legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.avia__chip { padding: 6px 4px; text-align: center; font-size: 11px; font-weight: 800;
  border-radius: 8px; background: rgba(34,197,94,.12); color: var(--fg-pos-soft);
  border: 1px solid rgba(34,197,94,.3); }
.avia__chip--bad { background: rgba(239,68,68,.12); color: #d69199;
  border-color: rgba(239,68,68,.3); }
`;

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function AviaMasters() {
  useInjectedStyles(STYLE_ID, CSS);

  const { balance } = useGameSocket();

  const [phase, setPhase] = useState<Phase>('IDLE');
  const [bet, setBet] = useState('10.00');
  const [settled, setSettled] = useState<{ multiplier: number; payout: string } | null>(null);

  /** Telemetry mirrored out of the loop for the HUD, at a readable rate. */
  const [hud, setHud] = useState({ altitude: 0, distance: 0, multiplier: 1 });

  // The render loop reads refs, so it never restarts and never closes over a
  // stale value.
  const phaseRef = useRef<Phase>('IDLE');
  // Annotated: `GAME_CONFIG` is `as const`, so seeding from `deckAltitude`
  // would infer the literal type 120 and reject every later assignment.
  const altitudeRef = useRef<number>(GAME_CONFIG.deckAltitude);
  const distanceRef = useRef(0);
  const multiplierRef = useRef(1);
  const pickupsRef = useRef<Pickup[]>([]);
  const bombsRef = useRef<Bomb[]>([]);
  const platformsRef = useRef<Platform[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const nextPickupAtRef = useRef(0);
  const nextBombAtRef = useRef(0);
  const nextPlatformAtRef = useRef(0);
  /** The deck being landed on, so the animation knows where to settle. */
  const landingOnRef = useRef<Platform | null>(null);
  const landingStartedRef = useRef<number | null>(null);
  const landingFromRef = useRef(0);
  const shakeRef = useRef(0);
  const hudClockRef = useRef(0);
  const propellerRef = useRef(0);
  const settleRef = useRef<(won: boolean) => void>(() => {});

  // ── Damage feedback ──
  /** Seconds of red screen flash left after a hit. */
  const flashRef = useRef(0);
  /** Seconds the engine keeps trailing smoke after a hit. */
  const smokeRef = useRef(0);
  const floatersRef = useRef<Floater[]>([]);

  // ── Flight ──
  /** Vertical velocity in metres per second, positive up. */
  const velocityRef = useRef(0);
  /** Rendered pitch in radians, eased toward the velocity's implied angle. */
  const pitchRef = useRef(0);

  const isFlying = phase === 'FLYING';
  const isLanding = phase === 'LANDING';
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

  const payout = useMemo(() => payoutFor(safeBet, hud.multiplier), [safeBet, hud.multiplier]);

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
        text: 'DAMAGE!',
        // The honest number: what the hit actually took off the multiplier.
        sub: `−${multiplierLost.toFixed(2)}x`,
      });
    },
    [burst]
  );

  // ── Round flow ──
  const settle = useCallback(
    (won: boolean) => {
      if (phaseRef.current !== 'FLYING' && phaseRef.current !== 'LANDING') return;
      const multiplier = won ? multiplierRef.current : 0;
      setSettled({
        multiplier,
        payout: won ? payoutFor(safeDecimal(bet, GAME_CONFIG.minBet), multiplier) : '0',
      });
      setPhaseBoth(won ? 'LANDED' : 'CRASHED');
      velocityRef.current = 0;
    },
    [bet, setPhaseBoth]
  );
  settleRef.current = settle;

  const launch = useCallback(() => {
    if (betError) return;
    altitudeRef.current = GAME_CONFIG.deckAltitude;
    distanceRef.current = 0;
    multiplierRef.current = 1;
    pickupsRef.current = [];
    bombsRef.current = [];
    platformsRef.current = [];
    particlesRef.current = [];
    nextPickupAtRef.current = 140;
    nextBombAtRef.current = 460;
    nextPlatformAtRef.current = GAME_CONFIG.firstPlatformAt;
    landingStartedRef.current = null;
    landingOnRef.current = null;
    // The catapult shot: the round opens with the plane already climbing off
    // the deck, so the first tap is a choice rather than a scramble.
    velocityRef.current = GAME_CONFIG.launchImpulse;
    pitchRef.current = -GAME_CONFIG.maxPitchUp;
    shakeRef.current = 0;
    flashRef.current = 0;
    smokeRef.current = 0;
    floatersRef.current = [];
    setSettled(null);
    setHud({ altitude: GAME_CONFIG.deckAltitude, distance: 0, multiplier: 1 });
    setPhaseBoth('FLYING');
  }, [betError, setPhaseBoth]);


  // ── Jump ──
  //
  // One verb. A tap sets the upward velocity outright rather than adding to
  // it, so a frantic player and a patient one get the same climb per tap and
  // the arc stays readable — accumulating impulses would let a burst of taps
  // fire the plane through the ceiling.
  const jump = useCallback(() => {
    if (phaseRef.current !== 'FLYING') return;
    velocityRef.current = GAME_CONFIG.jumpImpulse;
  }, []);

  /** A tap anywhere on the board is a jump. There is no down control. */
  const onCanvasPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      // Pointer rather than click, so touch does not wait on the 300ms
      // synthetic-click delay: at this gravity that lag is a wet plane.
      event.preventDefault();
      if (phaseRef.current === 'FLYING') jump();
      else if (phaseRef.current !== 'LANDING') launch();
    },
    [jump, launch]
  );

  // ── Keyboard ──
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const key = event.key;
      // Space is the jump, so landing moved to Enter. Holding a key repeats it
      // through the OS, which would be a free hover — `event.repeat` filters
      // that back down to one jump per press.
      if (key === ' ' || key === 'ArrowUp' || key === 'w' || key === 'W') {
        event.preventDefault();
        if (event.repeat) return;
        if (phaseRef.current === 'FLYING') jump();
        else if (phaseRef.current !== 'LANDING') launch();
      } else if (key === 'Enter') {
        event.preventDefault();
        // Nothing to land with any more — the deck does that. Enter only starts
        // a round.
        if (phaseRef.current !== 'FLYING' && phaseRef.current !== 'LANDING') launch();
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [jump, launch]);

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

      const phaseNow = phaseRef.current;
      const flying = phaseNow === 'FLYING';
      const landing = phaseNow === 'LANDING';

      // ── Simulation ──
      const speed = Math.min(
        GAME_CONFIG.maxSpeed,
        GAME_CONFIG.baseSpeed + (distanceRef.current / 1000) * GAME_CONFIG.speedRamp
      );

      const halfHeight = GAME_CONFIG.planeHalfHeight;

      if (flying) {
        distanceRef.current += speed * dt;

        // ── Vertical motion ──
        // Gravity always pulls; a jump is the only thing that ever pushes back.
        velocityRef.current -= GAME_CONFIG.gravity * dt;
        if (velocityRef.current < -GAME_CONFIG.maxFallSpeed) {
          velocityRef.current = -GAME_CONFIG.maxFallSpeed;
        }
        altitudeRef.current += velocityRef.current * dt;

        // The ceiling is a hard stop, and it kills the climb rather than
        // letting the plane skate along the top holding velocity it would
        // otherwise cash in the moment it dropped away from the roof.
        if (altitudeRef.current > GAME_CONFIG.maxAltitude) {
          altitudeRef.current = GAME_CONFIG.maxAltitude;
          if (velocityRef.current > 0) velocityRef.current = 0;
        }

        // ── Touchdown ──
        // Checked before the sea, and only while descending: a plane climbing
        // up through a deck is passing it, not landing on it. `prevBottom`
        // makes this a *crossing* test rather than a proximity one, so a fast
        // descent cannot tunnel between two frames.
        if (velocityRef.current <= 0) {
          const bottom = altitudeRef.current - halfHeight;
          const prevBottom = bottom - velocityRef.current * dt;
          for (const platform of platformsRef.current) {
            if (platform.used) continue;
            if (Math.abs(platform.x - distanceRef.current) > GAME_CONFIG.platformHalfWidth) {
              continue;
            }
            const deck = platform.deckAltitude;
            const crossed = prevBottom >= deck && bottom <= deck + GAME_CONFIG.touchdownBand;
            if (!crossed) continue;

            // Clean landing: stop dead on the deck and bank the round.
            platform.used = true;
            landingOnRef.current = platform;
            altitudeRef.current = deck + halfHeight;
            velocityRef.current = 0;
            landingStartedRef.current = now;
            landingFromRef.current = distanceRef.current;
            burst(planeX, altToY(deck), 14, 130);
            floatersRef.current.push({
              x: planeX,
              y: altToY(deck) - 46,
              life: 0,
              maxLife: 1.4,
              text: 'TOUCHDOWN',
              sub: `${formatMultiplier(multiplierRef.current)} banked`,
            });
            setPhaseBoth('LANDING');
            break;
          }
        }

        // ── Water impact ──
        // The one way to lose. Bigger than a bomb hit on purpose: this ends
        // the round, so it gets a full splash, a long shake and a call-out.
        if (altitudeRef.current <= 0) {
          altitudeRef.current = 0;
          velocityRef.current = 0;
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
            sub: 'Round over',
          });
          settleRef.current(false);
        }
      }

      if (landing && landingStartedRef.current !== null) {
        const t = Math.min(1, (now - landingStartedRef.current) / GAME_CONFIG.landingMs);
        const eased = 1 - Math.pow(1 - t, 3);
        const deck = landingOnRef.current;
        if (deck) {
          // Roll forward along the deck and stop, rather than freezing mid-air
          // the instant the wheels touch.
          const rollout = Math.min(GAME_CONFIG.platformHalfWidth * 0.8, 70);
          distanceRef.current = landingFromRef.current + rollout * eased;
          altitudeRef.current = deck.deckAltitude + halfHeight;
        }
        velocityRef.current = 0;
        // Settles as a WIN, which credits the multiplier automatically. There
        // is no button in this path — landing is the cashout.
        if (t >= 1) settleRef.current(true);
      }

      const distance = distanceRef.current;
      const altitude = altitudeRef.current;

      // ── Spawning ──
      if (flying) {
        // Pickups sit ahead of the plane at a readable altitude spread.
        while (distance + 700 > nextPickupAtRef.current) {
          const spec = rollPickup();
          nextPickupAtRef.current += 90 + Math.random() * 120;
          pickupsRef.current.push({
            x: nextPickupAtRef.current,
            y: 90 + Math.random() * (GAME_CONFIG.maxAltitude - 200),
            spec,
            taken: false,
            age: 0,
          });
        }

        // Bombs. Placed at a *random* altitude rather than near the plane:
        // they are a minefield to be flown around, not a weapon aimed at
        // anyone. Density rises with distance, which is the reason not to fly
        // forever now that the deck is the only exit.
        while (distance + 900 > nextBombAtRef.current) {
          const pressure = Math.min(1, distance / 4200);
          nextBombAtRef.current += 260 - pressure * 130 + Math.random() * 170;
          bombsRef.current.push({
            x: nextBombAtRef.current,
            y: 70 + Math.random() * (GAME_CONFIG.maxAltitude - 140),
            drift: (Math.random() * 2 - 1) * 9,
            phase: Math.random() * Math.PI * 2,
            spent: false,
          });
        }

        // Landing decks at fixed milestones, at a readable spread of heights.
        while (distance + 1400 > nextPlatformAtRef.current) {
          platformsRef.current.push({
            x: nextPlatformAtRef.current,
            deckAltitude: 150 + Math.random() * 420,
            used: false,
          });
          nextPlatformAtRef.current += GAME_CONFIG.platformSpacing;
        }
      }

      // ── Movement and collisions ──
      const planeHitR = 34; // metres — pickups keep the older radial test
      const halfW = GAME_CONFIG.planeHalfWidth;
      const halfH = GAME_CONFIG.planeHalfHeight;

      // Bombs drift gently and reverse at the ends of the column. Nothing here
      // steers toward the plane.
      for (const bomb of bombsRef.current) {
        if (flying) {
          bomb.phase += dt;
          bomb.y += bomb.drift * dt;
          if (bomb.y < 60 || bomb.y > GAME_CONFIG.maxAltitude - 60) bomb.drift *= -1;
        }
        if (bomb.spent || !flying) continue;

        // Box-on-box. The bomb is a disc, so its half-extent is its radius in
        // both axes; damage fires only on a true overlap of the two boxes.
        const bombHalf = 26;
        const hit =
          Math.abs(bomb.x - distance) < halfW + bombHalf &&
          Math.abs(bomb.y - altitude) < halfH + bombHalf;
        if (!hit) continue;

        bomb.spent = true;
        const before = multiplierRef.current;
        multiplierRef.current = Math.max(1, before * BOMB_MULTIPLIER_PENALTY);
        registerHit(planeX, altToY(altitude), before - multiplierRef.current);
      }
      bombsRef.current = bombsRef.current.filter((b) => b.x > distance - 220);

      for (const pickup of pickupsRef.current) {
        if (pickup.taken) {
          pickup.age += dt;
          continue;
        }
        if (
          flying &&
          Math.abs(pickup.x - distance) < planeHitR &&
          Math.abs(pickup.y - altitude) < planeHitR
        ) {
          pickup.taken = true;
          multiplierRef.current = pickup.spec.apply(multiplierRef.current);
          burst(planeX, altToY(pickup.y), 12, pickup.spec.hazard ? 0 : 130);
        }
      }
      pickupsRef.current = pickupsRef.current.filter(
        (p) => p.x > distance - 150 && p.age < 0.5
      );

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

      // Launch carrier, scrolling away behind the plane
      const launchDeckX = planeX - distance * pxPerMetre - width * 0.14;
      if (launchDeckX > -width * 0.6) {
        drawCarrier(ctx, launchDeckX, altToY(GAME_CONFIG.deckAltitude), seaY, width * 0.42, '#e0b055');
      }

      // Landing decks, at their real world positions — the same x the
      // touchdown test uses, so what is drawn is what can be landed on.
      for (const platform of platformsRef.current) {
        const x = planeX + (platform.x - distance) * pxPerMetre;
        const halfPx = GAME_CONFIG.platformHalfWidth * pxPerMetre;
        if (x + halfPx < -40 || x - halfPx > width + 40) continue;
        drawPlatform(ctx, x, altToY(platform.deckAltitude), halfPx, platform.used);
      }

      // Pickups
      for (const pickup of pickupsRef.current) {
        const x = planeX + (pickup.x - distance) * pxPerMetre;
        if (x < -60 || x > width + 60) continue;
        drawPickup(ctx, x, altToY(pickup.y), scale * 2.1, pickup.spec, pickup.age);
      }

      // Bombs
      for (const bomb of bombsRef.current) {
        if (bomb.spent) continue;
        const x = planeX + (bomb.x - distance) * pxPerMetre;
        if (x < -60 || x > width + 60) continue;
        drawBomb(ctx, x, altToY(bomb.y), scale, bomb.phase);
      }

      // Plane — banked by what the player is asking for, so input reads visually
      if (phaseNow !== 'CRASHED' || particlesRef.current.length > 0) {
        // Banked by the steer actually applied, so pointer and keyboard pitch
        // the airframe identically.
        // ── Pitch ──
        // Nose follows the velocity, clamped either side and eased toward the
        // target rather than snapped to it: a jump reverses velocity in one
        // frame, and pinning the sprite straight to that reads as a flick
        // rather than a plane pulling up.
        const v = velocityRef.current;
        const targetPitch = landing
          ? -0.22
          : v >= 0
            ? -Math.min(GAME_CONFIG.maxPitchUp, (v / GAME_CONFIG.jumpImpulse) * GAME_CONFIG.maxPitchUp)
            : Math.min(
                GAME_CONFIG.maxPitchDown,
                (-v / GAME_CONFIG.maxFallSpeed) * GAME_CONFIG.maxPitchDown
              );
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

      // Damage call-outs, rising and fading above the plane.
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
        ctx.fillStyle = '#ef4444';
        ctx.fillText(floater.text, floater.x, floater.y - rise);

        ctx.font = `800 ${scale * 1.5}px ui-sans-serif, system-ui, sans-serif`;
        ctx.strokeText(floater.sub, floater.x, floater.y - rise + scale * 2);
        ctx.fillStyle = '#d69199';
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
    [burst, emitSmoke, registerHit]
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
    setBet(formatDecimalString(ceiling, 2));
  };

  return (
    <div className="avia">
      {/* ---------- Stage ---------- */}
      <div className="avia__stage">
        {/* Steering surface. Pointer events are the primary control; the
            keyboard and the two buttons below remain as alternatives. */}
        <canvas
          ref={canvasRef}
          className="avia__canvas"
          onPointerDown={onCanvasPointerDown}
          role="application"
          aria-label="Flight area — tap anywhere to jump"
        />

        <div className="avia__hud" aria-live="off">
          <div className="avia__tile">
            <span className="avia__tile-label">Altitude</span>
            <span className="avia__tile-value">{formatMetres(hud.altitude)}</span>
          </div>
          <div className="avia__tile">
            <span className="avia__tile-label">Distance</span>
            <span className="avia__tile-value">{formatMetres(hud.distance)}</span>
          </div>
          <div className="avia__tile avia__tile--mult">
            <span className="avia__tile-label">Multiplier</span>
            <span className="avia__tile-value">{formatMultiplier(hud.multiplier)}</span>
          </div>
          <div className="avia__tile avia__tile--payout">
            <span className="avia__tile-label">Payout</span>
            <span className="avia__tile-value">${formatDecimalString(payout, 2)}</span>
          </div>
        </div>

        {isOver && settled && (
          <div
            className={`avia__banner ${
              phase === 'LANDED' ? 'avia__banner--won' : 'avia__banner--lost'
            }`}
            role="status"
          >
            {phase === 'LANDED' ? (
              <>
                Landed at {formatMultiplier(settled.multiplier)}
                <small>+${formatDecimalString(settled.payout, 2)} (practice)</small>
              </>
            ) : (
              <>
                Ditched in the sea
                <small>Stake lost — practice round</small>
              </>
            )}
          </div>
        )}

        <p className="avia__hint">
          {isFlying
            ? 'Tap anywhere (or Space) to jump · land on a deck to cash out'
            : 'Tap the board or press Space to launch'}
        </p>
      </div>

      {/* ---------- Panel ---------- */}
      <div className="avia__panel">
        <div>
          <div className="avia__label">
            <span>Bet amount</span>
            <b>
              {balance.hasSynced ? `${balance.formatted} ${balance.currency}` : '—'}
            </b>
          </div>
          <div className="avia__inputs">
            <input
              className="avia__input"
              inputMode="decimal"
              value={bet}
              disabled={isFlying || isLanding}
              aria-invalid={betError !== null}
              aria-label="Bet amount"
              onChange={(event) => setBet(sanitizeDecimalInput(event.target.value))}
            />
            <button
              type="button"
              className="avia__mod"
              disabled={isFlying || isLanding}
              aria-label="Halve bet amount"
              onClick={() => scaleBet(0.5)}
            >
              ½
            </button>
            <button
              type="button"
              className="avia__mod"
              disabled={isFlying || isLanding}
              aria-label="Double bet amount"
              onClick={() => scaleBet(2)}
            >
              2x
            </button>
            <button
              type="button"
              className="avia__mod"
              disabled={isFlying || isLanding}
              aria-label="Bet maximum"
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

        {!isFlying && !isLanding && betError && <p className="avia__error">{betError}</p>}

        {isFlying || isLanding ? (
          // Not a button. Cashing out is landing on a deck, and a control that
          // banked the round from the panel would make the platforms pointless.
          <div className="avia__standing" role="status">
            <span>{isLanding ? 'Touchdown — banking' : 'In flight'}</span>
            <b>
              {formatMultiplier(hud.multiplier)} · ${formatDecimalString(payout, 2)}
            </b>
            <small>
              {isLanding ? 'Cashing out automatically' : 'Land on a deck to bank it'}
            </small>
          </div>
        ) : (
          <button
            type="button"
            className="avia__action"
            onClick={launch}
            disabled={betError !== null}
          >
            {isOver ? 'Fly again' : 'Fly'}
          </button>
        )}

        <p className="avia__note">
          Practice board. Outcomes are rolled in your browser and no balance
          moves — this table cannot be played for real stakes until a server
          engine settles it.
        </p>
      </div>
    </div>
  );
}
