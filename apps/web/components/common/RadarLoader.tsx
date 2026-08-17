'use client';

/**
 * FRIGAT — Radar loader.
 *
 * Replaces the rotating-border spinner on waiting states: a sweeping radar
 * beam with range rings and contacts that light as the beam crosses them.
 *
 * Canvas rather than CSS. A sweep needs a *gradient that rotates with the
 * beam* and contacts whose brightness depends on the angle between them and
 * that beam — expressible in CSS only as a stack of conic gradients and one
 * keyframe per blip, which is a lot of paint for something that has to run
 * while the page is busy doing the thing you are waiting for.
 *
 * It respects `prefers-reduced-motion`: the beam parks and the contacts hold
 * steady rather than pulsing.
 */

import { useCallback, useMemo, useRef } from 'react';

import { useCanvasRenderer, type CanvasFrame } from '@/lib/useCanvasRenderer';

export interface RadarLoaderProps {
  /** Rendered size in CSS pixels. */
  size?: number;
  /** Sweeps per second. */
  speed?: number;
  label?: string;
}

interface Contact {
  /** Angle around the dish, in radians. */
  angle: number;
  /** Distance from centre, 0..1. */
  radius: number;
  size: number;
}

const ACCENT = '245, 158, 11';

export function RadarLoader({ size = 96, speed = 0.55, label }: RadarLoaderProps) {
  const beamRef = useRef(0);

  // Fixed at mount: contacts that reshuffled every frame would read as noise
  // rather than as objects the beam is finding.
  const contacts = useMemo<Contact[]>(
    () =>
      Array.from({ length: 5 }, () => ({
        angle: Math.random() * Math.PI * 2,
        radius: 0.32 + Math.random() * 0.5,
        size: 1.6 + Math.random() * 1.8,
      })),
    []
  );

  const draw = useCallback(
    ({ ctx, width, height, delta }: CanvasFrame) => {
      const reduced =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const cx = width / 2;
      const cy = height / 2;
      const r = Math.min(width, height) / 2 - 2;

      if (!reduced) beamRef.current += (delta / 1000) * speed * Math.PI * 2;
      const beam = beamRef.current;

      ctx.clearRect(0, 0, width, height);

      // Dish
      ctx.fillStyle = `rgba(${ACCENT}, .05)`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Range rings and cross-hairs
      ctx.strokeStyle = `rgba(${ACCENT}, .22)`;
      ctx.lineWidth = 1;
      for (const ring of [0.34, 0.67, 1]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r * ring, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();

      // The sweep: a wedge trailing behind the beam, fading with angle.
      const TRAIL = Math.PI * 0.75;
      const sweep = ctx.createConicGradient
        ? ctx.createConicGradient(beam - TRAIL, cx, cy)
        : null;
      if (sweep) {
        sweep.addColorStop(0, `rgba(${ACCENT}, 0)`);
        sweep.addColorStop(TRAIL / (Math.PI * 2), `rgba(${ACCENT}, .34)`);
        sweep.addColorStop(TRAIL / (Math.PI * 2) + 0.001, `rgba(${ACCENT}, 0)`);
        sweep.addColorStop(1, `rgba(${ACCENT}, 0)`);
        ctx.fillStyle = sweep;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Leading edge
      ctx.strokeStyle = `rgba(${ACCENT}, .9)`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(beam) * r, cy + Math.sin(beam) * r);
      ctx.stroke();

      // Contacts. Brightness is how recently the beam passed, so they flare as
      // it crosses and decay behind it.
      for (const contact of contacts) {
        let since = (beam - contact.angle) % (Math.PI * 2);
        if (since < 0) since += Math.PI * 2;
        const glow = reduced ? 0.5 : Math.max(0, 1 - since / (Math.PI * 1.1));
        if (glow <= 0.02) continue;
        const x = cx + Math.cos(contact.angle) * r * contact.radius;
        const y = cy + Math.sin(contact.angle) * r * contact.radius;
        ctx.fillStyle = `rgba(${ACCENT}, ${0.85 * glow})`;
        ctx.beginPath();
        ctx.arc(x, y, contact.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${ACCENT}, ${0.16 * glow})`;
        ctx.beginPath();
        ctx.arc(x, y, contact.size * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Hub
      ctx.fillStyle = `rgba(${ACCENT}, .95)`;
      ctx.beginPath();
      ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    },
    [contacts, speed]
  );

  const canvasRef = useCanvasRenderer(draw, { maxPixelRatio: 3 });

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: 'block' }}
      role="progressbar"
      aria-busy="true"
      aria-label={label ?? 'Loading'}
    />
  );
}

export default RadarLoader;
