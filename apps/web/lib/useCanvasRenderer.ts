'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

export interface CanvasFrame {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  delta: number;
}

export interface UseCanvasRendererOptions {
  animate?: boolean;
  maxPixelRatio?: number;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export function useCanvasRenderer(
  draw: (frame: CanvasFrame) => void,
  options: UseCanvasRendererOptions = {}
): RefObject<HTMLCanvasElement> {
  const { animate = true, maxPixelRatio = 2 } = options;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const renderOnceRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let startedAt = 0;
    let previousAt = 0;
    let stopped = false;

    const syncBackingStore = (): { width: number; height: number } | null => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return null;

      const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
      const backingWidth = Math.round(width * ratio);
      const backingHeight = Math.round(height * ratio);
      if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
        canvas.width = backingWidth;
        canvas.height = backingHeight;
      }
      return { width, height };
    };

    const renderFrame = (now: number) => {
      if (stopped) return;
      if (!startedAt) {
        startedAt = now;
        previousAt = now;
      }

      const size = syncBackingStore();
      if (size) {
        const scale = canvas.width / size.width;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        drawRef.current({
          ctx,
          width: size.width,
          height: size.height,
          time: now - startedAt,
          delta: now - previousAt,
        });
      }
      previousAt = now;
    };

    const loop = (now: number) => {
      renderFrame(now);
      if (!stopped && animate) rafId = requestAnimationFrame(loop);
    };

    renderOnceRef.current = () => {
      if (stopped) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(animate ? loop : renderFrame);

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (!animate) renderOnceRef.current?.();
          });
    observer?.observe(canvas);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      observer?.disconnect();
      renderOnceRef.current = null;
    };
  }, [animate, maxPixelRatio]);

  useEffect(() => {
    if (!animate) renderOnceRef.current?.();
  });

  return canvasRef;
}
