/**
 * Slot machine — symbol palette and reel drawing.
 *
 * `makeStrip` and `decorativeSymbol` build the blur the player sees *while* the
 * reels are moving; they are deliberately random and deliberately never
 * consulted for a result, which comes from the server.
 */

import { SLOTS_SYMBOLS, SLOTS_WEIGHTS, type SlotSymbol } from '@frigat/shared';

import { STRIP_LENGTH } from './choreography';

// ─────────────────────────────────────────────
// Symbols
// ─────────────────────────────────────────────

export const SYMBOL_COLOURS: Record<SlotSymbol, { body: string; edge: string; glow: string }> = {
  CHERRY: { body: '#e5484d', edge: '#7f1d1d', glow: '#d69199' },
  LEMON: { body: '#e0b055', edge: '#854d0e', glow: '#fde68a' },
  ORANGE: { body: '#fb923c', edge: '#7c2d12', glow: '#fed7aa' },
  PLUM: { body: '#a855f7', edge: '#4c1d95', glow: '#e9d5ff' },
  BELL: { body: '#fbbf24', edge: '#78350f', glow: '#fef3c7' },
  BAR: { body: '#e2e8f0', edge: '#1e293b', glow: '#f8fafc' },
  SEVEN: { body: '#ef4444', edge: '#450a0a', glow: '#fecaca' },
  WILD: { body: '#e0b055', edge: '#0b0e14', glow: '#bbf7d0' },
};

export const WEIGHT_TOTAL = SLOTS_SYMBOLS.reduce((sum, s) => sum + SLOTS_WEIGHTS[s], 0);

/**
 * A weighted symbol for the *decorative* strip only. The blur between stops is
 * cosmetic — the symbols that matter arrive from the server — but drawing them
 * from the real weights keeps a spin from looking unlike its own paytable.
 */
export function decorativeSymbol(): SlotSymbol {
  let roll = Math.random() * WEIGHT_TOTAL;
  for (const symbol of SLOTS_SYMBOLS) {
    roll -= SLOTS_WEIGHTS[symbol];
    if (roll <= 0) return symbol;
  }
  return SLOTS_SYMBOLS[SLOTS_SYMBOLS.length - 1];
}

export function makeStrip(): SlotSymbol[] {
  return Array.from({ length: STRIP_LENGTH }, decorativeSymbol);
}

/** Rounded rectangle path — the plate every symbol is drawn on. */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Draws one symbol centred in a cell. Everything is derived from `size` so the
 * board scales cleanly from a phone to a desktop without a second asset set.
 */
export function drawSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: SlotSymbol,
  cx: number,
  cy: number,
  size: number,
  alpha = 1
) {
  const palette = SYMBOL_COLOURS[symbol];
  const r = size * 0.3;

  ctx.save();
  ctx.globalAlpha = alpha;

  switch (symbol) {
    case 'CHERRY': {
      ctx.strokeStyle = '#166534';
      ctx.lineWidth = Math.max(2, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.02, cy - size * 0.34);
      ctx.quadraticCurveTo(cx - size * 0.22, cy - size * 0.1, cx - size * 0.17, cy + size * 0.08);
      ctx.moveTo(cx + size * 0.02, cy - size * 0.34);
      ctx.quadraticCurveTo(cx + size * 0.26, cy - size * 0.06, cx + size * 0.18, cy + size * 0.1);
      ctx.stroke();
      for (const [dx, dy, rr] of [
        [-0.17, 0.19, 0.15],
        [0.18, 0.21, 0.15],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + size * dx, cy + size * dy, size * rr, 0, Math.PI * 2);
        ctx.fillStyle = palette.body;
        ctx.fill();
        ctx.strokeStyle = palette.edge;
        ctx.lineWidth = Math.max(1.5, size * 0.03);
        ctx.stroke();
      }
      break;
    }
    case 'LEMON':
    case 'ORANGE':
    case 'PLUM': {
      ctx.beginPath();
      if (symbol === 'LEMON') {
        ctx.ellipse(cx, cy, r * 1.15, r * 0.82, 0, 0, Math.PI * 2);
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = palette.body;
      ctx.fill();
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = Math.max(2, size * 0.035);
      ctx.stroke();
      // Highlight, so the fruit reads as round rather than flat.
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.45)';
      ctx.fill();
      if (symbol !== 'LEMON') {
        ctx.strokeStyle = '#166534';
        ctx.lineWidth = Math.max(2, size * 0.04);
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + size * 0.04, cy - r - size * 0.1);
        ctx.stroke();
      }
      break;
    }
    case 'BELL': {
      ctx.beginPath();
      ctx.moveTo(cx - r, cy + r * 0.62);
      ctx.quadraticCurveTo(cx - r * 0.92, cy - r * 0.5, cx, cy - r * 0.95);
      ctx.quadraticCurveTo(cx + r * 0.92, cy - r * 0.5, cx + r, cy + r * 0.62);
      ctx.closePath();
      ctx.fillStyle = palette.body;
      ctx.fill();
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = Math.max(2, size * 0.035);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.78, r * 0.19, 0, Math.PI * 2);
      ctx.fillStyle = palette.edge;
      ctx.fill();
      break;
    }
    case 'BAR': {
      const w = size * 0.62;
      const h = size * 0.22;
      for (let i = -1; i <= 1; i += 1) {
        roundRect(ctx, cx - w / 2, cy + i * h * 1.22 - h / 2, w, h, h * 0.35);
        ctx.fillStyle = palette.body;
        ctx.fill();
        ctx.strokeStyle = palette.edge;
        ctx.lineWidth = Math.max(1.5, size * 0.025);
        ctx.stroke();
      }
      ctx.fillStyle = palette.edge;
      ctx.font = `800 ${size * 0.15}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BAR', cx, cy + size * 0.005);
      break;
    }
    case 'SEVEN': {
      ctx.fillStyle = palette.body;
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = Math.max(2, size * 0.04);
      ctx.font = `900 ${size * 0.74}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('7', cx, cy + size * 0.02);
      ctx.strokeText('7', cx, cy + size * 0.02);
      break;
    }
    case 'WILD': {
      // Five-pointed star: unmistakable at a glance, which matters for the
      // symbol that substitutes for every other one.
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const radius = i % 2 === 0 ? r * 1.12 : r * 0.46;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = palette.body;
      ctx.fill();
      ctx.strokeStyle = palette.edge;
      ctx.lineWidth = Math.max(2, size * 0.035);
      ctx.stroke();
      ctx.fillStyle = palette.edge;
      ctx.font = `900 ${size * 0.17}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('W', cx, cy + size * 0.01);
      break;
    }
  }

  ctx.restore();
}

/** Overshoot easing — the reel passes its stop and springs back onto it. */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export const NEON = ['#e0b055', '#22d3ee', '#a855f7', '#e0b055', '#fb7185'];

