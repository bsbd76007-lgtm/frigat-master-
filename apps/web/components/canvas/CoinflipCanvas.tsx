'use client';

import { useEffect, useMemo, useRef } from 'react';

import {
  useCanvasRenderer,
  usePrefersReducedMotion,
  type CanvasFrame,
} from '@/lib/useCanvasRenderer';

import {
  ACCENT,
  BOARD,
  FONT,
  GOLD,
  GOLD_DEEP,
  GOLD_SOFT,
  NEG,
  POS,
  alpha,
  drawBackdrop,
  drawFloorShadow,
  drawVignette,
  floorEllipse,
  makeScene,
  shade,
  type Scene,
} from './three';

export type CoinSide = 'HEADS' | 'TAILS';

export interface CoinFlight {
  /** Changes per round; a new id is what starts the landing. */
  id: string;
  landed: CoinSide;
  win: boolean;
}

export interface CoinflipCanvasProps {
  /** The player's pick — what the resting coin shows before a flip. */
  pick: CoinSide;
  /** True from the moment the bet is sent until the server answers. */
  spinning: boolean;
  /** Set once the round is settled; the coin then falls onto that face. */
  flight: CoinFlight | null;
  /** Called when the coin has come to rest. */
  onLanded?: () => void;
  height?: number;
  className?: string;
}

/** Degrees a second while the result is still in the air. */
const SPIN_RATE = 900;
const LAND_MS = 1150;
const MIN_LANDING_TURNS = 3;
const COIN_THICKNESS = 9;

