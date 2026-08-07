'use client';

/**
 * FRIGAT — SVG sprite → canvas image
 *
 * Decodes a data: URI into an HTMLImageElement once, so a render loop can
 * `drawImage` it every frame without re-parsing the SVG.
 *
 * Returned through a ref rather than state on purpose: the draw callback reads
 * it inside requestAnimationFrame, and a state update per decode would force a
 * React render for something the loop picks up on its next frame anyway.
 */

import { useEffect, useRef } from 'react';

export function useSpriteImage(
  dataUri: string
): React.MutableRefObject<HTMLImageElement | null> {
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    // No window during the server render.
    if (typeof window === 'undefined') return;

    const image = new window.Image();
    let cancelled = false;

    image.onload = () => {
      if (!cancelled) ref.current = image;
    };
    // A sprite that fails to decode leaves the ref null, and the caller falls
    // back to its own drawing rather than rendering nothing.
    image.onerror = () => {
      if (!cancelled) ref.current = null;
    };
    image.src = dataUri;

    return () => {
      cancelled = true;
      ref.current = null;
    };
  }, [dataUri]);

  return ref;
}

export default useSpriteImage;
