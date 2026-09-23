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
  /**
   * Render the frame into an offscreen buffer this many times smaller, then
   * blit it back with smoothing off — every art pixel lands as a hard
   * `pixelSize`-square block. The draw function is untouched: it still works in
   * CSS pixels and still gets the CSS width and height, so board geometry does
   * not change, only the resolution it is resolved at.
   *
   * 1 (the default) turns it off entirely and costs nothing.
   */
  pixelSize?: number;
  /**
   * Posterise each channel to this many steps, applied to the small buffer
   * before it is blitted. A limited palette is half of what makes pixel art
   * read as pixel art — chunky blocks in a smooth 24-bit gradient still look
   * like a photograph someone scaled down. 0 or undefined leaves colour alone.
   */
  colorLevels?: number;
  /**
   * Drawn at full resolution after the pixelated pass. Text is what this is
   * for: a 12px label rendered into a quarter-size buffer comes back as three
   * pixels of mush, and a board whose numbers cannot be read is not a style
   * choice. Ignored when `pixelSize` is 1.
   */
  overlay?: (frame: CanvasFrame) => void;
  /**
   * Cap on the backing-store scale. The backing store is always sized at
   * `min(devicePixelRatio, maxPixelRatio)` so drawing stays crisp on retina and
   * fractional-scaling displays; the cap keeps the fill rate sane on very high
   * ratios. Raise it for boards whose sprites are drawn as vector paths.
   */
  maxPixelRatio?: number;
}

/**
 * Snaps every channel in the buffer to `levels` evenly spaced steps. Done on the
 * small buffer, so it is a few tens of thousands of pixels rather than a few
 * million — cheap enough to run every frame.
 */
function posterise(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  levels: number
): void {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const step = 255 / (levels - 1);
  // A 256-entry lookup beats recomputing the rounding for every subpixel.
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) table[v] = Math.round(Math.round(v / step) * step);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = table[data[i]];
    data[i + 1] = table[data[i + 1]];
    data[i + 2] = table[data[i + 2]];
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(image, 0, 0);
  ctx.restore();
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
  const { animate = true, maxPixelRatio = 2, pixelSize = 1, colorLevels = 0 } = options;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const overlayRef = useRef(options.overlay);
  overlayRef.current = options.overlay;

  /** The low-resolution buffer, kept across frames so it is allocated once. */
  const bufferRef = useRef<HTMLCanvasElement | null>(null);

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
        const frame = {
          width: size.width,
          height: size.height,
          time: now - startedAt,
          delta: now - previousAt,
        };

        if (pixelSize > 1) {
          const buffer = (bufferRef.current ??= document.createElement('canvas'));
          const bw = Math.max(1, Math.ceil(size.width / pixelSize));
          const bh = Math.max(1, Math.ceil(size.height / pixelSize));
          if (buffer.width !== bw || buffer.height !== bh) {
            buffer.width = bw;
            buffer.height = bh;
          }
          const bctx = buffer.getContext('2d', { willReadFrequently: colorLevels > 0 });
          if (bctx) {
            // The buffer is 1/pixelSize the size, so the same transform factor
            // lets the draw function keep working in CSS pixels.
            bctx.setTransform(1 / pixelSize, 0, 0, 1 / pixelSize, 0, 0);
            bctx.imageSmoothingEnabled = false;
            bctx.clearRect(0, 0, size.width, size.height);
            drawRef.current({ ctx: bctx, ...frame });

            if (colorLevels > 1) posterise(bctx, bw, bh, colorLevels);

            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, size.width, size.height);
            ctx.drawImage(buffer, 0, 0, bw, bh, 0, 0, bw * pixelSize, bh * pixelSize);

            // Overlay last and unpixelated — see `overlay` above.
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            overlayRef.current?.({ ctx, ...frame });
          }
        } else {
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          // Draw calls are issued in CSS pixels and resolved at the backing-store
          // resolution; smoothing keeps any bitmap a board blits look clean
          // instead of blocky when the ratio is not a whole number.
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.clearRect(0, 0, size.width, size.height);
          drawRef.current({ ctx, ...frame });
        }
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
  }, [animate, maxPixelRatio, pixelSize, colorLevels]);

  useEffect(() => {
    if (!animate) renderOnceRef.current?.();
  });

  return canvasRef;
}