export function CoinflipCanvas({
  pick,
  spinning,
  flight,
  onLanded,
  height = 340,
  className,
}: CoinflipCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  /**
   * The coin's tumble, in degrees from "heads face up". Kept in a ref because
   * it has to survive across rounds: a landing starts from wherever the free
   * spin left the coin, which is what stops the coin snapping before it falls.
   */
  const thetaRef = useRef(0);
  const lastFrameRef = useRef<number | null>(null);
  const landingRef = useRef<{
    id: string;
    from: number;
    to: number;
    startedAt: number;
    done: boolean;
  } | null>(null);
  const onLandedRef = useRef(onLanded);
  onLandedRef.current = onLanded;

  useEffect(() => {
    if (!flight) {
      landingRef.current = null;
      return;
    }
    if (landingRef.current?.id === flight.id) return;
    const from = thetaRef.current;
    // Land on the face the server rolled: heads is an even half-turn, tails an
    // odd one. Round up past a few more turns so it always falls forward.
    const parity = flight.landed === 'HEADS' ? 0 : 180;
    const floor = from + MIN_LANDING_TURNS * 360;
    const to = parity + 360 * Math.ceil((floor - parity) / 360);
    landingRef.current = { id: flight.id, from, to, startedAt: performance.now(), done: false };
  }, [flight]);

  useEffect(() => {
    if (!spinning && !flight) {
      // Back to rest between rounds: the resting coin shows the player's pick.
      landingRef.current = null;
      thetaRef.current = pick === 'HEADS' ? 0 : 180;
    }
  }, [spinning, flight, pick]);

  const draw = useMemo(
    () =>
      ({ ctx, width, height: h, delta }: CanvasFrame) => {
        const scene = makeScene(width, h, { top: 0.22, bottom: 0.92, focus: 0.6, far: 2.6 });

        const landing = landingRef.current;
        const now = performance.now();
        const step = lastFrameRef.current === null ? 0 : Math.min(delta, 64);
        lastFrameRef.current = now;

        const x = width / 2;
        const y = 0.6;
        const radius = Math.min(width * 0.17, h * 0.23);
        const hover = h * 0.3;

        let z = 0;
        let settled = false;

        if (landing) {
          const t = reducedMotion ? 1 : Math.min(1, (now - landing.startedAt) / LAND_MS);
          const eased = 1 - Math.pow(1 - t, 3);
          thetaRef.current = landing.from + (landing.to - landing.from) * eased;
          // One last arc up and down, with a short bounce as it touches.
          const arc = Math.sin(Math.min(1, t) * Math.PI) * hover;
          const bounce = t > 0.86 ? Math.abs(Math.sin((t - 0.86) * 18)) * (1 - t) * hover * 0.9 : 0;
          z = arc + bounce;
          if (t >= 1) {
            settled = true;
            z = 0;
            thetaRef.current = landing.to;
            if (!landing.done) {
              landing.done = true;
              onLandedRef.current?.();
            }
          }
        } else if (spinning && !reducedMotion) {
          thetaRef.current += (SPIN_RATE * step) / 1000;
          z = hover + Math.sin(now / 320) * h * 0.02;
        } else if (spinning) {
          z = hover;
        }

        const win = settled && flight ? flight.win : null;
        drawBackdrop(ctx, scene, {
          glow: win === null ? ACCENT : win ? POS : NEG,
          glowStrength: settled ? 0.15 : 0.09,
        });

        // The coin's plinth, so a landed coin has something to land on.
        const pad = floorEllipse(scene, x, y, radius * 1.7);
        ctx.beginPath();
        ctx.ellipse(pad.cx, pad.cy, pad.rx, pad.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = shade(BOARD.floor, 0.06);
        ctx.fill();
        ctx.strokeStyle = BOARD.line2;
        ctx.lineWidth = 1;
        ctx.stroke();

        drawFloorShadow(ctx, scene, x, y, radius * (z > 1 ? 0.8 : 1), z, z > 1 ? 0.7 : 1);
        drawCoin(ctx, scene, x, y, z, radius, thetaRef.current);

        const caption = settled && flight ? flight.landed : spinning ? null : pick;
        if (caption) {
          const at = scene.project(x, y + 0.26, 0);
          ctx.fillStyle = settled ? (win ? POS : NEG) : BOARD.muted;
          ctx.font = `800 12px ${FONT.body}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(settled ? `LANDED ${caption}` : `YOUR PICK · ${caption}`, at.x, at.y);
        }

        drawVignette(ctx, scene);
      },
    [pick, spinning, flight, reducedMotion]
  );

  const canvasRef = useCanvasRenderer(draw);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: '100%', height, borderRadius: 12 }}
      role="img"
      aria-label={
        flight
          ? `Coin landed ${flight.landed}`
          : spinning
            ? 'Coin flipping'
            : `Coin resting on ${pick}`
      }
    />
  );
}

/**
 * The coin, tumbling about an axis across the screen.
 *
 * A disc seen at an angle is an ellipse, and the vertical radius is the whole
 * illusion: it runs from a full circle when the coin is edge-on to the camera
 * down to the floor's own foreshortening when the coin lies flat. `theta` is
 * measured from "heads face up", so which face the player sees is just the sign
 * of its cosine — the same number that decides where the coin comes to rest.
 */
function drawCoin(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  x: number,
  y: number,
  z: number,
  radius: number,
  theta: number
): void {
  const radians = (theta * Math.PI) / 180;
  const facing = Math.cos(radians);
  const edgeOn = Math.abs(Math.sin(radians));

  const centre = scene.project(x, y, z + COIN_THICKNESS / 2);
  const s = scene.scale(y);
  const rx = radius * s;
  const flat = floorEllipse(scene, x, y, radius);
  const flatRatio = flat.rx > 0 ? flat.ry / flat.rx : 0.34;
  const ry = Math.max(1, rx * (flatRatio * Math.abs(facing) + edgeOn));
  const edgeH = COIN_THICKNESS * s * Math.abs(facing);

  // Rim first: the same ellipse dropped by the coin's thickness, plus the band
  // between the two — that band is the only thing that says "this has depth".
  if (edgeH > 0.5) {
    ctx.beginPath();
    ctx.ellipse(centre.x, centre.y + edgeH, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = shade(GOLD_DEEP, -0.25);
    ctx.fill();
    ctx.fillStyle = shade(GOLD_DEEP, -0.1);
    ctx.fillRect(centre.x - rx, centre.y, rx * 2, edgeH);
  }

  const face = ctx.createLinearGradient(
    centre.x - rx * 0.6,
    centre.y - ry,
    centre.x + rx * 0.7,
    centre.y + ry
  );
  face.addColorStop(0, GOLD_SOFT);
  face.addColorStop(0.5, GOLD);
  face.addColorStop(1, GOLD_DEEP);
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.strokeStyle = alpha(GOLD_SOFT, 0.7);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Milled edge and the letter, both squashed with the coin so they sit in its
  // plane rather than floating in front of it.
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.scale(1, Math.max(0.02, ry / rx));
  ctx.beginPath();
  ctx.arc(0, 0, rx * 0.82, 0, Math.PI * 2);
  ctx.strokeStyle = alpha(GOLD_DEEP, 0.55);
  ctx.lineWidth = Math.max(1, rx * 0.05);
  ctx.stroke();

  const label = facing >= 0 ? 'H' : 'T';
  ctx.fillStyle = '#3a2a08';
  ctx.font = `800 ${rx * 0.95}px ${FONT.display}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, rx * 0.04);
  ctx.restore();
}

export default CoinflipCanvas;
