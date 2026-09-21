/**
 * Avia Masters — canvas painting.
 *
 * Every function here takes a context and draws. None of them advance the
 * simulation or decide an outcome, which is what keeps the round logic in the
 * component and makes this file safe to tune by eye.
 */

import type { PickupSpec } from './config';

// ─────────────────────────────────────────────
// Painting
// ─────────────────────────────────────────────

/** The red vintage biplane, nose right, banked by its climb rate. */
export function drawPlane(
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

export function roundRect(
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

/**
 * An aircraft carrier seen side-on — the launch deck and the finish deck.
 *
 * `deckY` is the landing line itself: the top edge of the deck surface, where
 * the wheels sit. The deck is drawn *down* from it and the island *up* from it,
 * so every carrier and the finish marker, all drawn from the same baseline
 * altitude, line up to the pixel — whatever their size.
 */
export function drawCarrier(
  ctx: CanvasRenderingContext2D,
  x: number,
  deckY: number,
  seaY: number,
  width: number,
  accent: string
) {
  const deckT = Math.max(3, (seaY - deckY) * 0.08);

  // Hull, from under the deck down into the water.
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(x, deckY + deckT);
  ctx.lineTo(x + width, deckY + deckT);
  ctx.lineTo(x + width * 0.9, seaY + 4);
  ctx.lineTo(x + width * 0.08, seaY + 4);
  ctx.closePath();
  ctx.fill();

  // Deck surface, hanging from the landing line.
  ctx.fillStyle = '#334155';
  ctx.fillRect(x, deckY, width, deckT);

  // Centreline markings.
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1.5, width * 0.008);
  ctx.setLineDash([width * 0.05, width * 0.04]);
  ctx.beginPath();
  ctx.moveTo(x + width * 0.06, deckY + deckT / 2);
  ctx.lineTo(x + width * 0.94, deckY + deckT / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Island superstructure, standing on the deck.
  const islandH = Math.max(10, (seaY - deckY) * 0.5);
  ctx.fillStyle = '#475569';
  roundRect(ctx, x + width * 0.7, deckY - islandH, width * 0.12, islandH, 2);
  ctx.fill();
}

/**
 * Chequered finish flag. Its foot is `deckY` — the same landing line the
 * carriers are drawn from — so it stands on the deck, never above or in it.
 */
export function drawFinishMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  deckY: number,
  scale: number,
  wave: number
) {
  const poleH = scale * 11;
  const flagW = scale * 6;
  const flagH = scale * 4;
  const cells = 4;

  ctx.save();
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(x - scale * 0.25, deckY - poleH, scale * 0.5, poleH);

  // The cloth ripples; the pole and its foot never move.
  const top = deckY - poleH;
  for (let c = 0; c < cells; c += 1) {
    for (let r = 0; r < 3; r += 1) {
      const cx = x + (c * flagW) / cells;
      const ripple = Math.sin(wave * 5 + c * 0.9) * scale * 0.35 * (c / cells);
      ctx.fillStyle = (c + r) % 2 === 0 ? '#f8fafc' : '#0f172a';
      ctx.fillRect(cx, top + (r * flagH) / 3 + ripple, flagW / cells + 0.5, flagH / 3 + 0.5);
    }
  }
  ctx.restore();
}

/** A pickup badge: the label is the whole point, so it leads. */
export function drawPickup(
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

  const fill = spec.hazard ? '#ef4444' : '#e0b055';
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
export function drawBomb(
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
